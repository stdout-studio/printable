# Printable

Design 3D-printable parts by pointing, sketching, and chatting. Fit a part
to something you own, remix an existing model, or start from scratch —
Printable turns your intent into a manifold STL you can send straight to
your slicer or a print shop.

Part of [stdout.studio](https://stdout.studio). MIT licensed.

---

## Try it

**Hosted**: [printable.stdout.studio](https://printable.stdout.studio)

**Self-host**:

```bash
git clone https://github.com/stdout-studio/printable
cd printable
cp .env.example .env
# edit .env: add your ANTHROPIC_API_KEY
docker compose up --build
```

Open `http://localhost:3000`. First boot lands on the setup wizard — pick
an admin password and you're in.

---

## What's in the box

| Component              | What it does                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `apps/web`             | Next.js 16 web app — landing, auth, viewer, chat, agent driver               |
| `apps/blender-worker`  | Python (FastAPI + Blender) headless mesh editor the agent calls into          |
| `apps/indexer`         | Local 3D-corpus embedding index (LanceDB + SigLIP) for similarity retrieval   |
| `packages/shared-types`| TypeScript types shared by `web` and `indexer`                                |

## Dual-mode architecture (self-host + studio)

Every stdout.studio app is built to run in **two modes** from the same codebase:

- **Local mode** (default): SQLite, local filesystem, BYO Anthropic key,
  no Stripe, no analytics, no external services. What you get when you
  clone and run.
- **Studio mode** (`STDOUT_MODE=studio`): shared Postgres, Stripe billing,
  shared Anthropic key (tagged per-app for cost tracking), PostHog
  analytics, Google SSO + email/password. What we deploy at
  `printable.stdout.studio`.

The app talks to abstractions in `apps/web/src/platform/` — `auth`, `ai`,
`billing`, `storage`, `analytics`. Implementation swaps at boot based on
`STDOUT_MODE`. Self-host or hosted, same product, same code.

## Developing

```bash
pnpm install
cp .env.example .env             # set ANTHROPIC_API_KEY
pnpm --filter @printable/web dev # http://localhost:3000
pnpm worker                      # http://localhost:8080 (Blender)
```

The dev server runs in local mode by default. First visit redirects to
`/setup` to create the admin account.

### Useful routes

- `/` — landing page (toggle hosted ↔ self-host view in the header)
- `/setup` — first-run wizard (auto-disabled once the first user exists)
- `/login`, `/signup` — auth flow
- `/app` — the actual product (auth-gated)
- `/impressum`, `/privacy`, `/terms` — legal pages
- `/billing` — subscription management (studio mode only)
- `/api/auth/*` — Better-Auth handler (signin, signout, session, OAuth callbacks)
- `/api/chat` — agent chat endpoint

## Environment variables

| Variable                    | Purpose                                                                 | Default                |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `ANTHROPIC_API_KEY`         | Required — drives the AI agent                                          | _none_                 |
| `STDOUT_MODE`               | `local` (self-host) or `studio` (hosted SaaS)                           | `local`                |
| `STDOUT_DATA_DIR`           | Where SQLite + uploaded files live                                      | `./data`               |
| `STDOUT_ALLOW_SIGNUPS`      | Open public signups on a local-mode instance                            | `false`                |
| `PUBLIC_URL`                | Public URL the instance is reachable at (for OAuth + email links)       | `http://localhost:3000`|
| `BLENDER_WORKER_URL`        | Where the Blender worker is reachable                                   | `http://localhost:8080`|

## License

MIT — see [LICENSE](./LICENSE). Built by stdout.studio.
