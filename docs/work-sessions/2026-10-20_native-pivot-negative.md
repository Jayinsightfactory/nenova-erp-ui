# NENOVA.EXE 음수 주문 피벗 수정


## 2026-10-20 NENOVA.EXE 음수 주문 피벗
사용자가 native EXE의 모든 차수·국가 음수 표시와 합계 차감을 명시 요청. 기존 4033996D SHA256 버전은 unsigned/IL-only이고 ` WHERE vo.OutQuantity > 0 `의 IL 참조는 FormQuantityPivot.GetData 한 곳이다. 같은 길이 ` WHERE vo.OutQuantity <>0 `로 #US 내용 2바이트만 변경한다. 메타데이터/IL/입고·출고·재고/엑셀 경로 그대로 유지.
기준: 동일 연도 포함 OrderYearWeek BETWEEN/StockList 조인, 0/NULL 제외, SUM 부호 유지, 모든 국가 공통. 동작별 부작용: 조회/합계/엑셀 모두 OrderDetail·ShipmentDetail·ShipmentDate·ShipmentFarm·ProductStock·StockHistory·Estimate·WebProfitReport 보존. DB 쓰기 없음.
실제 수정 EXE를 .NET Framework x86에서 로드해 FormQuantityPivot의 grid 생성(Load/GetData 미호출), 2025/2026×01-01/44-01/44-02×3국가의 +10/-3를 바인딩. native SummaryType=Sum, -3/7/총126 확인. 실제 WYSIWYG XLSX도 -3/7/126 numeric cell 확인.
원본/수정 EXE에서 추출한 SQL 직접 SELECT 비교: 20264401 기존1227행 동일+음수31행/-103, 대상 콜롬비아 카네이션 여분26행/-76. 20264402 588행,20254401 3336행 동일. 개인정보 출력/저장 없음.
원본/수정 hash: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63 / FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 배포는 사용자 PC만, 다른 직원 실행파일 자동변경 아님. 실행중 프로세스 강제종료 금지, 닫힌 뒤 원본 백업과 atomic replace.
메뉴 기준선: 적용—기존 화면/키보드/스크롤/필터 보존. 해당 없음—웹 shell/입력/매칭/DB쓰기. 화면상 실제 로그인 조회는 아직 미검증. native control 시험과 실제SQL 읽기검증은 완료.
