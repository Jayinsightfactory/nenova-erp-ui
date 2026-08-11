// 주차별 매출이익 보고서 — "이 숫자는 어디서 왔나" 데이터 사전(단일 정의).
//
// 이 파일은 설명 전용이며 계산/저장에 전혀 관여하지 않는다. 화면(components/ProfitReportSourceGuide.js)과
// 회귀테스트(__tests__/profitReportSourceGuide.test.js)가 이 상수 하나만 읽는다.
//
// 작성 근거(추측 금지 — 코드/SQL 실측):
//  - lib/profitReport.js            : salesByCategory(N) / estimateByCategory(L·O) / purchaseByCategory(Q)
//                                     / forwardingByCategory(레거시 S) / purchaseQtyByCategory / invoiceRatesByCategory(R)
//                                     / latestStockSnapshotWeek / stockSnapshotByCategory / loadManual / saveManual
//  - lib/profitReportCalc.js        : C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C, F 자동공식
//  - lib/customsForwarding.js       : H(그외통관비) 국가별·콜롬비아 배분, S(포워딩) 자동감지
//  - lib/customsFields.js           : VAT_FACTOR=1.1, 관세·선율 1/2/3 분할합계
//  - lib/colombiaTruck.js           : 월드운송료 1t/2.5t/5t 등급
//  - lib/profitReportClassification.js : 국가·화종 분류, 기타(미분류)
//  - pages/api/sales/profit-report.js  : 기초(E)/기말(F) 차수 경계, R 우선순위(29차 규칙)
//  - pages/sales/profit-report.js      : D=C/ΣC, U=P/ΣP, 합계행 범위, 수기 보정 UI
//  - docs/exe-golden/FormProfitReport.md / docs/contracts/weekly-profit-report.json

/** 입력 성격 — 화면 배지로 그대로 표시된다. */
export const ENTRY_KINDS = {
  auto: { label: '자동', hint: '전산(nenova.exe) DB에서 그대로 읽어옵니다. 사람이 넣는 값이 아닙니다.' },
  calc: { label: '계산', hint: '화면 안의 다른 항목으로 그 자리에서 계산합니다. 따로 저장하지 않습니다.' },
  autoManual: { label: '자동 + 직접입력 가능', hint: '자동값이 기본이고, [🛠 수기 보정]에서 값을 넣으면 그 값이 우선합니다.' },
  manualSource: { label: '입력화면에서 옴', hint: '별도 입력 화면(그외통관비·포워딩)에 저장한 값이 자동으로 들어옵니다. 입력이 없으면 0입니다.' },
  manual: { label: '직접입력', hint: '사람이 넣어야만 값이 생깁니다. 자동 원천이 없습니다.' },
};

/** 상단 한 줄 요약 — 펼치기 버튼 옆/안내문에 쓴다. */
export const GUIDE_SUMMARY =
  '파란 배지(자동)는 전산 장부를 그대로 읽은 값, 회색 배지(계산)는 화면에서 더하고 나눈 값, '
  + '노란 배지(직접입력)는 사람이 넣은 값입니다. 사람이 넣은 값을 자동값처럼 설명하지 않습니다.';

/**
 * 표에 보이는 열 — pages/sales/profit-report.js 의 COLUMN_DEFS, lib/profitReportExcel.js 의 COL_LABEL 과
 * key/label 이 완전히 같아야 한다(테스트가 강제).
 */
