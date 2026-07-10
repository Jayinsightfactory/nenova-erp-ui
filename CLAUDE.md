# 📑 CLAUDE.md: Nenova ERP 웹 개발 마스터 지침 (v3.0)

## 👤 Role & Identity
- **역할:** 시스템 아키텍트 + DB 구조 준수 개발자
- **핵심 원칙:** DB가 정답, 웹이 맞춰야 함. DB를 건드리면 오류가 많아짐.

## 🏗️ 프로젝트 구조
```
[GitHub: Jayinsightfactory/nenova-erp-ui (master)]
         ↓ git push (GitHub Actions 자동 트리거)
[Cafe24 Ubuntu 서버 172.233.89.171]
  - nginx/1.24.0 리버스 프록시
  - pm2로 Next.js 실행 (앱명: nenova-erp)
  - 경로: /var/www/nenova-erp
[SQL Server (MSSQL)] ← 전산프로그램과 공유
```

---

## ⚠️ DB 구조 준수 규칙 (절대 위반 금지)

### 규칙 1: GET 요청 = 읽기 전용
- SELECT만 허용. UPDATE/DELETE/INSERT 금지
- 자동 동기화, 자동 보정 금지

### 규칙 2: ShipmentDetail WRITE 시 필수 필드
| 필드 | 값 | 설명 |
|------|------|------|
| OutQuantity | qty | 출고수량 |
| EstQuantity | 환산 기준 수량 | 금액/견적 기준 수량. 단/송이 환산 품목은 OutQuantity와 다를 수 있음 |
| BoxQuantity | qty | 박스수량 |
| BunchQuantity | qty × BunchOf1Box | 단수량 |
| SteamQuantity | qty × SteamOf1Box | 송이수량 |
| ShipmentDtm | calcShipDate() | 업체별 기본출고일 |

⚠️ `EstQuantity = OutQuantity`로 일괄 보정 금지. 카네이션/수국/루스커스처럼 박스 출고지만 단/송이 금액 기준을 쓰는 품목은 `EstQuantity`가 15, 25, 30 등으로 정상적으로 달라진다.

### 규칙 3: 출고일(ShipmentDtm) 계산
```
기준: getCurrentWeek 단순 7일 분할의 시작일에서 직전/당일 수요일
Week N 시작일 = day (N-1)*7+1
기준 수요일 = Week N 시작일보다 뒤의 수요일이 아니라, 시작일과 같거나 바로 앞의 수요일
예: 2026년 23-01 기준 수요일은 2026-06-03, 금요일 출고는 2026-06-05
BaseOutDay 오프셋: [0→+0(수), 1→+4(일), 2→+5(월), 3→+6(화), 4→+1(목), 5→+3(토), 6→+2(금)]
차수 -01/-02 무관 (같은 수요일 사용)
⚠️ Date 자정/ISOString 사용 금지 → 시간대 변환으로 하루 밀릴 수 있음. Date 객체는 정오로 만들거나 SQL date 문자열로 CAST.
```

