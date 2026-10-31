# Isolated Vercel review environment

The CRM can run with either SQLite or PostgreSQL. Existing VPS installations keep the canonical SQLite schema and migration history. This change does not convert an existing database.

The PostgreSQL schema is derived from prisma/schema.prisma by scripts/prisma-database.mjs. It uses an independent migration directory, prisma/postgresql/migrations. Use npm run db:migrate:postgres with a direct MIGRATION_DATABASE_URL for that provider. Never run a PostgreSQL baseline against an existing SQLite database; never use db push/reset for an update. Future model changes need a reviewed migration in each provider's history.

Postinstall generates both provider clients. npm run build regenerates clients before the production build. Local Windows builds should stop their own review server before regenerating its loaded native Prisma engine. Both clients share the canonical model contract. PostgreSQL financial writes use serializable transactions; a concurrent conflicting update produces a refresh/retry response rather than claiming success.

The dedicated maxtravel-crm-preview Vercel project is in Alpesh Manjiyani's PRO team, region Mumbai, Node 22, with deployment protection enabled. Its Neon database is maxtravel_crm_preview on the isolated ux-review branch. No production data is copied. Booking uses a different database on that branch.

Preview secrets are server-only project environment variables: DATABASE_URL, JWT_SECRET, CRM_DATA_ENCRYPTION_KEY, WA_WORKER_SECRET and BLOB_READ_WRITE_TOKEN. Use the generated per-deployment VERCEL_URL as the trusted origin when APP_ORIGIN is absent. A configured APP_ORIGIN continues to take precedence. Do not place secrets in NEXT_PUBLIC variables or browser bundles.

Set PRIVATE_STORAGE=vercel-blob for durable private documents and package media. UPLOAD_ROOT and PACKAGE_MEDIA_ROOT are bounded local caches under /tmp on Vercel. File downloads still require their existing staff permission or signed public-upload flow. The Blob store is private. Failed durable writes fail the operation; deleting a local cache does not delete the durable file. Disk remains the default for a VPS. This is not a public CDN migration.

Apply migrations in a separate controlled job before opening the candidate deployment. Builds never apply database migrations. Docker supports the provider-specific startup migration, with RUN_MIGRATIONS=false available for a separate migration job. The authenticated WhatsApp worker remains a separate service; a Vercel frontend deployment does not start a continuous worker.

The existing VACUUM-based backup/restore scripts remain SQLite-only and reject other providers. PostgreSQL needs provider snapshots or pg_dump/pg_restore with a separate restore rehearsal. Private Blob retention must be included in a cloud recovery policy. Do not restore SQLite archives into PostgreSQL.

The live preview probe is tests/cloud-preview-smoke.mjs. It refuses a non-preview database, writes only synthetic records, checks the real case/work/review/invoice APIs and captures admin/staff views. Private access and generated credentials are saved under gitignored test-artifacts. Local Mailpit verification used by booking is not evidence of cloud SMTP delivery. No live supplier reservation, money movement, or customer WhatsApp is part of these checks.

Vercel Git source lookup was unavailable for this connected account. The review deployment uploads only files from the verified Git commit, with commit metadata attached. Use an explicit REST API target of staging for Preview. No automatic production promotion is configured by this workflow.

Protected service requests use @vercel/oidc only for exact HTTPS origins in PROTECTED_API_ORIGINS. Application signing and actor permissions remain mandatory. The header adds deployment access, not application authority. Unconfigured origins and non-Vercel workers never request or forward an identity token. Malformed allowlists and missing identities fail closed. Trusted Sources must be separately approved before granting Preview-to-Preview access between the two project IDs. The standalone CRM delivery worker remains a separately hosted service; deploying its website does not run a continuous worker.

PostgreSQL search filters retain SQLite LIKE case behavior for contains/startsWith/endsWith, including nested string negation. Exact identifier comparisons remain case-sensitive. Native PostgreSQL checks cover both behaviors. Synthetic access credentials live in gitignored .env.codex-preview-users.local, outside disposable browser output.
