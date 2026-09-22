# Security

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private reporting instead — the **Security** tab → *Report a
vulnerability*. It creates a private thread visible only to me.

I'll acknowledge within a few days. This is a side project maintained by one
person, so I can't promise a fix window, but I'll tell you honestly what I plan
to do and when.

## Scope

Things I'd consider a vulnerability here:

- Authentication bypass on the API or the admin panel
- A project token reaching data belonging to another project
- Tenant isolation failing on a multi-tenant host
- Session credentials (`data/sessions/`) or `ENCRYPTION_KEY` leaking
- Injection reachable through the public API
- Anything letting an unauthenticated caller send messages

Things that are known and documented rather than vulnerabilities:

- **Using Baileys violates WhatsApp's Terms of Service**, and accounts can be
  banned. That's the project's stated premise, not a defect.
- **`RETENTION_DAYS` rounds up.** Partitions are monthly, so a message can live
  up to ~30 days past the configured window. Deliberate and documented in
  `docs/02-modelo-de-dados.md` §3.
- **The worker is a single instance by design** (ADR-002). Running two will
  corrupt session state; the process lock is there to stop you.
- Weak configuration you chose yourself — a guessable `ENCRYPTION_KEY`, an
  exposed Postgres port, a panel published without TLS.

## If you deploy this

A few things that are your responsibility, not the code's:

- **Back up `ENCRYPTION_KEY` somewhere other than the server.** Lose it and
  every paired channel has to be re-paired by QR.
- **The `sessions` volume is the one you can't lose.** The database restores
  from a dump; session credentials don't regenerate.
- **Don't expose Postgres or Redis.** The dev compose file publishes their
  ports for convenience; the production one shouldn't.
- **Rotate project tokens** if one leaks. The panel revokes them without a
  redeploy.
- 2FA on the panel is mandatory and shouldn't be worked around.
