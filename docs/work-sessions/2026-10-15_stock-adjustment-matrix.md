# 2026-10-15 조정 원장 세부차수 행렬과 Excel

## 질문 → 처리
- 조정 원장 전수를 Excel에서 품목 행 × 41-1/41-2 차수 열로 보고 싶다.
- 주차별 매출이익 보고서 > 원인분석 > 조정 원장 전수에 세부차수별 실제 재고조정 표와 Excel 다운로드를 추가했다.
- 연도 필수, 대차수/품목 검색 지원. 실제 StockHistory After-Before를 집계한다. 기존 대차수 잔량 계산과 분리한다.
- 3시트: 세부차수별 실제 조정, 실제 조정 원이력(현재 필터), 기존 대차수 흐름차이(선택 연도 전체 참고).
- 무이력 빈칸, 순0은 0, 누락값 확인 필요. 작은 비0은 지수표기로 보존한다. 품목번호+단위로 구분한다.

## 근거와 검증
- 실제 설치 EXE FormStockView dnSpy GetData 재추출, StockType/StockHistory 운영 SELECT 확인.
- 2026년 41차 운영 SELECT: 61품목, 99이력, 41-1/41-2/41-3, 누락수량0. Excel 3시트 생성 및 렌더 확인.
- UI Chrome 합성 smoke 1920×1080/800×700 CSS pixel, 100%: 줄바꿈, 가로스크롤 끝열, 키보드, 초점, 실패/로딩, 연도전환 확인.
- 실제 차수 행렬/Excel/API/UI 단위검사 통과. 전체 ERP 계약/manifest/writeguard/build 및 배포 결과는 완료 후 추가한다.
- 운영 ERP 수정·재고계산·견적/매출 쓰기 없음. 조회와 파일다운로드만.

## 기준선
적용: 기존 메뉴 내 추가, 페이지 세로스크롤, 가로 표 스크롤, 키보드, 로딩/실패, 선택 연도 격리.
해당 없음: 새 메뉴/shell, ERP 쓰기, 승인, 임시저장.
예외: contracts 공통 businessIdentity 필드의 CustKey는 공통 validator 요구사항으로 보존하되 실제 읽기 식별자는 별도 actualReadIdentity로 명시.
docs/CODEX_SUBTASK_ORCHESTRATION.md는 저장소에 없었으며 제공된 AGENTS의 역할분리/메인 외부쓰기 원칙을 적용했다.

검증 완료: 신규18검사, 전체 ERP 계약, dnSpy evidence(계약 suite 포함), 변경 manifest/writeguard, production build 모두 통과. 초기 manifest requiredCommands 누락은 보완 후 전체 재검증했다.
