# Deployment

Two paths, depending on what you need:

- **[Single host with Docker Compose](#single-host-docker-compose)** — one server,
  one instance. Start here.
- **[Multi-tenant on AWS with CI/CD](#multi-tenant-on-aws)** — several isolated
  instances on one machine, deployed from GitHub Actions. This is what the
  `scripts/` directory automates.

Either way, the runtime is the same four containers: `api`, `worker`, `panel`,
plus PostgreSQL and Redis.

---

## Before you start

**You need a phone number you can dedicate to this.** Pairing a channel means
scanning a QR code with WhatsApp on a real account, and that account is then
tied to this gateway. Don't use your personal number.

**Understand what you're signing up for.** Using WhatsApp Web through an
unofficial library violates WhatsApp's Terms of Service. Accounts get banned,
sometimes without any obvious trigger. Plan for it: add more than one channel,
and be ready to replace one.

---

## Single host (Docker Compose)

Any VPS with 2 GB RAM will do. Requirements: Docker with the Compose plugin,
and a domain pointing at the host if you want TLS.

### 1. Get the code and configure

```bash
git clone <this-repo> /opt/wpp-gateway
cd /opt/wpp-gateway
cp .env.example .env
```

Generate the secrets:

```bash
for v in ENCRYPTION_KEY SESSION_SECRET PANEL_SESSION_SECRET INTERNAL_API_TOKEN; do
  echo "$v=$(openssl rand -hex 32)"
done
```

Put those in `.env`, then set the rest:

```bash
NODE_ENV=production

# Point at the containers, not localhost
DATABASE_URL=postgresql://wpp:<strong-password>@postgres:5432/wpp
REDIS_URL=redis://:<strong-password>@redis:6379
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>

# Your deploy's identity
PANEL_PUBLIC_URL=https://wpp.your-domain.com
PANEL_BRAND_NAME=Your Company

# Where channel-down alerts go (E.164, no "+")
ALERT_WHATSAPP_NUMBER=5511999998888
ALERT_EMAIL=you@your-domain.com

# SMTP is the fallback alert path — set all three or none
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...

# Timezone matters — see the warning below
TENANT_TIMEZONE=America/Sao_Paulo
SILENT_HOURS_START=23
SILENT_HOURS_END=6

# Session storage — this path must be a persistent volume
SESSIONS_PATH=/app/data/sessions
```

> ⚠️ **`TENANT_TIMEZONE` is not cosmetic.** It decides when quiet hours start,
> when daily caps reset, and what "today" means on the dashboard. Servers run in
> UTC; if you leave this at the default while operating from, say, Brazil, your
> quiet window will be off by three hours and your daily limit will reset in the
> middle of your afternoon.

> ⚠️ **`ENCRYPTION_KEY` encrypts stored WhatsApp credentials.** If you lose or
> change it, every paired channel has to be re-paired by QR. Back it up
> somewhere other than the server.

### 2. Start it

```bash
docker compose -f docker/compose.app.yml up -d postgres redis
docker compose -f docker/compose.app.yml run --rm migrate
docker compose -f docker/compose.app.yml up -d api worker panel
```

### 3. Put TLS in front

The panel and API shouldn't be exposed directly. With Caddy, a two-line
`Caddyfile` gets you automatic certificates:

```caddyfile
wpp.your-domain.com {
    handle /v1/* {
        reverse_proxy api:3000
    }
    handle {
        reverse_proxy panel:3001
    }
}
```

Note the split: `/v1/*` goes to the API, everything else to the panel — one
domain serves both.

### 4. Create your admin user

```bash
bash scripts/admin-create.sh <tenant> you@your-domain.com
```

It creates the user with no password, generates a 72-hour setup token and prints
a `/login/setup?token=...` URL. Open that URL to set a password (12 characters
minimum) and enrol 2FA — both are mandatory. Further users are invited from the
panel's **Users** screen.

If you're running a single instance rather than the multi-tenant layout, the
script still expects a tenant slug, since it locates that tenant's `panel`
container.

### 5. Pair your first channel

In the panel: **Channels → New**. It shows a QR code — scan it from
WhatsApp on the phone whose number you're dedicating to this
(*Settings → Linked devices → Link a device*).

<!-- SCREENSHOT: QR pairing screen -->

The channel enters **warmup**: reduced limits for the first 7 days. Don't skip
this. A brand-new account pushing volume is the clearest signal there is.

### 6. Create a project token

**Projects → New** generates the token your systems will use. Each project gets
its own token, quota and rate limit, so you can track usage and cut one system
off without touching the others.

Test it:

```bash
curl -X POST https://wpp.your-domain.com/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"5511999998888","text":"Hello from wpp-gateway"}'
```

Your deploy now serves its own integration reference at
**`https://wpp.your-domain.com/docs/api`** — public, no login, in English,
Portuguese and Spanish. Point whoever is writing the client at that URL rather
than at this file: it's generated from the deploy itself, so it always matches
the version actually running.

---

## Multi-tenant on AWS

What `scripts/` automates: several fully isolated instances on a single EC2 box,
each with its own domain, database, Redis, channel pool and volumes. Nothing is
shared between tenants except the host and a single Caddy in front.

This runs on a `t4g.medium` (ARM) — small and cheap, since the workload is
mostly idle waiting on WhatsApp.

### Architecture

```
                    Internet
                       │
                  ┌────▼────┐
                  │  Caddy  │  one instance, routes by domain, automatic TLS
                  └────┬────┘
         ┌─────────────┴─────────────┐
         ▼                           ▼
  wpp-acme_net                 wpp-nova_net      ← isolated Docker networks
  ┌──────────────┐             ┌──────────────┐
  │ api          │             │ api          │
  │ worker       │             │ worker       │
  │ panel        │             │ panel        │
  │ postgres     │             │ postgres     │
  │ redis        │             │ redis        │
  │ volumes:     │             │ volumes:     │
  │  pgdata      │             │  pgdata      │
  │  sessions ⚠  │             │  sessions ⚠  │
  └──────────────┘             └──────────────┘
   wpp.acme.com                 wpp.nova.com
```

Each tenant runs as Docker Compose project `wpp-<tenant>`, which prefixes its
containers, network and volumes. Config lives in SSM Parameter Store under
`/wpp-gateway/<tenant>/`, so secrets never sit in the repo or in the AMI.

### Setup

**1. Declare your tenants** in [`scripts/tenants`](scripts/tenants) — one per
line, `<slug> <domain>`:

```
acme      wpp.acme-example.com
nova      wpp.nova-example.com
```

The slug becomes the Compose project name, the volume prefix and the SSM
namespace. Point each domain's DNS at the EC2 instance's Elastic IP.

**2. Put each tenant's config in SSM** under `/wpp-gateway/<tenant>/`, one
parameter per environment variable. Use `SecureString` for anything secret:

```bash
aws ssm put-parameter --type SecureString \
  --name /wpp-gateway/acme/ENCRYPTION_KEY --value "$(openssl rand -hex 32)"
aws ssm put-parameter --type String \
  --name /wpp-gateway/acme/PANEL_PUBLIC_URL --value "https://wpp.acme-example.com"
# ...and so on for every variable in .env.example
```

`deploy.sh` reads this path and writes the tenant's `.env` on the host at deploy
time. It aborts if the path is empty, rather than starting with a half-built
config.

**3. Provision the instance** with
[`scripts/user-data.sh`](scripts/user-data.sh) as EC2 user data — it installs
Docker, the AWS CLI and the SSM agent, and lays out `/opt/wpp-gateway`.

The instance needs an IAM role granting: SSM parameter read, ECR pull, S3 write
for backups, and SNS publish for alarms.

> **Use an Elastic IP.** WhatsApp notices when a session's IP keeps changing.
> A stable address is one less anomaly signal.

**4. Configure GitHub Actions.** The
[workflow](.github/workflows/deploy.yml) authenticates via OIDC — no long-lived
AWS keys in GitHub. Set:

- `vars.AWS_ACCOUNT_ID`, `vars.AWS_REGION`
- the IAM role ARN the workflow assumes
- an IAM trust policy scoped to your repo:
  `repo:<your-user>/wpp-gateway:*`

On push to `main` it builds the image, pushes to ECR, then invokes
`deploy-all.sh` over SSM — which applies the same image to every tenant in
`scripts/tenants`, one at a time.

**5. Set up the proxy:**

```bash
bash scripts/deploy-caddy.sh
```

This regenerates the Caddyfile from `scripts/tenants` and reloads Caddy. Run it
whenever you add or remove a tenant.

### What a deploy actually does

`scripts/deploy.sh <tenant> <image-tag>`:

1. Builds the tenant's `.env` from SSM
2. Logs into ECR and pulls the image
3. Runs migrations
4. Recreates `api` and `panel` — always
5. Recreates `worker` — **only if the image actually changed**
6. Reinstalls the backup cron, prunes old images

Step 5 is the subtle one. The worker holds live WhatsApp sessions, so recreating
it costs a reconnect. Comparing the running worker's image ID against the newly
pulled one is what avoids needless churn — and it has to be the *running
container's* image, not the tag on disk, because after the first tenant is
deployed the new tag is already local and every subsequent tenant would compare
equal.

### Backups

[`scripts/backup.sh`](scripts/backup.sh) runs by cron per tenant: dumps
PostgreSQL, archives the sessions directory, uploads both to S3.

> 🔴 **The `sessions` volume is the one you can't lose.** The database can be
> restored from a dump; session credentials cannot be regenerated. Losing them
> means re-scanning the QR code for every channel on that tenant — which means
> touching every phone you've paired.

CloudWatch alarms publish to SNS per tenant. Pair them with the in-app
channel-down alert: the app tells you a channel dropped, CloudWatch tells you
the host is unhealthy.

---

## Operations

### Useful commands

The worker ships a CLI, run as `pnpm worker <command>`:

```bash
pnpm worker list                    # channels and their status
pnpm worker pair <label>            # add a channel, print its QR
pnpm worker logout <accountId>      # drop a channel's session
pnpm worker diagnose                # connectivity diagnostics
pnpm worker queue:status            # what's pending / failed / retrying
pnpm worker send <accountId> <number> <text>   # send directly, bypassing the queue
pnpm worker settings set alert_whatsapp_number 5511999998888
```

On a multi-tenant host, run it inside that tenant's worker container:

```bash
# Follow logs for one tenant
docker compose -p wpp-acme -f docker/compose.app.yml logs -f worker

# Channel status for one tenant
docker compose -p wpp-acme -f docker/compose.app.yml exec worker \
  pnpm worker list
```

Panel access recovery — the break-glass path when password reset email isn't an
option:

```bash
bash scripts/admin-reset.sh acme --email you@your-domain.com
bash scripts/admin-reset.sh acme --email you@your-domain.com --password-only
```

Without `--password-only` it clears both password and 2FA, sending the user back
through `/login/setup`.

Some settings live in the database's `settings` table and override the
environment at runtime — the alert number among them — so you can change them
without a deploy.

### When a channel goes down

You'll get an alert. Then:

1. Check the panel — **Channels** shows the status and why it disconnected
2. **Transient disconnect** — it reconnects on its own; nothing to do
3. **Actually banned** (401/403) — the account is gone. Pair a new number as a
   new channel; queued messages fail over to the remaining channels meanwhile

This is why more than one channel matters. With a single channel, a ban is an
outage. With three, it's a Tuesday.

### Upgrading

Push to `main`. The workflow builds, pushes and deploys to every tenant.
Migrations run before the new containers come up, and the worker is only
recreated when the image changed — so a docs-only change won't disturb live
sessions.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Service won't start, complains about an env var | Zod validation rejected the config. The log names the variable — it's missing or malformed |
| QR code never appears | Worker can't reach Redis, or `SESSIONS_PATH` isn't writable |
| Channel re-pairs on every restart | `SESSIONS_PATH` isn't on a persistent volume |
| Messages queue but never send | All channels down or in quiet hours; check **Queue** in the panel |
| Nothing sends at a specific time of day | Quiet hours in the wrong timezone — check `TENANT_TIMEZONE` |
| Panel 404s on every route | Check the reverse proxy: `/v1/*` must go to `api`, everything else to `panel` |
| Everything paired, alerts silent | `ALERT_WHATSAPP_NUMBER` is a channel in this same pool — if the pool is down, so is the alert. Set `ALERT_EMAIL` and SMTP as the independent fallback |