export const COLUMN_GUIDE = [
  {
    key: 'category',
    label: '품명',
    source: '전산 품목정보의 나라·꽃 종류. 운송료 전용 품목은 품목이름을 먼저 봅니다.',
    formula: '콜롬비아는 수국·카네이션·장미·루스커스·알스트로로 나누고, 나머지는 나라 단위로 묶습니다. 어디에도 안 맞으면 “기타(미분류)” 줄로 모입니다.',
    kind: 'auto',
    note: '“기타(미분류)”가 보이면 숫자가 틀린 게 아니라 품목의 나라/꽃 종류가 비어 있거나 다르게 적힌 것입니다. 비고에 원본 품목이 자동으로 적힙니다.',
    fields: 'Product.CounName / Product.FlowerName / Product.ProdName · lib/profitReportClassification.js',
  },
  {
    key: 'C',
    label: '매출액',
    source: '아래 순수매출액 + 불량금액 + 그 외 매출액',
    formula: '매출액 = 순수매출액 + 불량금액 + 그 외 매출액 (불량금액은 보통 마이너스라 빼지는 효과)',
    kind: 'calc',
    note: '이 줄만 따로 저장되지 않습니다. 세 값이 바뀌면 자동으로 다시 계산됩니다.',
    fields: 'C = N + L + O · lib/profitReportCalc.js',
  },
  {
    key: 'D',
    label: '매출비율',
    source: '이 화면 안에서만 계산',
    formula: '그 줄의 매출액 ÷ 표 맨 아래 합계 매출액. 합계에는 “공제” 줄과 “기타(미분류)” 줄도 포함됩니다.',
    kind: 'calc',
    note: '합계 매출액이 0이면 빈칸으로 둡니다(0%로 쓰지 않습니다). 합계 줄은 항상 100.0%입니다.',
    fields: 'D = row.C / totals.C · pages/sales/profit-report.js',
  },
  {
    key: 'E',
    label: '기초상품재고액',
    source: '전 차수(27차라면 26차)의 마지막 세부차수 재고 스냅샷. 전 차수 보고서에 기말재고를 저장해 두었으면 그 값이 먼저입니다.',
    formula: '① 이번 차수에 직접 넣은 값 → ② 전 차수 보고서에 저장된 기말상품재고액 → ③ 전 차수 재고로 기말재고와 똑같은 공식으로 자동계산',
    kind: 'autoManual',
    note: '01차만 전년도 52차를 전 차수로 봅니다. 전 차수 재고 스냅샷이 아예 없으면 자동계산이 안 되고 검증 목록에 뜹니다.',
    fields: 'ProductStock.Stock(전 차수 마지막 StockKey) / WebProfitReport.ColKey=E · pages/api/sales/profit-report.js',
  },
  {
    key: 'F',
    label: '기말상품재고액',
    source: '이번 차수의 마지막 세부차수 재고 스냅샷(전산 재고현황의 마지막 잔량) + 이번 차수 매입·포워딩·통관비',
    formula: '(구매금액 × 환율 + 포워딩 × 환율 + 그외통관비) ÷ 이번 차수 매입 총수량 × 남은 재고수량. 이번 차수 매입이 없으면 품목별 최근 매입단가 × 남은 수량 × 환율, 그것도 없으면 [🏷 재고단가표] 평가액(수량 × 단가 ÷ 1.1)',
    kind: 'autoManual',
    note: '재고수량을 웹이 다시 계산하지 않고 전산 재고현황의 마지막 잔량을 그대로 씁니다. 재고 마감표시(isFix)는 스냅샷을 고르는 조건이 아니라 참고 표시입니다. 마이너스 재고가 섞이면 검증 오류로 알려줍니다.',
    fields: 'ProductStock.Stock(이번 차수 마지막 StockKey) / WarehouseDetail / WebStockPrice / WebProfitReport.ColKey=F',
  },
  {
    key: 'G',
    label: '매입액(상품+포워딩)',
    source: '상품 금액(구매) + 포워딩 원화환산',
    formula: '매입액 = 상품 금액(구매) + 포워딩 원화환산 = (구매금액 × 환율) + (포워딩 × 환율)',
    kind: 'calc',
    note: '통관비는 여기에 안 들어갑니다. 통관비는 매출원가에서 따로 더합니다.',
    fields: 'G = P + T · lib/profitReportCalc.js',
  },
  {
    key: 'H',
    label: '그외통관비',
    source: '[📦 그외통관비 입력] 화면에 저장한 값. 무게(GW)는 입고관리에서 자동으로 가져옵니다.',
    formula: '나라별 = 백상창고료(무게 × 원/kg) + 관세 + 선율 ÷ 1.1 + 월드운송료 ÷ 1.1 + 한국방역 ÷ 1.1. 콜롬비아 카네이션·장미·알스트로·루스커스는 세부차수 합계를 “박스당 무게 × 박스수” 비율로 나눠 담습니다.',
    kind: 'manualSource',
    note: '÷1.1은 부가세를 뺀 공급가만 원가로 잡기 위한 것입니다. 백상창고료·관세는 원래 공급가라 나누지 않고, 베트남 선율만 예외로 나누지 않습니다. 입력이 없으면 0으로 계산되고 검증 목록에 뜹니다.',
    fields: 'WebCustomsWeekly / WebColombiaWeekly / WebCustomsRateConfig · lib/customsForwarding.js',
  },
  {
    key: 'I',
    label: '매출원가',
    source: '기초재고 + 매입액 + 그외통관비 − 기말재고',
    formula: '매출원가 = 기초상품재고액 + 매입액 + 그외통관비 − 기말상품재고액',
    kind: 'calc',
    note: '이스라엘·뉴질랜드·일본은 원본 양식대로 기말재고를 빼지 않습니다(기초 + 매입 + 통관비).',
    fields: 'I = E + G + H − F (variant=noEnding은 E + G + H)',
  },
  {
    key: 'J',
    label: '매출이익',
    source: '매출액 − 매출원가',
    formula: '매출이익 = 매출액 − 매출원가',
    kind: 'calc',
    note: '이스라엘·뉴질랜드·일본은 기말재고를 다시 더합니다(매출액 − 매출원가 + 기말재고). 마이너스면 빨간색으로 보입니다.',
    fields: 'J = C − I (variant=noEnding은 C − I + F)',
  },
  {
    key: 'K',
    label: '이익률',
    source: '매출이익 ÷ 매출액',
    formula: '이익률 = 매출이익 ÷ 매출액',
    kind: 'calc',
    note: '이스라엘·뉴질랜드·일본과 맨 아래 합계 줄은 (매출액 + 기말재고)로 나눕니다. 나눌 값이 0이면 빈칸입니다.',
    fields: 'K = J / C (noEnding·합계는 J / (C + F))',
  },
  {
    key: 'L',
    label: '불량금액',
    source: '전산 견적/차감 자료 중 “불량차감”으로 분류된 금액',
    formula: '확정된 출고에 연결된 차감 금액 중 코드값이 불량차감인 것만 더합니다. 보통 마이너스 금액입니다.',
    kind: 'auto',
    note: '웹에서 만들지 않습니다. 전산에 등록된 차감이 그대로 보입니다.',
    fields: 'Estimate.Amount + CodeInfo.Descr2=N\'불량차감\' · lib/profitReport.js',
  },
  {
    key: 'M',
    label: '불량율',
    source: '불량금액 ÷ 매출액',
    formula: '불량율 = −(불량금액) ÷ 매출액. 불량금액이 마이너스라 부호를 뒤집어 플러스 비율로 보여줍니다.',
    kind: 'calc',
    note: '매출액이 0이면 빈칸입니다.',
    fields: 'M = −L / C',
  },
  {
    key: 'N',
    label: '순수매출액',
    source: '전산 출고분배에서 확정(마감)된 출고의 공급가액 합계',
    formula: '삭제되지 않고 확정된 출고 전표의 출고금액을 나라·꽃 종류별로 더합니다. 출고수량이 0인 줄과 무게(Chargeable/Gross weight) 줄은 빼고 셉니다.',
    kind: 'auto',
    note: '확정 전(미확정) 출고는 들어오지 않습니다. 그래서 차수를 확정하기 전에는 매출이 낮게 보일 수 있습니다.',
    fields: 'ShipmentDetail.Amount · ShipmentMaster.isFix=1 / isDeleted=0 / OrderYearWeek',
  },
  {
    key: 'O',
    label: '그 외 매출액',
    source: '전산 견적/차감 자료 중 불량차감이 아닌 것',
    formula: '검역·취소·단가·부족·중복·출하오류·샘플·판매요청 등 불량차감 이외의 차감/가산 금액을 모두 더합니다.',
    kind: 'auto',
    note: '불량금액과 같은 표에서 오고, 코드값이 불량차감인지 아닌지로만 갈립니다.',
    fields: 'Estimate.Amount · CodeInfo.Descr2 <> N\'불량차감\'',
  },
  {
    key: 'P',
    label: '상품 금액(구매)',
    source: '구매금액(외화) × 환율',
    formula: '상품 금액(구매) = 구매금액(외화) × 환율',
    kind: 'calc',
    note: '환율을 바꾸면 이 값과 매입액·매출원가가 같이 바뀝니다.',
    fields: 'P = Q × R',
  },
  {
    key: 'Q',
    label: '구매금액(외화)',
    source: '입고관리에 등록된 입고 전표의 외화 금액 합계',
    formula: '같은 연도·같은 대차수의 입고 전표 금액을 나라·꽃 종류별로 더합니다. 운송료/SERVICE FEE 줄과 무게 줄은 빼는데, 운송료는 포워딩(USD) 칸에서 따로 세기 때문입니다.',
    kind: 'auto',
    note: '원화가 아니라 외화(달러·유로 등) 금액입니다. 원화는 옆의 상품 금액(구매)입니다.',
    fields: 'WarehouseDetail.TPrice · WarehouseMaster.OrderYear + OrderWeek + isDeleted=0',
  },
  {
    key: 'R',
    label: '환율',
    source: '① 그 차수 입고 청구서(BILL) 시점에 저장된 환율 → ② 29차부터는 전 차수 보고서에 저장된 과세환율 → ③ 통화마스터의 현재 환율',
    formula: '①은 그 차수 입고들의 환율을 구매금액으로 가중평균합니다. 세 가지가 다 없고 매입이나 포워딩 금액이 있으면 그 줄에 입력칸이 저절로 나타납니다.',
    kind: 'autoManual',
    note: '나라별 통화가 다릅니다 — 네덜란드 EUR, 호주 AUD, 중국 CNY, 일본 JPY, 나머지는 USD. 인보이스 환율과 다르면 직접 넣어 저장하세요. 넣은 값은 자동값이 아니라 저장된 입력값입니다.',
    fields: 'FreightCost.ExchangeRate → WebProfitReport.ColKey=R(전 차수) → CurrencyMaster.ExchangeRate',
  },
  {
    key: 'S',
    label: '포워딩(USD)',
    source: '입고관리 전표의 “운송료”/“SERVICE FEE” 줄을 자동으로 찾아 나라별로 합칩니다. [🚢 포워딩 입력]에서 고칠 수 있습니다.',
    formula: '같은 청구서 안의 꽃 품목 나라로 국가를 판정하고, 못 찾으면 농장명·인보이스 표기로 판정합니다. 콜롬비아는 인보이스의 “수국” 표기로 수국과 나머지 4품목을 나누고, 나머지 4품목은 세부차수 항공료 총액을 무게비율(무게=과금무게일 때) 또는 CBM비율로 나눠 담습니다.',
    kind: 'autoManual',
    note: '자동감지 자체가 아예 없을 때만 옛 추정식(청구서 과금무게 × 운임률 + 서류비를 품목 금액 비율로 나눔)을 씁니다. 새 농장이라 못 잡히면 직접 입력한 값이 우선합니다.',
    fields: 'WarehouseDetail(ProdName LIKE 운송료 / SERVICE FEE) / WebForwardingWeekly / WebColombiaWeekly.AirRateUSD',
  },
  {
    key: 'T',
    label: '포워딩 원화환산',
    source: '포워딩(USD) × 환율',
    formula: '포워딩 원화환산 = 포워딩(USD) × 환율',
    kind: 'calc',
    note: '포워딩은 통화가 달라도 이 표에서는 그 줄의 환율을 그대로 곱합니다.',
    fields: 'T = S × R',
  },
  {
    key: 'U',
    label: '상품구매비율',
    source: '이 화면 안에서만 계산',
    formula: '그 줄의 상품 금액(구매) ÷ 합계 상품 금액(구매)',
    kind: 'calc',
    note: '매출비율과 달리 이 합계에는 “공제” 줄이 빠집니다. 두 비율의 분모가 다른 것은 원본 양식 그대로입니다. 합계가 0이면 빈칸입니다.',
    fields: 'U = row.P / totals.P (totals.P는 공제 행 제외)',
  },
];

