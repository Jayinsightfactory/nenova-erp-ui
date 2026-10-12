# 주광 다운로드 이름·합계·잔량 표시

## 사용자 기준과 근거
- 사용자 요청: 그룹 품종과 품목명에 반복되는 품종명을 제거하고 합계·잔량을 색으로 구분한다.
- 실제 저장 양식은 기존 주광 발주내역 XLSX. 행 높이·열 너비·테두리·폰트·숫자서식·그룹 병합은 보존한다.
- `WeekdayEstimateWorkspace.downloadOriginalWorkbook`의 선택 차수 전체 matrix → snapshot → XLSX 경로를 유지한다.
- 기존 native 근거 `docs/exe-golden/WeekdayConfirmationLifecycle.md`를 보존한다. 이번 변경은 브라우저 다운로드 표현이며 SQL·ERP 조회 범위·수량·확정·인쇄 SQL 변경이 없다.

## 기준 장부
| 대상 | 기준 | 소비자 |
|---|---|---|
| 품목명 | 등록 DisplayName 우선, 없으면 기존 한글 제안. 현재 그룹과 같은 선두 품종 토큰만 제거. 빈 이름은 원문 유지. 고유 품종·국가·규격·다른 단어 보존 | snapshot / workbook |
| 행 | ProdKey 또는 단위가 다른 행은 합치거나 삭제하지 않음 | snapshot / workbook |
| 역할 | snapshot column.kind를 전달, 문자열 제목으로 역할 추정하지 않음 | workbook |
| 합계 | dayTotal/sum01/sum02/total, 연한 파랑 | 헤더·숫자·빈칸 |
| 잔량 | remaining01/remaining02/remaining, 연한 초록 | 헤더·숫자·빈칸 |
| 변경 | change, 연한 노랑 | 헤더·숫자·빈칸 |
| 소계 | 품종/단위별 기존 합산, 별도 진한 하늘색 행 | 소계 전체 |
| 서식 | 원본 XF를 복제하여 fillId/applyFill만 덮어쓰고 캐시. 원본 폰트·border·numFmt·alignment·theme 보존 | XLSX styles |
| 값 | 0은 서식 있는 빈칸, 음수는 숫자 유지. unknown/null·일반/윌슨·교차연도·선택차수·초안 값 보존 | 회귀 fixture |

## ERP 부작용 표
| 사용자 동작 | OrderMaster/Detail | ShipmentMaster/Detail/Date/Farm | Product/StockMaster/ProductStock/StockHistory | Estimate/WebProfitReport | 확정 |
|---|---|---|---|---|---|
| 엑셀 다운로드 | 보존 | 보존 | 보존 | 보존 | 보존 |

## 검증
실제 XLSX ZIP의 cell style → XF → fill 연결, 원본 XF 서식 보존, 16열 이후 동적 열, 0/음수/unknown, 여러 단위 소계, 그룹명 중복 제거와 고유 토큰/행 보존을 검사한다. 원본 주광 양식으로 생성한 결과를 렌더링하고, 필수 ERP 가드·빌드 통과 후 PR/master/Cafe24 배포와 실제 Chrome 다운로드를 확인한다.

## 실행 결과
- 실제 설치 EXE를 dnSpy CLI로 다시 확인: `FormEstimateView.GetExcelDetail`은 ViewShipment/ViewOrder의 연도 포함 차수키, CustKey, ProdKey와 ShipmentDate를 연결하고 DetailFix=1, 양수 EstQuantity로 읽는다. `btnExcel_Click`은 조회한 DataTable을 엑셀로 출력한다. 이 경로의 SQL/확정/수량은 이번 변경 대상이 아니다.
- `output/weekday-export-native-20261012.txt` 로컬 근거. 기존 동일 업무키 읽기 근거는 WeekdayConfirmationLifecycle 기록을 유지한다.
- 원본 사용자 XLSX를 실제 exporter에 넣어 생성하고 Artifact Tool로 렌더링: 브루트/몬디알 화이트 50CM/화이트, 일반 2+윌슨 1=3, 5−3=2, 음수 −10, 0 빈칸, 동적 합계/잔량/변경/소계 색을 확인했다.
- snapshot/workbook 회귀, ERP contract, dnSpy evidence, changed-from origin/master manifest/write guard, production build 통과.
- 원본 XLSX·fixture·렌더링·실행 로그는 로컬 output에만 보관하며 커밋하지 않는다.
