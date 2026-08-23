# Self-hosting Cohold

Cohold is a single Node process backed by SQLite. It has no external database,
cache or queue, so a small VPS, a home server or a Raspberry Pi is plenty.

This guide covers the Docker Compose route, which is the recommended way to run
Cohold. For a bare-metal install with systemd, see
[deployment-bare-metal.md](./deployment-bare-metal.md).

## Requirements

- Docker with the Compose plugin
- About 1 GB of RAM and 1 GB of disk to start
- A domain and a reverse proxy if you want HTTPS and access from the internet

## 1. Get the code

```bash
git clone https://github.com/AlexanderPezarro/cohold.git
cd cohold
```

## 2. Create your configuration

```bash
cp .env.example .env
```

Now generate the secrets. **Do not** ship the placeholder values — anyone who
knows them can forge sessions and read your encrypted documents.

```bash
# Session and JWT secrets
openssl rand -base64 32

# Encryption keys — 64 hex characters each
openssl rand -hex 32
```

Edit `.env` and set at minimum:

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | From `openssl rand -base64 32` |
| `JWT_SECRET` | From `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | From `openssl rand -hex 32`. Encrypts uploaded documents. |
| `BANK_TOKEN_ENCRYPTION_KEY` | From `openssl rand -hex 32`. Encrypts bank OAuth tokens. |
| `CLIENT_URL` | The public URL you will reach Cohold on, e.g. `https://cohold.example.com` |

> **Keep `ENCRYPTION_KEY` and `BANK_TOKEN_ENCRYPTION_KEY` safe and unchanged.**
> They are not stored in the database. If you lose or rotate them, previously
> uploaded documents and stored bank tokens cannot be decrypted.

Optionally set an initial admin account, created automatically on first start:

```
OWNER_EMAIL=you@example.com
ADMIN_PASSWORD=a-strong-password
```

Both must be set for this to take effect. If you leave them out, you will create
the first account through the setup wizard in the browser instead. Either way,
this only happens while no account exists yet.

## 3. Start it

```bash
docker compose -f compose.self-host.yml up -d
```

The first build takes several minutes because it compiles the client and native
modules. Subsequent starts are fast.

Database migrations run automatically on every start, so upgrades need no manual
step.

Check it came up:

```bash
docker compose -f compose.self-host.yml ps
curl http://localhost:3000/api/health
```

You should get `{"status":"ok",...}`. Then open http://localhost:3000.

## 4. Put it behind HTTPS

Cohold does not terminate TLS itself. Run it behind a reverse proxy. With Caddy,
a `Caddyfile` this short is enough:

```
cohold.example.com {
    reverse_proxy localhost:3000
}
```

Set `CLIENT_URL=https://cohold.example.com` in `.env` and restart so that links in
outgoing emails point at the right place.

> Serve Cohold over HTTPS if it is reachable from the internet. Session cookies
> and tenant financial data should never cross the network in the clear.

## Optional features

Cohold runs fine without these; the features are simply inactive until configured.

### Email

Password resets and notifications need a [Resend](https://resend.com) API key:

```
RESEND_API_KEY=re_...
EMAIL_FROM=Cohold <noreply@yourdomain.com>
```

Without this, password reset emails cannot be sent — so set an admin password you
will not lose, or configure email before you need it.

### Monzo bank integration

To sync real transactions and match them against expected rent, register a client
at the [Monzo developer portal](https://developers.monzo.com/) and set:

```
MONZO_CLIENT_ID=...
MONZO_CLIENT_SECRET=...
MONZO_REDIRECT_URI=https://cohold.example.com/api/bank/monzo/callback
WEBHOOK_BASE_URL=https://cohold.example.com
MONZO_WEBHOOK_SECRET=...   # node -e "console.log(require('crypto').randomUUID())"
```

`WEBHOOK_BASE_URL` must be reachable from the internet for webhooks to arrive.

## Backups

Everything that matters lives on the `cohold-data` volume: the SQLite database and
the uploads directory. Back up the volume and your `.env` file — without the
encryption keys in `.env`, a backup of the documents is useless.

```bash
docker compose -f compose.self-host.yml stop

docker run --rm \
  -v cohold_cohold-data:/data:ro \
  -v "$(pwd)/backups:/backup" \
  busybox tar czf /backup/cohold-$(date +%F).tar.gz -C /data .

docker compose -f compose.self-host.yml start
```

Stopping first avoids copying a SQLite file mid-write. Store a copy off the host,
and **test a restore** — an untested backup is not a backup.

## Upgrading

```bash
git pull
docker compose -f compose.self-host.yml up -d --build
```

Migrations run automatically on start. Take a backup first.

## Troubleshooting

**Container exits immediately.** Check the logs:

```bash
docker compose -f compose.self-host.yml logs -f
```

A migration failure is fatal by design and will be the first error shown.

**Cannot log in after a restore.** Confirm `SESSION_SECRET` matches the one in use
when the backup was taken; changing it invalidates existing sessions.

**Documents will not open.** `ENCRYPTION_KEY` has changed. Restore the original
value from your backup of `.env`.

**Port already in use.** Change `PORT` in `.env`; the compose file publishes
`${PORT:-3000}` on the host.
