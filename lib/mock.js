// lib/mock.js — 전체 화면 모의 데이터
// API 연결 전까지 이 데이터로 UI 개발

export const CURRENT_WEEK = '13-01';
export const CURRENT_YEAR = '2026';

export const customers = [
  { id: 1, code: '0000000379', name: '(주)미카엘플라워', area: '양재동', ceo: '나우석', manager: '박성수', tel: '02-3461-5118', mobile: '010-3793-8989', outDay: '금요일', orderCode: 'CL22' },
  { id: 2, code: '0000000549', name: '(재)FITI시험연구원', area: '경부선', ceo: '전재구', manager: '변진형', tel: '', mobile: '', outDay: '수요일', orderCode: 'CL10' },
  { id: 3, code: '8568103020', name: '주광농원', area: '경부선', ceo: '김원영', manager: '김원영', tel: '', mobile: '', outDay: '수요일', orderCode: 'CL2' },
  { id: 4, code: '0000000363', name: '(주)과일랜드', area: '경부선', ceo: '김성기,김덕식', manager: '변진형', tel: '02-2640-7990', mobile: '', outDay: '목요일', orderCode: 'CL3' },
  { id: 5, code: '0000000334', name: '(주)광주종합렌탈', area: '지방', ceo: '김석균', manager: '변진형', tel: '', mobile: '', outDay: '금요일', orderCode: 'CL5' },
  { id: 6, code: '0000000001', name: '(주)네노바', area: '양재동', ceo: '', manager: '', tel: '134-86-94367', mobile: '', outDay: '', orderCode: '' },
  { id: 7, code: '0000000462', name: '(주)동광해운', area: '경부선', ceo: '김화수', manager: '변진형', tel: '', mobile: '', outDay: '월요일', orderCode: 'CL12' },
  { id: 8, code: '0000000222', name: '(주)명진후르츠', area: '양재동', ceo: '오영석', manager: '박성수', tel: '02-443-3064', mobile: '', outDay: '화요일', orderCode: 'CL8' },
  { id: 9, code: '0000000019', name: '소재2호', area: '양재동', ceo: '박기철', manager: '박성수', tel: '032-744-8435', mobile: '', outDay: '수요일', orderCode: 'CL9' },
  { id: 10, code: '0000000060', name: '(주)상경로지스틱', area: '경부선', ceo: '김기정', manager: '변진형', tel: '', mobile: '', outDay: '화요일', orderCode: 'CL15' },
];

export const products = [
  { id: 2306, code: 'CAR01-CO0001', name: 'CARNATION Doncel',     flower: '카네이션', country: '콜롬비아', cost: 300, unit: '박스', bunchPerBox: 15, steamPerBunch: 20 },
  { id: 2851, code: 'CAR01-CO0002', name: 'CARNATION Moon Light', flower: '카네이션', country: '콜롬비아', cost: 300, unit: '박스', bunchPerBox: 15, steamPerBunch: 20 },
  { id: 2515, code: 'CAR01-CO0003', name: 'CARNATION Novia',      flower: '카네이션', country: '콜롬비아', cost: 300, unit: '박스', bunchPerBox: 15, steamPerBunch: 20 },
  { id: 2744, code: 'CAR01-CO0004', name: 'CARNATION Pride',      flower: '카네이션', country: '콜롬비아', cost: 300, unit: '박스', bunchPerBox: 15, steamPerBunch: 20 },
  { id: 3001, code: 'ROS01-CO0001', name: 'ROSE / Freedom 50cm',  flower: '장미',    country: '콜롬비아', cost: 100, unit: '단',   bunchPerBox: 30, steamPerBunch: 10 },
  { id: 3002, code: 'ROS01-EC0001', name: 'Ecuador Electric MO',  flower: '장미',    country: '에콰도르', cost: 2400, unit: '송이', bunchPerBox: 1,  steamPerBunch: 1  },
  { id: 4001, code: 'HYD01-CO0001', name: 'Hydrangea Blue (블루)', flower: '수국',    country: '콜롬비아', cost: 30,  unit: '박스', bunchPerBox: 1,  steamPerBunch: 1  },
  { id: 4002, code: 'ALS01-CO0001', name: 'ALSTROMERIA Whistler', flower: '알스트로', country: '콜롬비아', cost: 160, unit: '단',   bunchPerBox: 16, steamPerBunch: 10 },
  { id: 5001, code: 'ACA01-NL0001', name: 'Acacia / Chiara de Luna', flower: '아카시아', country: '네달란드', cost: 0, unit: '단', bunchPerBox: 1, steamPerBunch: 1 },
];