/** 표에 함께 나오지만 열이 아닌 값들 */
export const ROW_GUIDE = [
  {
    key: 'row-extra',
    label: '기타(미분류) 줄',
    source: '나라·꽃 종류 매칭에 실패한 전산 거래',
    formula: '매출·견적·입고·포워딩 각각에서 분류 안 된 금액을 모아 한 줄로 보여주고, 원본 품목 목록을 비고에 자동으로 적습니다.',
    kind: 'auto',
    note: '금액이 있으면 노란 배경으로 표시되고 검증 오류가 뜹니다. 품목의 나라/꽃 종류를 고쳐야 사라집니다.',
    fields: 'lib/profitReport.js unclassifiedDetailsByCategory / formatUnclassifiedNote',
  },
  {
    key: 'row-deduct',
    label: '공제 줄',
    source: '자동 원천 없음',
    formula: '전산에서 자동으로 채우는 값이 없습니다. [🛠 수기 보정]에서 넣은 기초/기말/통관비/환율/포워딩만 들어갑니다.',
    kind: 'manual',
    note: '합계에서 매출액·기초·기말·매출이익에는 포함되고, 매입·통관·원가 쪽 합계에서는 빠집니다(원본 양식 규칙).',
    fields: "CATEGORIES manualOnly=true · computeProfitTotals 의 nonDeduct 범위",
  },
  {
    key: 'row-total',
    label: '맨 아래 합계 줄',
    source: '위 줄들의 합',
    formula: '매출액·기초재고·기말재고·매출이익은 “공제” 줄까지 포함해 더하고, 나머지(매입·통관비·원가·불량·매출·구매·포워딩)는 “공제” 줄을 빼고 더합니다.',
    kind: 'calc',
    note: '합계의 이익률은 매출이익 ÷ (매출액 + 기말재고)입니다. 각 줄의 이익률을 평균낸 값이 아닙니다.',
    fields: 'lib/profitReportCalc.js computeProfitTotals',
  },
  {
    key: 'row-stockweeks',
    label: '재고 스냅샷 표기 (기말=27-02 처럼)',
    source: '전산 재고계산이 만든 재고 스냅샷',
    formula: '그 대차수에서 재고 자료가 실제로 있는 세부차수 중 번호가 가장 큰 것을 고릅니다. 같은 세부차수가 중복이면 품목 줄이 더 많은 쪽, 그 다음 키가 큰 쪽을 씁니다.',
    kind: 'auto',
    note: '27-03이 생기면 자동으로 27-03을 씁니다. 재고 마감표시가 “미확정”이어도 재고 자료가 있으면 그대로 사용합니다.',
    fields: 'StockMaster + ProductStock · latestStockSnapshotWeek()',
  },
  {
    key: 'row-note',
    label: '비고사항',
    source: '위쪽 노란 상자는 자동, 아래 입력칸은 사람이 씁니다.',
    formula: '노란 상자 [자동 미분류 내역]은 미분류 품목에서 자동 생성됩니다. 아래 칸에 쓴 글은 그 차수 보고서에 저장되고 엑셀에도 함께 나갑니다.',
    kind: 'autoManual',
    note: '2,000자까지 저장됩니다. 자동 문구는 저장 대상이 아니라 조회할 때마다 다시 만들어집니다.',
    fields: "WebProfitReport(Category='_note', ColKey='note')",
  },
];

