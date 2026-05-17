import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { LocalStorageService } from '../../../services/storage/LocalStorageService.js';
import {
  FileSizeError,
  InvalidFileTypeError,
  PathTraversalError,
  FileNotFoundError,
} from '../../../services/storage/errors.js';

describe('LocalStorageService', () => {
  let storageService: LocalStorageService;
  const testUploadDir = 'test-uploads';
  const testFile = Buffer.from('test file content');

  beforeEach(() => {
    storageService = new LocalStorageService(testUploadDir);
  });

  afterEach(async () => {
    // Clean up test uploads directory
    try {
      await fs.rm(testUploadDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }
  });

  describe('saveFile', () => {
    it('should save a file successfully with valid metadata', async () => {
      const metadata = {
        originalFilename: 'test.jpg',
        mimeType: 'image/jpeg',
        size: testFile.length,
      };

      const result = await storageService.saveFile(testFile, metadata);

      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('url');
      expect(result.filename).toContain('.jpg');
      expect(result.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/.+\.jpg$/);

      // Verify file was actually created
      const fullPath = path.join(testUploadDir, result.filePath);
      const fileExists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

    });

    it('should organize files by year and month', async () => {
      const metadata = {
        originalFilename: 'test.png',
        mimeType: 'image/png',
        size: testFile.length,
      };

      const result = await storageService.saveFile(testFile, metadata);

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      expect(result.filePath).toContain(`${year}/${month}`);
    });

    it('should generate unique filenames', async () => {
      const metadata = {
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        size: testFile.length,
      };

      const result1 = await storageService.saveFile(testFile, metadata);
      const result2 = await storageService.saveFile(testFile, metadata);

      expect(result1.filename).not.toBe(result2.filename);
      expect(result1.filePath).not.toBe(result2.filePath);
    });

    it('should preserve file extension from original filename', async () => {
      const testCases = [
        { originalFilename: 'document.pdf', mimeType: 'application/pdf', expectedExt: '.pdf' },
        { originalFilename: 'photo.jpg', mimeType: 'image/jpeg', expectedExt: '.jpg' },
        { originalFilename: 'image.png', mimeType: 'image/png', expectedExt: '.png' },
      ];

      for (const testCase of testCases) {
        const metadata = {
          originalFilename: testCase.originalFilename,
          mimeType: testCase.mimeType,
          size: testFile.length,
        };

        const result = await storageService.saveFile(testFile, metadata);
        expect(result.filename).toMatch(new RegExp(`${testCase.expectedExt}$`));
      }
    });

    it('should reject files exceeding size limit', async () => {
      const metadata = {
        originalFilename: 'large.jpg',
        mimeType: 'image/jpeg',
        size: 11 * 1024 * 1024, // 11MB
      };

      await expect(storageService.saveFile(testFile, metadata)).rejects.toThrow(FileSizeError);

      try {
        await storageService.saveFile(testFile, metadata);
      } catch (error: any) {
        expect(error.statusCode).toBe(413);
        expect(error.errorCode).toBe('FILE_TOO_LARGE');
      }
    });

    it('should reject files with invalid MIME types', async () => {
      const metadata = {
        originalFilename: 'script.js',
        mimeType: 'application/javascript',
        size: testFile.length,
      };

      await expect(storageService.saveFile(testFile, metadata)).rejects.toThrow(
        InvalidFileTypeError
      );

      try {
        await storageService.saveFile(testFile, metadata);
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.errorCode).toBe('INVALID_FILE_TYPE');
      }
    });

    it('should reject filenames with path traversal attempts', async () => {
      const maliciousFilenames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        'test/../../secret.txt',
        './../../etc/hosts',
      ];

      for (const filename of maliciousFilenames) {
        const metadata = {
          originalFilename: filename,
          mimeType: 'image/jpeg',
          size: testFile.length,
        };

        await expect(storageService.saveFile(testFile, metadata)).rejects.toThrow(
          PathTraversalError
        );
      }

      // Also verify error properties
      try {
        await storageService.saveFile(testFile, {
          originalFilename: '../../../etc/passwd',
          mimeType: 'image/jpeg',
          size: testFile.length,
        });
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.errorCode).toBe('PATH_TRAVERSAL');
      }
    });

    it('should accept all allowed MIME types', async () => {
      const allowedTypes = [
        { mimeType: 'image/jpeg', ext: 'jpg' },
        { mimeType: 'image/png', ext: 'png' },
        { mimeType: 'application/pdf', ext: 'pdf' },
      ];

      for (const { mimeType, ext } of allowedTypes) {
        const metadata = {
          originalFilename: `test.${ext}`,
          mimeType,
          size: testFile.length,
        };

        await expect(storageService.saveFile(testFile, metadata)).resolves.toBeDefined();
      }
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing file', async () => {
      // First, save a file
      const metadata = {
        originalFilename: 'to-delete.jpg',
        mimeType: 'image/jpeg',
        size: testFile.length,
      };

      const { filePath } = await storageService.saveFile(testFile, metadata);

      // Verify file exists
      const fullPath = path.join(testUploadDir, filePath);
      let fileExists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Delete the file
      await storageService.deleteFile(filePath);

      // Verify file is deleted
      fileExists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should not throw error when deleting non-existent file', async () => {
      await expect(
        storageService.deleteFile('non-existent/file.jpg')
      ).resolves.not.toThrow();
    });

    it('should reject path traversal attempts in delete operations', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        'test/../../secret.txt',
      ];

      for (const maliciousPath of maliciousPaths) {
        await expect(storageService.deleteFile(maliciousPath)).rejects.toThrow(
          PathTraversalError
        );
      }
    });
  });

  describe('getFileUrl', () => {
    it('should return correct URL format', () => {
      const filePath = '2026/01/test-file.jpg';
      const url = storageService.getFileUrl(filePath);

      expect(url).toBe('/uploads/2026/01/test-file.jpg');
    });

    it('should handle different file paths correctly', () => {
      const testCases = [
        { filePath: '2026/12/photo.png', expected: '/uploads/2026/12/photo.png' },
        { filePath: '2025/03/document.pdf', expected: '/uploads/2025/03/document.pdf' },
        { filePath: '2024/01/image.jpg', expected: '/uploads/2024/01/image.jpg' },
      ];

      for (const testCase of testCases) {
        const url = storageService.getFileUrl(testCase.filePath);
        expect(url).toBe(testCase.expected);
      }
    });

    it('should reject path traversal attempts', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        'test/../../secret.txt',
      ];

      for (const maliciousPath of maliciousPaths) {
        expect(() => storageService.getFileUrl(maliciousPath)).toThrow(PathTraversalError);
      }
    });
  });

  describe('encryption', () => {
    it('should store files encrypted (raw disk content differs from plaintext)', async () => {
      const metadata = {
        originalFilename: 'secret.jpg',
        mimeType: 'image/jpeg',
        size: testFile.length,
      };
      const { filePath } = await storageService.saveFile(testFile, metadata);

      const rawContent = await fs.readFile(path.join(testUploadDir, filePath));
      expect(rawContent).not.toEqual(testFile);
      // Encrypted file is 28 bytes larger (12-byte IV + 16-byte auth tag)
      expect(rawContent.length).toBe(testFile.length + 28);
    });

    it('should round-trip correctly: encrypted write then decrypted read', async () => {
      const originalContent = Buffer.from('sensitive document content');
      const metadata = {
        originalFilename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: originalContent.length,
      };
      const { filePath } = await storageService.saveFile(originalContent, metadata);

      const stream = await storageService.getFileStream(filePath);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(originalContent);
    });

    it('should throw on construction when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      expect(() => new LocalStorageService(testUploadDir)).toThrow('ENCRYPTION_KEY');
      process.env.ENCRYPTION_KEY = saved;
    });

    it('should throw on construction when ENCRYPTION_KEY is not 64 hex chars', () => {
      const saved = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'tooshort';
      expect(() => new LocalStorageService(testUploadDir)).toThrow('ENCRYPTION_KEY');
      process.env.ENCRYPTION_KEY = saved;
    });

    it('should throw when a tampered file is read back', async () => {
      const metadata = {
        originalFilename: 'tamper.jpg',
        mimeType: 'image/jpeg',
        size: testFile.length,
      };
      const { filePath } = await storageService.saveFile(testFile, metadata);

      // Corrupt a byte in the ciphertext (after the 28-byte header)
      const fullPath = path.join(testUploadDir, filePath);
      const raw = await fs.readFile(fullPath);
      raw[28] = raw[28] ^ 0xff;
      await fs.writeFile(fullPath, raw);

      await expect(storageService.getFileStream(filePath)).rejects.toThrow();
    });
  });

  describe('getFileStream', () => {
    it('should return a readable stream with correct file content', async () => {
      const metadata = {
        originalFilename: 'test.jpg',
        mimeType: 'image/jpeg',
        size: testFile.length,
      };
      const { filePath } = await storageService.saveFile(testFile, metadata);

      const stream = await storageService.getFileStream(filePath);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(testFile);
    });

    it('should throw FileNotFoundError for a non-existent file', async () => {
      await expect(
        storageService.getFileStream('2026/01/doesnotexist.jpg')
      ).rejects.toThrow(FileNotFoundError);

      try {
        await storageService.getFileStream('2026/01/doesnotexist.jpg');
      } catch (error: any) {
        expect(error.statusCode).toBe(404);
        expect(error.errorCode).toBe('FILE_NOT_FOUND');
      }
    });

    it('should reject path traversal attempts', async () => {
      await expect(
        storageService.getFileStream('../../../etc/passwd')
      ).rejects.toThrow(PathTraversalError);
    });
  });
});
