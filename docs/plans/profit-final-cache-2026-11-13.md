# 최종 통관비 계산본 저장 정합

## 실측과 범위
사용자 승인: 2026년36~46차 최신 통관비까지 명시 갱신, 기존 계산본 보존 및 재고/비용 영향 분리. 실제 저장 새버전222~232와 재조회 화면을 대조한 결과 POST 응답에는 관세/평균 보완값이 있지만 원본 저장 JSON에는 loadReportData의 보완 전 값이 남았다. 과거 GET의 고정 계산정책은 정상이며 이를 해제하지 않는다.

실제 CLI 재확인(2026-11-13):
```powershell
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormSalesView 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
```
FormSalesView.GetData의 기존 ViewShipment/ViewOrder/ShipmentDate/PeriodDay 매출 조회는 변경하지 않는다. EXE에 웹 계산본 저장 기능은 없다. 원문 증거는 비공개 E:/NenovaVerification/stock35-20261113/FormSalesView-current.txt. 기존 native/SQL근거는 profit-weekly-cache-evidence-2026-10-27.md. 운영 SELECT 전후 ProductStock/StockHistory/OrderDetail/ShipmentDetail/Estimate/WebProfitReport 지문 일치, 활성 회계 확정36~46 없음, 기존 버전 보존을 확인했다.

## 기준·부작용
|동작|Snapshot|ERP 주문/출고/입고/재고/Estimate|WebProfitReport 수기/확정|
|---|---|---|---|
|과거 일반조회|최신 저장 calc/totals 읽기, 재계산0|보존|보존|
|명시·예약 갱신|기존 동일 연도/대차수 잠금과 원천 전후 검증 안에서 최종값 새버전 INSERT|읽기만|보존/활성확정 skip|
|donor 읽기|완성 계산본의 cacheSourcePayload만 원천으로 사용|읽기만|보존|
|원천/관세/평균 연결 실패|INSERT0/기존 transaction rollback|보존|보존|

`finalizeProfitCachePayload`는 raw materialization→strict 관세/평균 연결→최종 형식/연도/차수검사→최종 calc 보존과 raw donor 분리를 수행한다. 명시 저장은 관세 메모리 캐시를 새로 읽는다. `saveProfitCache`는 이미 검증된 materialized calc를 auto/manual로 재계산하지 않는다. `profitCacheSourcePayload`는 동일 연도/차수·정책버전·원천 형식을 검증하며 중첩/누락/상이연도 donor를 거부한다. 옛 계산본/확정 JSON의 UPDATE/DELETE 및 schema 변경0.

기존 사용자가 누르는 조회/계산본 생성·갱신 순서·버튼·페이지 구조 변경 없음. 화면틀/스크롤/키보드/가이드 신규 변경 해당없음. 원가 산식·관세율·EXE/SP 변경 없음. 계산 보류 원천을 임의0으로 만드는 수정 아님. 45·46 조회의 HTTP HTML 오류는 저장 완료와 별개로 검증한다.

실행형 회귀 profitFinalCache.test.cjs: 최종값/원천 동시 보존, 실제 저장 함수 body→SQL spy→재조회 roundtrip, 중첩/손상/교차연도·차수, strict 실패/미완성 fallback/수기0, 모든 호출자 공통 경로. 기존 weekly/monthly/export/confirm/source-fence 검사를 유지한다. 전체 gate/build/CI/배포 및 재갱신/운영 재조회는 후속 WORK_MEMORY에 기록하며 실행 전 완료로 주장하지 않는다.

## 명시 운영 갱신
45/46 진행 차수는 전체 원천 GET이 반복502/HTML 응답으로 실패할 수 있어, 화면 GET을 선행하지 않는 같은 기존 POST action의 순차 운영 도구를 둔다. workflow_dispatch만 있고 기본 dry-run, 기존 서비스 토큰을 기존 withAuth 경로에 사용한다. 권한확대/신규인증/새API/일반GET저장0. parse와 executor가2026/36~46 범위를 각각 검사하며 임의 URL/연도/차수를 받지 않는다. 결과에는 차수/버전/키/완료·결과불명 코드만 남기고 토큰·응답 payload·SQL·금액·개인정보는 CI artifact/log에 남기지 않는다. HTTP 실패/HTML/응답불명은 즉시 중단하고 자동 재요청하지 않는다. SQL readback으로 저장 유무를 확인한 뒤 남은 범위만 사람이 명시 실행한다.
서버에만 존재하는 정산 원천/분류 파일도 사용해야 하므로, 로컬에서 같은 함수로 만든45/46 임시 계산본231/232는 최종 검증본이 아니며 배포 후 운영 HTTP 새버전으로 대체한다. 기존 버전은 삭제하지 않는다.
