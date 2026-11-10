# 수입부 비용·매칭·합계·현재 입력 다운로드 (진행 중)

요청: 방금 NL46 및 다른 국가 실파일 입고 저장값부터 엑셀 다운로드까지 검증/배포. 운영 DB 수정 금지.

실제 팀 보관 AI: 46-1 PROFORMA Factuur.pdf, Holex, 2026/46-01, 11행 상품1391.90 EUR + 운송321.49 + 처리50 =1763.39. GW102/CW114kg.

원인: EUR는 USD 전용 ERP 헤더에 저장하지 않으며 goods-only writer는 비용행을 쓰지 않음. 이번 수정은 기존 웹 costInputs를 검증된 입고와 연결해 표시/계산하는 것으로 ERP 비용행 writer 추가가 아님. 운영 조회 중 다른 작업자의 운송료/중량 행 변경 관찰; live 원장이 달라지면 웹 과거 비용을 무시하고 경고.

구현: 동일 입고 현재 리비전 비용 연결/중복 운임 방지, 입고 화면 비용 표시, 팀 매칭 CAS 저장/미매칭 초안 복구, 단위별 합계와 총금액 표시, 현재 환율·관세 다운로드 공유, Woolly 오류 안내 보존. NL 수정 비용도 등록 총액 대조에 반영.

검증: focused 회귀 PASS. native 10공식 실제 XLSX·FX1600/관세25% 반영 54PASS/9기존SKIP/0실패. 격리 SQL writer/원가 저장·내보내기/live비용/stale 경고 PASS. 운영 쓰기0. webpack compile/dnSpy/manifest210/쓰기guard PASS.

미완료: 전체ERP 최종 결과(.verify/erp-contract-final.log) 확인, 실제 브라우저 신규업로드→입고→다운로드 전체E2E, 다른 국가 실파일, 가이드 갱신, PR/CI/배포. npm build prebuild는 PackingListTool 변경 뒤 가이드 재촬영 필요로 차단. 우회 배포하지 않음.

다음: 실제 NL46 원본 SHA0615ed4a…와 보관 AI를 격리환경에 복사→매칭/저장초안/총액/입고재조회/수정FX·관세 다운로드→다른 국가→번호·줌 가이드→전체게이트→배포. 운영 쿠키 추출/토큰 재발급/DB쓰기 금지.

검색어: import-repair-1110 NL46 EUR371.49 매칭유지 현재환율 관세 다운로드 운송비

후속 전체 ERP pre/core/post 최종 exit0 확인. 화면/가이드/배포 미완료 상태는 변함없음.
