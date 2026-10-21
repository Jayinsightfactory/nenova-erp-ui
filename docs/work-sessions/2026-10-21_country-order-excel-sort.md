# 국가별 발주서 품목순 정렬

Q. 수입부 국가별 발주서 엑셀 다운로드를 dnSpy 기준 품목 A-Z 순서로 맞춰 달라.

## 구현 전 기준
- 실제 dnSpy CLI 실행: dnSpy.Console.exe --no-color -t FormQuantityPivot Nenova.exe. ProdName 피벗 필드 및 ExportToXlsx(ExportType.WYSIWYG) 확인. 명시적인 SortOrder 재정의는 출력에 없음. 사용자 요청을 기준으로 각 파일의 품목명 대소문자 무시 A-Z를 적용한다. 완전한 .NET 로케일 동등성 주장은 하지 않는다.
- 운영 SELECT: ViewOrder WHERE OrderYear IN ('2025','2026') AND OrderWeek='42-02' AND CounName=N'네덜란드'; 2026 134행/74품목/16049송이, 2025 해당 범위 0행. 개인정보 출력 없음.
- 조회 SQL/연도·차수 범위/수량 원천은 기존 계약 보존. 정렬은 순수 브라우저 workbook 생성 단계에서 적용.
- 부작용: 다운로드는 메모리 배열 순서만 변경; OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Warehouse, Stock, Estimate, WebProfitReport 모두 보존. Amount/Vat/isFix 및 견적/매출 View 영향 없음. 저장/API/SP 추가 없음.
- 기준선: 출력 미리보기=엑셀 순서 적용. 화면틀/키보드/스크롤 변경 없음. ERP 쓰기 전 확인 해당 없음(읽기 전용).
- 에콰도르는 A-Z 정렬 뒤 기존 100송이 합포장 묶음 유지(사용자 질의 중).

## 검증·배포
진행 중, 미검증.

Q. 에콰도르는 합포장 유지, 기존 nenova.exe 정렬 그대로 적용.
A. 실제 DevExpress.PivotGrid.v25.1.Core.dll의 PivotGridFieldBase.SortOrder 기본값 Ascending 확인. 품목명 오름차순 후 기존 합포장 인접 묶음 유지. 합포장 예외를 사용자에게 설명. 박스 산식 보존.

- 실제 운영 조회→변경된 생성기→XLSX 직렬화→재개봉: 네덜란드 2026/42-02 74품목·16,049송이, 에콰도르 2026/42-01 8품목·1,150송이 보존. 원본 행렬 불변·미리보기와 파일 첫 품목 일치. 원본 개인정보/엑셀 파일은 저장하지 않음.
- dnSpy 추가 증거: PivotGridFieldBase.SortOrder의 DefaultValue(PivotSortOrder.Ascending). 전산 개인별 저장 정렬은 확인되지 않았으며 기본 정렬 기준임.
- 세션 Q&A 백업은 저장소 `.cursor/skills/session-qa-backup/SKILL.md` 적용.

- 전체 ERP 검사와 프로덕션 빌드 통과. PR #1209 최초 CI 통과, 공용 기록 충돌 정리 후 최신 master 통합 CI 진행. 브라우저 로그인 연결 복구, 운영 Ecuador 조회8품목 확인(배포 전).
