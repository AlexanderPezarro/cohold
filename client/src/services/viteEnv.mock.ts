// Jest stand-in for viteEnv.ts (see jest.config.js moduleNameMapper) — mirrors
// Vite's dev-mode defaults since tests run outside a Vite build.
export const viteEnv: ImportMetaEnv = {
  DEV: false,
  PROD: false,
  MODE: 'test',
  BASE_URL: '/',
  SSR: false,
  VITE_API_BASE_URL: undefined,
};
