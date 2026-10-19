# 패킹 품목 매칭 후 다음 단계 — 작업 기준

사용자 요청: 원본 품명 옆 DB 품목을 연결하면 다음 단계로 진행한다. 별도 원문 대조 체크는 요구하지 않는다. 실제 수량·단가 오류 및 중복입고 검증은 유지한다.

## 변경 전 근거
- 2026-10-19 로컬 dnSpy CLI: ExcelLoadingPackingList.MakeTempTable / CheckData / InsertMaster 재조회. 품목 연결과 연도·차수 검증, 명시 입고 저장 경계 보존.
- 읽기 전용 운영 probe: WarehouseMaster 2025/42-02 28개, 2026/42-02 36개. 최신 WebInvoiceOperation LINK_EXISTING_COST COMMITTED. 이 작업에서 ERP 행 변경 없음.
- 기존 웹은 AI 상품행을 별도 MANUAL 확인 기록 없다는 이유로 차단했다. 사용자 최신 요구가 이 웹 전용 확인 정책을 대체한다. 확인하지 않은 행을 사람이 확인했다고 기록하지 않는다.

## 부작용 범위
| 동작 | Product | WarehouseMaster/Detail | Order/Shipment/Stock | Estimate/WebProfitReport |
|---|---|---|---|---|
| 품목 선택 | 조회, 기존 공용 매칭 CAS 저장 | 보존 | 보존 | 보존 |
| 다음 단계·숫자 수정 | 조회/브라우저 작업값만 | 보존 | 보존 | 보존 |
| 최종 입고 | 기존 명시 승인/중복 방지 API 그대로 | 기존 저장 정책 | 기존 정책 그대로 | 기존 정책 그대로 |

## 기준 및 소비 경로
- 원본 SHA-256 일치·행 존재·국가별 필수 수량/단가 형식·음수 거부: 공통 숫자 검증을 미리보기, 다음 단계, 어댑터에 적용.
- 품목: 현재 selectable DB 품목과 국가, 기존 명시 매칭/정확 매칭 기준 그대로. 미매칭이면 다음 단계 차단.
- 단위 환산/금액 검산/인보이스 metadata 오류/구형 중국 단위 모호성/잘린 파일: 기존 차단 유지.
- 숫자 수정: 원본 스냅샷과 변경 사유 보존. 수동 확인을 허위 기록하지 않음.
- 별도 상품행 원문 체크/PDF 렌더 성공은 다음 단계 조건에서 제외. 실제 저장은 기존 서버 preflight/commit에서 재검증.
- 연도·차수/원본·인보이스 키/중복 저장/동시 작업 검사는 변경하지 않음. 교차연도 fixture 유지.

## Q&A / 검증
**Q.** 원본 품명 옆 DB 매칭이 완료되면 다음으로 넘어가고 별도 원문확인 체크는 빼 달라.
**A.** 다음 버튼과 입고 변환기가 같은 assertPackingSourceValues를 사용한다. 선택적 숫자 수정은 requireConfirmation=false로 적용하고 VALUES_APPLIED로 기록한다. 실제 사람이 대조했다는 허위 확인 기록은 만들지 않는다.

- 전체 ERP 계약 검사, dnSpy evidence, 변경 manifest/write guard 통과. API/SQL 변경 0개.
- 첫 production build 통과. 최종 문구·PDF 오류 분리 변경 후 재빌드 예정.
- 격리 실제 Chrome: 체크박스 없이 단수10→20, 금액320→640과 사유 적용 성공. 반환 quantity20/method VALUES_APPLIED/confirmed false 확인.
- 기존 값 보존·0단가·누락/음수/잘못된 숫자·다른 SHA·2025/2026 스냅샷·미매칭 차단 테스트 통과.
- 실제 운영 파일 업로드/입고 저장은 실행하지 않았다. 운영 배포 후 화면 스모크 남음.
- `.tmp-*` probe/fixture/로그와 생성된 개발이력 JSON은 커밋에 포함하지 않는다.
