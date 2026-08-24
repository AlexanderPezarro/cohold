/**
 * Removes the per-run SQLite directory created by jest.globalSetup.cjs.
 * Set COHOLD_TEST_DB_KEEP=1 to keep it for post-mortem inspection.
 */
const fs = require('node:fs');

module.exports = async () => {
  const runDir =
    globalThis.__COHOLD_TEST_DB_DIR__ || process.env.COHOLD_TEST_DB_DIR;
  if (runDir && !process.env.COHOLD_TEST_DB_KEEP) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
};
