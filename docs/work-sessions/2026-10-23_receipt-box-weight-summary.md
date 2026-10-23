# 입고 박스·중량 현황

## 요청과 답변
- 인보이스 입고등록 후 국가·품종별 박스 합계 검증, 별도 메뉴에서 차수/월/연도와 무게 조회. 운영 DB 변경 금지.
- 기존 `/incoming/boxes`를 `입고 박스·중량 현황` 독립 메뉴로 확장. 입고 완료 원장 SELECT만 사용한다.
- 차수/연도는 OrderYear, 월은 InputDate. 연도 범위 최대 10년. 국가·품종 단독/조합 집계와 필터.
- BoxQuantity와 헤더 GW/CW를 분리한다. 여러 품종 입고의 무게는 임의 박스비율 배분 없이 혼합 중량에 한 번만 표시. 일부 품종 필터도 전체 무게를 해당 품종에 귀속하지 않는다.

## 검증 근거
- 설치 EXE dnSpy ExcelLoadingPackingList 재실행: F 박스, I 단, J 송이 독립 저장, InputDate와 연도/차수 확인. 기존 writer/SP/계산식 변경 없음.
- 실제 인보이스의 기존 분석 캐시를 재사용하여 localhost:14339 호출별 생성 DB에서 기존 매칭/어댑터→실제 입고 writer→원가 시험 다운로드→새 현황 SQL 실행.
- 콜롬비아 43-02 송장2914(전체 PDF 7개 송장 중 한 개) 48박스, 호주41-01 56박스, 미국41-01 70박스 일치. 세 국가 × 기간3 × 분류3 =27조합, 국가·품종 필터 합계 일치.
- CO GW100/CW200은 TEST_ONLY 값. AU/US 미기재 그대로. 무게 실측 또는 새로운 OCR 정확도 검증이라고 주장하지 않는다.
- 같은 SQL에 삭제 Master, 삭제 Product, 전년도 동일 차수, NULL/0/소수박스, 미분류 및 월 경계 fixture를 삽입 후 rollback하여 제외/보존/중량 중복 방지 확인. 조회 전후 헤더 스냅샷, 기존 writer 보호 원장 스냅샷 불변.
- 실제 빌드 Next 페이지를 읽기전용 로컬 proxy에서 CUA로 확인. 데이터는 위 격리 SQL readback(3DB의 입고키는 UI에서 충돌 방지용 재번호). 월/연도/국가/품종 필터로174/56/27박스 확인. 이 UI 확인은 원본 업로드부터 단일 브라우저 E2E는 아님.
- 단위/API handler 테스트: 날짜/범위, GET only, SQL 오류 안전 안내, 명시0/NULL, 같은 무게 두 입고의 합산, 혼합 필터. 전체 계약/dnSpy/manifest/write/layout/build 통과(최종 재빌드·재검사 후속 기록).

## 메뉴 기준선
| 항목 | 판정 | 근거 |
|---|---|---|
| 단일 shell/독립 메뉴 | 적용 | 기존 단일 MENU_ITEMS href 유지, layout 검사 |
| 페이지 세로 스크롤/표 가로 스크롤 | 적용 | 고정 세로 높이 없음, 표만 overflow-x |
| 키보드 | 적용 | native select/button/anchor, Tab 및 키보드 선택 CUA 확인 |
| 미저장/매칭/실제 반영 확인 | 해당 없음 | 조회 전용 |
| ERP 원장 안전 | 적용 | SELECT only, 운영 DB 접속/변경 없음 |
| 1920×1080 | 미검증 | IAB 실제 CSS viewport1280×720, screenshot 패널645px. 이 환경 범위만 검증 |

## 배포
PR/CI/배포는 진행 중. 운영 원장 수정·이관·재계산 금지. 후속 기록 참조.

검색어: receipt-box-weight-summary 입고박스 중량 월별 연도별 혼합입고 WarehouseKey
