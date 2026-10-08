# 인보이스 → 입고 → 도착원가 연결

| 항목 | 내용 |
|---|---|
| 세션 | 019f5032-9276-72a2-8709-29b719c67702 / 2026-10-08 |
| 요청 | 진행 및 연결·배포까지 완료 |
| 화면 | 수입부 업무도구 패킹리스트, 입고관리 |
| PR | #960 / codex/invoice-receipt-cost-prd |
| 운영 부작용 | 이번 검증은 운영 SELECT만. 입고 저장 테스트는 고유 격리 SQL DB에서 수행 후 삭제 |
| 배포 | PR #960 병합 및 운영 배포 성공. 아래 최종 배포 검증 참조 |

## 이어받을 때 고정된 결정

- 파일 분석/초안 저장은 ERP 입고가 아니다. 저장 초안 검증 후 사유를 입력한 명시 입고 등록만 원장/재고를 변경한다.
- 실제 입고량 원가가 기본이며 95% 예상값은 비교용이다. 현재 검증된 공식은 중국 해상/네덜란드 금액배분 두 가지다.
- 기존 EXE/공유 SP/공용 임시입고 staging/타 작업 RUN 게이트를 수정하지 않는다. 6개 웹 저장 테이블은 앞선 승인으로 이미 운영 적용된 구조를 사용한다.
- 같은 인보이스 문서 수정은 기존 WarehouseKey/WdetailKey/receiptPartId를 재사용한다. 별도 분할 입고는 거절하며 지원 완료로 설명하지 않는다.
- 원가만 변경하면 재고 계산 없음. 수량 수정 시 Product.Stock 차액과 native 현재/후속 StockCalculation, 독립 원장식 readback을 한 트랜잭션에서 검증한다.
- 운영에서 임의 테스트 입고를 생성하지 않는다. SQL 테스트 성공과 실사용 운영 입고 성공은 구분한다.

### 1. 연결·배포 요청

**Q.** 인보이스 업로드에서 입고관리와 도착원가까지 연결하고 배포도 해야 한다.

**A.** 초안 revision/수정자 이력, 원본 해시, 전산 품목 연결, 서버 사전검사, 명시 등록, 작업 ID 재시도, 기존 원장 수정, 실제량 원가 승인/조회와 입고관리 원가 열을 구현했다. 원가 승인본은 EXE에서 원장 헤더·상세가 바뀌면 재검토 상태로 표시한다. 원가 공식 적용 입고일·운송·품목에 대한 담당자의 명시 확인을 요구하며 미확인 적용 기간을 임의 추정하지 않는다.

**결과.** docs/plans/invoice-receipt-connected-implementation.md와 docs/contracts/invoice-receipt-connected.json이 현재 계약이다.

### 2. 실제 SQL 및 native 근거

**Q.** nenova.exe 호환 및 기존 재고잠금 문제를 재발시키지 않아야 한다.

**A.** dnSpy FormWarehouseAdd와 기존 ExcelLoadingPackingList/CommonLogic, SSMS에서 읽은 native CreateWarehouse/GetNextKey/ViewOrder 원문 지문을 검증했다. 수기 EXE 수정의 전체 수량 중복 가산 결함은 복제하지 않고 웹은 차액을 적용한다. native SQL은 변경하지 않았다.

- 운영 SELECT 재확인: SQL2016, DB collation Korean_Wansung_CI_AS, @@TRANCOUNT=0, 웹 테이블6개 존재.
- WarehouseMaster GW/CW/DocFee decimal(10,2), FreightRateUSD decimal(10,4); 자릿수 초과를 저장 전 차단한다.
- StockHistory.Descr max_length1000 bytes = nvarchar(500). ERP 설명은500자로 제한하고 전체 사유는 웹 이력에 보존한다.
- kg당 USD 운임과 인보이스 운송비 총액을 분리한다. 순중량을 CW로 추정하지 않는다.

### 3. 격리 검증

**A.** loopback SQL2022의 새 NenovaInvoiceFixture_* DB, SQL2016 호환130, 운영과 동일 Korean_Wansung_CI_AS에서 실제 웹 writer와 캡처 native SP를 실행했다. 매 실행 후 해당 실행에서 만든 DB만 정리했다.

통과한 항목:

