# CI/CD Pipeline

This guide describes the automated build-and-test pipeline used by this
repository's GitHub Actions workflows. It is aimed at maintainers and at anyone
forking Cohold who wants the same setup.

If you just want to **run Cohold for yourself**, you do not need any of this —
see [Self-hosting](./self-hosting.md) instead.

## Overview

CI builds and verifies images. It does not deploy: nothing in this repository
connects to a server. Rolling a new image out is pull-based and belongs to
whatever provisioner you run — CI's contribution is that `:latest` only ever
points at an image that passed the smoke suite.

| Trigger | Workflow | What it does |
|---|---|---|
| Pull request | `deploy-pr.yml` | Build the PR image, smoke test it, comment the result |
| Merge queue | `merge-queue.yml` | Smoke test the queue's speculative merge |
| Push to `main` | `deploy-main.yml` | Build, smoke test, then promote `:latest` |
| Manual | `promote.yml` | Move `:latest` to a chosen tag by hand |

Images are published to GitHub Container Registry (GHCR):

- Base: `ghcr.io/<owner>/cohold-base`
- App: `ghcr.io/<owner>/cohold`

The workflows derive `<owner>` from `github.repository_owner` and lowercase it,
so a fork publishes to its own namespace with no edits required.

---

## The tag gate

CI cannot gate a rollout it does not perform, so it gates the **tag** instead.

Every push to `main` builds an image tagged with its commit SHA, smoke tests
that exact image, and only then re-tags it as `:latest`. Promotion re-tags an
existing manifest — nothing is rebuilt — so the promoted image is byte-identical
to the one that passed. A bad merge leaves `:latest` pointing at the last good
image rather than rolling out.

`promote.yml` is the manual escape hatch: use it when a build is known good but
the smoke suite blocked promotion for an unrelated reason (a flaky UI test, a
GHCR blip), or to roll `:latest` back to an earlier commit.

---

## Smoke tests

`.github/actions/smoke-test` is a composite action shared by all three test
paths. It starts a throwaway container from the image under test, backed by an
anonymous volume so every run begins from an empty database and exercises the
entrypoint's `prisma migrate deploy` exactly as a real rollout will, then runs
the Playwright suite against it on the runner.

It needs one secret, `SMOKE_TEST_PASSWORD`: the container seeds an admin account
(`smoke@cohold.app`) only when `ADMIN_PASSWORD` is non-empty, and the suite logs
in as that account. The action fails fast with a clear message when the secret is
missing, rather than surfacing it later as a login-page timeout.

---

## Prerequisites

- GitHub repository with admin access
- A GitHub PAT with `write:packages` for the one-off base image bootstrap

---

## Step 1: Configure GitHub secrets

Go to **Settings → Secrets and variables → Actions**.

| Secret | Value |
|---|---|
| `SMOKE_TEST_PASSWORD` | Any strong password; seeds the smoke-test admin account |
| `CHROMATIC_PROJECT_TOKEN` | Only if you use Chromatic for Storybook review |

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no setup needed.

---

## Step 2: Initial base image build

The app image builds `FROM` the base image, so the base must exist before the
first automated run.

```bash
echo "<your-github-pat>" | docker login ghcr.io -u <your-github-username> --password-stdin

docker build --platform linux/amd64 \
  -t ghcr.io/<owner>/cohold-base:latest \
  -f Dockerfile.base .

docker push ghcr.io/<owner>/cohold-base:latest
```

This takes 5–10 minutes on first build. Use a lowercase `<owner>` — Docker
rejects uppercase repository names.

---

## Private image access

Only relevant if you publish the GHCR packages privately.

The CI runner is already handled: `docker/login-action` authenticates with
`secrets.GITHUB_TOKEN`, which has `packages: write` via the `permissions:` block
at the top of each workflow.

Anything **pulling** the image outside GitHub Actions needs its own credentials —
a PAT with `read:packages`, via `docker login ghcr.io`. Docker caches this in
`~/.docker/config.json`, so it persists.

Note that private packages stay private when the repository is made public, and
their visibility is managed separately, under the package's own settings.

---

## Verify the setup

1. **Open a test PR.** `deploy-pr.yml` should check whether dependencies changed
   (rebuilding the base only if so), build and push `cohold:pr-<number>` plus a
   SHA tag, smoke test the SHA-tagged image, and comment the result.
2. **Merge to `main`.** `deploy-main.yml` should build, smoke test, and promote
   `:latest`. Confirm the `promote` job ran and the `:latest` digest now matches
   the SHA-tagged image.

### Checklist

- [ ] `SMOKE_TEST_PASSWORD` secret set
- [ ] Base image built and pushed to GHCR
- [ ] PR workflow builds and smoke tests successfully
- [ ] Push to `main` promotes `:latest`

---

## Base image build optimization

The base image rebuilds **only** when these files change:

- `package.json` / `package-lock.json`
- `client/package.json` / `client/package-lock.json`
- `prisma/schema.prisma`
- `Dockerfile.base`

All other changes (source code, migrations, docs, config) skip the base build and
reuse the published image, resolved to an immutable digest so the app image can
never be built on a base that shifted between jobs.

| Scenario | Build time |
|---|---|
| Dependency / schema change | ~8–10 min (full base build) |
| Code-only change | ~2–3 min (skips base build) |

The `check-changes` job output shows which path was taken.

To force a rebuild without changing dependencies, make a trivial change to
`Dockerfile.base` and push.

---

## Rolling back

Use the **Promote Image to Latest** workflow (`promote.yml`) from the Actions
tab, passing the SHA tag you want `:latest` to point at. It re-tags the existing
manifest, and your provisioner picks the change up on its next poll.

---

## Troubleshooting

### `repository name must be lowercase`

The GHCR namespace is derived from the account name, which preserves its case.
Each job that consumes the image refs recomputes them lowercase into
`$GITHUB_ENV`; if you add a job that builds or pulls an image, it needs that step
too.

### `build-app` fails resolving the base image digest

The base image has never been pushed, or was pushed under a different namespace.
Run the [initial base image build](#step-2-initial-base-image-build).

### Smoke tests fail immediately with a missing-secret error

`SMOKE_TEST_PASSWORD` is not set. Fork pull requests do not receive secrets, so
this is expected on PRs from forks.

### `smoke-test` is skipped rather than run

GitHub propagates a skip transitively through the `needs` graph, so a skipped
`build-base` would skip everything downstream. The workflows guard against this
with `if: always() && needs.<job>.result == 'success'`. A skipped required check
does not block a merge, so treat an unexpectedly skipped smoke test as a failure.
