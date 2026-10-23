# Production image, used by docker-compose.yml and Fly.io (fly.toml).
# Debian-based (glibc) rather than alpine (musl) so the committed lockfile's
# optional native deps resolve cleanly under `npm ci`.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Every page is dynamic, so the build never touches the DB or needs secrets.
RUN npm run build

FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# Production deps only. tsx is one of them: `npm run db:migrate` and
# `npm run sync` run their TypeScript sources inside this image.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY lib ./lib
EXPOSE 3000
CMD ["npm", "start"]
