# 선택 원가 파일 즉시 처리

## 기준 / 부작용

| 동작 | 원천/검증 | 변경 | 보존 |
|---|---|---|---|
| 자동 처리 | uploadedAt+24h, 기존 arrivalDriveTiming | 기존 WebArrivalCost revision | 예약 규칙·등록시각 |
| 지금 처리 | nenovaSS3 + confirm===true + resolveArrivalDriveSelection | 선택 파일 해당 연도/차수/국가만 기존 revision 저장 | 다른 파일·차수·연도 |
| 원본 변경/충돌 | id/sha/year/week/country 재검사, 파일 hash | 보류 상태만 | 모든 원장 |
| 수동 현재본·수동 매칭 | 기존 createArrivalCostImport DB lock 내 검사 | 보류 상태만 | 수동 수정값 |

Product/Farm은 읽기 전용. OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, WarehouseMaster/Detail, StockHistory/ProductStock, Estimate, WebProfitReport 및 호텔 WebRaumPnlItem.CostPrice는 변경하지 않는다. 웹 원가 참고값의 갱신만 의도한 downstream 효과다.

## 구현

- 설정 API POST action=run-now를 관리자만 사용. 누락/false/문자열 확인값 거부.
- 실행 중복 시 상태 조회 안내. 완료 상태는 건너뛰며 DB hash 멱등 경로 유지.
- 파일명/차수 확인창과 파일별 버튼, 진행 표시, 완료 행수/매칭 확인 건수/이력 또는 보류 사유.
- 처리 실패 메시지가 24시간 대기 문구에 가려지지 않게 우선 표시.
- 일반 업로드나 서버 등록시각 조작으로 우회하지 않음.
- 기존 API를 통해 실행하므로 별도 서버 SSH 인증 불필요.

## 검증

- dnSpy 및 읽기 probe: FormArrivalCost golden 기록.
- 단위/실행 fixture: 선택 한 개, 기본 대기, stale hash/year/week/country/id, 비활성/제외국가/누락시각, 파일군 충돌, 완료 중복, 수동 보호 실패, 처리 중, 관리자/confirm 형식.
- 기존 저장 코어 fixture: 동일 hash 멱등, 최신 revision, 이전 연도 보존, 오류 rollback, 수동 현재본 보호.
- 전체 필수 검사·빌드·배포·실브라우저 결과는 완료 후 추가.
