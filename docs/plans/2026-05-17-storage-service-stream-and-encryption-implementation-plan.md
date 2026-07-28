# Implementation Plan: Storage Service Stream and Encryption

**Design:** docs/plans/2026-05-17-storage-service-stream-and-encryption-design.md
**Date:** 2026-05-17

## Task Overview

| # | Task | Dependencies | Complexity |
|---|------|--------------|------------|
| 1 | Add `getFileStream` to IStorageService + LocalStorageService, fix download route | none | Small |
| 2 | Add AES-256-GCM encryption to LocalStorageService | Task 1 | Medium |

---

## Tasks

### Task 1: Add `getFileStream` to IStorageService + LocalStorageService, fix download route

**Dependencies:** none

#### Overview

The download route (`GET /api/documents/:id/download`) currently reads files from disk directly using `fs.createReadStream()`, bypassing the storage service abstraction entirely. This means a future S3 implementation would require changes in the route as well as the service. This task closes that gap by adding a `getFileStream` method to the `IStorageService` interface, implementing it in `LocalStorageService`, and updating the download route to use it. The route should know nothing about the filesystem after this change.

#### Files

- **Modify:** `server/src/services/storage/errors.ts`
- **Modify:** `server/src/services/storage/IStorageService.ts`
- **Modify:** `server/src/services/storage/LocalStorageService.ts`
- **Modify:** `server/src/routes/documents.ts`
- **Modify:** `server/src/__tests__/services/storage/LocalStorageService.test.ts`

---

#### Step 1: Write failing tests for `getFileStream`

Add a new `describe('getFileStream', ...)` block to `server/src/__tests__/services/storage/LocalStorageService.test.ts`. Add these imports at the top of the file:

```typescript
import { FileNotFoundError } from '../../../services/storage/errors.js';
```

Add after the existing `describe('getFileUrl', ...)` block:

```typescript
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
```

Run: `npm test -- --testPathPattern=LocalStorageService`
Expected: **FAIL** (FileNotFoundError does not exist yet, getFileStream does not exist yet)

---

#### Step 2: Add `FileNotFoundError` to errors.ts

In `server/src/services/storage/errors.ts`, add after the `PathTraversalError` class:

```typescript
export class FileNotFoundError extends StorageError {
  constructor(message: string = 'File not found') {
    super(message, 404, 'FILE_NOT_FOUND');
    this.name = 'FileNotFoundError';
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}
```

---

#### Step 3: Add `getFileStream` to the interface

In `server/src/services/storage/IStorageService.ts`, add the `Readable` import and the new method:

```typescript
import { Readable } from 'stream';
```

Add to the `IStorageService` interface:

```typescript
/**
 * Get a readable stream of the file's contents
 * @param filePath - Relative path to the file
 * @returns Readable stream of plaintext file content
 * @throws FileNotFoundError if the file does not exist
 */
getFileStream(filePath: string): Promise<Readable>;
```

---

#### Step 4: Implement `getFileStream` in LocalStorageService

In `server/src/services/storage/LocalStorageService.ts`, add to the imports:

```typescript
import { Readable } from 'stream';
import {
  FileSizeError,
  InvalidFileTypeError,
  PathTraversalError,
  FileNotFoundError,
} from './errors.js';
```

Add the following method to the `LocalStorageService` class (after `deleteFile`):

```typescript
async getFileStream(filePath: string): Promise<Readable> {
  this.validatePath(filePath);

  const fullFilePath = path.join(this.uploadDir, filePath);

  try {
    const fileBuffer = await fs.readFile(fullFilePath);
    return Readable.from(fileBuffer);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new FileNotFoundError(`File not found: ${filePath}`);
    }
    throw error;
  }
}
```

Run: `npm test -- --testPathPattern=LocalStorageService`
Expected: **PASS**

---

#### Step 5: Update the download route

In `server/src/routes/documents.ts`, remove these imports (no longer needed after the route change):

```typescript
import fs from 'fs/promises';
import fsSyncStream from 'fs';
import path from 'path';
import { storageConfig } from '../config/storage.js';
```

Replace the body of the `GET /api/documents/:id/download` handler — everything after the document lookup — with:

```typescript
// Set response headers using metadata from the DB record
res.setHeader('Content-Type', document.fileType);
res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
res.setHeader('Content-Length', document.fileSize);

const stream = await storageService.getFileStream(document.filePath);
return stream.pipe(res);
```

Update the catch block of that handler to handle `statusCode` errors (consistent with the upload and delete routes):

```typescript
} catch (error: any) {
  console.error('Download document error:', error);
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
    });
  }
  return res.status(500).json({
    success: false,
    error: 'An error occurred while downloading document',
  });
}
```

Run: `npm test -- --testPathPattern=documents`
Expected: **PASS** (existing download tests continue to work)

---

