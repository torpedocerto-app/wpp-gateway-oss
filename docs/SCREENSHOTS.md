# Screenshots

The images in `docs/images/` were captured from a local instance seeded with
fictitious data. This file explains how to regenerate them.

Every phone number, contact and message body comes from
[`packages/database/prisma/seed-demo.ts`](../packages/database/prisma/seed-demo.ts)
and is fake. **Never capture screenshots from an instance holding real recipient
data** — a screenshot is the easiest way to leak it into a public repo.

## Regenerating

```bash
# 1. Infra + schema
pnpm infra:up
pnpm db:deploy

# 2. Demo data: 4 channels (connected / warmup / banned), 3 projects,
#    ~110 messages, opt-outs and 14 days of daily stats
pnpm --filter @wpp/database exec tsx prisma/seed-demo.ts

# 3. Panel
pnpm --filter @wpp/panel dev
```

Then set the panel language to English and capture at 1440px wide.

Two things the seed depends on:

- **`TENANT_TIMEZONE`** decides what counts as "today". The seed anchors its
  messages to 06:00 in that timezone, so the dashboard's daily cards are only
  populated if the tenant's local clock is past mid-morning. Capturing outside
  those hours produces an almost-empty dashboard — which is correct behaviour,
  just a poor screenshot.
- **The worker** must be running (`pnpm --filter @wpp/worker dev`) for the Queue
  screen to render; it reads live queue state over the worker's internal API
  rather than from the database.

## The shots

| File | Screen | Why it's worth showing |
|---|---|---|
| `dashboard.png` | Dashboard | Pool status, per-channel volume against each cap, failures by reason |
| `channels.png` | Channels | The whole story in one frame: healthy channels, one in warmup, one banned |
| `channel-detail.png` | Channel detail | Event timeline with `statusCode: 401` — ban vs. transient disconnect |
| `messages.png` | Messages | Delivery status, direction, per-project attribution, a real error |
| `opt-out.png` | Opt-out | Suppression list, with the contact who replied STOP |
| `projects.png` | Projects | Per-project tokens, quotas and rate limits |
| `alerts.png` | Alerts | Where channel-down notifications go |

Not included:

- **QR pairing** — the QR only renders on step 2 of the wizard, which requires
  pairing a real WhatsApp number. Not worth doing for a screenshot.
- **Queue** — with no jobs actually in flight it renders all zeros, which says
  nothing. Capture it while a batch is being processed if you want it.

## Adding one to the README

```markdown
![Dashboard](docs/images/dashboard.png)
```

Keep each image under ~300 KB. `sips -Z 1440 in.png --out out.png` on macOS is
usually enough; `pngquant` compresses further if you have it.
