# 신라 상세 결산 매입단가 수정

## 사용자 결과

- 신라 손익계산서의 저장된 차수 상세표에서 `1개당 매입단가`를 직접 수정한다.
- 수정한 품목 수를 표시하는 `신라 매입단가 저장` 버튼으로 단가만 별도 저장한다.
- 같은 결산 안에서 동일한 전산 품목·단위·일반/수동 구분을 가진 중복 행은 화면과 저장값이 함께 바뀐다.
- 저장 성공 뒤 서버 저장본을 다시 조회하며, 실패하면 입력 중인 값은 화면에 남긴다.

## 기준값과 실패 정책

| 항목 | 기준 |
|---|---|
| 결산 범위 | 저장된 `PnlKey + OrderYear + MajorWeek + PartnerCode='shilla'` |
| 품목 범위 | `ProdKey + Unit + IsCustom`, 미연결은 정규화한 원본명 + 단위 + 구분 |
| 동시 수정 | 상세 화면을 열 때 받은 모든 `ItemKey + CostPrice`의 정확한 snapshot |
| 허용값 | 0 이상의 숫자 또는 명시적 빈 값(NULL) |
| 실패 | 잘못된 값·다른 화면의 변경·범위 불일치 시 전체 취소, 자동 재시도 없음 |

## 부작용 표

| 동작 | WebRaumPnlItem | WebRaumPnl | Order/Shipment | Stock/Estimate/WebProfitReport |
|---|---|---|---|---|
| 상세 열기·입력 | SELECT/브라우저 초안 | SELECT | 보존 | 보존 |
| 신라 단가 저장 | 일치 품목 `CostPrice/CostSource`만 UPDATE | `UpdatedBy/UpdatedAt`만 UPDATE | 보존 | 보존 |
| 오래된 snapshot·입력 오류 | 쓰기 없음 | 쓰기 없음 | 보존 | 보존 |

기존 `/api/raum/shilla-purchase-costs`의 잠금·snapshot 저장 계약을 재사용한다. 신규 테이블이나 ERP 프로시저를 추가하지 않으며 `nenova.exe` 주문·출고·재고 경로를 호출하지 않는다.

## 회귀

- 변경 없음, 중복 품목 전파, 0원, 빈 값, 음수 차단, 저장되지 않은 상세 차단을 순수 정책 테스트로 고정한다.
- 신라 상세 UI는 전체 결산 저장 버튼과 분리된 전용 단가 저장 버튼만 노출한다.

