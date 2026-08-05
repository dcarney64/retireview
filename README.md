# ProjectSkeleton

A reusable full-stack starter: Express + PostgreSQL backend and React (Vite +
Tailwind) frontend, with a complete auth and security layer already wired up.

## What's included

- **Auth**: register, login, JWT access tokens (15 min) + httpOnly refresh
  cookie, logout, argon2id password hashing with pepper, zxcvbn password policy
- **2FA**: email OTP and TOTP (authenticator app) with backup codes, trusted
  devices, localhost bypass for dev
- **Security**: per-IP failed-attempt auto-blocking, login history with
  geolocation, new-IP / impossible-travel email alerts, nightly cleanup job
- **Admin**: user management (create / role / activate / delete), security
  dashboard (blocked IPs, login history, active sessions)
- **App shell**: sidebar + topbar layout, dark/light theme, protected routes,
  settings page (profile, change password, security)
- **Infra**: docker-compose (Postgres + backend + frontend), idempotent schema
  migration on boot, rate limiting, helmet, request timeouts

## Using this as a template

1. Copy this folder and rename it to your project.
2. Find & replace the placeholders:
   - `ProjectName` → your app's display name (page titles, emails, UI)
   - `projectname` → your app's slug (DB name, container names, storage keys)
   - `project-skeleton` → your package name (all three `package.json` files)
3. `cp .env.example .env` and generate real secrets (each variable has a
   comment explaining how).
4. Boot it (below), log in as the seed admin, change the password.
5. Build your app: every extension point is marked with
   `ADD YOUR ... BELOW THIS LINE` or `TODO` comments:
   - `backend/src/db/schema.sql` — your tables
   - `backend/src/index.js` — your route mounts
   - `backend/src/jobs/jobManager.js` — your cron jobs
   - `frontend/src/App.jsx` — your routes
   - `frontend/src/components/layout/Sidebar.jsx` — your nav

## Quick start (Docker)

```bash
cp .env.example .env    # then fill in real secrets
docker compose up --build
```

- Frontend → http://localhost:51176
- Backend → http://localhost:8004
- Postgres → localhost:5432 (volume `pgdata`)

The schema is applied automatically on backend boot (`src/db/migrate.js` runs
`schema.sql`, which is idempotent). The seed admin (`ADMIN_EMAIL` /
`ADMIN_PASSWORD` from `.env`, defaults `admin@example.com` / `changeme123`) is
created on first boot when the users table is empty — **change the password
immediately after first login**.

## Quick start (bare metal dev)

```bash
npm install
cp .env.example .env            # fill in secrets; set DB_HOST=localhost
docker compose up -d db         # or point .env at your own Postgres
npm run dev                     # backend :8004 + Vite :5176
```

For dev without SMTP, set `DEV_MODE_LOG_OTP=true` (OTP codes print to the
backend console) or `TWO_FA_ENABLED=false`. Logins from localhost skip 2FA
automatically.

## Scripts

- `npm run dev` — backend + frontend dev servers
- `npm start` / `npm stop` / `npm run status` / `npm run restart` — background
  process management (`scripts/*.sh`)
- `npm run docker:up` / `npm run docker:down`
- `npm run kill` — force-kill everything on the project ports
- `npm run ports` — show what's listening