- 같은 품목의 서로 다른 단가 두 행 유지와 native Product.Stock/StockHistory 결과 대조.
- 최초 입고, 같은 상세 수량 수정, 가격만 수정 시 재고 보존.
- 2025/2026/2027 동일 세부차수 분리와 native 후속 재고 계산/readback.
- 동일 작업 ID 및 서로 다른 ID 동시 요청: 입고 하나만 생성.
- 커밋 후 응답 유실 재요청은 같은 결과 반환(실제 네트워크 장애 자체를 재현한 것은 아님).
- native stock 계산 실패 시 전체 롤백, busy gate 소유 정보 보존.
- 공용 staging4행 및 주문/분배 원본 보존.
- ViewOrder에서 누락된 원본 주문 상세는0으로 오인하지 않고 검증 차단.
- 실제 원가 승인 저장/조회/재요청,95% 비교 분리, 공유 비용 원천 중복 거절, EXE 상세 변경 시 승인 원가 표시 중지.

## 최종 점검 / 남은 경계

- 브라우저 1920×1080 CSS/100%,1280×800 모두 통과. 실제 컴포넌트를 컴파일한 격리 브라우저에서 저장 문서 조회, 실패 시 초안 유지, 이슈 복사, 등록 확인창, 원가 검토, 수정 시 원가 stale을 검증했다. 모든 API는 fixture로 차단해 운영 쓰기는 없었다. 화면 넘침/겹침 없이 기준 화면은 표·이슈 병렬, 작은 화면은 내부 표 스크롤을 확인했다.
- 최종 전체 `test:erp-contract`, 프로덕션 `build`, 실제 격리 SQL writer 및 원가 승인·조회 검증 통과. native SQL fixture의 공백/마지막 빈 줄은 운영 원문 해시 일치를 위해 의도적으로 보존한다.
- native ProdKey=0은 활성 품목 전체를 계산하며 독립 readback은 이번 변경 품목을 검사한다. 무관 품목의 native 결과까지 모두 새 공식으로 재구현했다고 설명하지 않는다.
- 지원하지 않는 국가/공식/혼합통화/공동 비용 배분 및 별도 분할 입고는 검토 필요로 남긴다.
- 원본 파일 자체의 장기 서버 보관 기능이 아니라 원본 해시·행 근거·검토값을 저장한다.
- 기존 docs/work-sessions/2026-10-07_packing-db-product-match.md의 선행 사용자 변경은 이번 커밋에서 제외한다.

## 최종 배포 검증 (2026-10-08 KST)

- 기능 커밋: `723ffb82fce6dfcf0510999fbb461f016991c19c`.
- PR #960: 원격 ERP Contract Guard 통과 후 13:13:32 KST 병합. 운영 SHA `e8de7664b77ad13eb166bea3d82201bda08f7c1e`.
- Deploy to Cafe24 실행 `37726456265` 성공(13:18:56 KST 완료). 서버 계약/교차연도 검사, SSH 배포, 실브라우저 hydration 모두 통과.
- 실행 URL: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37726456265
- 운영 buildId는 `build-1791429272552`에서 `build-1791432935266`으로 변경됨. 실제 화면 왼쪽 상단 SHA도 `e8de7664` 확인.
- 허용된 테스트 계정 로그인 후 `/import/tools` 및 `/incoming` 1920×1080 CSS/100% 실브라우저 확인. runtime 오류0, API 오류0, 페이지 가로 넘침 없음.
- 입고관리에서 기존 원장을 실제 클릭해 상세 표의 `실제 도착원가` 열과 원가 조회200까지 확인. 원장 선택은 조회만 수행했다.
- `/api/ping`: DB 정상. 저장 초안 GET 200(2026/41-01 문서0), 기존 입고 원장의 원가 GET 200(승인 원가 없음). 문서0/원가 없음은 최초 미등록 상태이며 임의 0원 원가를 생성하지 않음.
- 운영 smoke는 로그인 이외 GET/HEAD/OPTIONS만 허용하는 브라우저 차단 장치 사용. 운영 입고·원가 승인·초안 쓰기0. 신규 입고 저장/수정/원가 승인 자체는 앞서 격리 SQL에서 검증한 결과와 구분한다.
- 로컬 증거: `outputs/invoice-receipt-live-import.png`, `outputs/invoice-receipt-live-incoming.png`, `outputs/invoice-receipt-ui-1920x1080.png`, `outputs/invoice-receipt-ui-1280x800.png`.
- 이 배포 후 증거 단락은 로컬 MD에 추가 저장했다. 운영 기능 배포 후 문서만 다시 배포하지 않았다.
