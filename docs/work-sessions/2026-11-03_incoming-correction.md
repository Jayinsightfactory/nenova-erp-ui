# 입고 재업로드 수정

| 항목 | 내용 |
|---|---|
| 기간 | 2026-11-03 |
| 화면 | 네노바웹 입고관리 `/incoming` |
| 원장 부작용 | 선택 WarehouseKey FARM/REPLACE 계약만 허용. 운영 수정 실험0 |
| PR/배포 | 작업 중; 완료 여부 아래 후속 기록 참조 |
| 정본 | `docs/plans/incoming-replacement-2026-11-03.md`, `docs/work-reports/2026-11-03-incoming-correction-qa.md` |

## 고정 결정
- 재업로드는 신규등록이므로 별도 기존원장 수정 흐름을 만든다.
- 농장만 수정할 때 수량·재고 보존. 품목 교체는 기존/신규 품목 차액과 native 현재·후속연도 재고 검산.
- 스키마 변경 없이 SystemActionLog 원자 감사와 동일 작업 UUID 재시도.
- 원가/인보이스/정산/확정/농장분배 연결은 명시 차단. 강제 확정해제나 재고조정 없음.
- 기존 입고번호·연도·차수·인보이스·AWB·입력일자 및 운송 메타데이터 유지.

### 1. 조사 요청
**Q.** 농장·품목을 잘못 입고 업로드했을 때 수정 로직과 재업로드 수정 가능 여부를 dnSpy·MD로 확인.
**A.** 최신 master, 실제 EXE 3타입, DB 저장 SP/View SELECT 확인. 현재 업로드는 신규추가. EXE 품목 A→B 수정은 A 재계산 누락, 웹 삭제→재업로드는 Product.Stock 차감 부재와 별도 요청 문제.
**결과.** `docs/work-reports/2026-11-03-incoming-reupload-review.md`.

### 2. 웹 적용 요청
**Q.** 그 구조를 설계하고 네노바웹 메뉴에 적용.
**A.** 입고관리 선택 원장에 수정창/API/공통 preflight·저장 정책/원자 writer/감사/초안/키보드 구현. 로컬 unit·격리 실제 SQL·모의 브라우저 검증 수행. 운영 쓰기0.
**결과.** 설계·계약 warehouse-correction.json, QA 정본. 전체 ERP/최종 빌드 PASS. PR/배포 후속 진행.

## 이어받기
현재 branch `codex/review-incoming-reupload`, worktree `C:/Users/USER/.codex/worktrees/5569/nw-incoming-reupload-review`. `.verify/` 로그/스크린샷은 로컬 검증 산출물로 커밋 제외. npm prebuild로 생긴 무관한 data/generated 이력 변경은 포함하지 않는다. `.env`/JWT/연결 비밀번호를 저장하지 않는다.
