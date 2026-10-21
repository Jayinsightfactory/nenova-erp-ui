# 업로드 이력과 매칭 후 중단 진단

## 확인 근거
- product-matches API는 활성 로그인 계정 공통 packing.erp-matches를 읽고 scope=team 반환. 개인별 namespace 없음.
- 기존 작업복구는 IndexedDB latest-by-user. 다른 PC/계정은 원본과 분석 결과를 불러올 수 없음.
- 변경 이력 탭은 importTeamStore의 공동 자료 수정만 표시하며 업로드 원본 없음.
- 2026-10-20 KST16:41 다음·입고준비 → Carnation Mochi 박스/단수 원문 확인 →16:42 취소 클릭. 클릭 로그만으로 값 오류의 구체적 숫자를 확정하지 않음.
- 42-1 CHINA CI.pdf와41-2 NL H CI.pdf는 WebInvoiceDocument COMMITTED/APPROVED 기록 존재. 모든 직원 작업이 실패했다고 해석하지 않음.
- SystemActionLog 최근3일: CLOUD PDF 및 해상 XLSX UPLOAD_FAILED 각1,42-1 PDF MATCH_REQUIRED37. 원인 상세는 과거 로그에 없음.
- 10/21 당일 화면 최신200건(이전 페이지 더 있음): 09:49:21/09:49:26/09:51:28 KST 다음·입고준비 클릭, HYDRANGEA 원문 날짜·통화·총액 안내 및 metadata 검토창 클릭. 당일 `/api/import/receipts/drafts` 요청0건(nextCursor 없음). 따라서 관측된 작업은 초안 저장 요청 이전에 멈췄다. 클릭 안내문만으로 특정 필드가 틀렸다고 확정하지 않는다. 13:25/13:26 Excel 원본 업로드 클릭도 존재.

## 기준 및 부작용
|동작|웹 파일|주문/분배/입고/재고/견적/손익|
|---|---|---|
|원본·분석 보관|인증 사용자·시각·해시와 불변 revision 추가|보존|
|이력 조회·불러오기|읽기, 브라우저 초안 복원|보존|
|실제 입고|기존 서버검증 및 명시 승인 사용|기존 계약만 적용|

원본50MiB, 분석JSON2MiB 제한. 바이너리는 해시별 재사용, snapshot은 개별 UUID 불변.
동일 파일이라도 업로드 작업ID가 다르면 별도 이력. 복구본은 새 작업으로 보관하며 과거 기록 덮어쓰기 금지.
현재 원본과 sourceHash 검증, 최신 매칭 조회, generated/preflight/commit 데이터 제거.
서버 이력 저장실패와 ERP 실패는 구분; 실패 시 로컬 작업 보존. 이력 삭제/SQL 마이그레이션 없음.
기존 업로드는 과거 원본이 없으면 새로 보관했다고 추정하지 않음.

## 검증 범위와 남은 한계
- 로컬 dnSpy CLI 재실행은 CLR 0x80131506으로 실패. 새 native 검증 성공으로 주장하지 않는다. 기존 FormWarehouseUpload 근거와 웹 파일 전용 변경 경계를 보존하며 ERP writer/SP/계산식은 변경하지 않았다.
- 2026-10-19 원문 확인 체크 제거 정책 유지: 품목 매칭만 완료하면 모든 필드가 유효한 경우 다음 단계 진행 가능. 10월20일 클릭 로그는 원문 창에서 취소한 사실만 증명하며 어떤 값이 잘못됐는지는 증명하지 않는다.
- 신규 불변 이력·해시·다른 연도·다른 직원·권한 정보 제거 5개 검사 및 기존 개인 복구 6개 검사 통과.
- 전체 ERP 계약, packing-team 97통과/1선택검사skip, UI layout, manifest, write scope, dnSpy evidence guard, production build 통과.
- 격리 실제 Chrome: 직원A 파일보관 → 직원B 공용이력 조회 → Space/Enter로 복구, 페이지 오류0/ERP write0. 원본만 보관된 상태 검증이며 실제 인보이스 입고·원가 E2E를 이번 작업에서 재실행한 것은 아님.
- 운영 ERP는 SELECT만 실행. 과거 실패 로그의 누락된 상세 원인은 복구할 수 없어 확정하지 않는다.
- 최종 커밋/PR/배포/운영 브라우저 확인은 별도 결과로 기록한다.
