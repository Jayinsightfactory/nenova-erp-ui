# 주문 저장의 빈 출고 연결 헤더 — 2026-11-18

## 범위와 근거

사용자의 최신 명시 지시는 일반 신규 주문등록과 영업부 붙여넣기에 EXE처럼 빈 출고 연결 헤더를 준비하는 것이다. 실제 FormOrderAdd.btnSave_Click의 전체 헤더 COUNT=0 조건, raw OrderYearWeek 및 GetShipmentMaster의 조회 전제를 사용한다. 수정 전 읽기 전용 감사는 [감사 기록](../SALES_PASTE_DOWNSTREAM_AUDIT_2026-11-18.md)에 있다. 과거 중복/삭제 헤더를 정리하지 않는다.

## 기준표와 부작용

| 기준/소비자 | 확정 값 | 근거 |
|---|---|---|
| 일반 화면 저장 payload | source=manual-order; 기존 수량/단위/연도/차수 유지 | pages/orders/new.js |
| 영업부 화면 저장 payload | 기존 source=sales-paste, ADD, expectedCurrentQty 유지 | sales-paste-order 계약 |
| source 미지정/호텔/내 업체 | 기존 동작 유지 | 소스별 계약 |
| 최종 저장 잠금 | OrderYear+OrderWeek+CustKey 전체 ShipmentMaster; 삭제 필터 없음; UPDLOCK/HOLDLOCK | 실제 EXE lookup + native 헤더 계약 |
| 0건 | 기존 safe key/retry로 빈 헤더 생성 + KeyNumbering 동기화 | 기존 production insert 경로 |
| 단일 활성/fixed | key만 재사용, 메타데이터 수정0 | resolveNativeOrderShipmentHeader |
| 삭제/복수 | ORDER_SHIPMENT_HEADER_CONFLICT 409, 전체 주문/이력 rollback | 같은 helper; 실행 회귀 |
| explicit false/생략 | 해당 두 source의 헤더 준비를 우회하지 않음 | 서버 source 정책 |
| 헤더 필드 | isFix=0,isDeleted=0, OrderYearWeek=연도+대차수, native EstimateName | FormOrderAdd |
| 미리보기/후처리 | 기존 주문 초안/확인/재조회 유지; 헤더 자격은 저장 잠금 안에서 결정 | 새 헤더 후보 선택 UI 없음 |

| 동작 | OrderMaster/Detail/History | ShipmentMaster | ShipmentDetail/Date/Farm | Estimate/매출/손익 | Stock |
|---|---|---|---|---|---|
| 영업부 ADD | 기존 optimistic ADD | 부재시 빈 헤더/단일 활성 재사용 | 보존 | 보존 | 기존 보존 |
| 일반 저장 | 기존 가산 | 부재시 빈 헤더/단일 활성 재사용 | 보존 | 보존 | 기존 native 재계산 경로 유지 |
| 헤더 충돌/저장 실패 | rollback | rollback | 보존 | 보존 | 후처리 호출0 |

직접 StockHistory 재고조정0. 빈 헤더 자체는 ViewShipment 상세·견적·매출을 만들지 않는다. 분배/확정은 별도 기존 업무다.

## 검증 fixture

양성: 두 source 신규 빈 헤더 생성, 활성/fixed 헤더 메타데이터 보존 재사용, sales ADD 정상 후속 저장의 헤더1개 유지.
반례: 2025 동일차수, 다른업체, 다른세부차수, 단일 삭제헤더, 복수 활성, 활성+삭제, stale expectedCurrentQty 재시도, 헤더 INSERT 실패, 후속 품목실패 전체 rollback. fake transaction은 실제 createOrder 함수 본문을 실행하며 ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport 쓰기를 시도하면 실패한다. 분배 수량/금액/Vat/확정/날짜 sentinel을 보존한다.

공통 helper: resolveNativeOrderShipmentHeader. 영업부 stock helper 호출0, 일반 기존 호출1. 원장 실제 시험쓰기는 하지 않는다.

## 메뉴 개발 기준선

| 기준 | 판정 | 근거 |
|---|---|---|
| 업무키/ERP 반영 안전 | 적용 | 두 source transaction fixture/계약/dnSpy |
| 기존 데스크톱 연결 | 적용 | components/Layout.js 및 desktop/menu.json에 두 URL 존재, 검색/즐겨찾기 기존 카탈로그 재사용 |
| 새 메뉴/탭·레이아웃·키보드 순서 변경 | 해당 없음 | UI 수정은 manual-order payload 필드1개, 기존 화면 배치·조작 유지 |
| 영상 신규/갱신 | 해당 없음 | 메뉴·탭·작업 순서 변경 없는 저장 호환성 수정 |
| desktop 버전/메뉴 신규 등록 | 해당 없음 | 이미 연결된 두 화면의 서버 저장 동작 수정 |
| Rust 핫패스 | 해당 없음 | DB transaction CRUD, 새 상주/바이너리 처리 없음 |

실제 직원 EXE GUI의 저장→분배→확정→견적 전 과정과 운영 신규 주문 쓰기는 미검증으로 유지한다. 과거43-01 복수 헤더는 이 수정으로 자동 정리되지 않는다.
