# Hotel P&L arrival-reference read-only audit

User request: 손익계산서에서 매칭되지 않는 도착원가와 다른 원가 확인.

2026-09-22 production SELECT-only audit of 2026 active WebRaumPnl masters and items. 54 masters, 709 item rows; 6 custom rows excluded from matching classification. Used the current executable buildRaumPnlArrivalReferences and its reference SELECT, without schema initializers or writes. This is reference availability and identity auditing, not verification of every workbook calculation or a browser smoke.

| Partner | Items | Convertible reference | No product | No valid current cost for product | Only future cost | Conversion failure | Custom excluded |
|---|---:|---:|---:|---:|---:|---:|---:|
| choimun | 50 | 31 | 0 | 3 | 16 | 0 | 0 |
| raum | 458 | 336 | 11 | 40 | 65 | 0 | 6 |
| shilla | 201 | 88 | 1 | 44 | 57 | 11 | 0 |

Convertible does not mean the underlying product match is correct. 57 convertible rows use an earlier major week. Future-only rows are excluded intentionally; never substitute later costs into an earlier P&L without a policy change.

## Confirmed display causes

- Shilla week 01 white tulip uses `단-10스팀`; weeks 28–37 white lily use `단-5스팀`. The reference converter recognizes 단/송이/박스 and stem aliases, not compound unit descriptions. These 11 rows have source costs but conversion errors. Week 37 lily source is 3,470 KRW per source 단; do not blindly treat it as a five-stem target bunch without source-count reconciliation.
- Twelve items lack ProdKey: Raum 27 흰장미/스텔링/버터플라이/다빈치/튤립 오렌지주스; Raum 28 장미 나르샤; Raum 33 대왕퐁퐁국화 연보라; Raum 34–37 피오니 연핑크; Shilla 33 태국샘플.
- 87 rows have no positive current 2026 arrival cost joined to their product. This does not prove the original file lacks the item: costs may be attached to another product.
- 138 rows have matching product costs only in later major weeks.
- Reference grouping uses literal week strings, exposing both `01-2` and `1-2` for Shilla week 01 tulip.

## Other stored identity discrepancies

Compared current 2026 raw arrival names against unique normalized exact active Product names. 874 arrival rows across 125 stored-key → exact-name-key pairs differ; these are review candidates, not authorized corrections. Twenty-two pairs touch product keys used by the hotel items; counts are not unique affected P&L rows and do not prove each row was chosen as the displayed reference.

Examples:
- Tulip Single Dynasty L/Pink stored 1897 Crown Dynasty, exact-name product 1919 (92 rows).
- CARNATION Mix Box A stored Novia 456, exact Mix Box 2515 (19); Mix Box B stored Hermes 408 instead of 2516 (18); Mix Box C stored Maruchi 436 instead of 2517 (17).
- Den. Jinda Sweet L stored XL 609 instead of L 619 (42); M stored XL 609 instead of M 636 (10).
- MOK Orange Peach L stored M 623 instead of L 624 (6).
- White Select hydrangea stored regular White; tinted lavender stored regular Lavender.
- MC/MEL/EZ variants also differ; intentional substitutions/manual history must be inspected before any correction.

Current helper selects the highest converted cost within each literal subweek when multiple rows/farms exist. Presence alone must not be described as verified correct cost.

## Next safe action

Add compound-unit/count reconciliation and normalized week grouping with fixtures. Review affected source rows and MATCH/BASIS_CHANGE history before scoped reversible identity repair; deploy code first. Do not overwrite user-entered CostPrice or ERP orders, shipments, stock, estimates, or sales. No code, deployment, or production data was changed during this audit.
