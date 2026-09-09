# 견적 수량 증가분 다음 세부차수 배정 — 구현 전 기준

상태: 설계/검증 중. 배포 완료가 아니다. 사용자 최종 결정은 **다음 차수 업체 기본 출고일**이며, 앞선 '현재 출고일 유지' 답변을 대체한다.

## 근거

- 2026-09-09 실제 dnSpy CLI: `FormShipmentDistribution.btnSave_Click`, `CommonLogic.GetBaseOutDay/GetShipmentDate`, `ClassShipmentDetail.Insert/Update`, `ClassShipmentDate.Insert/Update`.
- GetBaseOutDay는 Customer.BaseOutDay의 NULL/0을 4로 처리한다. GetShipmentDate는 `PeriodDay.OrderYearWeek=year+parentWeek AND WeekDay=BaseOutDay`의 BaseYmd를 사용한다. JS 달력/ISO 주차 추정은 사용하지 않는다.
- 운영 SELECT API로 사용자가 보고한 동일 연도·업체·품목의 현재 부족/다음 가용 재고, 출고일별 행과 다음 업체 확정마스터 존재를 확인했다. 실제 업체명·원장 수량·키를 포함한 상세 산출은 공개 저장소에 넣지 않고 `outputs/estimate-overflow-evidence.json`(미커밋)에만 보관한다.
- 현행 usp_StockCalculation 원문 SELECT: 직전 **StockMaster 1건**(제품별 과거행 검색 아님), ViewWarehouse 수량합 ROUND2, ViewShipment.DetailFix=1 합 ROUND2, CodeInfo StockType에 속한 StockHistory 순변화 ROUND2. 해당/후속 ProductStock cascade. Product.Stock은 이 SP가 변경하지 않는다.
- 현행 usp_ShipmentFix: 신규 확정은 DetailFix=1, Product.Stock 순차감, ChangeType=출고 이력, 출고일 이력. 품종 전체 SP를 호출하면 다른 미확정행도 변경하므로 이 기능에서 호출하지 않는다.

## 기준/소비자

| 기준 | 미리보기·저장 재검증·사후검증 |
|---|---|
| 업무키 | 연도+세부차수+업체+정확한 ProdKey, 부모차수 하나 |
| 배정 | 원본 기존량 보존, 양수 증가만 현재 가용량 먼저, 부족분만 01→02 또는 02→03. 03→다음 부모차수 자동 이동 금지 |
| 다음 차수 | 같은 연도, 바로 다음 세부차수 StockMaster와 업체 ShipmentMaster가 실제 존재해야 함. 없는 마스터/차수 추정 생성 금지 |
| 날짜 | 위 EXE의 Customer+PeriodDay 조회, 유일한 BaseYmd 필수. 기본일 외 기존 날짜들은 보존 |
| 가용량 | 위 native 근거의 주차 원천+미확정 예약분도 차감. 원본 증가가 다음 차수 이월을 줄이는 영향 반영. 미리보기/저장은 같은 계획 helper |
| 수량 경계 | 물리수량 0.001 정규화, EstUnit 수량은 EXE 정수 반올림과 환산 후 왕복 검증. 가용량을 초과하도록 올림하지 않음 |
| 신규 다음 출고 | 미리보기에 '신규 출고 생성·확정' 명시 후 확인된 경우만 native 0→N 순효과 적용. Master 상태를 근거로 isFix 상속하지 않음. 기존 다음 상세가 미확정이면 자동 확정하지 않고 안내 |
| 기존 확정 | 기존 Master/Detail isFix 보존. 전체 확정해제/재확정 금지 |
| 다음 주문 | 같은 연도·차수 업체·품목 양수 활성 주문 있으면 보존. 없으면 양수 신규, 원본 주문은 보존. 0 가짜 주문 금지 |
| 단가 | 기존 행 단가 보존. 신규 다음 행은 원본 저장 단가 사용, 미리보기에 표시. 수량+단가 동시 편집은 분할 전에 별도 단가 저장 안내(잘못된 새 행 재기준화 방지) |
| 동시성 | V2 gate→현재/다음 스냅샷·편집권·재고 잠금→서버 재계획 해시 일치→한 트랜잭션→원장/날짜합/EXE 노출/후속재고 확인 |
| 중복 | 작업 UUID+Actor+요청 해시, SystemActionLog에 결과를 같은 트랜잭션으로 기록. 동일 요청 재시도는 기존 결과, 다른 요청값 재사용은 거부. 응답 불명 때 새 ADD 재생성 금지 |
| 기본값 | overflow 요청 생략은 기존 저장 계약. 미리보기 자체는 ERP·편집기준값 쓰기 없음. 명시 확인 없이 apply 금지 |

## 부작용 표

