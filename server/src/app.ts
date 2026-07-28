import express from 'express';
import qs from 'qs';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import SqliteStore from 'better-sqlite3-session-store';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import propertiesRouter from './routes/properties.js';
import eventsRouter from './routes/events.js';
import tenantsRouter from './routes/tenants.js';
import documentsRouter from './routes/documents.js';
import leasesRouter from './routes/leases.js';
import transactionsRouter from './routes/transactions.js';
import usersRouter from './routes/users.js';
import apiKeysRouter from './routes/api-keys.js';
import propertyOwnershipRouter from './routes/propertyOwnership.routes.js';
import settlementRouter from './routes/settlement.routes.js';
import reportRouter from './routes/report.routes.js';
import monzoRouter from './routes/monzo.js';
import bankAccountsRouter from './routes/bank-accounts.js';
import webhooksRouter from './routes/webhooks.js';
import webhookStatusRouter from './routes/webhook-status.js';
import matchingRulesRouter from './routes/matching-rules.js';
import pendingTransactionsRouter from './routes/pending-transactions.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine project root (works in both dev and production)
// In dev: server/src -> ../..
// In production: dist/server/server/src -> ../../../..
const projectRoot = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../../..')
  : path.join(__dirname, '../..');

export function createApp() {
  const app = express();

  // Trust proxy - required for Fly.io and other reverse proxies
  // This allows Express to correctly read X-Forwarded-* headers
  // Use 1 (single hop) instead of true to satisfy express-rate-limit validation
  app.set('trust proxy', 1);

  // Express's default query parser (qs) silently switches a repeated param
  // like ?property_id=a&property_id=b&... from an array to a plain object
  // once it sees more than its default arrayLimit of 20 entries. Routes that
  // accept a list of IDs this way (e.g. GET /api/leases?property_id=...) then
  // fail Zod validation for any landlord with more than 20 properties. Raise
  // the limit well past any realistic portfolio size.
  app.set('query parser', (str: string) => qs.parse(str, { arrayLimit: 1000 }));

  // Compression middleware for production
  app.use(compression());

  // Security middleware
  // upgrade-insecure-requests is dropped from the default CSP: Cloudflare's edge
  // already forces HTTPS for all public traffic, and this directive makes browsers
  // rewrite same-origin asset requests to https:// even when the page itself was
  // served over plain HTTP — breaking internal HTTP-only access paths (health
  // checks, the CI smoke-test SSH tunnel) where no TLS listener exists.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'upgrade-insecure-requests': null,
        },
      },
    })
  );

  // General API rate limit - generous for normal usage
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Strict rate limit for login to prevent brute force
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 1000 : 20, // More permissive in tests
    message: 'Too many login attempts, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply general limiter to all API routes
  app.use('/api', apiLimiter);

  // Apply stricter limiter specifically to login endpoint
  app.use('/api/auth/login', loginLimiter);

  // Session middleware with SQLite store
  const SessionStore = SqliteStore(session);
  const sessionDb = new Database(
    process.env.NODE_ENV === 'production'
      ? '/data/sessions.db'
      : path.join(projectRoot, 'data/sessions.db')
  );

  app.use(
    session({
      store: new SessionStore({
        client: sessionDb,
        expired: {
          clear: true,
          intervalMs: 900000, // 15 minutes
        },
      }),
      secret: process.env.SESSION_SECRET || 'change-this-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        // 'auto' marks the cookie Secure only when the request is actually HTTPS
        // (directly, or via X-Forwarded-Proto since trust proxy is enabled above).
        // A hardcoded `NODE_ENV === 'production'` check would mark the cookie
        // Secure even for plain-HTTP internal access (health checks, CI smoke
        // tests) where browsers correctly refuse to store it, breaking sessions.
        secure: 'auto',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
      },
    })
  );

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static file serving for uploads
  app.use('/uploads', express.static(path.join(projectRoot, 'uploads')));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth routes
  app.use('/api/auth', authRouter);

  // Properties routes
  app.use('/api/properties', propertiesRouter);

  // Property ownership routes (must come after properties router)
  app.use('/api/properties', propertyOwnershipRouter);

  // Settlement routes
  app.use('/api', settlementRouter);

  // Report routes
  app.use('/api', reportRouter);

  // Events routes
  app.use('/api/events', eventsRouter);

  // Tenants routes
  app.use('/api/tenants', tenantsRouter);

  // Documents routes
  app.use('/api/documents', documentsRouter);

  // Leases routes
  app.use('/api/leases', leasesRouter);

  // Transactions routes
  app.use('/api/transactions', transactionsRouter);

  // Users routes
  app.use('/api/users', usersRouter);

  // API Keys routes
  app.use('/api/api-keys', apiKeysRouter);

  // Bank integration routes
  app.use('/api/bank/webhooks/status', webhookStatusRouter);
  app.use('/api/bank/webhooks', webhooksRouter);
  app.use('/api/bank/monzo', monzoRouter);
  app.use('/api/bank', matchingRulesRouter);
  app.use('/api/bank/accounts', bankAccountsRouter);

  // Pending transactions routes
  app.use('/api/pending-transactions', pendingTransactionsRouter);

  // Serve static files from React build in production
  if (process.env.NODE_ENV === 'production') {
    const clientBuildPath = path.join(projectRoot, 'client/dist');

    // Serve static files
    app.use(express.static(clientBuildPath));

    // SPA fallback: serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
  }

  return app;
}
