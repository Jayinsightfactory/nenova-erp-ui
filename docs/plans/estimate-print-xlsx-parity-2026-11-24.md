# 업체 견적서 인쇄·Excel 일치

연결 목표 g03(실제 출력 검증), g19(사용자 판단 기준 반영). 사용자는 견적서관리에서
업체 선택 → 출력 → Excel 다운로드의 실제 인쇄 결과가 다르다고 신고했다.
변경요청서 출력과는 별개이며, 원장 수량·단가·금액·부가세 산식을 변경하지 않는다.

## 확인 근거

- 최신 master 격리 worktree에서 실제 Chrome PDF와 Microsoft Excel의 읽기 전용
  ExportAsFixedFormat 결과를 비교했다. 모든 문서는 연습 업체·품목·공급사 정보다.
- 변경 전 12행/1업체: HTML 1쪽, XLSX 2쪽. 55행/2업체: HTML 4쪽, XLSX 8쪽.
- Excel은 공급사 표·로고·인사말이 없고, 박스 수량 옵션을 무시했으며, 합계 열 위치와
  용지 폭·머리글 반복·인쇄 영역이 달랐다.
- 실제 dnSpy FormPrintEstimate는 GetPrintDetail → ReportEstimate 미리보기 경로다.
- SELECT probe: ShipmentMaster.OrderYearWeek=202547 108행, 202647 116행.
  OrderWeek 단독 조회를 추가하지 않는다. 고객명·연락처·개별 값은 기록하지 않는다.

## 구현과 보존

1. Excel 다운로드도 인쇄와 같은 buildEstimateHtml과 동일한 옵션·조회 결과를 사용한다.
2. 격리된 화면 밖 iframe에서 실제 글꼴 로딩 후 leaf 셀의 위치·높이·문구·병합·서식을
   측정한다. 공급사 로고는 동일한 data URL을 사용한다. iframe은 성공/실패 모두 제거한다.
3. 기존 설치된 ExcelJS로 실제 값이 있는 셀을 작성한다. 숫자는 숫자로, 박스 수량은
   인쇄 문자열로 보존한다. A4 세로·좌우15mm/상하10mm·폭1쪽/높이자동·품목 머리글 반복.
4. 여러 업체·분리 출력은 기존 정렬과 독립 시트를 보존한다. 조회 실패 시 부분 출력 금지.

| 대상 | 영향 |
|---|---|
| OrderMaster/OrderDetail | 읽기·쓰기 추가 없음, 보존 |
| ShipmentMaster/Detail/Date, Amount/Vat/isFix | 기존 GET 결과만 사용, 보존 |
| Estimate/StockMaster/ProductStock/WebProfitReport | 쓰기·재계산 없음, 보존 |
| ECOUNT | 접속·쓰기 없음 |
| nativeLayout/요일별 견적 | 기존 HTML 경로·EXE 산식 보존 |

## 기준선

적용: 기존 견적서 메뉴·사용 가이드·고밀도 표·키보드/작은 화면·데스크톱 기존 접근
검증·계약·교차연도 회귀·필수 ERP 검사·webpack 빌드·CI 후 squash·운영 스모크.
해당 없음: 신규 메뉴/탭·DB 스키마·ERP 쓰기·Rust 핫패스·직원 PC 원격 명령.
되돌림은 해당 PR revert이며 원장 복구 작업은 필요 없다.

## 검증

진행 중. 완료 시 실제 PDF/XLSX 페이지 수, 옵션별 값·로고·장문/다페이지·다업체,
1920/1280/390·키보드·가이드 재생·배포 버전을 WORK_MEMORY에 기록한다.

## 사용자 배포 우선 지시 (2026-11-24)

사용자 원문: “우선 배포부터.” 이번 출력 변경의 영상 재촬영·보강·Drive 백업은 배포 선행조건에서 제외하고 배포 후 처리한다. config/workflow-guides.json에 변경 파일의 정확한 현재 SHA와 승인 근거만 등록한다. 전체 가이드 검사와 다른 기능의 기준은 유지한다. 기존 배포 가이드 자산은 보존한다. ERP 필수검사·webpack·CI 성공·운영 출력 스모크는 생략하지 않는다.

## 배포 전 검증 결과

ERP 전체 검사(전·후행 포함), dnSpy 근거, 계약 manifest245개, 원장쓰기 가드, webpack 빌드 통과. 대상 단위/타이포13개 통과. 실제 PDF/XLSX 7종의 페이지 수·업체·품목·금액 대조와 1920/1280/390 키보드 검증을 수행했다. 기존 데스크톱 /estimate 메뉴·popup·검색/즐겨찾기 경로를 사용하므로 설치 프로그램/메뉴 카탈로그 변경은 해당 없음이며 공유 웹 코드가 반영된다. 신규 원장 쓰기와 ECOUNT 접근 없음.
