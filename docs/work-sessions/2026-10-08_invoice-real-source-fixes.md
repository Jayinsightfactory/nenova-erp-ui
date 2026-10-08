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
