# Screenshots

Suggested shots for the README, in priority order. Save them to
`docs/images/` and uncomment the matching `<!-- SCREENSHOT: ... -->` markers.

**Before you capture anything:** switch the panel to English, and make sure
every phone number, contact name and message body on screen is fake. Screenshots
are the easiest way to leak real recipient data into a public repo.

Seed a few plausible-looking messages first — an empty dashboard sells nothing.

---

## 1. Dashboard — the hero shot

Goes at the top of the README. It should show, at a glance, that this is a real
operating system and not a demo: usage numbers, several channels, recent
activity.

Wide crop, full width.

## 2. Channels list

The feature that justifies the whole project. Ideally showing:

- three or more channels
- mixed states — one connected, one in warmup, one disconnected

That single frame tells the rotation-and-failover story better than a paragraph.

## 3. QR pairing

From **Channels → New**. The most recognizable screen in the repo — anyone
who has used WhatsApp Web knows instantly what they're looking at.

Blur or crop the QR itself. A live pairing code is a credential.

## 4. Message history

Shows delivery status tracking and which channel sent what. Use obviously fake
recipients (`+55 11 99999-8888`) and transactional content — an OTP, a sign-up
confirmation.

## 5. Queue

Pending, failed and retrying. Worth including if you can capture a state that
shows a retry, since that's the failover behavior made visible.

## 6. Project tokens

Per-project quota and rate limit. **Mask the token values.** Even a revoked
token in a screenshot is a bad habit to publish.

---

## Adding them to the README

```markdown
![Dashboard](docs/images/dashboard.png)
```

Keep each image under ~300 KB — GitHub serves them inline and large PNGs make
the page crawl. `pngquant` or a quick export at 1600px wide is plenty.

For the LinkedIn post itself, the dashboard and the channels list are the two
that carry best at thumbnail size.
