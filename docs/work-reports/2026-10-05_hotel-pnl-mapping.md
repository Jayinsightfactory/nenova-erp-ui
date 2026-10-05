# 호텔 순익계산서 매칭 복원

## 요청과 원인

신규 호텔과 기존 호텔의 품목·업체 연결을 지원한다. customHotel 화면은 canErpSync에 품목 연결 버튼까지 묶여 있었고, 호텔 업체 매칭 설정 자체가 없었다. 최신 master 4f694305에서 작업했다. 지정 docs/CODEX_SUBTASK_ORCHESTRATION.md는 작업 사본과 기본 checkout 모두 없어 루트 사용자 지시와 AGENTS를 적용했다.

## 동작별 부작용 및 기준

| 동작 | 읽기 | 허용 쓰기 | 보존 |
|---|---|---|---|
| 호텔 업체 연결/해제 | 활성 registry, Customer | WebPnlHotelCustomerMap | Customer, Product, ERP 원장 전체 |
| 호텔 품목 연결/해제 | 같은 PartnerCode+OrderYear의 결산 snapshot, 활성 Product | WebRaumPnlItem.ProdKey, 부모 감사 필드 | 원본 수량/단가/금액/비율, ERP 원장 전체 |
| 다음 업로드 | 같은 호텔·연도 이름+단위의 유일한 활성 연결 | 기존 결산 저장만 | 다른 호텔/연도 및 기존 수기원가 |
| 연결 업체 출고 참조 | sm.CustKey + OrderYear + OrderWeek LIKE 선택 대차수, 활성 Product | 없음 | ERP 원장 전체 |

업체는 이름으로 자동 선택하지 않는다. 명시 CustKey는 양의 정수, 해제는 null; Revision은 0 이상 정수이고 stale 값은 409. 품목은 저장된 일반행만, 같은 호텔 연결은 이름+단위 정확 일치, 기존 연결 충돌 시 전체 취소. 같은 호텔/연도 잠금을 매칭·업로드·전체 저장에서 공유한다. 전체 저장 직후 새 ItemKey를 다시 조회한다. 참조 수량은 전산 OutUnit 그대로 표시하고 결산이나 분배에 자동 적용하지 않는다.

## 선행 근거

실제 dnSpy FormOrderAdd CLI 성공 및 GetDataProduct의 Product key/단위 확인. read-only 운영 probe에서 은화 hotel_87bc41c16ae5 활성, 2026 결산 1건; 신라 446/라움 680/초이문 683/호텔여분 690 활성 Customer 확인. 실제 호텔 연결은 임의 추정하여 저장하지 않았다.

## 검증

신규 executable 테스트: 호텔·연도 격리, inactive hotel/product/customer, stale snapshot/revision, 연결 충돌, rollback, 전체 저장 매핑 보호, 참조의 정확한 업체·연도 조건. 기존 신라 단일/일괄 매칭, customHotel 통합, 다차수 업로드, 원본 보존 회귀 통과. 필수 erp-contract/manifest/dnspy/write-scope 및 production build를 실행한다. 배포 후 1920×1080, 100% 브라우저에서 신규 호텔 은화와 기존 호텔의 매칭 검색/모달/스크롤을 확인한다. 운영 결산·업체 매칭 실저장 시험은 사용자 업체를 추정하여 수행하지 않는다.

## 배포

WebPnlHotelCustomerMap 명시 migration은 기존 배포 workflow에서 실행한다. 새 테이블만 생성하고 ERP Customer/주문/출고/재고/견적/매출 원장은 변경하지 않는다.
