# Claude 인계서: 카탈로그 · 도착원가 SQL 자동화

작성일: 2026-06-15

## 한 줄 요약

**원가자료 Excel = SQL에서 나가는 결과물.** 카탈로그·피벗 도착원가는 **입고원장(WarehouseMaster/Detail) → computeFreightCost → pivotFreightArrival** 로 **Excel 업로드 없이** 자동 표시. 카탈로그 Excel 업로드는 **선택적 덮어쓰기**만.

## 운영 배포

| 항목 | 값 |
|------|-----|
| 최신 커밋 | `e7f747c` Fix SQL auto arrival cost and catalog export toggles |
| 배포 | GitHub Actions `Deploy to Cafe24` success (2026-06-15) |
| URL | https://nenovaweb.com/catalog , https://nenovaweb.com/stats/pivot |

## 절대 기준 (사용자 의도)

1. **원가자료 xlsx** (Hood Canal, Cloudland, Holex 등) = `/api/freight/excel` 로 **SQL → Excel 다운로드** (콜롬비아 원가자료 레이아웃).
2. **카탈로그 "① 도착원가 불러오기"** = `/api/catalog/bootstrap` → `getArrivalCostsWithFallback` → DB live/snapshot 계산.
3. **`/api/catalog/arrival-upload`** = **선택** — 자동 계산값을 수동 덮어쓸 때만 (`data/catalog-arrival-overrides.json`).
4. **매번 Excel 업로드 하지 않아도** 도착원가 표시가 목표.

## 도착원가 데이터 파이프라인

```
WarehouseMaster (FarmName, OrderWeek, AWB)
  + WarehouseDetail (UPrice=FOB, OutQuantity)
  + 특수행: 운송료 / Gross weight / Chargeable weight
    → lib/pivotFreightArrival.js (_computeArrivalForAwbGroup)
    → lib/freightCalc.js computeFreightCost → displayArrivalKRW
    → aggregateArrivalCosts (입고수량 가중평균)
    → catalogArrival.js (최근 52주 fallback)
    → catalog bootstrap / pivotStats
```

- **FreightCost 스냅샷**: 없어도 **live** 경로 동작. 운송기준원가 탭 저장은 캐시용(선택).
- **카탈로그 costMode**: `recent`(기본) | `selected`
- **도착원가 정의**: freight 탭 `displayArrivalKRW` 와 동일

## 이번 세션 핵심 버그 수정 (`e7f747c`)

**증상**: Cloudland 등 BILL에서 GW/CW가 `OutQuantity`에만 있음 (예: 475kg) → 기존 `weightOfRow`가 Box/Bunch/Steam만 봐서 **GW/CW=0** → live 도착원가 계산 실패.

**수정**: `lib/freightCalc.js` 에 `freightWeightOfRow()` 추가 — **OutQuantity 포함**.

적용 위치:
- `lib/pivotFreightArrival.js` (카탈로그·피벗)
- `pages/api/freight/index.js` (운송기준원가 탭)
- `pages/api/freight/excel.js` (원가자료 Excel export)

**검증** (`scripts/probe-cloudland-arrival-fix.js`):
- Cloudland AWB `99993212291`: GW=CW=475
- 만달라 ≈ 23,470원/단 자동 산출

## 원가자료 Excel vs ERP 매칭 (분석 결과)

| Excel 파일 | ERP FarmName | 매칭 |
|-----------|--------------|------|
| 24-1 2중국 (Cloudland) | Cloudland 24-01 | 11/11 FOB 일치 |
| 24-2 NL (Holex) | Holex 24-02 | 34/37, FOB 3건 차이 |
| PREMIUM GREENS 13-1 | Premium Greens | 8/8 일치 |
| Hood Canal 17-1 | Hood Canal | 1/1 일치 |
| Ecuador 24-1 | **La Rosaleda** (Freightwise는 운송만) | AWB 그룹으로 조회 |
| 태국 덴파레 | **Krung/Super Fresh** (태국 AWB는 운송만) | AWB 그룹 |
| NZBLOOM | NZ Bloom | 품목명 규칙 불일치 |
| VT SUNPRIDE | Royal Base | Excel `[Premium] White` vs DB `ORCHID VIETNAM/호접란` |

