# Agent Instructions

Guidance for AI coding agents working in this repository. Human contributors
should read [CONTRIBUTING.md](./CONTRIBUTING.md), which covers the same ground.

## Project

Cohold is a property management application for landlords: React + Vite client,
Express server, SQLite via Prisma. See [CLAUDE.md](./CLAUDE.md) for architecture
and commands.

Requires Node.js 20.19+, 22.12+, or 24+ (see `.nvmrc`, which pins 24 to match Docker).

## Issue tracking

Work is tracked in GitHub Issues. There is no separate issue tracker in the repo.

## Quality gates

Run these before considering a change complete:

```bash
npm test          # Jest; coverage thresholds are enforced
npm run lint
npm run format
```

Coverage thresholds are 80% lines/functions/statements and 70% branches. New
server code is expected to come with tests.

If tests need a database, run `npx prisma migrate deploy` first.

## Conventions

- **Validation belongs in `shared/validation/`.** Those Zod schemas are imported
  by both client and server — change the rule there rather than duplicating it.
- **Schema changes go through Prisma migrations.** Edit `prisma/schema.prisma`
  and generate a migration; never hand-edit generated SQL or the database.
- **Styling is SCSS modules.** The project migrated off MUI — do not reintroduce
  a component framework.
- Server tests live in `server/src/**/__tests__/*.test.ts`.

## Finishing a session

1. Make sure the quality gates above pass.
2. Commit with a clear, imperative message describing the effect of the change.
3. Open a pull request against `main`. Do not push directly to `main`.
4. Summarise what changed, what was verified, and anything left outstanding.

Do not commit secrets, `.env` files, or database files. If you need credentials
for a feature, add them to `.env.example` as placeholders and document them.
