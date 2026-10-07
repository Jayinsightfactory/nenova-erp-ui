# 중국 발주 다운로드 예시 양식

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-07 |
| 화면 | /stats/china-order-download |
| 원장 부작용 | 다운로드 표현만 변경, 모든 ERP 원장 보존 |
| PR/배포 | 검증 후 기록 |

## 고정 결정
- 파일명은 `42-1 중국 발주 SEA.xlsx` 형태, 선택 실제 세부차수와 suffix 유지.
- 예시의 첫 줄 `42-1 중국 / ETA / 날짜 / SEA/Air` 추가, 업체 열은 클라이언트 번호만 표시.
- 사용자 정정: ETA 날짜는 다운로드 시점의 한국 날짜이며 실제 입고예정일 계산이 아니다.
- 숨김 수량원본 및 기존 4개 감사 시트의 구조/수량/수식 보존.

## Q → A
**Q.** 첨부 중국 발주 파일처럼 파일명과 차수·국가·ETA를 자동 처리해 달라.

**A.** 첫 시트 상단 표시 행과 파일명을 공용 helper로 생성한다. 다운로드 시각을 한 번 캡처하여 한국 날짜로 저장하며 Excel 날짜 타입을 사용한다. 기존 헤더는 2행으로 이동하고 고정 행 및 필터 위치도 함께 이동한다.

## 근거와 검증
- 첨부 OOXML 읽기: A1=42-1 중국, B1=ETA, C1=46309(2026-10-14), D1=SEA/Air. 2행 업체 코드는 B66/B77/K01 등, 업체 이름 없음.
- 실제 dnSpy CLI FormQuantityPivot의 ViewOrder.OutQuantity 및 Excel 내보내기 메서드 재확인. API SQL과 조회범위는 수정하지 않는다.
- 자료 분석용 bundled dependency loader가 이 호스트에서 unavailable이라 첨부 XML을 읽기 전용으로 분석했다. 별도 작성용 workbook 대신 기존 앱 ExcelJS exporter를 수정한다.
- 설계 검토 gpt-5.6-sol/high, 테스트 구현 gpt-6-sol/medium (지정 terra 사용 불가 대체). 외부 반영은 메인만 수행.
- 중국 workbook/UI 테스트 통과: XLSX 재열기 후 배너 A1:D1, C1 날짜 타입/서식, 서울 자정 경계, suffix/교차연도 파일명, 헤더·freeze·filter, 수량원본/수식 보존 확인.
- Next production build 통과. dnSpy 근거 및 81개 계약 manifest, 변경 API 0건 쓰기 가드 통과.
- 운영 읽기 화면에서 실제 37-01~42-02 세부차수 선택 및 중국 양수 주문 수량표 확인. 테스트 원장 쓰기 없음.
- 전체 `npm run test:erp-contract` exit0, importPedidos 23 pass/2 첨부샘플 skip. 최종 독립 검토 차단 이슈 없음.
- 배포 결과는 후속 기록.
