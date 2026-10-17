# 패킹리스트 전체 인보이스 확인 체크 제거

질문: 수입부 패킹리스트 업로드에서 ‘원본 근거와 입력값을 검토했습니다’ 체크가 되지 않는다. 이런 체크는 필요 없다.

답변: 전체 인보이스 확인 체크와 해당 체크에 연결된 적용 차단을 제거했다. ‘확인값 적용 · 결과 재생성’ 버튼의 명시적 동작으로 로컬 입력값을 적용한다. 품목별 원문 검토, metadata, 숫자·총액·수정 사유·파일 스냅샷 검증과 최종 입고 절차는 유지한다.

## 변경 기준

|항목|기준|
|---|---|
|인보이스 전체 체크|표시·필수 검증 제거|
|사용자 적용|각 invoiceIndex에 applyValues boolean true 제출|
|기존 호출 호환|confirmed boolean true 허용; 문자열·숫자 값은 허용 안 함|
|적용 기록|confirmationMethod=apply-values, appliedAt; 사람 검토 완료로 기록하지 않음|
|숫자·metadata·상품행|기존 검증 보존|
|원본·연도 격리|파일 hash/snapshot 및 invoiceIndex 검증 보존|

## 부작용

로컬 초안과 결과 파일 생성만 수정한다. OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Estimate, WarehouseMaster/Detail, StockHistory/ProductStock, WebProfitReport 및 운영 SQL writer/SP는 모두 보존한다. 이번 적용 버튼은 ERP 입고 저장이 아니다.

현재 설치 Nenova.exe의 ExcelLoadingPackingList를 dnSpy.Console.exe로 직접 다시 확인했다. UPrice/TPrice 별도 열, InsertMaster→uspCreateWarehouse 저장 경로는 변경하지 않는다. 웹 전용 파일 검토 UI 수정으로 같은 업무키의 DB 변경이 없어 이번 변경에 운영 DB probe와 데이터 보정은 해당 없음이다. 기존 증거 docs/exe-golden/FormWarehouseUpload.md와 계약 invoice-pdf-human-review.json을 따른다.

## 운영 규칙과 검증

고성능 설계 검토 gpt-5.6-sol/xhigh, 기계적 테스트 gpt-6-luna/medium(지정 gpt-5.6-luna 미제공에 따른 대체). 메인 전용 push/병합/배포. orchestration 문서는 현재 worktree에 없어 C:/Users/USER/.codex/worktrees/8cf8/nenova-erp-ui/docs/CODEX_SUBTASK_ORCHESTRATION.md를 읽었다.

메뉴 기본값: 기존 모달·페이지 shell 유지, 기본 HTML 버튼과 기존 Tab/Escape 동작 유지. 1920×1080/100% 모달 smoke로 핵심 동작 확인. ERP 저장 전 확인은 별도 기존 단계로 유지. 신규 메뉴·매칭 저장·실시간 진행률·원장 쓰기는 해당 없음.

검증: npm run test:erp-contract, test:nenova-dnspy-evidence, 변경 manifest와 ERP 쓰기 scope, npm run build 통과. 패킹 관련55개 회귀 통과. RUN_PACKING_PDF_SOURCE_BROWSER=1 브라우저 회귀는1920×1080/100%에서 체크 부재, 개별 상품행 확인·수정 후 무효화·재확인, 체크 없는 적용, 원문 스냅샷과 applyValues 제출을 검증해 통과했다. 브라우저 원본 미리보기는 격리 fixture이며 운영 ERP 쓰기를 수행하지 않았다.

최종 고성능 검토에서 기존 브라우저 회귀가 제거된 체크를 누르는 부분을 발견해 해당 테스트도 새 흐름으로 수정하고 활성 실행했다. 빌드에서 자동 생성된 개발이력 데이터는 이번 변경 커밋에 포함하지 않는다. 배포는 코드만 적용하며 DB migration과 데이터 보정은 실행하지 않는다.