export const orders = [
  {
    id: 1001, week: '13-01', year: '2026', date: '2026-03-24', manager: '김원영',
    custName: '주광농원', custArea: '경부선', orderCode: 'CL2',
    items: [
      { prodId: 2306, prodName: 'CARNATION Doncel',      qty: 3,  unit: '박스', stock: 30 },
      { prodId: 2851, prodName: 'CARNATION Moon Light',  qty: 20, unit: '박스', stock: 173 },
      { prodId: 2515, prodName: 'CARNATION Novia',       qty: 6,  unit: '박스', stock: 61 },
    ],
  },
  {
    id: 1002, week: '13-01', year: '2026', date: '2026-03-24', manager: '박성수',
    custName: '(주)미카엘플라워', custArea: '양재동', orderCode: 'CL22',
    items: [
      { prodId: 2306, prodName: 'CARNATION Doncel',  qty: 2, unit: '박스', stock: 30 },
      { prodId: 4001, prodName: 'Hydrangea Blue',    qty: 1, unit: '박스', stock: 40 },
      { prodId: 3001, prodName: 'ROSE / Freedom 50cm', qty: 5, unit: '단', stock: 120 },
    ],
  },
  {
    id: 1003, week: '13-01', year: '2026', date: '2026-03-25', manager: '변진형',
    custName: '소재2호', custArea: '양재동', orderCode: 'CL9',
    items: [
      { prodId: 2744, prodName: 'CARNATION Pride',    qty: 10, unit: '박스', stock: 50 },
      { prodId: 4002, prodName: 'ALSTROMERIA Whistler', qty: 8, unit: '단', stock: 200 },
    ],
  },
];

export const shipmentData = [
  { id: 1, week: '13-01', custName: '주광농원', custArea: '경부선', manager: '김원영', totalQty: 604, isFix: false,
    items: [
      { prodName: 'CARNATION Doncel', unit: '박스', outDate: '2026-04-02', box: 3, bunch: 0, steam: 0, qty: 3 },
      { prodName: 'CARNATION Moon Light', unit: '박스', outDate: '2026-04-02', box: 20, bunch: 0, steam: 0, qty: 20 },
      { prodName: 'CARNATION Novia', unit: '박스', outDate: '2026-04-02', box: 6, bunch: 0, steam: 0, qty: 6 },
    ]
  },
  { id: 2, week: '13-01', custName: '(주)미카엘플라워', custArea: '양재동', manager: '박성수', totalQty: 68, isFix: false, items: [] },
  { id: 3, week: '13-01', custName: '소재2호', custArea: '양재동', manager: '박성수', totalQty: 403, isFix: true, items: [] },
  { id: 4, week: '13-01', custName: '아이엠', custArea: '양재동', manager: '박성수', totalQty: 64, isFix: false, items: [] },
  { id: 5, week: '13-01', custName: '신라호텔', custArea: '경부선', manager: '변진형', totalQty: 350, isFix: true, items: [] },
  { id: 6, week: '13-01', custName: '일신원예', custArea: '경부선', manager: '변진형', totalQty: 41, isFix: false, items: [] },
];

export const stockItems = [
  { prodId: 2306, prodName: 'CARNATION Doncel',      flower: '카네이션', country: '콜롬비아', unit: '박스', prevStock: 0,  inQty: 30,  outQty: 27, adjQty: 0, stock: 3 },
  { prodId: 2851, prodName: 'CARNATION Moon Light',  flower: '카네이션', country: '콜롬비아', unit: '박스', prevStock: 5,  inQty: 173, outQty: 130, adjQty: 0, stock: 48 },
  { prodId: 2515, prodName: 'CARNATION Novia',       flower: '카네이션', country: '콜롬비아', unit: '박스', prevStock: 11, inQty: 61,  outQty: 47, adjQty: 0, stock: 25 },
  { prodId: 2744, prodName: 'CARNATION Yukari Cherry',flower: '카네이션', country: '콜롬비아', unit: '박스', prevStock: 0,  inQty: 30,  outQty: 30, adjQty: 0, stock: 0 },
  { prodId: 4001, prodName: 'Hydrangea Blue (블루)',  flower: '수국',     country: '콜롬비아', unit: '박스', prevStock: 0,  inQty: 40,  outQty: 40, adjQty: 0, stock: 0 },
  { prodId: 4002, prodName: 'ALSTROMERIA Whistler',  flower: '알스트로', country: '콜롬비아', unit: '단',   prevStock: 10, inQty: 200, outQty: 160, adjQty: -5, stock: 45 },
  { prodId: 3001, prodName: 'ROSE / Freedom 50cm',   flower: '장미',     country: '콜롬비아', unit: '단',   prevStock: 0,  inQty: 120, outQty: 95, adjQty: 0, stock: 25 },
  { prodId: 5001, prodName: 'Acacia / Chiara de Luna', flower: '아카시아', country: '네달란드', unit: '단',  prevStock: 0,  inQty: 0,   outQty: 0,  adjQty: 0, stock: 0 },
];

