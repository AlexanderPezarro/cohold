// Set up test environment variables before any modules are loaded
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.BANK_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Give this test file its own copy of the migrated template database, so
// parallel workers never share a SQLite file. jest.globalSetup.cjs built the
// template and exported these paths; without it (e.g. a hand-rolled jest
// invocation) we leave DATABASE_URL alone.
const template = process.env.COHOLD_TEST_DB_TEMPLATE;
const runDir = process.env.COHOLD_TEST_DB_DIR;

if (template && runDir) {
  const worker = process.env.JEST_WORKER_ID ?? '1';
  const dbPath = join(runDir, `test-${worker}-${randomUUID().slice(0, 8)}.db`);
  copyFileSync(template, dbPath);
  // db/client.ts reads DATABASE_URL at import time, which happens after this file.
  process.env.DATABASE_URL = `file:${dbPath}`;
}