/** 값이 들어오는 입력 화면 */
export const INPUT_GUIDE = [
  {
    key: 'in-weight',
    label: '중량 GW / CW (그외통관비 입력)',
    source: '입고관리 전표의 Gross weight / Chargeable weight 줄',
    formula: '같은 항공건(AWB) 안의 품목 나라로 국가를 정하고 무게를 더합니다. 무게 전용 줄이 없으면 입고 헤더의 총중량/과금중량을 대신 씁니다.',
    kind: 'auto',
    note: '무게 줄 자체는 금액이 아니므로 매출·매입·재고 계산에서는 모두 제외됩니다. 무게가 틀리면 [무게 수기교정]에서 고칩니다.',
    fields: 'WarehouseDetail(Gross/Chargeable weight) / WarehouseMaster.GrossWeight·ChargeableWeight',
  },
  {
    key: 'in-customs-split',
    label: '관세 · 선율 1/2/3 분할입력',
    source: '사람이 입력',
    formula: '관세와 선율은 1차·2차 각각 세 번까지 나눠 청구될 수 있어 1·2·3칸에 나눠 넣고, 서버가 합계를 다시 만들어 저장합니다.',
    kind: 'manual',
    note: '빈칸은 0으로 칩니다. 예전에 합계만 저장된 자료는 첫 칸에 그대로 보여 금액이 사라지지 않습니다.',
    fields: 'WebCustomsWeekly.Customs1_1~3 / Customs2_1~3 / SunYul1_1~3 / SunYul2_1~3',
  },
  {
    key: 'in-world',
    label: '월드운송료 (국내 트럭)',
    source: '입고 무게로 자동 등급 선택. 고치면 그 값이 우선합니다.',
    formula: '총중량 1,000kg 이하 → 1t 1대, 2,500kg 이하 → 2.5t 1대, 그보다 크면 5t 1대. 등급 단가는 단가표에서 관리합니다.',
    kind: 'autoManual',
    note: '입력 화면에는 부가세 뺀 금액으로 보이고, 통관비 합계에서도 ÷1.1로 반영됩니다. 자동값은 저장되지 않아 무게가 바뀌면 다시 계산됩니다.',
    fields: 'lib/colombiaTruck.js / WebCustomsRateConfig(Truck1t·Truck2_5t·Truck5t)',
  },
  {
    key: 'in-colombia',
    label: '콜롬비아 4품목 배분',
    source: '세부차수 단위 공유 입력값 + 입고 박스수',
    formula: '통관비는 항상 “박스당 무게 × 박스수” 비율로 나눕니다. 포워딩은 총중량과 과금중량이 같으면 무게비율, 다르면 CBM비율로 나눕니다.',
    kind: 'manualSource',
    note: '카네이션·장미·알스트로·루스커스만 해당됩니다. 콜롬비아 수국은 나라 단위로 따로 계산합니다.',
    fields: 'WebColombiaWeekly / WarehouseDetail.BoxQuantity / WebCustomsRateConfig(BoxWeight_·BoxCBM_)',
  },
  {
    key: 'in-stockprice',
    label: '재고단가표 (🏷)',
    source: '웹 전용 지정단가 → 수국 단가표 → 품목의 원가',
    formula: '재고 평가액 = 재고수량 × 적용단가 ÷ 1.1. 기말재고 자동계산이 매입 원천을 못 쓸 때 마지막으로 쓰이는 값입니다.',
    kind: 'autoManual',
    note: '여기서 지정한 단가는 그 품목에 계속 적용됩니다. 비우면 지정이 풀립니다.',
    fields: 'WebStockPrice.Price / Product.Cost',
  },
];

