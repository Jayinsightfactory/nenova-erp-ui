# 공동 AWB 원가 계산

## 2026-11-10 원본 통관비 기본 계산
- 기존 42-1 P6=C8×460, P8=C9×10000, P10=SUM(P6:P9)+R6+R7. P7=33000/P9=99000/R6=40000. R7 원본 공란(합계의 추가금 없음). 품종수는 전체 AWB의 실제 활성 원가 그룹 수이며 농장/상품 행 수가 아니다.
- 기본 FORMULA: 현재 공동 GW와 품종 분류로 서버가 통관 합계를 재계산, preview와 download가 같은 appliedInput 사용. 실제 청구 확정액으로 표시하지 않는다. TOTAL 명시/과거 명시 총액(0 포함)은 그대로 보존. GW/CW/운임 누락은 임의0·이전차수·농장GW 합산으로 채우지 않는다.
- 환율: 기존 인증 live-exchange-rate GET의 조회시점 시장환율+15원. 출처/시각 표시, 직접입력 우선, 실패는 재조회/직접입력 안내. 승인된 과거 환율/원장은 변경하지 않는다.
- 동작/부작용: 조회=기존 Warehouse/웹문서 SELECT, 입력=브라우저 메모리, 계산/다운로드=순수 계산·파일응답. Order/Shipment/Stock/Estimate/WebProfitReport/승인원가 모두 보존. 새SQL/DDL/SP/운영쓰기0.
- DNSpy 2026-11-10 실제 ExcelLoadingPackingList CLI 재확인: dt[5]/[8]/[9] 박스/단/송이 독립, uspCreateWarehouse→uspStockCalculation. 이 경로 변경/호출 없음. 기존46-1 SELECT snapshot(31송장/총64204.86USD) 재사용, 실비 검증과 원본기본값 계산본 검증 구분.
- 메뉴 기준: 기존 UI/키보드/페이지스크롤 적용. 새 메뉴/입고쓰기 해당없음. 변경된 통관/환율 입력 가이드 재촬영 필요(검증 전 완료 표시 금지).

## 근거와 기준
- 43-1 콜롬비아 원가표: 품종별 박스수 × 실중량/부피 계수로 비율 계산. GW=CW이면 중량, 다르면 부피로 운임 배분. 통관비는 중량 비율.
- 44-1 수국 원가표: 공동 AWB 운임과 통관비를 전체 수국 송이수로 나눔. 농장별 CW는 필요하지 않음.
- 45-1 수국 AWB 160-17338005: 전체 GW 3483kg, CW 4307kg. 13개 송장 전체가 계산 분모. 농장별 CW를 실제 측정값으로 만들지 않는다.
- 실제 설치 EXE dnSpy CLI 재확인: BoxQuantity/BunchQuantity/SteamQuantity/UPrice/TPrice 독립 보존, InsertMaster의 입고 및 재고 SP 호출 순서 변경 없음.

## 기준 ledger
| 기준 | 원천 | 사용 |
|---|---|---|
| 연도+세부차수+정규화 AWB+통화 | 서버 문서 및 명시 manifest | 그룹 선택/미리보기/다운로드 |
| 전체 송장 목록+revision+sourceHash | 조회 당시 manifest | 누락/중복/변경 차단 |
| 품종 분류 | 확인한 행별 groupId | 이름 자동 추정 금지 |
| 박스·송이·가격 | 저장 입고 재조회 | 원본 단위 보존 |
| GW/CW 및 총비용 | 공동 AWB 입력 | 그룹 전체에 한 번만 적용 |
| 미입력/0 | 원본 명시 값 | 누락은 오류, 명시 비용0 보존 |
| 출력 | 미승인 계산본 | 승인된 원가 자동 갱신 금지 |

## 부작용
공동 계산/다운로드는 WarehouseMaster/Detail 읽기만, Order*, Shipment*, Stock*, Estimate, WebProfitReport, 승인 WebInvoiceCost* 모두 보존한다. 실제 입고는 기존 writer의 격리 테스트에서만 실행한다. 새 운영 쓰기/DDL/SP 호출 없음.

## 검증 상태
구현 중. Aside 전체 13농장 입고→다운로드, 다른 국가 회귀, 배포는 아직 미검증.

## 2026-11-10 엑셀 재계산 회귀
- 판매 행수 진단이 CO AB12(중량배분 입력)를 덮어써 원가→추천판매가→COUNT→중량비율 순환을 만든 원인 확인. 진단을 AK14:AL15로 이동해 원본 수식·다른 국가 배치는 유지한다.
- 46-1 읽기 스냅샷 31입고265상품으로 루프백 실제 컴포넌트 다운로드. GW100/CW120/운임100USD는 TEST_ONLY. 실제 비용 검증으로 보고하지 않는다.
- Artifact와 Microsoft Excel에서 GW100→101로 통관비 및 전체 도착원가 합계 +460원, 265상품 원가·판매·이익 갱신/원복 검증. 재현 명령: `powershell -NoProfile -File scripts/verify-colombia-cost-recalculation.ps1 -FilePath <다운로드.xlsx>` (파일 readOnly, 변경 저장 없음).
- 운영 DB·확정 원가·매입액·손익·재고는 전부 보존한다. 최종 CI/배포 결과는 작업 메모에 추가한다.