#### Step 6: Run full test suite and commit

```bash
npm test
```
Expected: All tests pass, coverage thresholds met.

```bash
git add server/src/services/storage/errors.ts \
        server/src/services/storage/IStorageService.ts \
        server/src/services/storage/LocalStorageService.ts \
        server/src/routes/documents.ts \
        server/src/__tests__/services/storage/LocalStorageService.test.ts
git commit -m "feat: add getFileStream to IStorageService and fix download route to use storage service"
```

#### Verification

- `GET /api/documents/:id/download` works end-to-end (upload a file, download it, content matches)
- A request for a document whose file is missing from disk returns 404
- `documents.ts` no longer imports `fs`, `path`, or `storageConfig`
- All tests pass

---

### Task 2: Add AES-256-GCM encryption at rest to LocalStorageService

**Dependencies:** Task 1

#### Overview

Files are currently stored as plaintext on disk. This task adds AES-256-GCM encryption so that every file is encrypted before being written and decrypted transparently when read back. The key comes from the `ENCRYPTION_KEY` environment variable (64 hex characters = 32 bytes). The on-disk format is a fixed-length header followed by ciphertext: `[12-byte IV][16-byte auth tag][ciphertext]`. The GCM auth tag ensures tampered files are detected and rejected at read time. The `fileSize` stored in the database remains the original plaintext size (used for `Content-Length`) — the 28-byte encryption overhead is invisible to callers.

#### Files

- **Modify:** `.env.example`
- **Modify:** `server/src/services/__tests__/jest.setup.ts`
- **Modify:** `server/src/services/storage/LocalStorageService.ts`
- **Modify:** `server/src/__tests__/services/storage/LocalStorageService.test.ts`

---

#### Step 1: Write failing encryption tests

Add a new `describe('encryption', ...)` block inside the outer `describe('LocalStorageService', ...)` in `server/src/__tests__/services/storage/LocalStorageService.test.ts`:

```typescript
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
    // Encrypted file is 28 bytes larger than plaintext (12-byte IV + 16-byte auth tag)
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
```

Also update the `'should save a file successfully with valid metadata'` test in `describe('saveFile', ...)`. Remove the direct raw-content comparison (the file on disk is now encrypted so comparing to plaintext would always fail). Delete these two lines from that test:

```typescript
// Verify file content
const savedContent = await fs.readFile(fullPath);
expect(savedContent.toString()).toBe(testFile.toString());
```

Run: `npm test -- --testPathPattern=LocalStorageService`
Expected: **FAIL** (constructor does not validate key yet, saveFile does not encrypt yet)

---

#### Step 2: Set `ENCRYPTION_KEY` in the Jest setup file

In `server/src/services/__tests__/jest.setup.ts`, add:

```typescript
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
```

This file runs before any module is loaded. The `LocalStorageService` is instantiated at module level in `documents.ts` (`const storageService = new LocalStorageService()`), so the key must be present before that import resolves.

---

#### Step 3: Add encryption to LocalStorageService

In `server/src/services/storage/LocalStorageService.ts`, add a private `encryptionKey` field and update the constructor:

```typescript
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
```

Add two private methods to the class:

```typescript
private encrypt(plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag(); // always 16 bytes for GCM
  // On-disk format: [12-byte IV][16-byte auth tag][ciphertext]
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
```

In `saveFile`, replace the write line:

```typescript
// Before:
await fs.writeFile(fullFilePath, file);

// After:
await fs.writeFile(fullFilePath, this.encrypt(file));
```

In `getFileStream`, replace the read-and-return block:

```typescript
// Before:
const fileBuffer = await fs.readFile(fullFilePath);
return Readable.from(fileBuffer);

// After:
const encrypted = await fs.readFile(fullFilePath);
const plaintext = this.decrypt(encrypted);
return Readable.from(plaintext);
```

Run: `npm test -- --testPathPattern=LocalStorageService`
Expected: **PASS**

---

#### Step 4: Update `.env.example`

In `.env.example`, add to the `# Storage` section:

```
# AES-256 encryption key for uploaded files (32 bytes = 64 hex characters)
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your_64_character_hex_string_here
```

---

#### Step 5: Run full test suite and commit

```bash
npm test
```
Expected: All tests pass, coverage thresholds met.

```bash
git add server/src/services/storage/LocalStorageService.ts \
        server/src/__tests__/services/storage/LocalStorageService.test.ts \
        server/src/services/__tests__/jest.setup.ts \
        .env.example
git commit -m "feat: add AES-256-GCM encryption at rest to LocalStorageService"
```

#### Verification

- Upload a file, then inspect it on disk — the content should be unreadable binary, not plaintext
- Download the same file — the content should be the original plaintext
- Start the server without `ENCRYPTION_KEY` set — should fail with a clear error message
- All tests pass
