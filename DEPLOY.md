# Deploying Akere HR

## Option A: Render (free, quickest)

1. Sign in at https://render.com with GitHub and allow access to the `Akere` repository.
2. **New → Blueprint**, pick the repo and branch `claude/friendly-bohr-m1m2xf`. Render reads `render.yaml` and creates `akere-db` (Postgres), `akere-api` and `akere-web`.
3. Click **Apply** and wait for both builds (≈10–15 min the first time).
4. Open the `akere-web` URL (e.g. `https://akere-web.onrender.com`).

Free-plan limits: services sleep after 15 min without traffic, and the first visit then takes 1–3 min (the API also re-creates the demo data on every start, because free services have no persistent disk). Free Postgres is deleted after 30 days. For an always-on demo use Option B.

## Option B: your own server

Target: any Linux VPS with 2 GB RAM (e.g. Hetzner CX22, PS.kz, DigitalOcean). Cost ≈ €4–5/month.

1. **Create the server** (Ubuntu 24.04), note its public IP.
2. **Domain**: point a DNS A-record (e.g. `hr.yourname.kz`) to the IP.
   No domain? Use the free `<IP>.sslip.io` (for IP 203.0.113.7 → `203.0.113.7.sslip.io`).
3. **Install Docker** on the server:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. **Get the code and configure**:
   ```bash
   git clone https://github.com/Maquldar/Akere.git && cd Akere
   git checkout claude/friendly-bohr-m1m2xf
   echo "SIGNING_MASTER_KEY=$(openssl rand -hex 32)" > .env
   echo "DOMAIN=hr.yourname.kz" >> .env
   ```
5. **Start** (Caddy obtains the HTTPS certificate automatically):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
   docker compose run --rm -e SEED_FORCE=true api pnpm exec tsx prisma/seed/index.ts
   ```
6. Open `https://<DOMAIN>`. Demo accounts are on the login page (password `Akere2026demo`).

**Update to a new version**: `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d`

**Reset demo data** (e.g. nightly, visitors change it): `docker compose run --rm -e SEED_FORCE=true api pnpm exec tsx prisma/seed/index.ts`

**Notes**
- `DEMO_MODE=true` is intentional for a public portfolio demo (one-click demo accounts). For real company data set `DEMO_MODE=false` in `docker-compose.yml` and create users via the admin panel.
- Only ports 80/443 are public; the API, database and Mailpit are reachable only inside Docker.
- Firewall: allow 22, 80, 443 (`ufw allow 22,80,443/tcp && ufw enable`).
