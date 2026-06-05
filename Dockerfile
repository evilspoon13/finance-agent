# Single image, reused by the `migrate` (one-shot) and `app` services in
# docker-compose.yml. Runs the Next.js dev server — chosen over a production
# build so a fresh clone never hits build-time prerender against the DB/Plaid.
# Debian-based (glibc) rather than alpine (musl) so the committed lockfile's
# optional native deps resolve cleanly under `npm ci`.
FROM node:24-slim
WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

# App source (see .dockerignore for what's excluded).
COPY . .

EXPOSE 3000
# Next 16 binds `next dev` to 0.0.0.0 by default, so it's reachable from the host.
CMD ["npm", "run", "dev"]
