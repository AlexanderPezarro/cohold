# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues,
discussions, or pull requests.

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/AlexanderPezarro/cohold/security)
2. Click **Report a vulnerability**

This opens a private channel visible only to the maintainers.

Please include:

- The type of issue (e.g. authentication bypass, injection, broken access control)
- The affected file paths or endpoints
- Steps to reproduce, and a proof of concept if you have one
- The impact — what an attacker could achieve

## What to expect

- **Acknowledgement** within 72 hours.
- **An initial assessment** within 7 days, including whether we consider it in
  scope and a rough severity.
- **Progress updates** as a fix is developed.
- **Credit** in the release notes when the fix ships, unless you would rather stay
  anonymous.

Please give us a reasonable opportunity to ship a fix before disclosing publicly.

## Scope

Cohold handles tenant records, financial transactions and bank credentials, so the
areas we care most about are:

- Authentication and session handling
- Access control between users, and between co-owners of a property
- The bank integration: OAuth token storage, webhook authenticity
- Document upload, storage and encryption at rest
- API key scoping
- SQL injection, XSS and CSRF

Findings that are generally **out of scope**: missing hardening headers with no
demonstrated impact, rate limiting on non-sensitive endpoints, output from
automated scanners without a working proof of concept, and vulnerabilities that
require an already-compromised host.

## Self-hosting note

If you run your own instance, your deployment configuration is your
responsibility. At minimum:

- Set a strong, unique `SESSION_SECRET`, `ENCRYPTION_KEY` and
  `BANK_TOKEN_ENCRYPTION_KEY` — never use the placeholder values
- Serve over HTTPS
- Keep the host and dependencies patched
- Back up the database and the uploads directory, and test a restore

See [docs/self-hosting.md](./docs/self-hosting.md) for details.

## Supported versions

Security fixes are applied to the latest release on `main`. There are no
long-term support branches at this time.
