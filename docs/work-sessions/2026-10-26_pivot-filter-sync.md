# 2026-10-26 피벗 필터 동기화·초기화

## 요청·원인
국가·품종 선택 변경이 버튼에만 보이고 적용값은 고정되는 증상. 사용자 확인: 필드 체크박스와 상단 필터 모두 대상.
기존 피벗은 filters와 fieldFilters를 별도로 AND하여 같은 국가의 상충 조건이 남는다. 마지막 체크 해제도 []=전체로 변했다.
EXE 방식은 모든 후보가 다른 선택으로 제한되어 국가/품종/품목이 서로 잠글 수 있다. 기존 하단 지우기 외 상단 복구 동작이 필요하다.

## 기준·부작용
| 동작 | 기준/소비자 | 원장 |
|---|---|---|
| 기존 국가/품종 변경 | updatePivotDimensionFilter 양쪽 UI 동기화, 국가→꽃/품목 및 꽃→품목 해제 | 모두 보존 |
| 마지막 체크 해제 | __EMPTY__=0행, []=전체, 교차연도 동일 | 모두 보존 |
| EXE 관련 선택 초기화 | 명시 조작으로 국가/꽃/CountryFlower/품목만 해제, 고급조건/연도 보존 | 모두 보존 |
| 전체 초기화 | 값·고급조건 해제, EXE 필터 켜짐, 열린 팝업/접힘 해제. 조회기간/레이아웃/정렬 보존 | 모두 보존 |

SQL/API/SP/수량/견적/매출/Stock/Estimate/WebProfitReport 변경 없음.
실제 dnSpy.Console --no-color -t FormQuantityPivot 설치 EXE 확인: GetData ViewOrder/ViewWarehouse 및 ExportToXlsx.
SELECT-only scripts/probe-dutch-roundtrip-read.cjs: 2026/43-02/CustKey533/ProdKey1487 수량200, DetailFix=true, Amount381818/Vat38182, native date join1/farm0. 차수 확정124행, Amount13316274/Vat1331626. 개인정보 미출력. 원장 쓰기 없음.

## 메뉴 기준선
적용: 필터 동기화/명시 초기화, 표준 button 키보드 접근, 기존 화면 배치 보존.
해당 없음: 입력/업로드/ERP 반영확인/새 메뉴/새 스키마.
검증 및 배포 결과는 완료 시 갱신.

## 검증 결과
- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest/guard:erp-writes --changed-from origin/master, test:pivot, npm run build 통과. API 변경 0개.
- Chrome 실제 1920×1080: 국가+수국 선택→관련 초기화→에콰도르 장미 표 갱신→전체 초기화, 기존 화면 저장된 필드 필터와 헤더 국가 전환 동기화, Enter 초기화 통과. scripts/pivot-filter-ui-smoke.cjs, 개인정보 없는 mock 4행/외부통신·원장쓰기0.
- 기존 광역 pivot-exe-ui-smoke는 worker 완료 대기 가정 및 무관한 collapse 행수 검증에서 실패해 수정하지 않았다. 이번 변경 전용 실브라우저 테스트와 필수 gates로 검증했다.
- 초기 공유 node_modules에 최신 패키지가 없어 검사 실패: 새 작업트리에 npm ci 후 전체 재검증 통과.
- 운영 in-app browser는 로그인 세션이 없어 인증 후 데이터 조작은 아직 미검증. PR/배포 후 상태 추가 예정.
