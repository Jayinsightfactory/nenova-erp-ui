# 신라호텔 3자료 조회·분석

사용자 요청: 로그인된 신라 SRM 브라우저를 이용해 네노바웹의 버튼에서 DB 작업데이터·원본 엑셀·입고실적의 품목/단가/수량/금액을 비교한다.

최신 origin/master 94c512bf에서 분리한 작업트리 `nw-shilla-reconcile-1020`, 브랜치 `codex/shilla-reconcile-1020`. 기존 원본 체크아웃의 동시작업 파일 변경 없음.

## 사전 근거 및 기준

- 실제 설치 EXE에 dnSpy.Console.exe --no-color -t FormOrderAdd 실행 성공. CheckExistingOrder의 OrderYear+OrderWeek+CustKey 확인. 이번 기능은 웹 결산 SELECT만 사용하고 native writer/SP에 진입하지 않는다.
- 2026-10-20 SELECT-only 운영 probe: 신라 2026 WebRaumPnl 41개, WebRaumPnlItem 225개. 2025 동일 조회 조건 결과 없음. 실제 SELECT에 연도+PartnerCode+활성 조건 사용.
- SRM 공개 컴포넌트 `https://www.shillasrm.com/ui/sp/pro/gr/es-sh-sp-gr-detail.html`: onFindList는 searchParam fdate/tdate/i_werks를 사용하는 조회 전용 findGrSpListEai.do. response.lt_srmif6_re의 budat/werks_na/belnr/buzei/matnr/maktx/groes/meins/menge/netpr/wrbtr만 투영한다. 업체확인 confirmGrItems는 호출하지 않는다.
- 화면 조회기간 최대 31일. 확장은 달력 월별 순차 요청, 하나라도 오류이면 부분 성공 자료를 반환하지 않는다. 이름/규격/단위를 보존하고 중복 전표를 삭제하지 않는다.
- 엑셀은 기존 순수 신라 parser를 사용하되 승인된 원본 수정 helper를 호출하지 않는다. 원본의 검산 경고는 그대로 표시한다. 파일 원본/DB 결산 수정 없음.
- exact 원본 이름+단위의 DB/엑셀 집계. SRM 규격이 비어 있고 이름+단위가 정확한 때만 자동 연결한다. 그 외 자재/규격/단위별 명시 연결 및 단위 환산 확인. 퍼지 매칭 자동 확정 금지.
- 매출단가/수량/금액 및 DB↔엑셀 매입단가 비교. 복수 매출단가별 수량도 대조하고 차수별 차이를 별도 계산해 서로 다른 차수의 오차 상쇄 방지. 차수 39-2는 ERP 세부차수로 변환하지 않는다.
- 선택 차수와 SRM 입고기간은 사용자가 명시 지정한다. 엑셀 제목 날짜는 제안값일 뿐 동등한 범위의 증거가 아니다. 선택 범위 일치만 표시한다.
- 가격 기본값 공급가액, 명시 선택 시 DB/엑셀 매출가격·금액만 1.1로 나눈다. 0과 null 구별. qty 1e-6, 단가 .01원, 금액 1원 허용차. 사입/원가 회계 및 손익 분배율은 재계산하지 않는다.

## 부작용 표

| 동작 | WebRaumPnl / Item | Order / Shipment / Warehouse / Stock | Estimate / ShipmentDetail.Amount,Vat,isFix / WebProfitReport |
|---|---|---|---|
| 원본·DB 확인 / 세 자료 비교 | SELECT | 보존 | 보존 |
| 신라 입고 조회 | 보존 | 보존 | 보존 |
| 분석용 품목·단위 연결 | 현재 페이지 메모리만 | 보존 | 보존 |

인증 API는 multipart 원본을 임시 파싱 후 finally에서 삭제한다. 기존 ensure-tables 경로를 피하고 명시 SELECT만 사용한다. 자격증명/쿠키 수집 없음. 확장은 scripting 권한과 신라 호스트, 네노바 분석 화면 content script로 제한. 임의 URL/스크립트/다른 출처 메시지는 지원하지 않는다. 설치는 아직 실행하지 않았으며 사용자 승인이 필요한 최종 연결 단계다.

## 메뉴 기준선

페이지 주 스크롤, 표 가로 스크롤, 기본 HTML 키보드 컨트롤, 포커스 표시 적용. 기존 _app shell, Layout 메뉴 단일 등록. 원본 3열 및 원행 근거 표시 적용. ERP 반영 확인은 해당 없음(반영 기능 없음). 분석 연결값은 현재 페이지 전용으로 명시하며 새로고침 복원/분석 이력 저장은 이번 범위에 포함하지 않는다.

## 검증 진행

