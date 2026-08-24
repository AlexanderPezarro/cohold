/**
 * Jest global setup.
 *
 * Runs once per `jest` invocation, before any worker starts, and fixes three
 * traps that only bite locally (CI papers over all three with an exported
 * DATABASE_URL, `prisma migrate deploy` and `--runInBand`):
 *
 *  1. `.env` is only loaded by server.ts, which jest never imports, so tests
 *     silently ran against whatever DATABASE_URL happened to be exported.
 *  2. Nothing guaranteed the test database had a schema, hence the
 *     "table does not exist" failures on a clean checkout.
 *  3. Every worker shared one SQLite file, so parallel suites clobbered each
 *     other's rows (each suite starts with `deleteMany`).
 *
 * We load `.env`, build a migrated *template* database once, and hand each test
 * file its own copy of it (see server/src/services/__tests__/jest.setup.ts).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const TEMPLATE_CACHE_DIR = path.join(
  ROOT,
  'node_modules',
  '.cache',
  'cohold-jest-db'
);

/** Hash schema + migration SQL so the template is rebuilt only when they change. */
function migrationsFingerprint() {
  const migrationsDir = path.join(ROOT, 'prisma', 'migrations');
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma')));
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const sql = path.join(migrationsDir, entry.name, 'migration.sql');
    if (entry.isDirectory() && fs.existsSync(sql)) {
      hash.update(entry.name);
      hash.update(fs.readFileSync(sql));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

function buildTemplate(templatePath) {
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.rmSync(templatePath, { force: true });
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${templatePath}` },
    stdio: process.env.COHOLD_TEST_DB_VERBOSE ? 'inherit' : 'pipe',
  });
}

module.exports = async () => {
  // Trap 1: jest never loads server.ts, so nothing had loaded .env.
  // `override: false` keeps an explicitly exported DATABASE_URL (and CI's) winning.
  require('dotenv').config({
    path: path.join(ROOT, '.env'),
    override: false,
    quiet: true,
  });

  // Trap 2: guarantee a migrated schema exists rather than assuming one.
  const templatePath = path.join(
    TEMPLATE_CACHE_DIR,
    `template-${migrationsFingerprint()}.db`
  );
  if (!fs.existsSync(templatePath)) {
    buildTemplate(templatePath);
  }

  // Trap 3: a per-run directory that each test file copies the template into,
  // so no two workers ever touch the same SQLite file.
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cohold-jest-'));

  process.env.COHOLD_TEST_DB_TEMPLATE = templatePath;
  process.env.COHOLD_TEST_DB_DIR = runDir;
  // Fallback for anything reading DATABASE_URL before the per-file copy exists.
  process.env.DATABASE_URL = `file:${templatePath}`;

  globalThis.__COHOLD_TEST_DB_DIR__ = runDir;
};