- **차수 형식**: Excel `24-1` ↔ DB `24-01`
- **FarmName**: ERP `NZ Bloom ` (끝 공백), `Royal Base`, `Cloudland` 등

로컬 only (미커밋): `scripts/compare-cost-excel-vs-db.mjs`, `scripts/cost-excel-compare-report.json`

## 카탈로그 UI (동일 배포)

- **이름 / 단가** 체크박스 — PPT·미리보기·인쇄, **기본 ON**, 해제 시 미표시
- `sessionStorage` key: `nenovaCatalogDraft` (`showNames`, `showPrice` 포함)
- 도착원가 버튼: **① 도착원가 불러오기** (SQL 자동)
- Excel: **📥 도착원가 덮어쓰기(선택)**

## 카탈로그 이미지 (이전 세션, 참고)

- **통합본 PPTX** `카달로그_통합본.pptx` = 사진 canonical source
- 서버: `/var/www/nenova-erp/public/uploads/catalog/_bulk_import/`
- `lib/catalogAutoImport.js` — bootstrap 시 자동 import
- 품종 정렬: **CountryFlower** (`lib/catalogUtils.js` `groupProductsByCountryFlower`)

## 주요 파일

| 파일 | 역할 |
|------|------|
| `lib/freightCalc.js` | FOB+운임+통관 → displayArrivalKRW, `freightWeightOfRow` |
| `lib/pivotFreightArrival.js` | 차수별 prodKey 도착원가 맵 (AWB 그룹) |
| `lib/catalogArrival.js` | 최신 차수 + 52주 fallback |
| `pages/api/catalog/bootstrap.js` | 카탈로그 마스터 + 도착원가 API |
| `pages/api/freight/excel.js` | SQL → 원가자료 Excel |
| `pages/api/freight/index.js` | 운송기준원가 탭 + FreightCost 저장 |
| `pages/catalog/index.js` | 카탈로그 작성 UI |
| `lib/catalogPptExport.js` | PPT export |
| `lib/pivotStats.js` | 피벗 통계 (동일 arrivalMap) |

## DB / 환경

- Repo: `C:\Users\USER\nenova-erp-ui` (GitHub: Jayinsightfactory/nenova-erp-ui)
- DB: `.env.local` → `nenova1_nenova` on MS-SQL
- VPS: `172.233.89.171` → `/var/www/nenova-erp`
- Deploy: push `master` → `.github/workflows` Deploy to Cafe24

## 배포 후 확인 체크리스트

1. https://nenovaweb.com/catalog → **① 도착원가 불러오기** → 품목 카드에 도착원가 숫자
2. Cloudland/중국 장미 등 이전 0원 품목 확인
3. https://nenovaweb.com/stats/pivot → 도착원가 열 (동일 차수)
4. `/freight` → AWB 조회 → Excel 다운로드 = 원가자료 형식과 동일 소스

## 다음 작업 후보

1. Holex 24-02 FOB 3건 ERP vs Excel 기준 확정 후 원장 수정
2. NZ Bloom / Royal Base Excel↔DB **품목명 별칭 매핑** (비교용)
3. FreightCost 스냅샷 일괄 저장 (선택, 성능)
4. Ecuador·태국 UI에서 **AWB 그룹** 단위 표시 명확화
5. 미커밋 probe 스크립트 정리 또는 `.gitignore`

## 미커밋 로컬

- `scripts/probe-*.js`, `scripts/compare-cost-excel-vs-db.mjs` 등 분석용
- `docs/work-reports/2026-06-11_pivot-field-drag-arrival.md` (minor edit)

## 이전 커밋 맥락 (카탈로그)

- `ff69a6b` — 추출기 16:9 레이아웃 preview/print/PPT
- `89c704c` — CountryFlower 품종 정렬 (nenova.exe parity)
- `f12519d` — 통합본 PPTX 서버 업로드 API
