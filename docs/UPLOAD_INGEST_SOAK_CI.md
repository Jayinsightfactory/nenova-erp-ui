# Disposable upload/login/home soak

The workflow `.github/workflows/upload-ingest-soak.yml` runs only when a PR changes
that workflow itself, or through manual dispatch. It does not deploy anything.
Three independent GitHub-hosted Ubuntu runners test 5, 10 and 20 synthetic users
for **1,800 seconds each**, in parallel. No staff PC or production server receives
sustained test traffic. The harness refuses runs of 5 minutes or longer outside
the explicitly marked disposable Linux GitHub Actions job.

## Scope and expected cost before starting

- Workload wall time is 30 minutes per runner, plus dependency installation,
  image pull, production API build and cleanup: plan roughly 35–45 minutes wall
  time and 105–135 Linux runner minutes in total. These are estimates, not a bill.
  Each job has a 55-minute hard deadline; repeated commits cancel the older run.
- Each job requires at least 2 CPUs, 6 GiB RAM and 10 GiB available disk at the
  initial check. SQL is capped at 2 GiB/1 CPU; the client heap is capped at 384 MiB,
  the web heap at 1,024 MiB, build heap at 1,536 MiB, and existing file children
  retain their separate limits. Heap ceilings are not total RSS ceilings.
- The immutable SQL Server 2022 image digest is pinned in the setup script and
  workflow. A new container exposes only loopback port 14339 and contains just
  20 random-password synthetic login accounts. No repository production secrets,
  service tokens, `.env` files or production runtime data are loaded.
- The target's actual production Next API code is built in an isolated snapshot.
  Existing static source dependencies of its boot scheduler are copied too.
  Requests target only local login, authenticated personal-home and upload APIs.
  The SQL fixture is not a full ERP schema; unrelated boot-scheduler SQL is not
  covered by this test.

## Sustained workload and bounded memory

Each identity continuously logs in and reads its own 250 seeded tasks through
separate loops. Uploads are streamed from disk every roughly 15 seconds in a
30-minute stage; the cadence limits each identity to approximately 120 files,
with a hard fixture bound of 122. Upload retries retain the same bytes and are
bounded. Each job includes a fresh, readable exact 25 MiB XLSX and valid synthetic
PDFs. Fresh cycles are distributed; most later workbooks are ordinary 업무자료,
with a pairable 원가자료 workbook every twelve uploads and invoice PDFs on
alternate uploads. This exercises ongoing original storage and background pairs
without manufacturing a single-cycle all-to-all matching corpus.

The earlier short-run harness stored complete `r.data` bodies in per-request
arrays, retaining JWTs and hundreds of task objects per response. That is removed.
Metrics now use five fixed numeric histograms (1,200,040 bytes total), bounded
HTTP-status counters and exact maxima. P95 has 1 ms bucket resolution. Only the
current per-user authentication tokens and transient in-flight response bodies
remain in memory. Upload integrity uses bounded ID/SHA sets, not response bodies.
Optional local timing samples use an allowlist and stream backpressure; CI turns
them off. Client RSS/heap peaks and actual request overlap are summarized.

Success requires zero timeouts/application failures, complete planned upload
acknowledgments, matching ID/size/SHA on actual stored originals, no different IDs
for one SHA, maximum-size fixture success and successful login/home requests while
uploads are active. HTTP deadlines are absolute, independent of socket activity.

## Artifacts and cleanup

The artifact contains **only two allowlisted aggregate files**:

- `work/mixed-load/public/soak-summary.json`
- `work/mixed-load/public/soak-summary.md`

Both are re-sanitized before publication. They contain no user IDs, JWTs, cookies,
credentials, bodies, exception strings, raw request samples, server logs, source
snapshots or SQL state. Artifact retention is seven days. The job has only
`contents: read`, checkout does not persist credentials, and no production secret
is referenced. Cleanup verifies the exact container ID, generated name and label
before removing that one container. GitHub disposes of the runner afterward.

Local checks are intentionally short and do not start SQL or sustained traffic:

```sh
node --max-old-space-size=128 --test __tests__/driveLoadMetrics.test.cjs
node --check scripts/test-drive-ingest-mixed-load.cjs
```

The new 30-minute Linux CI stages have **not yet run**. The tests above cover
300,000 response observations without accessing body/JWT data, artifact redaction
and repeat sanitization, fixed metrics memory, and maximum XLSX/PDF fixtures.