### 규칙 4: PK 생성 = safeNextKey()
```javascript
async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(`SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {});
  return r.recordset[0].nk;
}
```

### 규칙 5: ShipmentDetail 검색 = 직접 검색
```
1단계: ShipmentDetail을 sm.CustKey+sd.ProdKey+sm.OrderWeek로 직접 찾기
2단계: 못 찾으면 sd.CustKey로 fallback 검색
3단계: 찾으면 해당 ShipmentKey 사용, 못 찾으면 새로 생성
UPDATE/DELETE는 SdetailKey로 정확히 타겟
```

---

## 🐛 발견된 이슈 패턴 & 해결법

### 패턴 1: 고스트 출고 레코드
- **증상**: 주문 없이 출고만 존재 → 잔량 마이너스
- **사례**: Emu Feather(Out=200, 주문0), Fern Sea Star(Out=50)
- **진단**: `view=ghostShipments&prodKey=XXX`
- **해결**: `view=deleteSdetail&sdk=XXX`

### 패턴 2: OutQty=0 빈 레코드
- **증상**: 전산에서 "이미 출고분배됨" → 삭제 차단
- **원인**: 전산이 분배 시 빈 ShipmentDetail 자동 생성
- **진단**: `view=checkEstQty`
- **해결**: `view=cleanupZero`

### 패턴 3: 환산필드 불일치
- **증상**: "출고수량과 출고일지정수량이 다름" 오류
- **원인**: 웹이 OutQuantity만 바꾸고 Est/Box/Bunch/Steam 안 건드림
- **해결**: PATCH에서 전 필드 동시 업데이트 (수정 완료)

### 패턴 4: 잔량 마이너스
- **증상**: "제품잔량이 마이너스인 출고 정보가 존재" → 확정 불가
- **원인**: 출고 > (이월재고+입고) 또는 이전 차수 미확정
- **진단**: `view=negativeStock`

### 패턴 5: 중복 ShipmentDetail
- **증상**: 같은 품목에 2개 레코드 (전산 원본 + 웹 신규)
- **원인**: 웹이 전산 레코드를 못 찾고 새로 INSERT
- **해결**: 직접 검색 방식으로 수정 (규칙 5)

---

## 📊 주요 테이블 관계
```
OrderMaster ← OrderDetail (주문)
ShipmentMaster ← ShipmentDetail (출고분배)
WarehouseMaster ← WarehouseDetail (입고)
StockMaster ← ProductStock (재고 스냅샷)
Customer.BaseOutDay → 업체별 기본 출고요일 (0~6)
Product.BunchOf1Box, SteamOf1Box → 환산 계수
ShipmentHistory → 전산 수정 이력 (읽기용)
UserFavorite → 즐겨찾기 (웹 전용, IDENTITY PK)
```

## 🔧 진단 API
| view | 용도 | DB 수정 |
|------|------|---------|
| negativeStock | 잔량 마이너스 품목 | ❌ 읽기 |
| checkEstQty | 불일치+빈레코드 확인 | ❌ 읽기 |
| ghostShipments | 고스트 출고 레코드 | ❌ 읽기 |
| cleanupZero | Out=0 빈 레코드 삭제 | ⚠️ DELETE |
| syncEstQty | Est=Out 강제 동기화 | 🚫 비활성화됨. 사용 금지 |
| deleteSdetail | 특정 SdetailKey 삭제 | ⚠️ DELETE |

### 분배 진단/수리 API
| API | 용도 | DB 수정 |
|-----|------|---------|
| `GET /api/shipment/distribute-diagnose?week=23-01` | 중복 ShipmentMaster, ShipmentDetail.CustKey 누락, ShipmentDate 수량/일자 불일치, 키넘버링, SP 존재 진단 | ❌ 읽기 |
| `POST /api/shipment/distribute-diagnose` `{ week, action:'repairMissingCustKey' }` | 기존 출고상세의 `CustKey`가 비었거나 `ShipmentMaster.CustKey`와 다를 때 같은 값으로 복구 | ⚠️ UPDATE |

## 🚫 배포 주의
- **빌드는 webpack 고정** (`next build --webpack`, package.json) — **Turbopack 복귀 금지.**
  2026-07-10 장애: Turbopack 프로덕션 빌드가 hydration 불능 산출물 생성(전 페이지 버튼 무반응,
  콘솔 에러 0, API 스모크는 전부 통과하는 "조용한 장애"). 재빌드·코드 revert 무효, webpack 전환으로만 복구.
  pptxgenjs의 node: scheme 은 next.config.js webpack 폴백으로 처리됨.
- 배포 후 **Hydration smoke**(Actions 러너 실브라우저, `scripts/hydration-smoke.js`)가 자동 검사 —
  버튼에 React fiber 미부착이면 워크플로 실패. "버튼이 안 눌린다" 신고 = 이 유형 의심, fiber 키 확인이 3초 진단.
- `xlsx-js-style`: webpack 전환으로 사용 가능 (매출이익 보고서 엑셀 생성에 사용 중) — 과거 금지 사유(Turbopack 실패)는 소멸
- `set -e` 사용 주의 (경고를 에러로 처리)
- 빌드 실패 시 pm2 재시작하면 502 → `.next` 확인 필수