/** 차수 경계·기간 규칙 */
export const BOUNDARY_GUIDE = [
  {
    key: 'bd-begin-end',
    label: '기초 · 기말재고의 차수 경계',
    source: '전산 재고 스냅샷',
    formula: '27차 기초재고는 26차의 마지막 세부차수 재고, 기말재고는 27차의 마지막 세부차수 재고를 씁니다. 01차일 때만 전년도 52차를 전 차수로 봅니다.',
    kind: 'auto',
    note: '“마지막 세부차수”는 재고 자료가 실제로 있는 세부차수 중 번호가 가장 큰 것입니다. 재고 마감표시(isFix)는 고르는 조건이 아니라 참고 표시로만 보여줍니다.',
    fields: 'pages/api/sales/profit-report.js prevMajor / latestStockSnapshotWeek()',
  },
  {
    key: 'bd-rate-29',
    label: '29차부터의 환율 상속',
    source: '전 차수 보고서에 저장된 과세환율',
    formula: '29차 이후 차수에서 그 주 입고 청구서의 환율 스냅샷이 없으면, 전 차수에 저장해 둔 과세환율을 먼저 물려받고, 그것도 없을 때만 통화마스터의 현재 환율을 씁니다.',
    kind: 'auto',
    note: '28차 이하에서는 이 상속이 동작하지 않고 청구서 환율 → 통화마스터 순서만 씁니다.',
    fields: 'currentMajor >= 29 && 전차수 WebProfitReport.R > 0',
  },
  {
    key: 'bd-country-start',
    label: '나라별 입력 시작 차수',
    source: '업무 기준',
    formula: '호주는 28차부터, 베트남은 29차부터 통관비·환율 원천을 검증합니다.',
    kind: 'auto',
    note: '시작 차수 전에는 값이 비어 있어도 정상이라 검증 경고를 만들지 않습니다. 매출·매입·재고를 0으로 만드는 규칙이 아닙니다.',
    fields: 'lib/profitReportAudit.js SOURCE_ENTRY_START_MAJOR',
  },
  {
    key: 'bd-monthly',
    label: '월별 보기의 달 배정',
    source: '전산 차수 달력(PeriodDay)',
    formula: '한 차수의 날짜가 모두 같은 달이면 그 달에 넣고, 두 달에 걸치면 끝나는 날이 속한 달에 차수 전체를 한 번만 넣습니다.',
    kind: 'auto',
    note: '기초·기말재고는 달 단위로 다시 계산하거나 더하지 않습니다. 차수 달력이 없는 차수는 0으로 세지 않고 “기간 확인 필요”로 남깁니다.',
    fields: 'PeriodDay.OrderYearWeek + BaseYmd · lib/profitReportMonthly.js',
  },
];

/** 화면 섹션 순서 — 컴포넌트와 테스트가 공유 */
export const GUIDE_SECTIONS = [
  { id: 'columns', title: '표에 보이는 항목', rows: COLUMN_GUIDE },
  { id: 'rows', title: '표에 함께 나오는 줄·값', rows: ROW_GUIDE },
  { id: 'inputs', title: '값이 만들어지는 입력 화면', rows: INPUT_GUIDE },
  { id: 'boundary', title: '차수·기간 경계 규칙', rows: BOUNDARY_GUIDE },
];

export const ALL_GUIDE_ROWS = GUIDE_SECTIONS.flatMap((section) => section.rows);
