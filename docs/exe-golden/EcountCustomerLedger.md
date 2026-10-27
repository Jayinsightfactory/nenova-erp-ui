# E040723 담당 거래처 채권 — 2026-10-27

외부 ECOUNT 조회 보고서를 웹 전용 WebEcountSnapshot에 보관하는 기능이다. EXE 정산/채권 원장을 구현하거나 수정하지 않는다.

로컬 설치 Nenova.exe를 dnSpy.Console.exe --no-color -t ClassCustomer 및 -t FormCustomerInfo로 직접 조회(exit 0). ClassCustomer.GetData의 BusinessNumber/Manager/OrderCode 읽기 필드와 FormCustomerInfo의 사업자번호/Manager/거래처주문코드 표시를 확인했다. OrderCode는 이카운트 거래처코드로 추정할 수 없다. 이번 작업은 해당 테이블에 쓰지 않는다.

읽기 전용 운영 DB probe: 활성 거래처 675, 담당자 지정 127, 활성 UserInfo에 유일하게 연결된 담당 거래처 125, 식별값이 10자리이며 활성 거래처 전체에서 유일한 수집 후보 120, 연결 확인 필요 5. Manager는 UserID 또는 UserName과 정확히 일치하되 후보가 정확히 한 계정일 때만 허용한다. 비활성 계정, 담당 변경, 중복 식별값은 매 요청 다시 판정한다.

ECOUNT 실제 로그인 UI에서 E040723 거래처관리대장1(채권), 전표별, 개별거래처기준, 2026-09-27~2026-10-27을 확인했다. 전산 사업자 식별값과 원본 코드/보고서 사업자 식별값이 유일하게 일치하는 표본에서 전표 37행을 조회했다. 일자/적요/판매/수금/잔액 5열, 이월잔액/합계 2열 병합을 확인했으며 판매합계·수금합계·모든 행의 이월 이후 잔액·최종잔액 대조가 일치했다. 다른 표본의 명시적인 ‘등록된 데이터가 없습니다.’도 확인했다.

수집기는 코드 정확 입력으로 단일 자동선택되는 경우만 진행한다. 날짜 바로가기는 검색을 실행하므로 조건을 다시 연 후 최근 달의 정확한 시작·종료 일을 설정한다. 출력 보고서 기간과 사업자 식별값을 다시 검사한다. 거래처명으로 추정하거나 여러 후보 중 첫 번째를 고르지 않는다. 식별값/적요/상호/개인정보/세션 URL/스크린샷은 저장하지 않는다. 저장 필드는 날짜·판매·수금·잔액·내부 CustKey·식별값 해시 및 검증 메타데이터다.

| 동작 | 읽기 | 쓰기 | 공유 원장 영향 |
|---|---|---|---|
| 담당 거래처 및 조회 권한 확인 | Customer, UserInfo | 없음 | 없음 |
| 원본 검색 | ECOUNT E040723 | 없음 | ECOUNT 조회 전용 |
| 검증 수집본 적재 | Customer, UserInfo | WebEcountSnapshot append | 웹 전용 |
| 직원 조회 | Customer, UserInfo, WebEcountSnapshot | 없음 | 없음 |

OrderDetail, ShipmentDetail(Amount/Vat/isFix 포함), ShipmentFarm, ShipmentDate, StockHistory, Estimate, WebProfitReport 및 관련 View/SP는 모두 preserve. 스키마 변경 없음. 수집 실패는 마지막 검증본을 덮어쓰지 않으며, 주말·업무시간 외에는 실제 수집기간과 마지막 수집시각을 표시한다.
