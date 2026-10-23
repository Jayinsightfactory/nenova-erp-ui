# 네덜란드 원본 표 업체 추가

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-23 |
| 화면 | 네덜란드 물량표 |
| 원장 부작용 | 초안·표시 변경만. 기존 검토/명시 적용 writer 보존 |
| 배포 | 검사 후 PR/운영 결과 후속 기록 |
| 이어받기 | docs/work-plans/2026-10-23-dutch-inline-add.md |

## 고정 결정
- 행 추가는 편집 탭 이동 대신 업체 매칭 popup. 현재 원본 시트의 해당 지역에 수량 열을 표시.
- 작업 저장과 실제 ERP 분배는 다름. 저장본 복원 후 재검증/명시 적용 필요.
- 원본 workbook은 그대로 두고 표시 projection만 확장. 추가행은 기존 immutable 저장 및 preview payload로 전달.
- 표는 전폭 사용, 반복 품목명 열은 넓히고 두 줄 제한. 좌측 전체 품목명 보존.

### 1. 요구와 구현
Q. 원본 표에서 업체 선택 후 지역별 셀 추가, 수량 입력·저장·분배. 빈 오른쪽 공간 활용, 반복 품목명으로 행 높이 증가 방지.
A. 기존 token/origin/source 검증 popup 재사용. CustArea별 열 삽입, 동일 고객 중복 방지, popup 동안 변경된 원본/revision 선택 폐기. 2025/2026 저장복원·합계·preview 수량 회귀 추가.

## 검증
- 실제 dnSpy 및 운영 SELECT 근거는 계획 문서. 운영 시험 저장 없음.
- scripts/dutch-inline-read-probe.cjs는 로컬 일회성 읽기 도구로 커밋 제외.
- 추가 기능은 화면·초안 전용. Excel 원본은 보존하고 추가항목은 기존 ERP적용초안 시트에 포함되는 계약 유지.
- 전체 검사·배포·운영 화면 확인은 결과 후속 기록.
- 전체 erp-contract, dnSpy evidence, manifest156개, write guard(API 변경0), ui-layout 및 Next webpack build 통과. 테스트용 PeriodDay의 WeekStartYmd/WeekEndYmd 누락을 격리 seed에만 보완하고 실제 MSSQL 분배 fixture 통과(기존주문 보존/신규주문/분배SET/단가/교차연도/고정·stale·중복/후반실패 전체rollback/downstream 보존). 운영 DB 변경 없음.
