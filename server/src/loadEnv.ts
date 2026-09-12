/**
 * Loads `.env` into `process.env` as a side effect of importing this module.
 *
 * This has to be its own module because of ESM evaluation order: a module's
 * body runs only after *all* of its static imports have been fully evaluated.
 * Calling `dotenv.config()` in the body of server.ts was therefore always too
 * late — `import { createApp } from './app.js'` had already pulled in the whole
 * route graph, so every module-scope `process.env` read in it saw an
 * unpopulated environment:
 *
 *  - routes/documents.ts built a LocalStorageService, which threw on the
 *    missing ENCRYPTION_KEY and took the whole boot down with it;
 *  - db/client.ts fell back to `file:./data/landlord.db`, silently ignoring
 *    the configured DATABASE_URL;
 *  - config/storage.ts and email/service.ts likewise fell back to their
 *    defaults instead of UPLOAD_DIR and EMAIL_FROM.
 *
 * Importing this module before any other local import is what guarantees the
 * variables are in place. Keep it first — see the regression test in
 * server/src/__tests__/envLoadOrder.test.ts.
 */
import dotenv from 'dotenv';

dotenv.config();
