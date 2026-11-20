# 분배 엑셀 선택 합산

## 기준·부작용

선택 업무키는 OrderYear+OrderWeek+CustKey+ProdKey. 기본 REPLACE는 기존 계약 유지. ADD는 실제 표시셀에서 매칭한 업체/품목의 추가분을 단위·선출고 정규화한 뒤 같은 업무키별로 합치고 기존 분배를 한 번 더한다. FINAL은 이 기능이 만든 최종합계 파일이며 표시셀의 매칭 업무키만 최종 SET하고 다른 행은 보존한다. 파일 메타는 연도/PK/권한 범위를 확장하지 않는다.

| 동작 | 주문 | 출고 | 농장 | 날짜·금액 | 견적/매출/재고 |
|---|---|---|---|---|---|
| 검증/다운로드 | 보존 | 보존 | 보존 | 보존 | 보존 |
| ADD 양수 | 기존 주문 보존, 없으면 양수 신규 | 검증시 기존+추가 고정 목표 SET | 기존+명시 추가분, 미입력은 보존 | 기존 수량변경 helper | 직접 원장쓰기 금지 |
| ADD 0/빈칸/누락 | 보존 | 보존 | 보존 | 보존 | 보존 |
| REPLACE/FINAL | 기존 업로드 양수/0 계약 | 최종 SET | 기존 명시 배정 검증 | 기존 helper | 직접 원장쓰기 금지 |

## 기준 원천 및 소비자

- 사용자 체크 기본 false. 기존10+파일3는 ADD13/기본3. 다운로드는 FINAL13 또는 ADDITIONAL3 선택(둘 중 하나). 선택 변경은 검증 무효화.
- 실제 EXE FormShipmentDistribution CLI 재추출 TEMP/additive-distribution-1120-native.cs 156140bytes. btnSave_Click은 ShipmentDetail→ShipmentFarm→수량 변경시 ShipmentDate 재생성, 금액 산식은 native 분배 환산. 웹의 기존 helper/확정 잠금 보존. 농장 후보는 ViewWarehouse ProdKey 범위 고정.
- 운영 SELECT 선검증 2026/46-01 Cust13 Prod53: Out16, 미확정, ViewOrder/ViewShipment 각1, ShipmentDate1, Farm0, 2025 동일 차수1. 운영 쓰기0. 기존 Farm 미배정은 native에 존재하므로 ADD만 기존 미배정 보존 허용, REPLACE/farm-only 합계 검증은 완화하지 않는다.
- `shipmentImportMode`를 preview·HMAC 계획·사전검사·잠금 트랜잭션에서 공유. 단위 환산은 ADD/생성 FINAL 파일에서 기존총량과의 근접 추정을 하지 않는다. 기존/추가/최종/미배정 표시.
- 농장 입력은 추가분 배정. 기존 농장 수량에 FarmKey별 추가하며 임의 비례 증감 없음. 추가 농장이 없으면 기존 배정 그대로, 추가분은 미배정. 기존 농장/수량 stale 또는 합계 초과는 전체 차단.
- 저장은 검증된 목표13 SET. 성공 후 자동 재검증으로16을 새 목표로 만들지 않는다. 완료된 기존값은 '합산전'으로 표시하고 승인 토큰 무효화. 같은 추가파일 재반영은 경고 후 명시 검증·승인.
- FINAL 다운로드는 원본 셀/수식·cached 합계/메모를 최종 수량으로 반영, 추가본은 추가 수량. 단위 환산 후 선출고 제외 수량이므로 두 생성파일은 ALREADY_EXCLUDED 요구. FINAL+ADD, ADDITIONAL+REPLACE는 안내 후 명시 선택/재검증. FINAL 재업로드는 표시셀 범위만 SET. 원본 행열·그림·인쇄 설정 보존.

## 가장 큰 한계

기존 부분 농장 배정이 있으면 ADD 후에도 미배정이 남는다. 임의 배정하지 않고 최종 미배정을 표시한다. 원본 양식에 없는 업체/품목을 최종 다운로드에 새 열로 만들지 않으며, FINAL 재업로드는 표시된 범위 밖 원장을 보존한다.

## 검증

필수: 10+3=13, 기본3, 같은키3+2+기존10=15, 0/빈칸/누락 보존, 교차연도, 단/박스/알스트로 환산, 선출고 중복제외 금지, stale·확정·중복 승인, 농장 보존/명시 추가/미배정/초과 차단, 파일 종류 불일치·최종 왕복·수식 cached 합계·native 인쇄. 현재 구현/검증 진행중, 미검증을 완료로 표시하지 않음.

