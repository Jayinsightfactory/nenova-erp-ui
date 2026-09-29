# 피벗 도착원가 환율 미리보기

## 요청과 완료 기준
- 피벗 상단 환율 버튼, 통화별 입력/명시 적용/원본 복원. 조회 범위만 적용하며 즐겨찾기나 DB에 저장하지 않는다.
- 외화 비용만 재계산, 원화 비용 보존. 원본 RawJson CNF 외화/원화 및 도착원가 합계가 대조되는 SOURCE 행만 지원. 근거 부족은 계산 불가 표시, 원본값으로 숨기지 않는다.
- 같은 연도/품목/최신 이전 세부차수, 단위 환산과 복수농장 MAX는 기존 helper 유지. 원 단위 반올림, XLSX 같은 모델과 환율 설명 시트.

## 기준/부작용
|동작|읽기|원장 쓰기|
|---|---|---|
|조회|기존 EXE SQL, WebArrivalCostLine 현재본 + Product|없음|
|환율 적용/복원/엑셀|브라우저 원본 행과 검증된 환율 계수|없음|
Order/Shipment/ShipmentDate/Farm/Stock/Estimate/WebProfitReport/원가 원본 모두 보존.
통화는 기존 countryClassification의 명시 국가 매핑, 미확인 국가는 추정 금지. 새 환율은 유한 양수, 빈칸은 원본 유지. 0/음수/Infinity 거부. 적용은 메모리 전용이며 페이지 재진입 초기화.

## 작업 전 근거
- dnSpy.Console.exe --no-color -t FormQuantityPivot 실제 실행: GetData/ViewWarehouse, ExportToXlsx 재확인. native SQL 변경 없음.
- readonly 2026 current ledger probe: 네덜란드2468/에콰도르31/중국860/콜롬비아4538/태국470행. 기존 경제 컬럼에 0/반올림 값이 있어 RawJson CNF와 원가 대조 필요. CNF송이, CNF원화, 도착원가송이, 단당수량으로 재계산 계수 근거 확보. 중국은 CNF단(원화) 및 FOB+운송비단 대조.
- 기존 recalcArrivalCostWithFx는 비용 누락을 0으로 역산하므로 피벗에 재사용하지 않는다. 다른 페이지는 변경하지 않는다.
- docs/CODEX_SUBTASK_ORCHESTRATION.md는 두 기존 checkout 모두 없음. 지침 내용을 추정하지 않고 메인 작업으로 수행.

## 검증/배포
- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest/guard:erp-writes --changed-from origin/master, build 통과. 추가 원본 국가통화/반올림 fixture도 재실행 통과.
- 로컬 실제 build 1920×1080: USD0 거부,1400 적용 시15000→14500, 미확인1개 빈칸/이유, 원본 복원15000 확인. 1280×800 입력5칸 모두 viewport 안, console error 없음.
- XLSX write/read roundtrip에서 조정14500과 USD1400 설명 시트 확인. 브라우저 download event 대기는 도구 timeout으로 별도 미확인; 원가 계산/생성 단위검증과 화면 클릭 후 오류 없음 확인.
- 운영 DB readonly 같은 query 재실행4000행(업무 진행 중 증가),3300원가 연결. BeSweet37-1 원가 구성 재현. 원본/ERP 쓰기 없음.
- 배포 진행 중.
