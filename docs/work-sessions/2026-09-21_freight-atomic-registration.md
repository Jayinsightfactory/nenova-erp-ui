# 운임 등록 원자성 재검증

## 요청과 근거
- 사용자: 운임 등록 중복·부분 저장·재확정 실패를 재검증하고 안전하게 수정·배포.
- 운영 SELECT: 2026 38-01, CustKey 515, ProdKey 2253, SdetailKey 91998,
  SdateKey 122187: 카네이션 운송료 31박스, 3,000원, 2026-09-17, 확정.
- 같은 국내왁스 분류의 확정 상세 35건. 실제 usp_ShipmentFix/Cancel은 업체가 아닌
  연도·세부차수·CountryFlower 전체를 변경한다. 선택 업체 운임만 처리하는 API에서
  이 전체 SP를 호출하지 않는다. 공용 SP 자체도 변경하지 않는다.
- 기존 estimateDirectionalQuantity / update-date-quantity 및 estimateOverflow는
  확정 플래그를 보존하며 native Cancel(old)+Fix(new)의 순재고 효과를 기록하고
  같은 트랜잭션에서 품목별 native 재계산을 실행한다. 운임도 이 계약을 따른다.
- 직접 DB 인증은 기존 MD의 연결 설정으로 읽기 검증. 비밀값은 산출물에 복사하지 않는다.

## 기준 원장 및 부작용
| 동작 | 주문 | 출고/날짜 | 확정/재고 | Estimate/손익 |
|---|---|---|---|---|
| 미리보기 | 조회 | 현재 업체·연도·부모차수 조회 | 조회 | 보존 |
| 기존 운임 최종값 | 보존 | 선택 상세와 유일 날짜의 수량·단가 갱신, 날짜 유지 | 확정 유지, 순증감 이력+품목 재계산 | 직접 쓰기 없음 |
| 새 운임 | 양수 주문 없을 때만 생성 | 기존 확정 마스터에 양수 상세/날짜 | 신규 확정 효과+품목 재계산 | 직접 쓰기 없음 |
| 한 행/재계산/검증 실패 | 전체 롤백 | 전체 롤백 | 전체 롤백 | 보존 |
| 동일 작업 재시도 | 보존 | 성공 영수증 반환 | 보존 | 보존 |

## Criteria ledger
- identity: OrderYear + OrderWeek + CustKey + ProdKey. year<=2025 금지(native 계산 범위).
- box freight only: 활성 Product, OutUnit/EstUnit 박스. 임의 품목/환산 추정 금지.
- qty/cost: 명시 양수 유한수, 수량 소수 3자리까지. 기존 수량에 덧셈하지 않는다.
- existing: 유일 상세/유일 날짜·확정·날짜합계 검증. 기존 날짜 유지.
- combined: target 01, source 01/02만. 02 기존 운임은 자동 이동/삭제하지 않고 사전 차단.
- new: 선택 업체의 기존 확정 마스터 및 PeriodDay 실제 날짜 필요. 다른 업체 해제 금지.
- preview/apply: 동일 prepare 함수와 기준 지문; 적용 전 잠금 재조회 및 지문 대조.
- idempotency: 작업 UUID+사용자+요청 해시, SystemActionLog 성공 영수증을 ERP와 함께 commit.
- stock: V2 gate 잠금, 현재고/현차수/후속 차수 증가 검증, force 및 자동 재고조정 금지.
- post-write: ViewOrder/ViewShipment/PeriodDay/날짜수량·단가·금액·확정 일치 후만 성공.

## 진행 상태
구현 및 로컬 검증 완료. 배포·브라우저 검증은 아직 진행 전이다.
- ERP 전체 계약, manifest 66개, 신규 API 포함 쓰기 가드, dnSpy evidence, production build 통과.
- 전용 localhost SQL2022 임시 fixture: 31→61, 기존 주문/날짜 보존, 신규 양수 주문/분배, 다른 업체/2025년 보존, native 실패/두 번째 행 실패/저장 후 대조 실패 전체 롤백 통과.
- 8개 client/입력 테스트: 명시 0/false/누락, 승인 취소, 응답 유실 후 영수증 조회, 같은 UUID 재시도, busy 결과 미확정 보존 통과.
- 실제 DB prepareFreight SELECT: 38-01 카네이션 운송료 31→61, 기존 09-17 유지, 주문 신규 불필요 확인. 운영 저장은 실행하지 않았다.
- 기준 검토: 전체 카테고리 확정해제 없음, 수량 0 가짜 주문 없음, 재고 강제 조정 없음, 02 기존 운임/여러 출고일은 자동 변경하지 않고 차단한다.