export const salesByArea = [
  { area: '경부선', curSales: 105681962, prevSales: 103116325, growth: 2.49 },
  { area: '양재동', curSales:  71110489, prevSales:  78399634, growth: -9.30 },
  { area: '지방',   curSales:  56808673, prevSales:  59149749, growth: -3.96 },
  { area: '호남선', curSales:  42976131, prevSales:  51697714, growth: -16.87 },
];

export const topCustomers = [
  { rank: 1, area: '경부선', custName: '주광농원',          curSales: 521161032, prevSales: 229417173, growth: 127.17 },
  { rank: 2, area: '양재동', custName: '아이엠',             curSales: 142633129, prevSales:  62364773, growth: 128.71 },
  { rank: 3, area: '호남선', custName: '일신원예',           curSales: 101175650, prevSales:  80376791, growth: 25.88 },
  { rank: 4, area: '경부선', custName: '소재2호',            curSales:  79841542, prevSales:  58983182, growth: 35.36 },
  { rank: 5, area: '경부선', custName: '일신원예',           curSales:  70876869, prevSales:  36955474, growth: 91.79 },
  { rank: 6, area: '양재동', custName: '꽃길',               curSales:  56528643, prevSales:  31525690, growth: 79.31 },
  { rank: 7, area: '경부선', custName: '중앙화훼유통',        curSales:  50710912, prevSales:   9801363, growth: 417.39 },
  { rank: 8, area: '양재동', custName: '그린화원',           curSales:  50075915, prevSales:  29701134, growth: 68.60 },
];

export const managerSales = [
  { manager: '변진형', custName: '소재2호',       area: '경부선', curSales: 18330182, prevSales: 13248636, growth: 38.36 },
  { manager: '변진형', custName: '중앙화훼유통',   area: '경부선', curSales:  6632727, prevSales:  6548182, growth:  1.29 },
  { manager: '김원영', custName: '주광농원',       area: '경부선', curSales: 49468679, prevSales: 55350951, growth: -10.63 },
  { manager: '박성수', custName: '(주)미카엘플라워', area: '양재동', curSales:  3696134, prevSales:  3834090, growth:  -3.60 },
  { manager: '박성수', custName: '그린화원',       area: '양재동', curSales:  6584546, prevSales:  7006819, growth:  -6.03 },
  { manager: '박성수', custName: '꽃길',           area: '양재동', curSales:  6664775, prevSales:  7860003, growth: -15.21 },
  { manager: '박성수', custName: '소재2호',        area: '양재동', curSales:  3968638, prevSales:  5097046, growth: -22.14 },
];

export const estimateItems = [
  { prodName: 'ALSTROMERIA Fifi Butterplus', unit: '송이', outDate: '05(일)', qty: 960, cost: 650, supply: 567273, vat: 56727 },
  { prodName: 'ALSTROMERIA Lavender',        unit: '송이', outDate: '05(일)', qty: 160, cost: 650, supply: 94545, vat: 9455 },
  { prodName: 'ALSTROMERIA Whistler',        unit: '송이', outDate: '05(일)', qty: 1600, cost: 650, supply: 945455, vat: 94545 },
  { prodName: 'Ecuador Channel AS154',       unit: '송이', outDate: '05(일)', qty: 200, cost: 2400, supply: 436364, vat: 43636 },
  { prodName: 'Ecuador Electric MO AS295',   unit: '송이', outDate: '05(일)', qty: 400, cost: 2400, supply: 872727, vat: 87273 },
  { prodName: 'ROSE CHINA / 프라우드',        unit: '단',   outDate: '05(일)', qty: 10, cost: 11500, supply: 104545, vat: 10455 },
  { prodName: 'CHINA / 백합 화이트',          unit: '단',   outDate: '05(일)', qty: 50, cost: 17500, supply: 795455, vat: 79545 },
];

export const warehouseItems = [
  { country: '네달란드', flower: '스키미아', prodName: 'Skimmia / Conf Kew Ger…', cn: 'CL3',  dates: { '2025-11-28': 156 } },
  { country: '네달란드', flower: '아마릴리스', prodName: 'Amaryllis / Red Lion12st', cn: 'CL10', dates: { '2025-11-28': 156 } },
  { country: '에콰도르', flower: '장미', prodName: 'Ecuador Channel AS154',  cn: 'CL2', dates: {} },
  { country: '에콰도르', flower: '장미', prodName: 'Ecuador Electric MO AS295', cn: 'CL2', dates: {} },
  { country: '콜롬비아', flower: '카네이션', prodName: 'CARNATION Moon Light', cn: 'CL2', dates: {} },
];
