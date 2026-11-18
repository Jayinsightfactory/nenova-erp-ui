# Missing-only settlement components

Latest owner instruction: keep costs resolved by SQL/existing formulas; supplement only missing disinfection, duty and clearance/quarantine-agency fees. Never import an Excel H grand total or duplicate warehouse/transport. Explicit SQL zero is present, not absent. Import VAT remains excluded.

## Evidence before implementation

Executed actual `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseView "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`: GetData reads WarehouseMaster year/week; GetDetail reads WarehouseDetail.TPrice. Native saves/deletes/stock procedures are not used by this feature.
Selected-year SQL probe 2026/35,36 read six WebCustomsWeekly rows (18 present fee fields) and zero WebColombiaWeekly rows. Private values remain outside Git. Existing typed settlement reader overwrites approved SQL amounts, whereas preview currently blocks unequal SQL/file values. Latest instruction replaces that policy with SQL-first, missing-only projection; original receipt files remain complete and arithmetic-validated.

## Criteria and side effects

|Action|Warehouse/Order/Shipment/Estimate/Stock|WebCustomsWeekly/ColombiaWeekly/Report/snapshot|Runtime evidence|
|---|---|---|---|
|Read report/input preview|SELECT or preserve|SELECT/preserve|read validated typed fields|
|Register exact-AWB receipt|preserve|preserve|atomic document/amount source only|

One shared policy protects an entire Customs/SunYul split stem if any SQL total/part is present (including0); no partial total is mixed with a second full receipt total. Colombia ItemCount, including0, protects actual agency fee from duplicate addition. Only duty/clearance/quarantine agency/disinfection fields may supplement SQL. GW/CW, warehouse rate, truck and freight stay existing-source-only. UI marks only actually applied fields as receipt-covered; saved DB fields remain editable/preserved.

Receipt source scope is explicit year/major/AWB, with current DB source re-read at registration and existing lock/digest/replay rules. Existing frozen/confirmed money is not refreshed. Source discrepancy is retained as DB-preserved, not silently replaced and not a mathematical match claim.

Disinfection must be a separately recognized named financial row, not an alias of quarantine agency. Existing 2/4-row parser remains; optional5-row layout requires exact disinfection label/position, all row sums and grand-total conservation. No unknown fee, import VAT or guessed amount is accepted. Actual5-row source validation remains separate from synthetic parser tests.

## Regression and completion

Missing/NULL/empty versus explicit0, nonzero SQL, split1/2/3, ItemCount0, wrong year/phase, unknown field, same document replay, different document same AWB, mixed DB+file fields and VAT provenance. Formula-based warehouse/domestic and SQL freight unaffected; source total remains validated in immutable file. UI/workflow labels must reflect DB-first and guide update applies if the displayed registration confirmation changes. Full ERP/dnSpy/scope/build gates and production read-only smoke required before completion.
