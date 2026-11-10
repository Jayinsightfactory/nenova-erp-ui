# PR1641 AWB 원본 동일성 기준

- 범위: 업무드라이브 콜롬비아 원가 엑셀 자동반영 게이트만. 인보이스 변환·원가식·입고 writer 변경 없음.
- 기준키: 명시 연도 + 세부차수 + 정규화한 11자리 AWB 번호. 수정시각은 사업연도 근거가 아님.
- 원가 엑셀의 실제 셀에서 AWB 번호를 읽고, 서버가 실제 PDF 바이트의 SHA256·PDF 형식·Air Waybill 본문·같은 AWB 번호를 검증한다. 파일명만 AWB인 파일, 계산 결과 XLSX, 삭제·egress·download·시험 산출물은 제외.
- 연도·차수는 파일명에 명시되어야 하며 cycle과 충돌하면 보류한다. 본문 연도와도 일치해야 한다. 스캔/암호화/정보 누락/다중 AWB는 자동 확정하지 않는다.
- 서버가 만든 별도 evidence Map만 사용한다. index/request의 임의 evidence 속성은 무시한다. 표시·실행·저장 직전은 같은 resolver를 사용하고 AWB hash도 재검증한다.
- 검증은 getFileForVerification의 동일 접근/삭제/path 검사를 사용하되 다운로드 이력을 쓰지 않는다. fs watcher를 스스로 다시 깨우는 반복 실행을 금지한다. 실제 다운로드 getFile의 감사이력은 보존한다.
- 누락·불일치 사유는 기존 reason 표시를 사용한다. UI·작업순서 변경 없음(메뉴/영상 기준 해당 없음).

| 작업 | Product/Farm | Warehouse/Stock | Order/Shipment/Estimate | WebProfitReport | WebArrivalCost |
|---|---|---|---|---|---|
| 상태/원본 검증 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 반영 실행 | 기존 SELECT만 | 보존 | 보존 | 보존 | 기존 importer만, 검증 전 호출 금지 |
| 이번 테스트/배포 | 보존 | 보존 | 보존 | 보존 | 운영 호출 금지 |

반례: 전년도 동일 차수, 미확인 차수/연도/국가, 다른 국가·번호, mixed country, filename/cycle 충돌, PDF 가장 XLSX, generated/shared-awb, hash 불일치, 본문 없는 PDF, 주입 evidence, 삭제/교체 후 저장, 명시0/빈값. 정상 CO 1건과 다른 국가 기존 동작을 함께 실행 검증한다.
