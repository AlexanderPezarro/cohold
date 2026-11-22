# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack property management application for landlords. React frontend with Express backend, SQLite database via Prisma ORM.

## Development Commands

```bash
# Development
npm run dev              # Run client + server concurrently
npm run dev:server       # Server only (tsx)
npm run dev:client       # Client only (Vite dev server)

# Testing
npm test                 # Run Jest tests with coverage thresholds
npm run test:watch       # Jest watch mode
npm run test:coverage    # Generate coverage report

# Build & Production
npm run build            # Build both client and server
npm start                # Start production server

# Code Quality
npm run lint             # ESLint
npm run format           # Prettier

# Database
npm run db:seed          # Seed database with test data
npm run db:reset         # Reset database
```

## Architecture

### Monorepo Structure

```
├── client/              # React frontend (Vite, MUI, React Router)
│   └── src/
│       ├── pages/       # Route pages
│       ├── components/  # Reusable UI components
│       ├── contexts/    # React Context (Auth, Toast)
│       ├── services/    # API client (axios)
│       └── hooks/       # Custom React hooks
├── server/              # Express backend
│   └── src/
│       ├── routes/      # API route handlers
│       ├── services/    # Business logic (auth, storage)
│       ├── middleware/  # Express middleware (auth, upload)
│       └── db/          # Prisma client
├── shared/              # Shared code
│   ├── types/           # TypeScript interfaces
│   └── validation/      # Zod schemas (used by both client and server)
├── prisma/              # Database schema & migrations
└── docs/                # Documentation
```

### Data Model

Core entities: User, Property, Tenant, Lease, Transaction, Event, Document. See `prisma/schema.prisma` for full schema. Key relationships:

- Property has many Leases, Transactions, Events
- Lease connects Property and Tenant
- Transaction belongs to Property, optionally to Lease
- Document uses polymorphic association (entityType + entityId)

### Component Library

Reusable UI lives in `client/src/components/`: `primitives/` (Button, Select, AppBar, …) and `composed/` (PropertyCard, SettlementForm, …). Components in those folders have a `*.stories.tsx` file beside them showing their props and variants. Before building new UI, check for an existing component to reuse, and add or update stories when you add or change a component.

Storybook (`npm run storybook` in `client/`, port 6006) runs the `@storybook/addon-mcp` server at `http://localhost:6006/mcp`, registered in `.mcp.json` as `storybook`. While Storybook is running, use its tools to:

- Look up components and their props (`docs-list`, `docs-show`).
- Find the stories that use a component (`stories-find-by-component`).
- Preview your changes (`stories-changed`, `stories-preview`).
- Run story tests (`test-run`).

If the tools are unavailable, Storybook isn't running. Start it, or read the story files directly.

### Validation

Zod schemas in `shared/validation/` are shared between client and server. Import from `shared/validation/index.ts`. Each entity has Create, Update, and full schemas.

### Authentication

Session-based auth with express-session and SQLite session store. Protected routes use `requireAuth` middleware. Frontend uses AuthContext for user state.

### Testing

Jest tests in `server/src/**/__tests__/*.test.ts`. Coverage thresholds: 80% lines/functions/statements, 70% branches.

Test databases are handled automatically — no `DATABASE_URL` or manual migration needed to run tests:

- `jest.globalSetup.cjs` loads `.env` (jest never imports `server.ts`, so nothing else does) and builds one migrated _template_ SQLite database, cached in `node_modules/.cache/cohold-jest-db/` and rebuilt only when the schema or migrations change.
- Each test file copies that template into a temp directory, so parallel workers never share a database and suites can't clobber each other's rows. `jest.globalTeardown.cjs` deletes the directory; set `COHOLD_TEST_DB_KEEP=1` to keep it.
- Because tests always get their own database, running them can no longer wipe your dev database.
- `forceExit` is set in `jest.config.js`, so a bare `npx jest` exits instead of hanging on an open SQLite handle.

## Environment Setup

Copy `.env.example` to `.env`. Key variables:

- `DATABASE_URL`: SQLite path (e.g., `file:./data/landlord.db`)
- `SESSION_SECRET`: Required for production
- `CLIENT_URL`: Frontend URL for CORS (default: `http://localhost:5173`)
- `UPLOAD_DIR`: Document storage directory
