# ecount 스키마 설계 (이카운트 원본 적재 기반)

사장님 지시: "ecount db 라고 해서 별도로 적용, 검증 끝나면 합친다." DB 생성 권한이 없어 **같은 DB 안의 별도 스키마 `ecount`** 로 분리한다.

## 1. 원칙
- **원본 그대로.** 이카운트 엑셀 헤더가 곧 열 이름(한글 그대로). 열 매핑·숫자 변환·계산을 하지 않는다(값은 NVARCHAR(400) 문자열). 400자 초과 값만 절단하고 배치 결과에 `truncated` 로 알린다.
- **이카운트에는 쓰지 않는다.** 이 영역은 우리 DB만 다룬다.
- **쓰기는 `ecount` 스키마만.** dbo ERP 원장, `ecount_work`, `web_mgmt` 는 읽기만(대조 뷰·상태 API).
- SQL Server 2016 Web 호환(STRING_AGG 등 2017+ 금지). `CREATE OR ALTER VIEW` 는 2016 SP1+ 에서 사용 가능(현재 SP3).

## 2. 구조
| 객체 | 내용 |
|---|---|
| `ecount.LoadBatch` | 적재 1회 = 1행. PrgId, 기간, Source(`legacy_snapshot`/`xlsx`/`daemon`), FileSha256(필터 UNIQUE), RowCnt/InsertCnt/DedupCnt, ScreenTotal |
| `ecount.Dataset` | prgId 사전(13개 시드: 판매현황·채권·채무·입출금·수금·지급·구매·거래처/품목 등록·회계거래·세금계산서·카드매입) |
| `ecount.[Raw_<PrgId>]` | 동적 생성. 고정열 `RowKey, BatchKey, RowNo, RowHash, IsSubtotal` + 엑셀 헤더 열. 새 헤더가 나타나면 `ALTER TABLE ADD` |
| `ecount.cmp_*` | 대조 뷰 4개(아래 §4) |

- 열 이름 정규화: 공백 정리, 허용 문자(문자·숫자·공백·`_-.()%/·`) 외 `_` 치환, 빈 헤더는 `열N`, 중복·고정열 충돌은 `_2` 접미, 대괄호 이스케이프. 식별자는 화이트리스트(`core.js`)를 통과한 것만 DDL 에 들어간다.
- **RowHash** = sha256(PrgId + 값이 있는 열만 `열이름=정규화값` 정렬 연결). BatchKey·열 순서·나중에 추가된 빈 열에 영향받지 않아 중복 판정에 쓴다.
- 합계행(`합계|총계|소계`, 코드칸 `… 계`)은 버리지 않고 `IsSubtotal=1` 로 적재.
- 적재(`loader.js loadRows`): 배치 생성 → Raw 테이블 보장 → 500행 단위로 같은 (PrgId,RowHash) 가 **다른 배치**에 있는지 조회 → 없는 행만 파라미터 바인딩 INSERT. 있으면 `DedupCnt` 만 증가. `allowDuplicate:true` 로 끌 수 있다. 전체가 한 트랜잭션.

## 3. 입구
- `npm run test:ecount-ledger` 테스트, `node scripts/ecount-ledger/ensure-schema.mjs [--views]` 스키마/뷰 보장.
- `node scripts/ecount-ledger/load-xlsx.mjs <prgId> <file.xlsx> [--from --to --source xlsx] [--dry-run]`
- `node scripts/ecount-ledger/backfill-legacy.mjs [--apply] [--dataset sales|ar|ap|cash]` — 옛 `WebEcountSnapshot/Row`(Payload JSON) 이관. 기본 dry-run, 스냅샷 단위 LoadBatch(`Note=SnapshotKey=N`), 이미 이관한 스냅샷은 건너뜀. **주의:** 옛 Payload 키는 영문(refDate, custName …)이라 legacy 로 채운 Raw 열은 영문, xlsx 로 채운 열은 한글이다 → 같은 prgId 에 두 계열이 섞이면 RowHash 가 달라 서로 중복판정되지 않는다. 뷰는 두 계열 이름을 모두 흡수한다.
- `GET /api/ecount-ledger/status` — 관리자 전용 읽기. 데이터셋별 배치·행·기간, 대조 뷰 요약.

## 4. 대조 뷰 (`views.js` 가 실제 Raw 열을 보고 생성)
Raw 열 이름이 데이터마다 달라 정적 SQL 로 둘 수 없어 JS 가 `CREATE OR ALTER VIEW` 를 만든다(존재하는 Raw 테이블에 대해서만).
- `cmp_sales_daily` — 판매현황 일자×거래처 합계 vs `ShipmentMaster⋈ShipmentDetail`(isFix=1, 마스터 isDeleted=0) 저장 `Amount+Vat`. 거래처명은 `Customer.CustName` 과 `Descr` 첫 `/` 앞 간판명 둘 다. 이카운트 일자 범위 내만 비교. ShipmentDetail 에는 isDeleted 없음.
- `cmp_ar_balance` — 거래처별채권 잔액(거래처별 가장 최근 배치 행) vs `lib/mgmt/receivables.js` 와 같은 계산(청구 − 입금).
- `cmp_customer_master`, `cmp_product_master` — 등록 목록의 우리 마스터 이름/코드 매칭 여부(`Matched`).
- 알려진 한계: 중복 생략 때문에 "가장 최근 배치" 가 스냅샷 전체가 아니다. 잔액이 A→B→A 로 되돌아간 거래처는 마지막 A 가 첫 A 와 중복 판정돼 B 로 보일 수 있다. 잔액 대조는 최신 단일 파일을 `allowDuplicate:true` 로 올리거나 합치기 전 별도 확인한다.

## 5. 합치기 기준
`cmp_*` 뷰 차이 0 이 N주(기본 제안 4주) 연속 유지되고, 사장님이 화면별로 확인한 뒤에 dbo 쪽 통합을 논의한다. 그 전에는 dbo 쓰기 없음.

## 6. 다른 작업영역과의 관계
- `ecount_work`(화면 동등성 작업영역)와는 **별개**이며 읽지 않는다. 이 영역의 소유 파일(`lib/ecount*.js`, `scripts/ecount-scraper/**`, `pages/api/ecount/**`, `docs/ecount-migration/**`)은 수정하지 않았다.
- 기존 수집 데몬은 그대로 `dbo.WebEcount*` 로 적재한다. 2단계에서 수집기가 `loadRows` 를 직접 호출해 `ecount` 스키마로 적재(`Source='daemon'`)하도록 붙일 예정이다.
