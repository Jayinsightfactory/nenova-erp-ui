# 중국 발주 다운로드 HF 별도 셀

요청: 품목명과 HF 코드가 합쳐진 다운로드 값을 옆 셀로 분리.

출력: A 품목명 / B HF CODE / C 단위 / D 총수량(박스수) / E 이후 업체 CL.
기존 banner A1:D1, 단일 시트, 업체 접두어 정렬, 단위별 합계, 매칭 정책, 조회 범위 유지.
HF는 문자열로 저장(선행0/수식형 문자열 보존), 미매칭 및 합계행 HF는 빈칸.
화면 표는 기존대로이며 이번 요청의 다운로드 파일만 변경.

| 동작 | Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport | 브라우저 파일 |
|---|---|---|
| 엑셀 다운로드 | 모두 보존, SQL/API 변경 없음 | HF 별도 열 |

기존 ChinaOrderDownload dnSpy/읽기 근거 재사용. 새로운 SQL/저장 경로 없음.
공유 buildChinaOrderCustomerMatrix 집계와 matchChinaHfCode 매칭은 그대로 사용.
XLSX 실제 저장/재개봉 회귀: 열 위치/폭, 선행0, 수식형 문자열, 미등록 빈칸, 합계, 소수, 박스환산 누락, CL 그룹 경계, 260업체, 교차연도/세부차수 격리 통과.
전체 ERP guard/빌드 및 운영 배포 스모크는 진행 중. 운영 DB 보정 없음.

검색어: 중국발주 HF CODE 별도열 별도셀 품목명 엑셀다운로드
