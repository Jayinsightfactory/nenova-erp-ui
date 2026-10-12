# Native CALC gate atomicity — offline proposal

## Status and boundary
Initial preparation was offline. Main subsequently reports the metadata preflight, isolated SQL fixture and production CALC patch completed after explicit all-writer maintenance confirmation. This review did not execute production SQL. This does not release the current RUN or authorize permission changes. Production owner termination still requires an authorized observation path. No age-based or missing-session reclaim.

## Acceptance criteria
- Preserve the six native parameters and every stock business SQL statement byte-for-byte.
- Start one transaction level before GateEnter; execute successful Leave before committing that level. An existing caller transaction retains its original count on success/busy return. Existing native CATCH whole-transaction rollback semantics remain unchanged.
- Reject pre-2026 requests before acquisition and transaction start, with explicit failure result. Do not leave an open transaction on early return.
- Busy or rejected acquisition closes only the newly opened transaction level and never clears the other owner.
- Disconnect rolls back uncommitted acquisition and calculation together, restoring prior idle/WAIT_CALC state. Attention alone can leave a live open transaction: caller must roll back/dispose the connection. Do not claim automatic recovery while a live transaction remains.
- Same scope pending full-product CALC remains permitted; cross-year/week and product-scoped pending takeover remain denied.
- Production installer must verify exact UTF-16LE SHA256 definition, full sys.parameters signature, uses_ansi_nulls/uses_quoted_identifier, execute_as_principal_id and absence of module signatures. Signed/encrypted/unexpected definitions block deployment rather than silently dropping protection.
- In the same maintenance DDL transaction, preserve SET options, ALTER only this module, verify signature/business-body hash, update only its existing NenovaStockGateOwnerV2Hash extended property, and require capability IsReady=1. Fully drain native/web writers before any installation. Installation is main-only and requires the live preflight and actual all-writer drain.

## Side effects
| Phase | Gate | Stock business data | Other ERP data |
|---|---|---|---|
| Offline helper/tests | none | none | none |
| Future reviewed migration | module/hash only; require idle and drained writers | none | none |
| Normal CALC after patch | acquire/leave within calculation transaction | original native StockMaster/ProductStock SQL only | original behavior preserved |
| Disconnect | restore exact prior gate | rollback calculation | preserve |

## Fixture plan
Use explicit stdin credentials with fixtureOnly=true, loopback:14339, dedicated NenovaNativeStockAtomicFixture DB; never import application db/env/auth. Orchestration tests replace only the calculation body with a transactional sentinel and WAITFOR, retaining transformed native control flow. Cover idle and WAIT_CALC, caller outer transaction counts, busy rejection, invalid year, error rollback, attention followed by explicit rollback and physical connection close. A stub-business fixture cannot establish production stock formula compatibility; existing native stock fixtures plus business-byte equality remain mandatory.

## Remaining scope
FIX/CANCEL have the same potential pre-transaction acquisition window. They are excluded from this minimal CALC proposal; review separately before claiming global prevention. Existing RUN recovery is a separate operation, never an installer side effect.

## Main-only installer and deployment record
`scripts/native-stock-gate-atomic-installer.cjs` defaults to offline dry-run. Applying requires both `--apply --all-writers-drained`; the acknowledgement is not evidence that writers were actually drained. Main must establish maintenance/drain independently. The installer never clears RUN/WAIT_CALC, acquires the fully idle singleton with XLOCK/HOLDLOCK/NOWAIT, checks live exact metadata and V2 capability, changes the single CALC module and existing capability hash in one outer DDL transaction, then rechecks metadata/signature, transaction health, fully idle state and capability. No permissions or business data are changed by the installer.

Main supplied metadata records both SET flags ON, execute-as NULL, zero signatures and the expected definition/property hash. The installer revalidates live values and the six exact parameters rather than trusting that snapshot. Injected-query tests and offline transformer tests pass; these do not replace the separately assigned SQL fixture. Main reports production SP deployment completed, after the first post-hash mismatch correctly rolled back. SQL Server 2016 retained CREATE in module text; post-validation now accepts only the exact prepared CREATE or ALTER hash. A changed-body negative fixture rejects any other definition. Main also reports native full CALC in an outer rollback-only smoke returned 0, preserved caller transaction count 1 and ended with idle gate/capability ready. See main operational records for actual timestamps and full hashes.
