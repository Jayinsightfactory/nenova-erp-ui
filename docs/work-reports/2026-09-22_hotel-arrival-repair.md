# Hotel arrival product identity / compound unit repair

## Scope and evidence

User approved implementation following the 54-master read-only audit. Preserve uploaded prices, manually entered hotel CostPrice, quantities, farms, and all ERP ledgers. No reupload or fuzzy bulk reassignment.

dnSpy CLI re-executed against `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`, `--no-color -t FormWarehouseView`, with GetData/GetDetail WarehouseMaster/Detail output verified. Web references do not invoke those write methods or stock procedures. `docs/CODEX_SUBTASK_ORCHESTRATION.md` is absent in this worktree; no subtask policy was invented and no agents delegated.

SELECT preflight: Aisha source rows explicitly contain 단당 수량=1, whereas Shilla target Unit=단-5스팀 and Product.SteamOf1Bunch=5. At 37-2, stored raw cost 3,470 is one source stem; reference cost is 17,350 per explicit five-stem target bundle. It is not a stored price update.

Exact original product identity + raw source cell + active unique Product + matching country finds 271 current 2026 arrival rows across 21 key pairs related to hotel product keys. Manual MATCH/BASIS_CHANGE rows are excluded. Five Chinese gypsophila rows have a country conflict with the exact-name Product and are held. Unlinked abbreviated P&L items are not guessed. Review digest: `1ee303b7e8d874f180d4df8cd93812af9a75851fc7eca6aa335d8c54579b7118`.

## Criteria / effects

| Action | WebArrivalCostLine | History | Hotel P&L items | ERP / downstream |
|---|---|---|---|---|
| New upload matching | existing upload path; exact name before search aliases | existing | preserve | preserve |
| Reference display | read only | preserve | read only; no CostPrice write | Estimate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport, Order, Stock all preserve |
| Post-deploy incident repair | reviewed 2026 current row ProdKey and audit timestamp only | MATCH with full before snapshot | all fields preserved/hash checked | no SQL writes |

Identity keeps MEL/EZ/MC/CHINA, punctuation and size. Search normalization remains separate. Before relaxed exact/learned/fuzzy selection, explicit sizes, length, mix-box and brand markers must agree. Duplicate strict names are unresolved. Year and numeric major fallback predicates are unchanged. Numeric equivalent subweeks have one reference. Explicit target `단-N스팀/송이/대/st` uses N stems and original positive pack count (otherwise existing Product metadata), never an implicit one-stem default. Unknown/invalid units retain an error. FX uses unchanged raw units/source cost then scales the preview.

Repair uses the existing import applock, locked complete row snapshot and reviewed digest, active Product revalidation, no manual history, exact original cell proof, one transaction, full BeforeJson audit. All non-target arrival rows (including other years/inactive revisions) and every hotel item are hash checked before commit. Production apply only after deployment verified. Local incident script is `.tmp/repair-hotel-arrival.cjs` (default read-only; not a scheduled job).

## Validation

Targeted parser and hotel reference tests passed. Includes reversed candidate order, brand/grade/size/mix-box near misses, duplicate names, original price/quantity preservation, explicit 5/10-stem bundles, missing pack metadata, malformed units, 37-02/37-2 grouping, exact/prior/future and selected-year query constraints. Full gates/deployment/repair results pending.
