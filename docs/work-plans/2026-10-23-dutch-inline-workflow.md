# Netherlands inline workflow — implementation ledger

## Scope and gates

Preserve the existing authenticated year/week preview, fixed-row protection,
single-use plan, mandatory pre-apply archive and atomic distribution writer.
No production test writes. Deployment requires all ERP gates and browser checks.

| Action | Shared ERP tables | Authority / consumers |
|---|---|---|
| Compact matrix, price placeholder removal | preserve all | User 2026-10-23; DutchVolumeSheet only |
| Add customer/product through overlay | preserve all until explicit apply | Existing draft + fresh preview |
| Top registration/distribution action | existing reviewed apply only | dutch-volume-board contract; no bypass |
| Excel/print | preserve all | Current edited draft; re-upload must revalidate |
| Color editing | Product.Descr + LastUpdateID/Dtm and SystemActionLog only | User approved shared description; locked expectedDescr, preserve unknown prose, full Product readback; other ledgers unchanged |

## Evidence and unresolved decisions

Actual local dnSpy ClassProduct inspection on 2026-10-23 confirms Descr is
read/written by nenova.exe. pivot-volume-excel derives color from the first
Descr segment. Never replace the full description with a color. Asked whether
to use web-only color metadata or explicitly modify the shared description.

Current sheet has conflicting 14px/10px CSS; the later 10px rule wins, and the
page additionally applies zoom:.7. Table min-width:100% can stretch columns.
Customer columns should be fixed, readable and compact, not globally zoomed.

User subsequently confirmed shared Product.Descr storage. Implemented separate
color CAS endpoint and full before/after confirmation. Actual schema/trigger
probe and native SQL recorded in ProductColor.md. Other popup/roundtrip requests
remain pending, not part of the implemented layout/color diff.

Status: layout/color gates running; not deployed.
