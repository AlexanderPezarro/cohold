import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { IStorageService, FileMetadata, SaveFileResult } from './IStorageService.js';
import {
  StorageError,
  FileSizeError,
  InvalidFileTypeError,
  PathTraversalError,
  FileNotFoundError,
} from './errors.js';
import { storageConfig } from '../../config/storage.js';

/**
 * Local filesystem storage implementation
 */
export class LocalStorageService implements IStorageService {
  private readonly uploadDir: string;
  private readonly encryptionKey: Buffer;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir || storageConfig.uploadDir;

    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
      throw new Error(
        'ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32'
      );
    }
    this.encryptionKey = Buffer.from(keyHex, 'hex');
  }

  private encrypt(plaintext: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  private decrypt(encrypted: Buffer): Buffer {
    const iv = encrypted.subarray(0, 12);
    const authTag = encrypted.subarray(12, 28);
    const ciphertext = encrypted.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Validate file size
   */
  private validateFileSize(size: number): void {
    if (size > storageConfig.maxFileSize) {
      throw new FileSizeError(
        `File size ${size} bytes exceeds maximum allowed size of ${storageConfig.maxFileSize} bytes`
      );
    }
  }

  /**
   * Validate MIME type
   */
  private validateMimeType(mimeType: string): void {
    if (!storageConfig.allowedMimeTypes.includes(mimeType as any)) {
      throw new InvalidFileTypeError(
        `MIME type '${mimeType}' is not allowed. Allowed types: ${storageConfig.allowedMimeTypes.join(', ')}`
      );
    }
  }

  /**
   * Validate path for traversal attempts
   */
  private validatePath(filePath: string): void {
    // Normalize the path
    const normalized = path.normalize(filePath);

    // Check for path traversal patterns
    if (
      normalized.includes('..') ||
      normalized.startsWith('/') ||
      normalized.startsWith('\\') ||
      path.isAbsolute(normalized)
    ) {
      throw new PathTraversalError(
        'Path traversal detected in filename or path'
      );
    }
  }

  /**
   * Generate unique filename with timestamp and random string
   */
  private generateUniqueFilename(originalFilename: string): string {
    // Extract extension
    const ext = path.extname(originalFilename);

    // Validate the original filename for path traversal
    this.validatePath(originalFilename);

    // Generate unique filename: timestamp + random + extension
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');

    return `${timestamp}-${random}${ext}`;
  }

  /**
   * Get directory path for current date (YYYY/MM)
   */
  private getDatePath(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    return `${year}/${month}`;
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  /**
   * Save a file to local storage
   */
  async saveFile(file: Buffer, metadata: FileMetadata): Promise<SaveFileResult> {
    // Validate file size
    this.validateFileSize(metadata.size);

    // Validate MIME type
    this.validateMimeType(metadata.mimeType);

    // Validate filename for path traversal
    this.validatePath(metadata.originalFilename);

    // Generate unique filename
    const filename = this.generateUniqueFilename(metadata.originalFilename);

    // Get date-based subdirectory
    const datePath = this.getDatePath();

    // Construct full directory path
    const fullDirPath = path.join(this.uploadDir, datePath);

    // Ensure directory exists
    await this.ensureDirectory(fullDirPath);

    // Construct file path
    const filePath = `${datePath}/${filename}`;
    const fullFilePath = path.join(this.uploadDir, filePath);

    // Write file (encrypted)
    await fs.writeFile(fullFilePath, this.encrypt(file));

    // Return result
    return {
      filePath,
      filename,
      url: this.getFileUrl(filePath),
    };
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(filePath: string): Promise<void> {
    // Validate path for traversal
    this.validatePath(filePath);

    // Construct full file path
    const fullFilePath = path.join(this.uploadDir, filePath);

    // Delete file (ignore if doesn't exist)
    try {
      await fs.unlink(fullFilePath);
    } catch (error: any) {
      // Ignore ENOENT (file not found) errors
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get URL for a file
   */
  getFileUrl(filePath: string): string {
    // Validate path for traversal
    this.validatePath(filePath);

    // Return URL with /uploads prefix
    return `/uploads/${filePath}`;
  }

  /**
   * Get a readable stream of the file's contents
   */
  async getFileStream(filePath: string): Promise<Readable> {
    this.validatePath(filePath);

    const fullFilePath = path.join(this.uploadDir, filePath);

    try {
      const encrypted = await fs.readFile(fullFilePath);
      if (encrypted.length < 28) {
        throw new StorageError(
          `Encrypted file is too small to be valid (${encrypted.length} bytes): ${filePath}`,
          500,
          'STORAGE_CORRUPTED'
        );
      }
      const plaintext = this.decrypt(encrypted);
      return Readable.from(plaintext);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(`File not found: ${filePath}`);
      }
      throw error;
    }
  }
}
