# Contributing to Cohold

Thanks for your interest in Cohold. Bug reports, fixes and features are all
welcome.

## Licensing of contributions

Cohold is licensed under the **GNU Affero General Public License v3.0 or later**.
By opening a pull request you are contributing your work under that same license,
and you keep the copyright in what you wrote.

There is **no CLA and no DCO sign-off** to complete. Just open a pull request.

## Getting set up

Requires **Node.js 20.19+, 22.12+, or 24+**. If you use `nvm`, run `nvm use` to
pick up the `.nvmrc` (Node 24, matching the Docker image).

```bash
git clone https://github.com/AlexanderPezarro/cohold.git
cd cohold

npm install
cd client && npm install && cd ..

cp .env.example .env
# generate the secrets described in the README's Configuration section

npx prisma migrate deploy
npm run db:seed      # sample data to work against

npm run dev
```

Client on http://localhost:5173, API on http://localhost:3000.

## Before you open a pull request

```bash
npm test          # must pass; coverage thresholds are enforced
npm run lint
npm run format
```

Coverage thresholds are 80% for lines, functions and statements, and 70% for
branches. New server code is expected to come with tests.

## Conventions

- **Validation lives in `shared/validation/`.** These Zod schemas are imported by
  both the client and the server. Add or change a rule there rather than
  duplicating it on one side.
- **Database changes go through Prisma migrations.** Edit `prisma/schema.prisma`,
  then generate a migration — do not hand-edit the SQL or the database.
- **Server tests** live in `server/src/**/__tests__/*.test.ts`.
- **Styling** uses SCSS modules alongside the component. The project migrated off
  MUI, so please do not reintroduce a component framework.
- Keep pull requests focused. A small, single-purpose change is much easier to
  review than a large mixed one.

## Commit messages

Use the imperative mood and describe the effect of the change:

```
fix: transaction split shows error even with valid ownership selected
feat: add CSV export to the transactions report
```

## Reporting bugs

Open an issue using the bug report template. The most useful reports include what
you expected, what happened instead, and the steps to reproduce it.

Please **do not** open a public issue for a security vulnerability — see
[SECURITY.md](./SECURITY.md).

## Questions

Open a GitHub Discussion or an issue. If you are planning something substantial,
it is worth opening an issue first so we can agree on the approach before you
spend time on it.
