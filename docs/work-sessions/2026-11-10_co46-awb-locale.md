# 2026-11-10 CO46 AWB decimal and filename false-negative correction

## Request and boundaries
- Fix decimal-comma AWB extraction and valid originals rejected by filename hints.
- Verify 46-1 hydrangea upload, matching, receipt and cost download in isolation; deploy code only.
- No production DB calls/writes, no new paid AI calls, no formula/migration/native EXE edits.

## Changes
- `parseAwbNumber`: decimal comma/dot and valid thousands groups; malformed/ambiguous leading-zero groups reject. Total extraction cannot accept a malformed numeric prefix.
- Weight columns bind Gross/Chargeable/Rate headings; commodity codes cannot substitute for GW.
- AWB filenames may omit year/country/week. Explicit conflicts still reject. Server checks actual byte hash, AWB checksum/number, Colombia form body and unique execution date/year, source workbook year/week and current evidence before import. Copyright year is not business year.
- No UI/order changes. Menu/video baseline: no new screen or sequence; existing controls retained, new video not applicable.

## Evidence
- Actual `46-1 콜수국 AWB.pdf`: 160-17338020, 2026/11/07, GW3487, CW4152, rate2.95, prepaid12320.40. Browser standalone AWB upload auto-populated all values.
- Source invoice: 16 farms/46 lines/662 physical boxes/19960 stems/USD13366.76. Source PDF totals and existing read-only receipt snapshot compared.
- Important limit: isolated invoice extraction used source-reviewed receipt-comparison transcription, not a fresh AI response. Descriptions in this fixture are ERP names. This is real PDF upload + UI/writer/cost integration coverage, NOT a fresh AI extraction or real-world fuzzy matching accuracy claim.
- Browser localhost19422, unique `NenovaInvoiceFixture_*` on fixed localhost14339: uploaded original CI; matched46 lines; each of16 invoices confirmed original total vs receipt amount;16 commit API200; native warehouse readback/window APIs200. Shared AWB prepare read16 new receipts and46 lines. Protected orders/temp/shipments unchanged at stop. Native `CommonLogic.CheckFixSave` eligibility SP is outside this fixture; captured warehouse/key/stock SQL writer runs in isolation.
- Actual browser cost download: `shared-awb-2026-46-01-16017338020 (1).xlsx`. Shared GW3487/CW4152/freight12320.40 entered from actual AWB once, no per-farm duplication. Live USD1344.19+15=1359.19; existing42-1 customs formula1786020KRW.
- Artifact recalculation:46 positive cost rows; goods13366.76/stems19960/freight12320.40/GW3487/CW4152/customs1786020; zero formula errors. GW3488 changes customs1786480 and unit cost increases; temporary mutation restored in memory, downloaded original not changed. Render inspected; long names still follow pre-existing template width (not a typography redesign).
- Tests: arrivalDriveAuto + actual PDF/XLSX proof + actual local46-1 PDF; importAwbFields; full ERP contract suite; dnSpy evidence; manifest207; write guard0 API files; webpack build PASS. Actual FormWarehouseView dnSpy extraction rerun locally.
- Local stale draft404 messages followed resetting unique test DB; not production errors. Corrected missing invoice_total/freight_total fixture fields without weakening production validators.

## Deployment
Pending PR CI and code-only Cafe24 deployment. Do not report production deployment complete until action success and read-only ping/version verification.

Search: CO46 AWB decimal comma 4152,0 12320,40 filename execution date 16017338020 isolated 16 invoices 46 hydrangea