| 동작 | OrderMaster/Detail | ShipmentMaster | ShipmentDetail/Date | ShipmentFarm | Product.Stock/StockHistory | ProductStock | Estimate/WebProfitReport |
|---|---|---|---|---|---|---|---|
| 미리보기/결과조회 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 현재 적용분 | 보존 | 보존 | 선택 날짜 증가분 및 상세환산·금액만 | 보존 | 확정 순증만 출고 이력·차감 | native 품목 재계산 | 직접보존; 정상견적/매출 View 수량·금액만 변동 |
| 다음 적용분 | 활성주문 보존/없으면 양수신규 | 기존행 보존 | 기본일 증가/없으면 생성, 신규 출고 확정은 명시확인 | 보존 | 확정 순증만 출고 이력·차감 | native 품목 재계산 | 직접보존; 정상견적/매출 View에 신규분 포함 |

## 알려진 근거 충돌

기존 estimate-date-quantity 계약의 차수별 가용량 설명과 현재 구현의 Product.Stock 검사가 다르다. 새 분할 경로는 Product.Stock을 차수별 배정 기준으로 사용하지 않으며, global current stock은 확정 순증 총합 안전검사에만 사용한다. 기존 무분할 경로를 임의 수정하지 않는다. 기존 웹의 ROUND3<0 저장 가드와 native FIX ROUND0<0은 별도 정책임을 유지하고 새 분할은 실제 부족량을 반올림해 숨기지 않는다.

## 필수 회귀

원본0/일부배정, 다음부족, 이전연도 동일차수, 이월 이중계상, 다음날짜2행, 기본날짜없음/중복, 기존 주문유지/신규양수주문, source0변화 금액/이력 보존, 확정순증 정확히1회, 단계별 전체롤백, 응답유실후 동일작업 재시도, 새마스터 없음·미확정 상세 차단, 동시단가 편집 안내, 1920×1080 미리보기·실패·완료 UI.

## 구현 후 검증 (2026-09-09)

- 실제 SQL: `scripts/test-estimate-overflow-sql.cjs` 통과. official SQL Server 2022,
  loopback 14339의 mount 없는 별도 컨테이너, 임의 생성한 `NenovaEstimateFixture_*`
  DB만 사용했다. native backup SHA256 prefix `adddbf9fd0c6`의 프로시저 본문은
  이름만 변경해 사용한다. 시험 DB는 완료/실패 후 삭제하며 운영 DB 쓰기는 0건이다.
- 미리보기 전후 ERP 원장 일치, 부족분 전량10/일부4+6, 신규 양수 주문·확정 출고·기본일,
  기존 주문·다른 날짜·원본 단가/금액·Estimate 보존, Product.Stock 정확히1회 차감,
  native 다음 재고0, 동일 UUID 재호출 무변경, 이전연도 보존, native 실패 전체롤백 통과.
- native CATCH가 외부 트랜잭션을 롤백하면 SQL266이 결과 SELECT 전에 발생했다.
  확인된 266/current count=0만 `STOCK_CALC_TRANSACTION_ABORTED`로 알린다.
  일반 네트워크 오류는 여전히 미확정 상태이며 성공/롤백으로 추측하지 않는다.
- 기존 directional SQL 시험은 master 원본 API로도 동일하게 실패하는 옛 fixture 2건을
  확인했다. 160.16송이는 실제 정수 환산에서 증가0이므로 16송이 증가/가용0.999로
  바꿔 실제 -0.001 부족을 검사한다. 또한 현행 Product.Stock/순증가 계약에 맞춰
  1 증가/현재고0.5 부족을 검사한다. 생산 저장 정책은 바꾸지 않았다. 수정 후 기존
  `scripts/test-estimate-directional-sql.cjs` 전체 통과.
- 새 fixture의 ShipmentDate는 실제 native INSERT처럼 identity이며, 기존 fixture만의
  OrderDetail.CustKey/OrderQuantity 필수 제약은 사용하지 않는다. native INSERT 근거를
  코드보다 우선 적용했다. OrderMaster/ShipmentMaster 부모키와 ViewOrder의 전체 차수키
  JOIN을 최종 검증에 포함했다.
- UI mock smoke: 모든 `/api/*` 차단, 1920×1080/100%. 모달 bounds x210–1710,
  y392–688, 화면 가로 넘침0, 취소 적용0회, 확인 적용1회, 현재 실제저장량55 표시,
  다음 차수+5 로그 표시, 오류0. `outputs/estimate-overflow-ui-1920.png` 로컬 증거.
- 전체 ERP 계약·dnSpy 근거 검사 통과. 최종 변경분 manifest/guard/build와 배포 결과는
  세션 기록의 후속 항목을 따른다.
