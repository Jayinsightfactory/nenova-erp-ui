# Actual invoice regression fixes — 2026-10-08

## Scope and safety
Continue country invoice validation using source documents already fetched from the business drive. No production receipt, order, shipment, stock, or cost writes. No EXE, SQL schema, stored procedure or native writer changes. Source year and subweek remain explicit; filenames alone do not authorize selecting a year.

## Implemented
- NL Holex CBS Units detection uses column/item centers for right-aligned totals; independent quantity and amount reconciliation remains mandatory.
- AU preview derives missing stems only from valid explicit bunch quantity × stems per bunch. Explicit zero and invalid explicit values are not overwritten. Excel worksheet formulas remain unchanged.
- Metadata review no longer accepts a grand-total quote as evidence for a zero freight charge. Manual correction remains available with a reason.
- Malformed AI currency objects display as unknown, not `[object Object]`; no country-based currency guess.
- Anonymous AU regression fixture runs without private source files; actual PDFs remain local-only.

## Verified evidence
Actual NL four-page invoice: 10,027 stems; goods EUR 10,918.43; freight 2,159.94; handling 50; total 13,128.37; GW 714.2; CW 795. AU seven rows reconcile to 12,750 stems after preview correction.

## Remaining limitations
Country matching is not proof of unit correctness. Thailand source contains stems, loose blooms and garlands: combined 9,005 must not be represented as a verified all-stem quantity. Vietnam Royal Base PDF still needs identification. China older workbook layouts need separate compatibility work. Non-CN-sea/NL-air cost support must not be claimed complete. This session has not deployed these fixes yet.

## Per-source replay (no new AI calls)
- NL: filename 18-02, invoice date 2026/05/03, 10,027 stems.
- EC: filename 40-01, invoice date 2026/09/27, 1,200 stems.
- TH: filename 40-01, invoice date 2026/10/05; mixed quantity 9,005, not verified stems. Filename/date period relationship requires operational verification.
- AU: filename 49-01, invoice date **2025/12/03**, 12,750 stems. Never substitute current year 2026.
- US: filename 40-01, invoice date 2026/09/25, 43,750 stems.
- CO: filename lacks a week. Require explicit selection; no 18-02 default in replay.

Earlier audit generator passed the same 18/2 arguments to all country converters. That run proved parsing/matching only, NOT per-week correctness. Corrected local replay uses each filename's subweek, reports invoice date separately, and does not approve or save inferred scope.

## Verification
Targeted receipt/source/cost tests: 46 passed. Import team suite: 180 passed, 3 skipped (not counted as successful checks); operations knowledge: 17 passed. Production build passed. ERP manifest and write-scope guards passed. Full ERP regression and independent review in progress at this entry.

Royal Base search repeated against current drive metadata: Royal Base workbooks, freight bills and remittance PDFs found; a commercial invoice PDF has not yet been identified. Do not analyze a remittance document as a merchandise invoice.

## Read-only operational order probe
Authenticated GET `/api/orders?year=...&week=...`, explicit year/subweek checked on every returned header. This is product-presence verification, not invoice quantity reconciliation or approval of inferred invoice scope.

| Source | Scope | Linked invoice rows present in orders | Linked absent | Unmatched |
|---|---|---:|---:|---:|
| NL | 2026/18-02 | 77 | 1 | 0 |
| EC | 2026/40-01 | 5 | 0 | 2 |
| TH | 2026/40-01 | 9 | 0 | 17 |
| AU | 2025/49-01 | 6 | 0 | 1 |
| US | 2026/40-01 | 0 | 0 | 1 |

Absent order does not prove an erroneous invoice: stock purchasing and split supplier shipments may be legitimate. Never compare one invoice against an entire period as if all supplier invoices were present.

## Release progress
- Independent reviewer caught a private-PDF dependency in mandatory tests. Fixed to keep anonymous fixtures mandatory, local source replay optional. Verified again in clean source worktree without outputs.
- Latest-master production build passed; full ERP regression passed locally and remote CI `37742620051` passed including dnSpy, cross-year, MOYI, write-scope gates.
- PR #981 merged at 2026-10-08 16:21:02 KST; production SHA `c09ed35902e248534aa16b9a84091a5eb8c211f0`.
- Deploy run `37742887413` in progress. This section is a local post-merge record, not yet part of the deployed commit.

## Final release verification
- Deploy `37742887413` succeeded 2026-10-08 16:26:27 KST, including server ERP guards and browser hydration.
- Authenticated live smoke passed `/import/tools` and `/incoming` at 1920×1080 CSS px / 100%; build `build-1791444189045`. No horizontal overflow, runtime errors or failed read APIs.
- Deployed chunks contain both new freight-evidence guard and AU missing-stem derivation. Existing preparation/cost recovery markers also present.
- DB health, document read and selected warehouse cost read returned success. No approved cost existed for selected sample; not a claim of cost-generation verification.
- Test execution sent no production receipt/order/shipment/stock/cost writes. All browser non-GET requests were blocked by the smoke harness. No new paid AI calls.
- Remaining TH mixed units, VN source identification, old CN layouts and unmatched items are explicitly unresolved; this release is not all-country end-to-end completion.
