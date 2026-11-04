# 2026-11-03 공동 AWB 원가

## 요청 및 결정
45-1 콜롬비아 13농장을 공동 AWB로 계산하고 Aside에서 입고부터 엑셀까지 검증. 다른 국가 계속 검증, 운영 DB 쓰기 금지.

## 정정한 원인
농장별 CW가 없다는 이유로 공동 AWB 계산을 막은 판단은 잘못이었다. 43-1 혼합 및 44-1 수국 원본은 공동 AWB 전체 운임을 품종별 중량/부피 또는 전체 수국 송이수로 배분한다. 농장별 실측 CW를 만들지 않는다.

## 구현
- 새 작업트리 nw-shared-awb-1103, origin/master 84f37724 기준.
- 순수 공동 AWB 코어, 서버 저장문서/실입고 재조회, 버전·해시·연도·차수·AWB·통화·중복 검사.
- 미승인 계산본 엑셀만 생성. 입고·확정 원가·주문·재고·견적 쓰기 없음.
- 공동 AWB UI 조회/품종/전체 비용/계산/다운로드 연결.
- 혼합품종의 QB/HB 물리박스를 FB로 오인하지 않도록 명시 FB 환산값 없으면 차단. 수국 단일품종은 전체 송이수 배분이므로 농장별 CW/FB 비율 필요 없음.

## 검증 진행
- 계산/그룹 75 tests PASS, 추가 API/엑셀/동시변경 3 PASS, 기존 원가+신규 34 PASS.
- 기존 10개 원가 양식 회귀 포함 export 35 PASS/9 optional source parity SKIP.
- webpack build PASS (빌드 이후 순수 서버 검증·혼합 FB guard 추가분은 최종 재빌드 필요).
- manifest187/변경API1 write guard/dnSpy PASS. 전체 ERP 계약 검사 진행 중.
- 설치 EXE dnSpy CLI 재실행: 필드/입고·재고 SP 순서 그대로.
- 이전 격리 서버 보호 주문·출고 불변 확인 후 종료. 새 서버 localhost19422, 호출 소유 격리 DB만 쓰기.
- Aside 실제 45-1 원본 작업 복구→25547/5237/2919 입고 진행. 전체 13농장 최종 다운로드 아직 미검증. 첫 송장 COMMIT200 확인. 뒤 송장들의 최종 건수는 status/readback으로 재확인 필요.
- 기존 업로드 복구는 cached extraction 사용. 새 AI 인식 성공으로 주장하지 않음.
- 원가 승인/배포 미완. 운영 DB 변경0.

## 다음 작업
Aside 세션86582, 새 격리 서버98642. coFarmUi helper로8256 처리 중. 나머지757/0631/6885/19044/5703/050266/1614/46293/5601을 실제 UI 금액 대조/등록. 도착원가 독립 탭에서2026/45-01 저장문서 조회 후 새 공동AWB 패널 사용. 원가 시험값은 TEST_ONLY, AWB GW3483/CW4307/운임12777.65USD. 다른국가 actual E2E는 완료 아님.

검색어: 공동AWB 45-1 콜롬비아 13농장 16017338005 GW3483 CW4307 12777.65 FB환산 Aside 운영DB쓰기0

