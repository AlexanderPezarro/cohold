import { describe, it, expect, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guards for "the server won't boot from `.env` alone".
 *
 * server.ts called `dotenv.config()` in its body, which under ESM runs only
 * after every static import has been evaluated. So `import { createApp } from
 * './app.js'` pulled in the whole route graph first, and routes/documents.ts
 * built a LocalStorageService at module scope and threw on the not-yet-set
 * ENCRYPTION_KEY. The quieter half of the same bug: db/client.ts,
 * config/storage.ts and email/service.ts silently fell back to their defaults
 * instead of the configured DATABASE_URL, UPLOAD_DIR and EMAIL_FROM.
 *
 * Two invariants keep it fixed, and both need guarding:
 *  1. importing a module must not require the environment to be populated yet;
 *  2. server.ts must import ./loadEnv.js before anything that reads env.
 *
 * (1) alone is not enough — with the storage service now lazy, breaking (2)
 * would no longer crash, it would quietly point the server at the wrong
 * database, which is worse.
 */

const SERVER_SRC = join(process.cwd(), 'server', 'src');

describe('env load order', () => {
  describe('modules import without the environment populated', () => {
    const savedKey = process.env.ENCRYPTION_KEY;
    const savedUploadDir = process.env.UPLOAD_DIR;

    afterEach(() => {
      process.env.ENCRYPTION_KEY = savedKey;
      if (savedUploadDir === undefined) {
        delete process.env.UPLOAD_DIR;
      } else {
        process.env.UPLOAD_DIR = savedUploadDir;
      }
    });

    it('imports the documents route with ENCRYPTION_KEY unset', async () => {
      delete process.env.ENCRYPTION_KEY;
      await expect(import('../routes/documents.js')).resolves.toHaveProperty('default');
    });

    it('imports the documents resolver with ENCRYPTION_KEY unset', async () => {
      delete process.env.ENCRYPTION_KEY;
      await expect(import('../graphql/resolvers/documents.resolver.js')).resolves.toBeDefined();
    });

    it('builds the storage service on first call, not at import time', async () => {
      delete process.env.ENCRYPTION_KEY;
      const { getStorageService } = await import('../services/storage/getStorageService.js');

      // Importing was fine; it is the *call* that needs the key.
      expect(() => getStorageService()).toThrow('ENCRYPTION_KEY');

      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      expect(getStorageService()).toBeDefined();
    });

    it('returns the same instance on repeated calls', async () => {
      const { getStorageService } = await import('../services/storage/getStorageService.js');
      expect(getStorageService()).toBe(getStorageService());
    });
  });

  describe('server.ts loads .env before importing anything that reads it', () => {
    const source = readFileSync(join(SERVER_SRC, 'server.ts'), 'utf8');

    it('imports ./loadEnv.js', () => {
      expect(source).toMatch(/^import '\.\/loadEnv\.js';$/m);
    });

    it('imports ./loadEnv.js before every other import', () => {
      const imports = source.match(/^import .*$/gm) ?? [];
      expect(imports.length).toBeGreaterThan(1);
      expect(imports[0]).toBe("import './loadEnv.js';");
    });

    it('no longer calls dotenv.config() in its body, where it would be too late', () => {
      expect(source).not.toMatch(/dotenv\.config\(/);
    });
  });

  describe('loadEnv.ts', () => {
    it('calls dotenv.config() as an import side effect', () => {
      const source = readFileSync(join(SERVER_SRC, 'loadEnv.ts'), 'utf8');
      expect(source).toMatch(/dotenv\.config\(\)/);
    });
  });
});
