# 네덜란드 물량표 작업 저장·불러오기

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-05 |
| 화면 | 네덜란드 물량표 |
| 요청 | 원본·단가·매칭 작업 뒤 업로드/적용, 작업 저장 이력과 다시 불러오기 |
| 브랜치 | codex/dutch-work-history |
| ERP 경계 | 초안 저장/불러오기는 원장 보존, 실제 적용은 기존 검증·승인·트랜잭션 재사용 |
| 상태 | 구현 및 ERP 가드/빌드 통과, 배포 준비 |

## 고정 결정

- 엑셀 다운로드, 서버 작업 저장, 실제 ERP 적용을 구분한다.
- 원본 workbook과 수정한 entries/prices 및 연도·차수를 함께 보관한다.
- 작업 저장은 새 기록으로 남긴다. 과거 저장본의 planToken/승인/검증 상태를 복원하지 않는다.
- 불러오기는 현재 작업 교체 확인 후 최신 ERP 읽기 검증을 다시 거친다.
- 운영 시험 주문·분배 저장, 자동 확정 해제, 재고 보정은 하지 않는다.

## 질문과 답변

**Q.** 원본물량표와 단가·매칭 작업을 마친 뒤 업로드 가능해야 하며, 작업 저장 로그에서 다시 불러올 수 있어야 한다.

**A.** 현재는 브라우저 임시 초안만 있고 서버 저장본 목록은 없다. 상단 작업 저장/이력 및 작업 완료·업로드 검토 흐름을 추가한다. 실제 결과는 아래 검증 뒤 기록한다.

## 사전 근거

- 실제 설치 EXE를 dnSpy CLI `-t FormShipmentDistribution`로 다시 확인: btnSave_Click의 ShipmentDetail → ShipmentDate 및 명시 농장 저장 순서 유지. 공용 쓰기 코어 변경 대상 아님.
- 2026/40-01/533/2231 SELECT: 주문/출고 View 각1, 분배100, 날짜합100, 농장0, 상세확정1, Amount190909/Vat19091, 견적 exact join1. 동일40-01 ViewOrder 2025년14/2026년35. 현재 확정 네덜란드30행 Amount10175999/Vat1017601. 이 수치는 읽기 시점 표본이지 저장 검증 결과가 아님.
- 기존 Cafe24 배포는 git reset을 사용하지만 runtime data를 clean하지 않는다. 개인 작업 저장은 public 밖 runtime 디렉터리에 분리한다.
- 실제 첨부4002 workbook JSON248386bytes, 압축 xlsx base6442892bytes. nginx 기본1MiB이므로 새 저장 경로의 입력 제한/오류 안내를 일치시킨다.
- `.tmp/` 자료/비밀값/업무 데이터는 커밋하지 않는다.

## 검증 및 배포

- 서버 저장/API, 실제4002 파일 2시트·81행 validator, 원본 서식·수식 보존 및 계정 격리 검증 통과.
- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest(origin/master), guard:erp-writes(origin/master) 통과. 새 API 1개 검사 포함.
- test:dutch-volume-distribution-sql 격리 fixture 통과: 교차연도, 누락0, 주문 보존, 원화가격0/빈칸, 확정/충돌/날짜 무결성 및 트랜잭션 롤백.
- npm run build 통과. 운영 ERP 시험 쓰기는 하지 않았다.
- test:dutch-volume-distribution 및 test:pivot 통과. 실행형 UI fixture: 저장 실패 ERP POST 0회, 성공1회, 중복 busy 차단, 2025년 저장본 복원/과거 검증 폐기.
- 작업본 저장은 사용자별 서버 runtime 파일이며 별도 외부 백업/공유/삭제 기능은 이번 범위가 아니다.

## 하위 작업 운영

- ARCHITECT: gpt-5.6-sol/xhigh 설계·계약, 마지막 검토는 capacity 실패로 메인이 수행.
- IMPLEMENTER: gpt-6-sol/high 시작 전 capacity 실패. gpt-6.1-sol/medium으로 범위 확정 저장소/API·테스트 구현 대체.
- TEST/DOC: gpt-5.6-luna/medium 회귀 fixture 및 테스트. 모든 외부 쓰기·병합·배포는 메인만 수행.
