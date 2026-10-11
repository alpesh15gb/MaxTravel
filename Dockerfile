# Max Travel CRM — production container image.
#
# Built and started locally with Docker 29.8 on 11 October 2026: the image compiles, the
# entrypoint applies migrations and /api/health answers 200. It has NOT been run in an
# orchestrator (no Kubernetes, no read-only root filesystem, no network volume), so treat
# those environments as unverified until someone tries them.
#
# Debian slim (not Alpine): Prisma's query engine needs glibc + openssl.
# `output: "standalone"` is deliberately NOT enabled in next.config.mjs, so this image
# runs the real server from the full build output and full node_modules.

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# package-lock.json is committed, so install exactly what is locked.
COPY package.json package-lock.json ./
RUN npm ci
# The Prisma client is generated code, not source: it must exist before the build.
COPY prisma ./prisma
RUN npx prisma generate

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A build must never depend on the deploy's real configuration: the config check is skipped
# during `next build` (Next sets its build phase and the hook returns early), and these throwaway
# values keep that guarantee explicit. They are set for this one command rather than as ENV, so no
# secret-shaped value is left in the image metadata.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="file:/tmp/build-only.db" \
    JWT_SECRET="build-only-placeholder-that-is-at-least-32-bytes-long" \
    npm run build

# Keep build tools out of runtime image layers, not just the final filesystem.
FROM deps AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    UPLOAD_ROOT=/data/uploads

# Prisma CLI is a production dependency because startup applies migrations.
# Build tools are removed from the final image, including ESLint and Tailwind.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json next.config.mjs ./
COPY prisma ./prisma

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY scripts/backup.mjs scripts/restore.mjs ./scripts/
COPY scripts/whatsapp-worker.mjs scripts/configure-evolution.mjs ./scripts/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# SQLite database + private uploads both live on one writable volume.
# The volume must be owned by uid 1000 (the built-in `node` user) or startup fails
# with an explicit "not writable" error from the entrypoint.
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# Node 22 has a global fetch, so no curl/wget in the image just for a probe.
# /api/health returns 503 when the database is unreachable, which marks the
# container unhealthy instead of letting a broken instance keep serving traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
