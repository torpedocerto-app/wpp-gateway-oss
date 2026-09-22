# Contributing

Thanks for looking. A few things up front, so nobody wastes their time.

## What this project is

This is a working system I built for my own use, published because the
architecture may be useful to others. It is **not** a product, and I'm not
staffing a support rotation for it. Expect the responsiveness of one person
with a day job.

## Using it

**You don't need permission, and you don't need to fork to use it.** MIT means
you can clone it, run it, change it, deploy it, and build something commercial
on top of it. Keep the copyright notice in the LICENSE file; that's the whole
obligation.

Fork only if you want your changes visible on GitHub under your account, or if
you plan to send a pull request. For plain use, `git clone` is enough.

If you do build something with it, I'd genuinely like to hear about it — open a
discussion or say hello. That's an invitation, not a requirement.

## Bugs

Issues are open. Please include:

- what you expected, and what happened instead
- the relevant log lines (the worker logs JSON; `docker compose logs worker`)
- your Node version, and whether you're on the Docker setup or running locally
- **redacted** phone numbers and message contents — never paste real recipient
  data into a public issue

Security problems are different: see [SECURITY.md](SECURITY.md). Don't open a
public issue for those.

## Feature requests

Also welcome, with one caveat: I'll be conservative about anything that makes
the project easier to use for bulk or unsolicited messaging. That's not the use
case (see the README's *Responsible use*), and the constraint is deliberate —
the defaults are conservative because user reports are what get accounts banned.

Requests that fit: better observability, other storage backends, deployment
targets beyond AWS, improvements to the anti-ban heuristics, tests.

Requests that don't: bypassing rate limits, removing opt-out enforcement,
"send to N numbers from a CSV" tooling.

## Pull requests

Small and focused lands faster than large and sweeping. Before opening one:

```bash
pnpm install
pnpm infra:up          # PostgreSQL + Redis
pnpm db:deploy
pnpm lint
pnpm typecheck
pnpm test:all
```

CI runs the same three commands on every PR.

Notes on the codebase:

- **Comments and docs are in Portuguese**, code identifiers in English. Match
  what's around you; don't translate existing comments as part of an unrelated
  change.
- **`docs/` is part of the source.** If you change behaviour the docs describe,
  update the doc in the same PR.
- **Tests that could send a real message are the one unforgivable bug.** There
  are three independent guards (a `-test` queue suffix, a `NODE_ENV=test` guard
  in the worker, and a mocked enqueue). Don't route around them.
- Never commit a real phone number, even in a test fixture. The fake ranges in
  use are `5511999998888` and similar.

I may take a while to review, and I may say no to things that work fine but
that I don't want to maintain. Neither is a judgement on the contribution.

## Discussions

Questions about how to use it, whether it fits your case, or how some part
works are better as a discussion than an issue. Issues are for defects.