## 실제 Aside 검증 결과 (후속)
- 13농장 모두 금액 확인 대화상자를 거쳐 native 격리 입고 COMMIT 200, 91001~91013. 원본 37행, 663박스, 20,010송이, 상품 13,452.20 USD.
- Aside 연결이 중간 종료되어 새 REPL20918에서 보관 작업을 복구했다. 12건 재등록 없이 마지막5601만 등록했다.
- 실제 입고는 BOX, 인보이스 단가는 STEM이며 단수 null. 기존 환산 연결이 이를 막는 문제를 발견했다. 공동 원가 계산은 검증된 실제 송이수와 송이 단가를 사용하고 receiptQuantity/receiptUnit은 별도 보존하도록 수정했다. 운영 입고/재고 단위 변경 없음. 이 케이스를 API 회귀 fixture로 변경, 8 PASS.
- 수정한 API는 동일 격리 DB를 SELECT만 허용하는 localhost19424 프록시에서 실행했다. 13개 입고 재검증/전체37행 공동계산/실제 다운로드 클릭 PASS. 생성본 title의 undefined 입고번호를 공동AWB로 수정 후 다시 다운로드.
- 최종 파일: C:/Users/USER/Downloads/shared-awb-2026-45-01-16017338005 (1).xlsx.
- AWB 실제 GW3483/CW4307/운임12777.65 USD. FX1400/통관1000은 사용자 허용 TEST_ONLY. 총원가36,722,790 KRW, 37행 원본수식 비교 모두 1전 미만 차이. 3시트/1050수식/저장된 오류셀0. 농장명37행 포함(HYD 약칭2행 포함).
- 원본 양식 계산 시트의 통관비 기본값1,784,180원은 레퍼런스 미승인 가정값으로 명시되어 별도 비교된다. 실제 계산 시험 통관비1000원과 동일한 승인원가라고 주장하지 않는다. Excel 앱 재계산·인쇄/글씨 겹침은 이번 실행에서 미검증.
- 전체 npm run test:erp-contract EXIT0. 최종 추가수정8PASS. 최종 webpack 재빌드 진행.
- 격리 서버 정상 종료 EXIT0, PROTECTED_ORDER_SHIPMENT_UNCHANGED 및 자체DB cleanup 완료. 운영DB쓰기0.
- 중국45-1/네덜란드44-2는 이전 실제다운로드 결과 있음. 다른 국가44-2+ 전체 Aside E2E는 미완이며, 원본파일/비용근거 확인 및 개별 실행을 이어가야 한다. 이번 변경 배포 미완.
- 최종 수정 후 webpack build EXIT0, manifest187/write-scope1 PASS, diff check PASS. 최종 엑셀 자동 assertion: 13농장/37행/20010송이/운임12777.65/총36722790/행별차이<0.01 모두 PASS.

## 2026-11-04 후속 Q/A — 중국해상 CBM / 태국 제목
- Q: 기존 원가자료의 중국해상 CBM 적용, 태국 제목 잘림 수정, 나머지 Aside 다운로드 검증 후 배포. 운영DB 금지.
- A(실제 완료): 원본 해시·규격 곱·CBM 수식 대조 후 96품목 연결 추출. 동일 이름/박스당 단수만 파일 참고 기본값 적용, 명시 입력/승인값 불변. 태국 R14/S14 wrapText만 복제하여 실제 Excel 두줄 정상 확인.
- 11프로필 합성 시험파일 재계산 오류0, 판매/이익 합계 일치, 파일 SHA불변. 관련61테스트52PASS/9optionalSKIP; 별도 원본CBM/통관10PASS. webpack 별도 .next-cbm-verify EXIT0. dnSpy/manifest187/writeguard PASS.
- Aside NL 격리 실다운로드 (4).xlsx 확인. 다른 국가를 모두 Aside로 다운로드 완료한 것은 아님. 전체ERP 재실행 session63002는 진행중이며 CI/배포 미완. 운영DB쓰기0.
- 근거/남은 작업: docs/plans/cost-auxiliary-tables-2026-11-04.md. outputs/cost-cbm-wrap-1104. 원본 비용은 실제 신규 청구내역으로 바꾸지 않음.

## 2026-11-04 전 국가 다운로드 후속
- Q: 남은 국가도 Aside 실제 다운로드 검증 후 배포, 운영DB 금지.
- A: 격리 웹19441에서 11프로필 실제 다운로드 버튼 성공. Downloads/{profile}_ASIDE_TEST_ONLY.xlsx. CO구형/42-1, TH, US, VN, AU, NZ, EC, CN항공/해상, NL.
- 각 3행 합성 승인 snapshot을 GET으로 제공하는 fixture이며 운영DB연결/쓰기 없음. 실제 국가별 인보이스 업로드부터 승인까지 전체 E2E를 수행했다는 의미가 아님.
- 다운로드 원파일을 복사해 artifact 재계산/오류검색/판매·이익 행합계/원본SHA불변 11개 통과. outputs/aside-download-1104/all-readonly-verification.json. 판매영역 렌더11개 확인, 겹침 없음. TH R14/S14 native Excel 검증은 앞선 결과 유지.
- 전체ERP63002 종료코드0 확인. CI/배포 후 결과 별도 기록 예정.
