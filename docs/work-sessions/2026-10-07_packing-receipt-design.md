# 2026-10-07 인보이스 입고 통합 화면 설계

## 요청 → 처리

Q. 패킹리스트 탭에서 인보이스 자동 품목·수량 매칭, 차수별 주문 대비 부족/초과 확인,
저장 후 수정, CW/GW·인식 오류 수동 수정, nenova.exe/dnSpy/MD 호환 전체 UI가 필요하다.

A. 실제 dnSpy CLI로 ExcelLoadingPackingList와 FormWarehouseAdd를 확인하고 관련 MD·API를 읽었다.
운영 인증 GET으로 입고 헤더·상세를 조회했다. 디자인·기준 ledger·부작용·출시 조건은
`../plans/packing-receipt-workflow-2026-10-07.md`에 작성했다.
조작 가능한 로컬 시안은 `../ui/packing-receipt-prototype.html`이다. 예시 데이터/모의 저장으로
표시하며 실제 인보이스 업로드·운영 저장 구현이나 배포 완료로 취급하지 않는다.

## 확인한 사실

- EXE 입고 업로드는 staging → master → usp_CreateWarehouse → usp_StockCalculation.
- 실제 CommonLogic CLI의 CheckFixSave는 현재 확정·이전 미확정·다음 확정을 검사한다.
  현재 웹의 현재차수 Master.isFix 검사와 동일하다고 주장하지 않는다.
- EXE 수동 수정의 재고값은 old stock + new quantity 식이다. 현행 SP/트리거 대조 없이 복제 금지.
- 현재 패킹리스트 탭은 파일 변환 도구이며 실제 입고 저장까지 연결되어 있지 않다.
- 기본 입고 GET은 UploadDtm, exeParity=0은 InputDate 조회. 같은 날짜 입력의82/62개 차이는 필터 축 차이다.
- 7593(2026/41-02) ProdKey866 Out10박스/Est300,889 Out58박스/Est1740 확인.
- 확인한 헤더8개 CW/GW=NULL. 미인식을0으로 변환하지 않는다.
- 공용 TempWarehouseDetail 전체 삭제와 웹 전용 앱잠금은 EXE 동시 업로드 안전성을 보장하는 증거가 아니다.

## 실제 변경 경계

운영 DB 쓰기·DDL·SP/EXE 변경·운영 배포 없음. 새 런타임 기능 코드 변경 없음.
앞선 페이지 스크롤 배포 로그의 미커밋 변경을 보존했다.
브랜치: codex/packing-receipt-workflow, 기준 origin/master 5d005f75.

## 안전상 미완료

작업공간·canonical worktree에 SQL 연결 설정 없음. 직접 probe는 config.server 누락으로 실패.
현행 SP/트리거 정의, native 동시 실행, 재고 증가/감소/롤백을 격리 DB에서 검증하기 전 ERP 저장 연결 금지.
`../diagnostics/packing-receipt-readonly.sql`은 SELECT만 포함하며 권한 있는 SQL 연결에서 실행할 자료다.
새 문서/작업 SQL 이력 구조는 설계 제안일 뿐 승인·생성되지 않았다.

## 하위 작업

- 메인: guard-nenova-erp-changes, interpret-work-intent 적용. 실제 CLI·인증·운영 읽기·문서·통합검증 담당.
- Newton: gpt-5.6-sol/high, ARCHITECT, 준비된 로컬 자료 읽기 전용 설계 검토.
- Huygens: gpt-6-luna/high, IMPLEMENTER, UI 설계 시안 한 파일만 수정.
  지정 gpt-5.6-terra/gpt-5.6-luna가 도구에서 제공되지 않아 사용 가능한 모델로 대체.
- 하위 작업은 외부/운영 쓰기·승인·비밀 조회·병합·배포 금지.

## 검증 상태

로컬 Chrome headless, 확대100%, 1920×1080 / 900×1080 / 480×1080:
가로 페이지 overflow0, 중첩 세로 스크롤0, JS 오류0.
예시 재로드·미매칭 차단·수량 대조 재계산·모의 초안 저장/복원·매칭·Escape 초점복귀·
모의 저장 후 수정의 중복 가산 방지·음수/빈칸 차단·빈칸 비교불가·확인필요 필터 통과.
테스트는 output/packing-receipt-ui-smoke.cjs, output/packing-receipt-interaction-smoke.cjs.
첫 조작 테스트에서 발견한 예시 초기화/반복요소 오류와 단위 변경·중복 매칭 집계 오류를 수정 후 재검증했다.
ERP 전체 테스트/빌드/실제 입고저장 검증은
런타임 변경이 없으므로 이번 시안으로 대체하거나 통과했다고 주장하지 않는다.

## 이어서 할 작업

운영 읽기 전용 SQL 연결 또는 진단 SQL 결과 확보 → 현행 SP/트리거 확인 → 저장 계약 확정
→ 웹 전용 영구 이력 DDL 필요 시 사용자 승인 → UI/서버 구현 → 격리SQL·전체ERP회귀
→ PR/병합/배포 → 운영 읽기 smoke. 운영 원장 테스트는 별도 정확한 대상 승인 후만 수행.
