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
PR #801 / master39d155c9 / Cafe2436540249821 성공. 1920×1080 운영 확인: 친구플라워/울산신화 4개 매칭의 2026-09-29 17:08:47 분석 시각이 새로고침 후 저장된 분석으로 유지됨. 원장 probe 전후 동일.

## 실브라우저 후속 보완

실패한 신규 자동 분석도 호출 한도에 포함하도록 예약 시점을 네트워크 호출 전으로 이동. 저장본 응답만 한도 환급. 실패 후 다음 자동 요청 차단 fixture 추가.
저장 조회가 느린 신규 Claude 작업 뒤에 대기하고, 가시성/disabled 전환 직후 deferred 상태가 재평가되지 않는 경계 발견. 저장 전용 lookup을 분석 큐보다 먼저 실행하며, deferred 종료 상태 변화에서 eligibility 재평가. lookup miss는 모델 호출/저장 없음. 신규 분석 순차/자동한도는 유지. 후속 재배포 및 자동 표시 확인 진행.
