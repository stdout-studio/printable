# Kerf

Design 3D-printable parts by pointing, sketching, and chatting. Fit a part to
something you own, remix an existing model, or start from scratch — Kerf turns
your intent into a manifold STL you can send straight to your slicer or a print
shop.

Open source, MIT licensed. Self-host it, or use the hosted version at
[kerf.stdout.studio](https://kerf.stdout.studio).

---

## Try it

**Self-host:**

```bash
git clone https://github.com/stdout-studio/kerf
cd kerf
cp .env.example .env
# edit .env: add your ANTHROPIC_API_KEY
docker compose up --build
```

Open `http://localhost:3000`. First boot lands on the setup wizard — pick an
admin password and you're in. (The first build downloads Blender, so it's large.)

---

## What's in the box

| Component               | What it does                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `apps/web`              | Next.js 16 web app — 3D viewer, chat, agent driver                          |
| `apps/blender-worker`   | Python (FastAPI + Blender) headless mesh editor the agent calls into        |
| `apps/indexer`          | Local 3D-corpus embedding index (LanceDB + SigLIP) for similarity retrieval |
| `packages/shared-types` | TypeScript types shared by `web` and `indexer`                              |

## Self-host vs hosted

Kerf runs in two modes from the same codebase:

- **Local mode** (default, `KERF_MODE=local`): SQLite, local filesystem, BYO
  Anthropic key, a single admin password, no billing, no analytics, no external
  services. You get the **raw product** — no marketing pages. This is what you
  get when you clone and run.
- **Hosted mode** (`KERF_MODE=hosted`): the app delegates auth + billing to a
  platform backend over HTTP (shared login, Stripe). It's how the hosted version
  runs; self-hosters never touch it.

The app talks to abstractions in `apps/web/src/platform/` — `auth`, `ai`,
`billing`, `storage`, `analytics` — that swap implementation at boot based on
`KERF_MODE`.

## Developing

```bash
pnpm install
cp .env.example .env             # set ANTHROPIC_API_KEY
pnpm --filter @printable/web dev # http://localhost:3000
pnpm worker                      # http://localhost:8080 (Blender)
pnpm --filter @printable/web test
```

The dev server runs in local mode by default; the first visit redirects to
`/setup` to create the admin account.

### Useful routes

- `/` — local mode goes straight to the product; hosted mode shows the landing
- `/setup` — first-run wizard (auto-disabled once the first user exists)
- `/login`, `/signup` — auth flow
- `/app` — the product (auth-gated)
- `/impressum`, `/privacy`, `/terms` — legal pages
- `/api/chat` — agent chat endpoint

## Environment variables

| Variable             | Purpose                                            | Default                 |
| -------------------- | -------------------------------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY`  | Required — drives the AI agent                     | _none_                  |
| `KERF_MODE`          | `local` (self-host) or `hosted`                    | `local`                 |
| `KERF_DATA_DIR`      | Where SQLite + uploaded files live                 | `./data`                |
| `KERF_ALLOW_SIGNUPS` | Open public signups on a local-mode instance       | `false`                 |
| `PUBLIC_URL`         | Public URL the instance is reachable at            | `http://localhost:3000` |
| `BLENDER_WORKER_URL` | Where the Blender worker is reachable              | `http://localhost:8080` |

## License

MIT — see [LICENSE](./LICENSE).
