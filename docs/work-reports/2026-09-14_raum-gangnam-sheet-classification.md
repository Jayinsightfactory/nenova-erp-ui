# 라움 견적서 강남 시트 분류

요청: `35차 강남콘서트`처럼 시트명에 강남이 들어가면 같은 차수의 강남 지점으로 분류한다.

## 기준과 범위

- 원천: 2026-09-14 사용자 지시. 시트명 강남 포함 → `branch=강남`.
- 공유 경로: `detectBranch` → `parseSheet` → 단일/다차수 파서. 업로드 API의 미리보기와 저장 모두 다차수 파서를 재실행한다.
- 차수는 시트명에 명시된 값만 사용한다. 차수별 배치, 원본 `sheetName`, 품목별 수량·단가·사입 여부와 금액 검증을 보존한다.
- 건대/초이문 기존 규칙과 거래처 격리를 보존한다. 같은 차수의 강남 시트가 여러 개면 기존 중복 검증으로 자동저장을 차단한다.
- 신규 기본값·API 필드·SQL·상태·권한 변경은 없다. 기존 저장자료를 직접 고치지 않는다.

## 부작용 및 근거

| 동작 | WebRaumPnl / Item | 주문 / 출고 / 출고일 / 농장 / 재고 | Estimate / WebProfitReport / 매출 View |
|---|---|---|---|
| 순수 시트 파싱 | 쓰기 없음 | 보존 | 보존 |
| 기존 업로드 저장 | 기존 연도+차수+거래처 계약 유지, 강남 분류 적용 | 보존 | 보존 |

`docs/exe-golden/FormRaumPnl.md`의 기능 경계와 `docs/DB_STRUCTURE.md`를 확인했다. 이번 변경은 DB 접근 없는 웹 전용 파서이며 EXE 주문등록/분배 동작을 변경하지 않는다. 운영 DB probe와 원본 업로드 파일 검증은 미수행이며 ERP 운영 데이터 변경을 주장하지 않는다.

## 사전 준비 및 역할

- 최신 master `159e17d28bba8fe371b9e44214202c52053e6a99`를 별도 작업공간에 복제하고 npm ci 완료.
- 설계: 고성능 Codex 하위 작업, 읽기 전용. 구현: gpt-5.6-terra/medium, 파서와 회귀 테스트만 수정, P0_LOCAL.
- 외부 쓰기·PR·병합·배포는 메인 담당. 하위 작업은 승인 요청·DB·비밀값 접근 금지.

## 검증

회귀는 `__tests__/raumPnlPartner.test.js`에서 접미어 강남 정규화, 차수별 분리, 동일 차수 중복 차단, 초이문 격리와 기존 건대 처리를 실행형 workbook으로 검증한다.

- 수정 전/후 `npm run test:erp-contract` 통과. Windows 임시 폴더 접근 때문에 정상 권한으로 실행했다.
- `node __tests__/raumPnlPartner.test.js`, `npm run test:nenova-dnspy-evidence`, `npm run build`, `git diff --check` 통과.
- 기준 SHA 대비 ERP manifest guard, ERP write scope guard 통과. 변경 API 0개.
- 운영 화면 사전 읽기: 배포 버전 `159e17d2`, 라움 목록 27~35차와 월별 합계 정상 표시. 1920×1080 CSS pixel / 확대 100%에서 업로드 버튼과 표 스크롤 확인.
- 최종 검토는 이전 검토 작업의 모델 용량 오류로 gpt-5.6-sol/high 검토 작업에 재배정했다.
- 배포 성공 여부는 이 변경을 포함하는 PR의 Cafe24 실행 및 후속 브라우저 확인으로 판정한다. 원본 파일 재업로드는 미수행이다.
