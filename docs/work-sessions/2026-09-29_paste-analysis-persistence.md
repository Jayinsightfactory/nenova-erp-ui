# 붙여넣기 사전 분석 영구 저장

## 요청 → 처리
- 페이지마다 다시 분석하지 않고 계속 보관 → 로그인 사용자·정확한 원문·연도 포함 차수로 서버 파일 저장. 기간 만료 없이 재사용.
- 원문/차수 변경은 별도 결과. 명시 재분석만 기존 결과 교체. 실패는 기존 성공 보존.
- UI에 저장 여부와 실제 분석 시각 표시. 주문 적용 여부와 분리.

## 기준/부작용
| 동작 | 웹 runtime | ERP 주문/분배/재고/견적/매출 |
|---|---|---|
| 저장된 분석 조회 | 읽기 | 보존 |
| 새 분석/재분석 | 성공 결과 atomic rename, actor scope | SELECT 및 기존 LLM 비용 로그만 |
| 결과 열기 | 초안 복사 | 최신 조회, 기존 명시 작업 흐름 유지 |

- `data/runtime/paste-analysis`는 비공개·gitignore·Cafe24 in-place 배포 보존 경로. 데이터 백업 대상에 포함해야 함.
- 다중 프로세스 lock 충돌은 실패 닫힘. 프로세스 비정상 종료의 잔류 .lock은 해당 작업 종료 확인 후 관리자 복구가 필요하며 자동 탈취하지 않음.
- dnSpy CLI FormShipmentDistribution GetCustomerList/ShipmentDate/SteamOf1Box 재확인.
- 읽기 전용 probe: 2026/39-02 CustKey478 ProdKey889, OutQuantity40, Amount2836364/Vat283636/isFixtrue, ShipmentDate1/Farm0/Order1/FixedView1. ERP 쓰기 없음.
- orchestration 문서는 현재 checkout에 없음. 하위 작업 없이 메인 수행.
- 테스트: 재생성/재접속, 사용자·교차연도·원문 분리, 동시 중복, 실패 보존, 재분석 전달, 캐시의 자동분석 한도 면제.

## 완료 상태
구현 완료, 필수 검증 및 배포 진행 중.
