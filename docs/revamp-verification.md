# Verification — 11 October 2026

Scope: UI polish, reporting and a single-office deployment package.

| Check | Result |
| --- | --- |
| Next production build, integrated TypeScript and lint | Passed |
| Regression suite (`node tests/smoke.mjs`) | 190 checks passed |
| Accessibility gate, including Reports, desktop 1440 and phone 390 | Passed; zero findings outside budget, zero accepted findings |
| UI metrics gate, 21 routes at desktop and phone widths | Passed; zero nested scrolling; median text 14px |
| Report screen visual review | Desktop and phone screenshots inspected |
| Production dependency audit after moving Prisma CLI to runtime dependencies | Zero known vulnerabilities |
| Full development dependency audit | 9 advisories; build tools excluded from production image |
| Docker Compose configuration validation | Passed |
| Production Docker image build | Passed |
| Disposable container: setup, migrations, login | Passed |
| Disposable container: 20 simultaneous authenticated Reports/Pulse reads | Passed |
| Container restart persistence | Passed |
| Container backup plus verified restore to a separate directory | Passed |
| ESLint/Tailwind absent from runtime filesystem | Passed |

The final regression run adds branch isolation, inclusive India-day end, exclusion of the
next day's midnight, and explicit notification read behavior to the earlier 185 checks.
The accessibility and UI gates passed against the final application source; subsequent
changes were test fixtures, documentation and Docker packaging only.

All application verification used isolated test databases and private upload directories.
The container harness used a disposable volume and cleaned it up. No live customer data
was used or changed. No deployment to an agency server was performed.

Remaining launch work: actual host/domain, HTTPS certificate verification, owner/staff
configuration, off-site backup destination and schedule, alert delivery, restore drill on
the chosen host and representative concurrent write workflows. The application remains
single-instance SQLite; the read probe does not establish full 20-user workload capacity.

See [single-office-launch.md](single-office-launch.md) for the launch procedure and
[reporting-research.md](reporting-research.md) for product references and reporting definitions.
