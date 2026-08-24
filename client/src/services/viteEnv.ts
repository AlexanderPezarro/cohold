// Isolates the `import.meta.env` syntax in its own module so it can be swapped
// for a plain-object stand-in in Jest (see jest.config.js moduleNameMapper) —
// ts-jest's CommonJS transform for the client project can't parse `import.meta`.
export const viteEnv: ImportMetaEnv = import.meta.env;
