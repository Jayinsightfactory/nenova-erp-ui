# 입고단가/송금 우측 탭 작업 기록 (2026-05-25)

## 사용자 요청

입고단가/송금 페이지에서 기존 입력 데이터가 우측 탭에 별도로 보이지 않아, 송금된 업체와 송금해야 할 업체를 쉽게 구분하기 어렵다는 요청이 있었다.

핵심 의도:

- 기존 입력 데이터는 우측 탭에서 따로 확인
- 송금된 업체와 송금해야 할 업체를 한눈에 구분
- 기존 입력/저장 흐름은 유지

## 확인한 구조

현재 입고단가/송금 페이지는 `/incoming-price` 이고, 데이터 API는 `/api/incoming-price` 이다.

현재 DB에는 별도의 “송금 완료” 테이블이 없고, 기존 입력 데이터는 `FarmCredit` 테이블에 저장된다.

- `FarmCredit.FarmName`
- `FarmCredit.OrderWeek`
- `FarmCredit.CreditUSD`
- `FarmCredit.Memo`
- `FarmCredit.isDeleted`

따라서 이번 구현에서는 DB 구조를 변경하지 않고, 기존 저장 데이터가 있는 업체를 “입력 있음”으로 분류했다.

## 구현 내용

파일:

- `pages/incoming-price.js`

추가된 UI:

- 우측 고정 패널
- `송금 필요` 탭
- `입력 있음` 탭
- 요약 카운터
- 업체별 소계, 차감, 송금액
- 저장된 차수/메모 표시

분류 기준:

- `입력 있음`: 선택 차수에 대해 `FarmCredit` 저장값이 있고, 금액 또는 메모가 비어 있지 않은 업체
- `송금 필요`: 선택 차수에 송금액이 있으나 저장 입력값이 없는 업체

반응형:

- 화면 폭이 좁으면 우측 패널이 아래로 내려가도록 처리했다.

## 검증

- `next build` 성공
- 운영 배포 확인 완료

배포 커밋:

- `14bbb41 feat: add incoming payment status side tabs`

운영 확인:

- `https://nenovaweb.com/api/dev/git-log?limit=1` 에서 `14bbb41` 확인

## 남은 판단 지점

현재 “송금 완료”는 명시적인 DB 필드가 아니라 `FarmCredit` 입력 존재 여부로 판단한다.

정확한 송금 완료/미완료 관리를 하려면 향후 별도 필드 또는 테이블이 필요하다.

예시:

- `FarmPaymentStatus`
- `FarmName`
- `OrderWeek`
- `PaymentAmountUSD`
- `PaymentDate`
- `isPaid`
- `Memo`

다만 이번 작업에서는 기존 DB 구조 충돌을 피하기 위해 UI 분류만 추가했다.

