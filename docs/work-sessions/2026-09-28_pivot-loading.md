# 피벗 중앙 로딩과 단계 진행률

Q. 필터 설정 후 페이지를 불러올 때 중앙 로고 애니메이션과 %가 필요하다.
A. 조회/필터/집계/화면 표시의 단계 완료율을 표시한다. 서버 SQL 작업량이나 소요시간을 추정한 %가 아니다.

## 구현 전 기준과 부작용

| 동작/기준 | 처리 |
|---|---|
| 서버 조회 대기 | 0%, 실제 응답 수신 전 시간으로 증가시키지 않음 |
| 원본 수신 | 25%, 기존 GET만 사용 |
| 필터 완료 | 50%, 기존 filterRows와 원본 조건 그대로 |
| 집계 완료 | 75%, 기존 buildPivotModel 그대로, worker에서 실행 |
| 화면 반영 | React commit 후 두 animation frame을 거쳐100%, 짧은 완료 표시 후 닫기 |
| 새 조건/취소/이탈 | 이전 worker 종료·콜백 무효화, 이전 응답이 최신 결과를 덮지 않음 |
| 실패 |100% 표시 금지, 오류/재시도, stale 결과 엑셀 금지 |
| API/원장 | SQL/API 변경 없음. Order/Shipment/Date/Farm/Warehouse/Stock/Estimate/WebProfitReport 및 Amount/Vat/isFix 모두 보존 |

## 근거

- 실제 dnSpy.Console FormQuantityPivot GetData/ViewOrder/ViewWarehouse/ExportToXlsx 재확인.
- SELECT-only 동일 운영 범위2026 01-01~02-02 8,066행, 장미 입고 메인01차4,858/02차4,330 확인. 직전 작업과 수량 동일.
- ERP guard 스킬 적용: 계산 실행 위치/상태만 변경. 기존 모델과 worker 모델 동등성 및2025/2026 교차연도 fixture 필수.

## 검증/배포

- test:pivot-exe/erp-contract/nenova-dnspy-evidence/erp-manifest/guard:erp-writes/ui-layout 및 build 통과. 마지막 작은 상태 변경 후 build 재확인.
- 실제 빌드 자산을 localhost fixture 서버로 제공(운영 인증/DB 없음).16,000행에서 필터 적용50%·완료 후800행/수량800 확인. 조회 취소 시 로딩 해제와 엑셀 차단, 재조회 복구.503은 검증용 오류로 표시하며100%/다운로드 금지.
- 1920×1080 및1280×800 중앙 카드 위치/회전 CSS/취소버튼 확인, worker 로딩 및 콘솔 오류 없음. `.tmp` 진단 로그·probe·fixture는 커밋하지 않는다.
- 배포/운영 검증 진행 중.
