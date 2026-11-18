# 송장·명세서·농장 마스터 연결

## 근거와 기준
- 원본 46-2 CI: 명세서26행/22 HAWB, 예 Flores Balverde ↔ CI FLORES BALVERDE SAS. 명세서 상품별 반복행은 송장 중복이 아님. 송장번호와 HAWB는 구분.
- 실제 dnSpy CLI ClassFarm.Select/Insert: Farm만 조회/추가, FarmCode/FarmName/CounKey/isDeleted/Descr/CreateID/CreateDtm/LastUpdateID/LastUpdateDtm. FarmKey는 INSERT에서 제외.
- 2026-11-18 운영 SELECT-only sys.columns: FarmKey int IDENTITY, FarmName nvarchar100, FarmCode20, Descr200, ID50. 활성 Balverde41/Kikuyal20 확인. 비공개 원문·연결 설정은 커밋하지 않음.
- Farm을 Customer에 복제하지 않는다. 기존 거래처관리와 구분되는 기준정보 농장 마스터가 실제 저장 대상이다.

## 부작용/권한/기준표
|동작|Farm|웹 분석/초안|Warehouse/Order/Shipment/Stock/Estimate/WebProfitReport|
|---|---|---|---|
|명세 대조/후보 조회|SELECT|원본명 보존|보존|
|이름 연결 확인|보존|원본+선택 키와 명시 연결 보관|보존|
|신규 농장 명시 등록|활성 국가 재검증·중복 잠금·1행 INSERT|반환 키 선택|보존|
- canManageInvoiceReceipt 기존 수입부 권한 사용. 비활성/외부 권한은 DB 접근 전 차단.
- 농장 추가는 명시 confirmed=true만 허용. 이름·국가 필수, 코드 선택. 삭제 마스터 재활성화/수정 없음. 동명/동일 정규화 기존 농장은 후보409로 안내. 정확 동일 요청은 기존1행 반환(재요청 중복 방지).
- Master PK는 실제 IDENTITY 근거를 따라 서버가 할당. 임의 MAX+1 금지.
- 명세서·송장 수 불일치/송장번호 또는 HAWB 충돌/동일 송장 중복 연결은 차단. 단순 약칭 차이는 최소 법인 표기 정규화 또는 유일 HAWB로 자동 제안, 그 외는 모든 항목의 1:1 연결과 DB 농장 선택이 있어야 통과.
- DB 선택은 실제 FarmKey 또는 기존 입고 근거 PK만 사용. 최종 기존 receipt writer가 재검증. 원본 수량·금액·농장 문자열은 변경하지 않음.
- 연도/차수 데이터는 원본 SHA 범위를 유지, 마스터는 연도 독립. 2025/2026 동일 차수 원장 모두 보존.

## 검증 계획
정상 약칭/HAWB·모호한 후보·다른 HAWB/번호·누락·중복·stale DB후보·명시0/빈값, 신규 등록/중복 재요청/권한/실패 rollback, 실제 컴포넌트 키보드·390px·합성 등록과 연결, 완료된 구간 재사용(provider0). ERP 전체/dnSpy/manifest/write guard/build·가이드·배포 스모크. 운영 등록 시험 금지.

## 데스크톱 및 가이드 연결
- 기존 `/import/tools`, `/master/codes` URL을 유지하여 즐겨찾기를 보존한다. Layout 메뉴와 desktop/menu.json의 농장 마스터 검색명을 동기화하고 Desktop 1.3.40으로 갱신한다. 기존 홈 진입 경로를 재사용하므로 shell 바로가기 추가는 불필요하다.
- 실제 Electron 격리 프로필에서 두 메뉴 검색·탭 열기·즐겨찾기 추가/해제 스모크 통과. 운영 프로필 설치/업데이트 실행은 하지 않는다.
- 신규 manifest-farm-matching 및 변경된 PackingListTool의 기존 두 가이드를 최종 소스로 녹화했다. 합성 API·운영 쓰기0·추가 유료 호출0이며 영상/한국어 자막/번호 목차와 소스 해시 검사 통과. 기존 전체 영상 일괄 갱신을 뜻하지 않는다.
