# 출고분배 업로드 버튼 정돈 · 2026-11-20

## 목적과 범위
운영 1920px 캡처에서 파일 선택, 반영 방식, 물량표 생성/저장품목, 검증, 승인, 이력이 한 toolbar에 섞여 두 줄로 감겼다. 기존 업무 순서에 맞춘 절제된 toolbar/구획 구조로 정돈한다. 새 계산 모드·권한·API·메뉴를 추가하지 않는다.

## 기준선과 부작용
| 사용자 동작 | UI 변경 | OrderDetail / ShipmentDetail / ShipmentFarm / ShipmentDate / Estimate / Stock / WebProfitReport |
|---|---|---|
| 파일/선출고/합산/다운로드 형식 선택 | 1번 입력 행으로 묶음 | 기존 onChange·검증 무효화 그대로 |
| 검증·승인·검증본 다운로드 | 2번 주요 행동 행으로 이동, 중복 농장검증을 주 검증으로 통합 | 기존 handlePreview(차수·파일 확인 포함)/handleApply/handleFarmDownload 그대로 |
| 보조 생성·저장품목·이력 | native details로 묶음 | 원래 핸들러·조건 그대로; 닫아도 입력/선택 상태 보존 |
| 카톡 농장 입력/단독 저장 | 선택 입력 details | 기존 farm-only 저장 범위 그대로 |
| 가이드 | 외부 details 아래 두 업무명으로 구분 | 조회·재생만, 바깥을 닫으면 재생 정지 |

UI 소스의 JSX 배치/표현만 변경하며 API·SQL·서명·권한·수량·농장 정책은 수정하지 않는다. EXE 저장/같은 연도 키/다운스트림 근거는 docs/plans/additive-distribution-2026-11-20.md 및 docs/exe-golden/FormShipmentDistribution.md의 기존 실제 CLI/읽기 probe를 재사용한다. 새 원장 쓰기 또는 운영 DB 시험 저장 없음. 기존 양식과 추가/최종 파일 exporter도 변경하지 않는다.

## 기준값 대조
- 체크 기본 false(REPLACE), ADD 기본 FINAL 다운로드, 선출고 기본 ORIGINAL_INCLUDES_EARLY 보존.
- 선택 year/week, pendingJob·확정·stale·완료 후 잠금, 체크/radio/농장 변경 후 검증 무효화 보존.
- 교차연도 fixture: 기존 shipmentAdditiveImport/shipmentAdditiveApply의 2025/2026 같은 차수·업체·품목 fixture 그대로 실행.
- always 적용: 목적 표시·한글 고딕·14px 조작부·tabular-nums·자연 페이지 스크롤·1920/390·키보드·실제 가이드.
- 해당 없음: 새 메뉴/권한/DB/SP/Rust 핫패스(일반 React 정돈), 원본XLSX/인쇄 정책 변경.
- Desktop: 기존 Layout 카탈로그와 menu.json의 /shipment/distribute-import 연결 유지; 별도 홈 바로가기 중복 추가 없음. 예약1.3.76으로 업데이트 제공/검색·즐겨찾기 기존 경로 검증.

## 검증 진행
실제 React/합산/저장 진입점 회귀16개 통과. 격리 Chrome 기본 REPLACE→ADD10+3=13, 다운로드2형식, 승인 잠금·완료 후 다운로드·반복 경고, 1920/390·가로넘침 없음, details Enter/Space 및 농장 값 유지·이력 부모 밖 표시 통과. 현장물량표 dry-run(원본/농장단독/1차합산 해제/생성파일 readback) 통과. 이후 최종 가이드·ERP 게이트·배포 결과를 WORK_MEMORY에 기록한다.

## 최종 모달 접근성 보완
추가 실제 클릭에서 native confirm 뒤 미매칭 모달을 Escape로 닫으면 body로 초점이 복귀하고, 390px 하단 재검증 버튼이 오른쪽403.5px까지 나오는 문제를 확인했다. confirm 전 실제 호출 버튼 ref를 기억하며 닫을 때 연결/활성/표시 여부를 검사하고 안전한 활성 버튼으로 복귀한다. 하단 행동 줄은 wrap을 허용한다. `scripts/smoke-distribution-import-layout.cjs`로 Escape 복귀·비활성 호출자 반례·분배 제외 선택 보존·재검증 payload·1920/390 하단 버튼 범위를 검증한다. 표 안의 넓은 매칭 후보는 기존 가로 스크롤을 유지한다. 저장/계산 정책 변경 없음.
