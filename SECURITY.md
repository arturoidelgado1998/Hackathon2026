# Security

RouteRipple is a hackathon project. It runs on one laptop for a demo, with
simulated shipments. It is not built to be put on the open internet.

## Reporting a problem

Please do not open a public issue for a security problem.

Use **Report a vulnerability** on this repository's
[Security tab](https://github.com/arturoidelgado1998/Hackathon2026/security/advisories/new).
The report goes privately to the maintainers. Say what you found, how to
reproduce it, and what you think it allows.

If you find something that looks like a key or password anywhere in this
repository or its history, report it the same way, even if it looks expired.

Only the `main` branch is maintained.

## What is and is not protected

These are deliberate limits of a demo, not things to report:

- **No sign-in.** Nothing in the app has accounts.
- **Relays** (`/api/driver-notices`, `/api/sim-state`): a request from another
  device needs the server's access key, which is a shared passcode in a link
  sent over plain HTTP. It keeps a stranger on the same network out. Anyone
  with the link has the same access.
- **AI endpoints** (`/incident`, `/shipment`): answered only for the computer
  the server runs on, and capped at 30 model calls a minute. The model key is
  read from the environment on the server and is never sent to the browser.
- **`--host` puts the dev server on the local network.** Stop it after the demo.

## For contributors

- Keys go in `.env`, which git ignores. `.env.example` holds names only.
- Changes reach `main` through a pull request into `staging`, then one from
  `staging` into `main`. Both need the pipeline's checks to pass.
- `npm run sanity` includes a check for key-shaped strings in tracked files.
