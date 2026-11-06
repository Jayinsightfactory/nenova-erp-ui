# 보고서 동결·명시 조회 기준표 (구현 전)

최신 사용자 승인으로 과거 관세/평균 평가 overlay 예외를 대체한다. 저장/확정 원본의 금액을 현재 원천과 혼합하지 않는다.

| 기준 | 권위 / 적용 |
|---|---|
| 확정 | 활성 WebProfitReportConfirm revision 전체 CALC/합계 최우선. 최근창도 재평가하지 않는다. 표시 K만 표시 J/C, C=0/null 공란 |
| 최근창 | 실제 PeriodDay 현재 업무차수와 직전 업무차수. 01 직전은 실제 달력 53/52; 숫자52 고정 금지 |
| 비확정 최근/미래 | 전체 loadReportData 최신 SQL 입력. current/prior 본표는 같은 요청의 raw SQL 전체로 교체. 오래된 취득원가 reference는 immutable donor 근거로만 유지하며 현재 본표 C/G/E/F/H를 그 금액으로 이식하지 않는다. 실패는 명시 보류, 저장본 일부 대체 금지 |
| 과거 | 최근창 이전 전체 물질화 저장 payload row.calc/totals. 현재 관세·평균·재고 금액 overlay 금지. 저장 누락/legacy는409 준비필요; 자동 생성/갱신 없음 |
| 사용자 0 | 수기/실제0 null과 구분. truthiness default 금지 |
| 조회 의도 | 진입/URL/선택/전후차수/보기변경은 입력만. 조회 클릭(키보드 포함)에서 캡처한 범위만 GET |
| 응답 경합 | 범위변경 시 abort+sequence 무효화. 미조회 범위를 이전 결과 제목으로 표시하지 않으며 출력 비활성 |
| 소비자 | category/weeks/monthly/XLSX/print 모두 loadWeeklyReportPayload 공용 정책. 현재 원장 참고는 별도 명시 펼침 |

부작용: 화면진입/선택/조회/출력은 Order*, Shipment*, ShipmentDate/Farm, Warehouse*, Stock*, Estimate, FreightCost, WebProfitReport, Snapshot, Confirm 모두 보존(SELECT only 또는 요청0). 운영 DML/DDL/SP/백필/재계산/계산본생성0.

실제 dnSpy.Console.exe --no-color -t FormStockView 및 FormSalesView를 설치 Nenova.exe에 실행했다(2026-11-06). FormStockView.GetData는 StockMaster→ProductStock 및 업무차수/이전차수, FormSalesView.GetData는 ViewShipment/Order/PeriodDay와 DetailFix=1/저장 Amount를 조회한다. 웹 계산본은 EXE 별도 금융 원장이며 본 변경은 native 저장/계산 순서 변경 없음.

## 실제 SELECT 및 대상 검증

2026-11-06 운영 PeriodDay 현재45(11/04~11/10), 직전44(10/28~11/03). 실제 운영 cutoff는<=43이며 사용자 예시 현재44일 때만<=42/최근43·44다. `scripts/probe-profit-frozen-history.cjs`는 SELECT/CTE SELECT만 허용하며 batch/SP를 차단한다. 과거39/42/43 canonical 응답의 모든 row.calc/totals는 원본 저장본 그대로이며 각각 약0.1~0.2초다. 표시 K만 기존 승인 J/C projection을 사용한다.

최근44 첫 cold canonical read: 46,853ms, 누적 SELECT2,704회, 전후 source fingerprint 동일. 전체 최신 main/prior SQL과 과거 취득원가 reference를 구분한다. 다음 값은 조회시점 결과이지 실제 납부 비용 또는 회계 확정 인증이 아니다.

| 국가 | N | C | G | E | F | H | J | K=J/C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 중국44 |44,964,933|39,413,527|59,971,650|1,833,777.480294|4,006,725.232037|13,989,631.366468|−32,374,806.614726|−82.1413587643%|
| 베트남44 |6,942,000|8,007,091|7,536,065.28|300,255.985185|295,804.818462|154,860|311,714.553276|3.8929812747%|