### 대상 검증 결과 (2026-11-20)
- 신규 정책/파일/농장/단위7그룹, 실제 저장 진입점 경쟁차단2, 실제 React7 통과. READONLY SQL fixture는 실제 MSSQL 저장 성공을 대신한다고 주장하지 않음. 서로 다른 job이 baseline10 이후 current13을 읽으면 preflight/잠금 단계 모두 stale로 차단, mutation0.
- 격리 실제 Chrome 1920/390: 기본 REPLACE, ADD10+3=13, 두 형식, 설정 변경 무효화, 완료 후 형식 고정·다운로드 유지·중복 승인/자동 재검증 차단 통과. 모든 /api 요청은 합성 응답으로 가로챔; 운영 쓰기0.
- 사용자 두 원본은 읽기 전용 보존. 실제 exporter 결과를 native Excel COM read-only CalculateFullRebuild/ExportAsFixedFormat으로 검증. 카네이션 추가3/최종13, 합계130/140·잔량59/49; 장미 추가3/최종13, 합계123/133·잔량37/27. 원본 row/cols/print XML 및 drawing/media 동일, native 그림13/6, A3 1페이지841.68×1190.4pt, 여백18/54pt, fit1×1 유지. 기준10은 격리 fixture이며 운영 baseline이 아님.
- readonly downstream(2026/46-01): ViewShipment870, Estimate184, DetailFix1=200 및 ViewOrder 조인 견적 노출200. 확정 Amount/Vat 집계44,910,994/4,491,106. WebProfitReport(2026/46)0·활성확정0. 최초 표본 Sdetail103067은 OutQuantity16 그대로. 직접 Estimate/Stock/WebProfitReport 쓰기 없음; ADD는 기존 공유 수량/금액/출고일 검증 helper를 재사용한다.
- Desktop1.3.69 메뉴 검색에 합산 명칭 연결, 단위77·실제 Electron 스모크 통과. 신규 합산6단계45초 및 기존 동일페이지 가이드를 현재 UI로 촬영, 가이드35업무/36영상 해시·번호·줌경계 검사 통과.
- 최종 ERP 전체게이트·빌드·CI·Cafe24·운영 페이지 스모크는 다음 단계(아직 미검증).
- 외부 증거: C:/Users/USER/.codex/visualizations/2026/11/20/additive-distribution-1120 (native-qa.json, 6xlsx/6pdf, Chrome 익명 화면). Drive 업로드 확인 전 삭제 금지.

### 최종 로컬 게이트 (2026-11-20)
프로덕션 build 통과. 전체 ERP 계약은 신규 manifest enum 오류를 고친 뒤 이미 통과한 선행·전반부를 반복하지 않고 manifest부터 나머지 명령144개 목록의 끝까지 순차 실행해 통과했다. dnSpy/manifest235개/변경 API 쓰기 가드 통과. 농장 텍스트11·현장물량표39 통과, 가이드 플레이어 MP4/VTT/키보드 목차/1920·390 통과. 실제 dnSpy 재실행 출력 SHA256=642AF0D4B6AB6A3536DDA5C124E28BA835190AD2D0468C10D33EF9DEEFB9A818. 새 기능 추가 없이 이후 CI에서 병합 최종 소스를 재검증한다.

## 최종 배포·종료 기록
PR1906은 f891c82c268dc45cc8dc9d908c7ab01a0d0a8daa로 squash 병합. 최종 ERP/Windows CI 성공, Cafe24 배포44662157882 성공. 운영 f891에서 합산 체크·두 다운로드 전환·검증 전 승인 차단을 확인하고 개인정보 없는 JPG를 보관했다. 공개 Desktop1.3.71은 f891 master CI44662157850의 EXE/블록맵 해시와 정확히 일치하며 latest.yml readback 통과. 타 세션의 기존 draft가 우리 merge 포함 f891 설치본으로 갱신·정식 게시되어 중복 패키징 없이 해당 검증으로 완료했다. 타인 artifact/최신 포인터를 변경하지 않았다.

목표g03/g13/g19에는 근거·메모·이력만 추가하고 progress0/100/40와 gate-p0를 보존. 비밀 없는 지시1건을 영구 학습했다. 정합률98.3%는 목표 달성률이 아니며 미접촉 목표11개는 WORK_MEMORY 참조. 운영 ERP 시험 쓰기0; native/격리 fixture/UI 검증의 구체적 범위와 기존30분 다운로드 서명 제한은 위 기록을 따른다.

최종 증거는 지정 Drive 폴더와 두 ZIP에 업로드·크기/부모/ID readback 확인. 최종 운영 JPG1장만 전달용으로 남기고 task worktree·공유 junction 참조·캐시·중복 설치본/영상/Excel/PDF는 보관 확인 후 정리한다. 사용자 원본과 이전 작업 기록은 유지한다.