- 신규 동작 회귀 7개 통과: 정상/0/null, 교차연도·하위기간·상쇄, 단위환산 승인, 단가·중복·기간·VAT, 퍼지 금지, 월별 collector 합성 DOM/오류 폐쇄, SQL/권한 제한.
- 초기 전체 검사/빌드: 오래된 기본 체크아웃 node_modules에 puppeteer-core/rrweb/antd/pdfjs-dist 부재. 공유 디렉터리는 수정하지 않고 junction 해제 후 별도 npm ci로 의존성 준비.
- 운영 브라우저 collector 연결·전체 gate·최종 배포는 후속 검증 기록 전까지 미검증.

검색어: 신라 3자료대조 shilla-reconciliation shilla-connector findGrSpListEai 입고실적 단위환산

## 최종 검증 후속 (2026-10-20)
- 신규 회귀는 최종 10개 모두 통과. 전체 ERP·dnSpy·manifest·쓰기 guard 통과. 최신 master 병합 후 로컬 build 성공. PR #1117 CI verify/installer 성공 후 squash 병합 07dbf6aa.
- 운영 배포39359785762 성공. 실브라우저에서 첨부 원본 업로드/SELECT 준비 결과 41차수와 DB225행 표시 확인. 브라우저 연결 없음 오류/안내 정상.
- 비교표 합성 fixture 데스크톱·640px·키보드 펼치기 검증. 실제 SRM 응답을 포함한 종단 검증은 최초 확장 설치 승인이 필요하여 미검증.
- 메뉴 기준선: 단일 _app shell·단일 메뉴·페이지 스크롤·표 가로 스크롤·표준 HTML 입력/포커스 적용. ERP 저장/반영은 해당 없음. 분석 매핑 복원/이력 저장은 현재 메모리 한정의 명시적 예외.

## 2026-10-20 기존 전산 매칭 재사용·안시리움 송이
- 사용자 요청: 돈셀의 노비아 오연결 수정, 안시리움은 표기와 무관하게 한 송이, 기존 ProdKey로 재대조.
- 기준: 같은 연도·선택 차수의 활성 Product 연결만 사용. 이름+단위의 연결 충돌은 경고. 동일 ProdKey+비교단위만 합산, 원문 행 보존. 수기행 제외. 안시리움181 단=송이=EA 1:1은 사용자 확인. 가격·수량 일치만으로 품목 결정하지 않음. 불명 PK는 제안만 하며 확인 전 대조 제외.
- 부작용: 분석은 WebRaumPnl/Item/Product SELECT만. 돈셀 정정은 기존 snapshot 검증 saver로 Item.ProdKey 및 부모 감사필드만 변경; Order/Shipment/ShipmentDate/Farm/Stock/Estimate/WebProfitReport는 보존. Product 명칭·단위와 원본파일 수정 없음.
- dnSpy FormOrderAdd CLI 재실행 성공. GetDataProduct의 ProdKey/SteamOf1Bunch 별도필드 확인. 운영 SELECT:223/225 연결. 돈셀17/19차 Item8604/8617→456. 후보389콜롬비아/2306중국으로 원산지 확인 대기.
- UI 기준 적용: 단일 shell, 페이지 스크롤, native select/checkbox 키보드. 쓰기 전 승인: 사용자 직접 요청 있음; 원산지 선택만 대기. 배포/실제 재대조 아직 미검증.
- 검색어: shilla-saved-matches Anthurium181 Doncel389 ProdKey aliases
- 후속: 사용자 콜롬비아 돈셀389 확인. 운영 UI에서 17차8604/19차8617 각각 단일행 수정 완료, SELECT에서389 확인. 수량20/28·단가14500·금액290000/406000 보존. 노비아 품목 자체 및 다른 행 변경 없음.
- 로컬 전체 ERP/dnSpy/manifest/writeguard/build 및 CI39383918915 통과. PR1123 squash67c7b3bf 병합. 배포39384245355 진행중. 증빙 outputs/신라-돈셀-연결수정.png 및 수정결과.txt.
- 실제 재조회523행에서 SRM 빈 규격이 빈 문자열이 아닌 '-'임을 확인. 자동 제안의 미기재 규격 조건에 '-' 추가, 실제 규격15cm는 여전히 제외하는 회귀검사 통과. 후속 배포 전 단계.
- 후속 자동연결 보강: SRM의 엔틱/염색 같은 추가 품종 토큰이 있으면 일반 연그린 품목에 연결하지 않음. 수입/행사용꽃/국가/단위만 제외한 의미 토큰을 양쪽 비교. 일반 연그린 양성 및 엔틱·염색 음성 회귀 포함 14개 통과. DB쓰기 없음. 메뉴 기준 적용: 기존 비교표 유지, 새 UI/원장 변경 해당 없음.
