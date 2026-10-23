# 네덜란드 물량표 인라인 작업 — 진행 중

| 항목 | 상태 |
|---|---|
| 작업트리 | C:/Users/USER/nw-dutch-inline-workflow |
| 브랜치/기준 | codex/dutch-inline-workflow / d57e3e98 |
| 원장 | 운영 DB 변경 없음 |
| PR/배포 | 없음; 전체 검증 전 |

## 고정된 결정
- 원본 물량표를 유지하며 업체/품목 추가를 팝업으로 처리한다.
- 전체 축소가 아니라 열 폭 축소, 반복 단가 입력 문구 제거.
- 등록·분배 버튼은 기존 범위 확인/확정 보호/사전 저장/원자적 writer를 우회하지 않는다.
- 사용자가 공유 Product.Descr 저장을 확정했다. 기존 설명 보존, 전체 변경 비고 확인 후 저장한다.

### 1. 요청과 조사
**Q.** 업체 추가, 좁은 업체 열, 칼라 품목관리 저장, 원본 화면 팝업, 상단 등록·분배, 인쇄/엑셀 선택, 재업로드 지원 및 dnSpy 검증.

**A.** 최신 origin/master 기반 별도 작업트리 생성. MD 계약 확인, 실제 dnSpy ClassProduct로 Descr 공유 확인. CSS 작은 글씨 재정의와 zoom:.7 확인.

**결과.** UI 초안: 업체 열 36px, 라벨 열 62/152/58px, 전체 zoom 제거, 빈 단가 문구 제거. 소스 검사 테스트 갱신. 실브라우저/전체 빌드/ERP gate 미검증, 미배포.

## 남은 작업
- 색상 저장은 별도 좁은 CAS API로 구현했다. 전체 Product readback 및 트랜잭션 감사 보호.
- 추가 팝업과 원본 matrix 새 열/행 표시, 저장/복원 포함.
- 상단 등록·분배, 인쇄 선택, Excel roundtrip 구현.
- 현재 연도/차수 읽기 전용 probe 및 실제 distribution dnSpy 대조.
- 계약 갱신, 회귀 테스트, ERP gates/build/browser, PR/CI/병합/Cafe24 smoke.
- install.log 등 임시 파일은 커밋 제외.

### 2. 배포 요청 후 검증
- 이번 배포 범위: 레이아웃/빈 단가 문구와 Product.Descr 칼라 저장. 추가 팝업/인쇄/재업로드는 아직 미완이라고 사용자에게 구분 안내.
- 실제 dnSpy ClassProduct 재확인, SELECT-only schema/trigger probe. Stock을 UPDATE하지 않으면 정규화 트리거는 즉시 반환.
- productColor, Dutch UI 검사, 전체 test:erp-contract, test:nenova-dnspy-evidence, manifest, write guard, npm run build 성공.
- 실브라우저 격리 실제 컴포넌트 SSR: 열 폭 62/152/58/36px, 수량13px, 표452px, 빈 단가문구 없음 확인. 저장 POST 운영 시험은 하지 않음.
- PR/운영 배포 및 운영 스모크는 후속 결과로 기록한다.
