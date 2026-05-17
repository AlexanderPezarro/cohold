// Set up test environment variables before any modules are loaded
process.env.BANK_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
