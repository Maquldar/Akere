# Deploying Akere HR to a server

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
