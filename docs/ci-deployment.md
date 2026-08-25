# CI/CD Deployment Setup

This guide describes the automated deployment pipeline used by this repository's
GitHub Actions workflows. It is aimed at maintainers and at anyone forking Cohold
who wants the same PR-preview + production setup.

If you just want to **run Cohold for yourself**, you do not need any of this —
see [Self-hosting](./self-hosting.md) instead.

## Overview

| | Staging | Production |
|---|---|---|
| **Trigger** | PR opened / updated | Push to `main` |
| **Image tag** | `pr-<number>` | `latest` |
| **Revert** | On PR close → reverts to `latest` | — |

Images are published to GitHub Container Registry (GHCR):

- Base: `ghcr.io/<owner>/cohold-base`
- App: `ghcr.io/<owner>/cohold`

The workflows derive `<owner>` from `github.repository_owner`, so a fork
publishes to its own namespace with no edits required.

Deployments run on a server reachable over Tailscale SSH. The GitHub Actions
runner joins the Tailnet using a Tailscale OAuth client, then SSHes into the
deploy host to pull and restart Docker Compose services.

> If your images are **private** GHCR packages, both the CI runner (push) and the
> deploy host (pull) need authenticated GHCR access — see
> [Private image access](#private-image-access).

---

## Prerequisites

- Tailscale account with admin access
- GitHub repository with admin access
- A Docker host on your Tailnet with Docker Compose installed
- A reverse proxy on that host connected to `proxy_network` (e.g. Traefik or Caddy)

---

## Step 1: Configure Tailscale OAuth Client

The CI runner authenticates to your Tailnet using a Tailscale OAuth client
(not a reusable auth key).

### 1.1 Create OAuth Client

1. Go to https://login.tailscale.com/admin/settings/oauth
2. Click **Generate OAuth client**
3. Grant the `auth_keys` scope (read/write) and tag `tag:ci`
4. Copy the **Client ID** and **Client Secret**

### 1.2 Tag Tailnet Nodes

Ensure your Tailnet ACL allows the `tag:ci` tag to SSH into the deploy host:

```json
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"]
  },
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:ci"],
      "dst": ["tag:server"],
      "users": ["autogroup:nonroot"]
    }
  ]
}
```

Tag your deploy server machine with `tag:server` in the Tailscale admin console.

---

## Step 2: Prepare the Deploy Server

### 2.1 Create env files

```bash
sudo mkdir -p /opt/cohold
sudo touch /opt/cohold/prod.env /opt/cohold/staging.env
```

Populate each file with the required environment variables (see `.env.example`).
At minimum:

```
DATABASE_URL=file:/data/app.db
SESSION_SECRET=<strong random secret>
CLIENT_URL=https://your-production-domain.example   # prod.env
# CLIENT_URL=https://your-staging-domain.example    # staging.env
NODE_ENV=production
UPLOAD_DIR=/data/uploads
```

### 2.2 Create the shared Docker network

```bash
docker network create proxy_network
```

This network is shared by the app containers and the reverse proxy.

### 2.3 Choose a deploy directory

Pick a directory on the host to hold `compose.yaml`, and create it:

```bash
mkdir -p /srv/cohold
```

The workflows sync `compose.yaml` there on every deploy. Record this path as the
`DEPLOY_PATH` repository variable in Step 3.

---

## Step 3: Configure GitHub Secrets and Variables

Go to **Settings → Secrets and variables → Actions**.

Add these **secrets**:

| Secret | Value |
|---|---|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID from Step 1 |
| `TS_OAUTH_CLIENT_SECRET` | Tailscale OAuth client secret from Step 1 |
| `DEPLOY_USER` | SSH username on the deploy server |
| `DEPLOY_HOST` | Tailscale hostname or IP of the deploy server |

Add these **variables**:

| Variable | Value |
|---|---|
| `DEPLOY_PATH` | Absolute path to the deploy directory from Step 2.3 |
| `STAGING_URL` | Public URL of the staging environment, used in PR comments |

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no setup needed.

> Keeping the host, user, path, and URLs in secrets and variables rather than in
> the workflow files means this repository can stay public without disclosing
> your infrastructure.

---

## Step 4: Initial Base Image Build

Before the first automated workflow run, build and push the base image manually.

### 4.1 Authenticate with GHCR

```bash
echo "<your-github-pat>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

Your PAT needs `write:packages` scope (and `read:packages` if the packages are private).

### 4.2 Build and push

```bash
docker build --platform linux/amd64 \
  -t ghcr.io/<owner>/cohold-base:latest \
  -f Dockerfile.base .

docker push ghcr.io/<owner>/cohold-base:latest
```

This takes 5–10 minutes on first build.

---

## Private Image Access

Only relevant if you publish the GHCR packages privately. Two consumers need credentials:

**CI runner (push):** already handled — `docker/login-action` in the workflows logs
in with `secrets.GITHUB_TOKEN`, which has `packages: write` via the `permissions:`
block at the top of each workflow file. No extra setup needed.

**Deploy host (pull):** `docker compose pull` runs directly on the deploy host over
SSH, outside GitHub Actions, so it needs its own persisted GHCR login:

```bash
echo "<your-github-pat>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

The PAT needs `read:packages` scope. Run this once as the same user the CI
workflows SSH in as (`DEPLOY_USER`) — Docker caches the credential in
`~/.docker/config.json`, so it survives across deploys without re-running.

---

## Step 5: Verify the Setup

### 5.1 Open a test PR

Push a branch and open a PR. The `deploy-pr.yml` workflow should:

1. Check whether `Dockerfile.base` / dependencies changed (and rebuild base if so)
2. Build and push `ghcr.io/<owner>/cohold:pr-<number>`
3. SSH into the deploy host and run `docker compose up -d cohold-staging`
4. Health-check the staging container
5. Post a comment on the PR with the staging URL

### 5.2 Close the PR

When the PR is closed, the `revert-staging` job switches staging back to the
`latest` image.

### 5.3 Merge to main

Merging to `main` triggers `deploy-main.yml`, which builds a `latest`-tagged image
and deploys to production automatically (no approval gate).

---

## Verification Checklist

- [ ] Tailscale OAuth client created with `tag:ci`
- [ ] Tailnet ACL allows `tag:ci` to SSH into deploy host
- [ ] `/opt/cohold/prod.env` and `/opt/cohold/staging.env` populated
- [ ] `proxy_network` Docker network exists on deploy host
- [ ] Secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_CLIENT_SECRET`, `DEPLOY_USER`, `DEPLOY_HOST` set
- [ ] Variables `DEPLOY_PATH` and `STAGING_URL` set
- [ ] Base image built and pushed to GHCR
- [ ] PR deploy workflow runs successfully
- [ ] Staging URL returns a healthy response
- [ ] PR close reverts staging to `latest`
- [ ] Push to `main` deploys to production

---

## Daily Workflow

### Deploying changes

1. Create a branch and make your changes
2. Push and open a Pull Request
3. **Automatic:** staging deploys with a PR-tagged image
4. Test at the staging URL posted in the PR comment
5. Merge the PR to `main`
6. **Automatic:** production deploys immediately (no approval gate)

### Viewing logs

SSH into the deploy host and use Docker:

```bash
docker logs cohold-staging -f
docker logs cohold-prod -f
```

### Rolling back production

```bash
# On the deploy host — pull a previous SHA-tagged image and restart
docker pull ghcr.io/<owner>/cohold:<sha>
STAGING_TAG=<sha> docker compose up -d cohold-prod
```

Replace `<sha>` with the full commit SHA from the GHCR image tags.

### Manual base image rebuild

To force a base image rebuild without changing dependencies, make a trivial change
to `Dockerfile.base` and push. Or rebuild locally:

```bash
docker build --platform linux/amd64 \
  -t ghcr.io/<owner>/cohold-base:latest \
  -f Dockerfile.base .
docker push ghcr.io/<owner>/cohold-base:latest
```

---

## Base Image Build Optimization

The base image rebuilds **only** when these files change:

- `package.json` / `package-lock.json`
- `client/package.json` / `client/package-lock.json`
- `prisma/schema.prisma`
- `Dockerfile.base`

All other changes (source code, migrations, docs, config) skip the base build and
reuse the existing image.

| Scenario | Build time |
|---|---|
| Dependency / schema change | ~8–10 min (full base build) |
| Code-only change | ~2–3 min (skips base build) |

The `check-changes` job output shows which path was taken.

---

## Troubleshooting

### Workflow fails on SSH step

- Verify the `DEPLOY_USER` and `DEPLOY_HOST` secrets are correct
- Check the deploy host is online: https://login.tailscale.com/admin/machines
- Confirm the Tailnet ACL allows `tag:ci` to SSH into the host

### Workflow fails on `docker compose pull`

- Check that `GITHUB_TOKEN` has `packages: write` permission (already set in the workflow)
- Ensure the GHCR image was successfully pushed in the `build-app` job
- If the images are private, confirm the deploy host itself is logged into `ghcr.io`
  (see [Private image access](#private-image-access)); an expired or missing
  host-level login shows up as a 401/403 on `docker compose pull`, not on the CI push step

### Workflow fails with an empty path

- Confirm the `DEPLOY_PATH` repository variable is set; an unset variable expands
  to an empty string and the `cd` will fail

### Health check fails after deploy

- SSH into the deploy host and check `docker logs cohold-staging`
- Verify the env file at `/opt/cohold/staging.env` is populated correctly
- Confirm the reverse proxy is routing to `cohold-staging` on `proxy_network`

### `proxy_network` not found

```bash
docker network create proxy_network
```

Then restart the affected containers.
