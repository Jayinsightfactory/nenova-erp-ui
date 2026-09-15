# Farm feedback inbox — main preflight

## User outcome

Automatic detections are feedback-needed work immediately, without a transfer/create button. Use a compact unified list with preserved comments, source details, missing-farm warning, new-source/recurrence review, and reversible exclusion with a reason. Do not send messages to farms or automatically assert resolution.

## Prepared evidence

- Worktree base: `0fc5eab2` (master, PR620), farm quality behavior from PR614.
- Dependencies: existing node_modules junction; no package installation.
- Source inspected: farmQuality.js, farmQualityStore.js, farm-quality API/page, schema migration, EXE golden and saved FormSalesDefectView.GetData decompile.
- No native EXE feedback counterpart: source/financial calculations remain separate.
- Read-only production probe 34923042310: source436, deleted24, active412, farm-missing80, unconfirmed55 (overlapping), 162 signals covering324 distinct sources. Required source columns present.
- GitHub CLI authenticated; no credentials read or changed.

## Side effects

| Action | WebSalesDefectDeduction / Product / ViewWarehouse | WebFarmQualityCase / Event / Evidence | ERP Order / Shipment / Warehouse / Stock / Estimate / WebProfitReport |
|---|---|---|---|
| List automatic feedback / open detail | SELECT only | SELECT only | preserve (ViewWarehouse read only for unchanged rates) |
| Explicit comment/request/response | SELECT and revalidate selected year | guarded transaction only | preserve |
| Exclude / restore | SELECT and revalidate | explicit reversible state/event; reason required | preserve |
| New-source / recurrence badge | SELECT only | read-only projection, no automatic resolution | preserve |
| Production smoke | SELECT only | SELECT only; no synthetic production comments | preserve |

## Acceptance gates

1. Same source counted once despite overlapping detection reasons; exact source identity and selected year preserved.
2. Missing farm/unconfirmed sources are trackable without changing trusted defect rates.
3. Existing comments, evidence, status and ownership retained; disappearing signals cannot remove saved feedback.
4. Concurrent first saves/idempotent retry cannot silently create duplicate auto cases.
5. New rows and post-resolution recurrence visibly require review, not auto completion.
6. Compact desktop verified at 1920x1080 CSS pixels, 100%; narrow layout retains controls.
7. ERP contract, manifest, dnSpy evidence, changed-write guard, build and independent review must pass before deployment.

Architecture details and final predicates are recorded separately before implementation. No ERP data repair is in scope.
