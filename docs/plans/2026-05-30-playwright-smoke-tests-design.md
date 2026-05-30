# Playwright Smoke Tests Design

**Date:** 2026-05-30

## Overview

A Playwright e2e smoke test suite that runs automatically after each staging deployment on PR creation. Tests hit the live staging URL using a dedicated test account, covering the full happy path through the app.

## Goals

- Catch regressions that unit/integration tests miss (broken routes, auth failures, UI crashes)
- Give PR authors confidence the deployed build actually works end-to-end
- Fast feedback loop — results visible in the PR within ~60 seconds of staging deploy

## Architecture

### Repo Structure

```
e2e/
├── playwright.config.ts     # Config pointing at staging URL
├── fixtures/
│   └── auth.ts              # Shared login fixture
└── tests/
    └── smoke.spec.ts        # Full happy path test
```

### CI Integration

A new `smoke-test` job added to `.github/workflows/deploy-pr.yml`, triggered after `deploy-staging` succeeds. It installs Playwright with Chromium only, runs the suite against the staging URL, and updates the existing PR comment with a pass/fail status line.

```
check-changes → build-base → build-app → deploy-staging → smoke-test
```

## Test Account

A dedicated `smoke@cohold.app` user is pre-seeded on staging via a `db:seed:smoke` npm script. The password is stored as a `SMOKE_TEST_PASSWORD` GitHub Actions secret. This account exists solely for automated testing and is never used manually.

Seeding is a one-time manual step (or part of staging provisioning) — not run on every PR.

## Happy Path Test Flow

The single `smoke.spec.ts` runs one sequential test:

1. **Login** — navigate to `/login`, sign in as `smoke@cohold.app`, assert redirect to dashboard
2. **Create property** — fill the new property form, save, assert property name appears in list
3. **Add tenant** — create a tenant with name and email, assert they appear in tenant list
4. **Create lease** — link tenant to property with start date and rent, assert lease shows as active
5. **Log a transaction** — add an income transaction against the property, assert it appears in transactions list
6. **Cleanup** — delete transaction, lease, tenant, and property in reverse order (wrapped in try/catch so cleanup failures don't mask test failures)

Expected runtime: under 60 seconds.

## Error Handling

- **Trace on failure:** Playwright traces uploaded as a GitHub Actions artifact when any test fails, so failures can be debugged locally via `playwright show-trace`
- **Cleanup resilience:** `afterEach` cleanup wrapped in try/catch — a cleanup failure surfaces as a warning, not a test failure
- **Merge blocking:** The job is a PR check but not a required status check by default — this is configured as a manual GitHub repo setting

## PR Comment Integration

The `smoke-test` job updates the existing staging deployment PR comment (identified by the `<!-- staging-preview-comment -->` marker) to append the smoke test result:

```
✓ Smoke tests passed  (or)  ✗ Smoke tests failed — see artifacts
```

## Secrets Required

| Secret | Purpose |
|---|---|
| `SMOKE_TEST_PASSWORD` | Password for `smoke@cohold.app` on staging |
| `TS_OAUTH_CLIENT_ID` | Tailscale (already exists) |
| `TS_OAUTH_CLIENT_SECRET` | Tailscale (already exists) |