원래44 저장 N(중국45,989,638 / 베트남0)은 최신 본표에 사용하지 않았다. 중국 H/F의 과거 취득원가 reference는 보존하며 현재 N/C/G 등 본표 셀을 이전 저장본에서 이식하지 않는다. 실제/수기0 보존·확정 recent 전체 고정·누락409·최신 source failure·53/교차연도·요청별 KCS 성공/실패 memo·기본 serial replay 유지/명시 pool parallel SELECT fixture PASS. 초기 probe가 자체 전역 pool을 driver 기본15초로 열었던 하네스 문제는 production와 같은60초로 고쳤다. 앱 전역 DB 설정은 바꾸지 않았다.

느린 actualArrival history 조회는 int index 컬럼을 nvarchar로 변환하던 조건을 `h.ArrivalLineKey=TRY_CONVERT(INT,l.ArrivalLineKey)`로 변경했다. 실제 sys.columns/sys.indexes SELECT: ArrivalLineKey=int, IX_WebArrivalCostHistory_Line. CTE source의 EXCEL만 legacy history를 연결한다. 실제 SELECT-only 합성4행 검사에서 EXCEL/42만42 연결, INVOICE/42·INVOICE/invoice:42·EXCEL/missing은NULL. SQL/Schema/ERP 쓰기0.

원본 JSON SHA256은 사전/사후 동일:

- 39/v14 `640fc8a32ce68551adc2dedb9bdc95d106cf0fcd8992846860e9f4b3ff600d5d`
- 42/v1 `02fe1fe70e897464b54ded0565b6660af2a8d1e81f96665392360a588e64c1b3`
- 43/v1 `9ed4ecfa2897819ee168cd062aaa63dca34bfbd22d63492efe4fc37a30a3c82b`
- 44/v1 `c401ac77c081875436c5f6fddb2ed6f25acba459d43f826f29a234e216caba9c`

실제 Chromium1920×1080 합성 API dry-run PASS: 진입 금융GET0, 입력변경GET0, URL은선택만, 43 늦은응답 뒤44선택보존, 입력변경후표숨김/출력잠금, 차수·월별탭 전환GET0, 명시조회16요청. 영상 첫 녹화는 backend HMR로 재로딩되어 실패했으므로 ready가 아니다. 전체 소스 freeze 후 부모가 재녹화한다. 필수 전체gate/정식 build/CI/배포·운영 smoke는 아직 미검증. 기존 표시와 raw 저장금액이 달라도 새 계산본 생성·보정·갱신은 하지 않는다.

메뉴 기준선:1920/키보드·명시query·scope·페이지스크롤·가이드 적용. 신규ERP writer/입고매칭/저장workflow 해당없음. 초기 context metadata GET은 금융조회0 원칙의 명시 허용 예외. 22개 출력선택/사용자비고 정책은 보존한다.

최종 fence 보완: 기존 ERP 지문에 없던 WebInvoiceCostRevision/Line/Document/Operation의 revision/status/financial values/JSON을 연도범위 SHA256로 전후 비교한다. 실제 SELECT digest `D41527E908FBBC09E2CD72A4DC05A0C10124D26D93ADAB89E13568DB7F65BF0A`; 동시승인 revision 변경이면 PROFIT_SOURCES_CHANGED fixture PASS. 운영44 전체 probe는 이 보완 전 수행했고 금융 산식/원천 선택은 그대로다. 보완 함수 실제SELECT는 별도로 성공했다.

현재 원장 참고 예외를 명확히 한다: 역사 본표 monetary overlay0이며 week-check는 별도 펼침에서만 조회한다. 기존 하단 재고조정 참고 notes는 사용자가 보고서 조회를 누른 뒤 자동GET할 수 있고 현재원장 별도참고 라벨을 유지한다. 최초진입/선택만으로는 해당GET도0. notes까지 명시 펼침 전용으로 바꾸는 것은 이번 범위 밖이다.

최종 녹화 PASS: localhost 실제화면/모든API합성, 추가reload0, 금융요청16/최초0/변경0/쓰기0. 1920×1080/20fps/48.9초 MP4·한국어VTT·proof와4목차 ready 등록, 중간·끝프레임 부모 시각확인. 초기 실패 녹화는 개발 HMR origin/클릭안정화 전 시도이며 최종 파일로 대체했다. 전체source freeze 이후 촬영했으며 이후 UI source 변경 없음. 필수 전체 gate 및 built UI/player 확인을 이어 진행한다.
