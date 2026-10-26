# GitHub build / Cafe24 deploy

2026-10-26 user approved moving compilation off the 3893MiB production host after kernel global OOM and 1536MiB V8 heap OOM.

## Criteria and side effects
- GitHub Linux Node20 builds webpack, DB_SERVER empty, no production credentials in build.
- Artifact includes only .next-build (excluding cache) and the two generated development-history JSON files. No runtime mappings, uploads, .env or DB data.
- Commit SHA, package-lock SHA and tar SHA256 must match before installation. Stale queued releases fail closed.
- Cafe24 installs production dependencies, verifies/extracts build, then retains existing mapping-readiness gate and previous-build rollback. No webpack on host.
- Orders, shipments, warehouse, stock, estimates, profit and past-year rows: preserve. No SQL logic/EXE contract changes; no new native probe needed for deployment-only work.
- Default migrations false. Explicit existing migration mode stays gated; this rollout uses code-only push.
- UI/layout/menu defaults: not applicable (no UI changes). Postdeploy ping and browser version required.

## Verification
Executable metadata/checksum fixtures: good artifact, wrong SHA, corrupt file, missing build, wrong lock; workflow checks no host build and preserved DB gates; existing ERP contracts, dnSpy evidence, manifest/write guards; Linux runner build and real deployment smoke.
