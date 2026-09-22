## What changes, and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test:all` pass locally
- [ ] Docs in `docs/` updated, if this changes behaviour they describe
- [ ] No real phone numbers or message contents, including in fixtures
- [ ] The three guards that stop tests from sending real messages are intact
      (`-test` queue suffix, `NODE_ENV=test` guard in the worker, mocked enqueue)

## Anything reviewers should know

<!-- Trade-offs you made, things you were unsure about, what you couldn't test. -->
