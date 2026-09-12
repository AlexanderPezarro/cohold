// MUST stay first: this populates process.env before any module below is
// evaluated, and several of them read it at module scope. See loadEnv.ts for
// why loading the environment here in this file's body would be too late.
import './loadEnv.js';
import { createApp } from './app.js';
import { initGraphQL } from './graphql/index.js';

console.log('[startup] Starting server...');
console.log('[startup] Node version:', process.version);
console.log('[startup] Environment:', process.env.NODE_ENV || 'development');
console.log('[startup] Database URL:', process.env.DATABASE_URL);

(async () => {
  try {
    const app = createApp();
    await initGraphQL(app);
    const PORT = parseInt(process.env.PORT || '3000', 10);

    console.log('[startup] App created successfully');
    console.log('[startup] Attempting to listen on 0.0.0.0:' + PORT);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[startup] SUCCESS: Server running on http://0.0.0.0:${PORT}`);
      console.log(`[startup] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('[startup] FATAL ERROR during startup:', error);
    process.exit(1);
  }
})();
