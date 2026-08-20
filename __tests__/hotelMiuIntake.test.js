// 호텔+미우 주문입력 계약 테스트
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  batchQtyDelta,
  mergeBoardMappings,
  nextBatchNo,
  overlayMappingRecord,
  parseHotelMiuText,
  isDraftBatch,
  mergeAllBatchLines,
  batchLineTotal,
  hotelMiuWeekOptions,
  pickHotelMiuCustomer,
  resolveHotelMiuDefaultVendors,
  HOTEL_MIU_BATCH_DRAFT,
  HOTEL_MIU_DEFAULT_VENDOR_LABELS,
} from '../lib/hotelMiuIntake.js';
import { normalizeImportUnit } from '../lib/orderImportUnits.js';

function sampleText(kind) {
  if (kind === 'header3') {
    return ['품명\t단위\t수량', '수국 화이트\t대\t220', '장미 레드\t단\t15'].join('\n');
  }
  if (kind === 'header2') {
    return ['품명\t수량', '수국 화이트\t220'].join('\n');
  }
  if (kind === 'index') {
    return ['1\t수국 화이트\t대\t220', '2\t장미 레드\t단\t15'].join('\n');
  }
  return ['수국 화이트\t220', '장미 레드 15'].join('\n');
}

const parsed3 = parseHotelMiuText(sampleText('header3'));
assert.ok(parsed3.rows.length >= 2, '3열 헤더 표에서 행을 읽어야 한다.');
const hydrangea = parsed3.rows.find((r) => /수국/.test(r.inputName));
assert.ok(hydrangea, '수국 행이 있어야 한다.');
assert.equal(Number(hydrangea.qty), 220);
assert.equal(normalizeImportUnit(hydrangea.unit), '박스', '대는 박스로 환산한다.');

const parsed2 = parseHotelMiuText(sampleText('header2'));
assert.ok(parsed2.rows.some((r) => /수국/.test(r.inputName) && Number(r.qty) === 220), '2열 표도 품명+수량을 읽는다.');

const parsedIdx = parseHotelMiuText(sampleText('index'));
assert.ok(parsedIdx.rows.some((r) => /수국/.test(r.inputName) && Number(r.qty) === 220), '행 번호 열은 수량이 아니다.');

const parsedLoose = parseHotelMiuText(sampleText('loose'));
assert.ok(parsedLoose.rows.some((r) => /수국/.test(r.inputName) && Number(r.qty) === 220), '헤더 없는 붙여넣기도 읽는다.');

const overlay = overlayMappingRecord('수국 화이트', { ProdKey: 99, ProdName: '수국화이트', DisplayName: '수국 화이트' }, '대');
assert.equal(overlay.value.prodKey, 99);
assert.equal(overlay.value.source, 'hotel-miu-board');
assert.equal(overlay.value.unit, '박스');

const merged = mergeBoardMappings(
  { [overlay.token]: { prodKey: 1, prodName: '공통매핑', source: 'global' } },
  { [overlay.token]: overlay.value },
);
assert.equal(merged[overlay.token].prodKey, 99, '게시판 overlay가 공통 order-mappings를 덮는다.');
assert.equal(merged[overlay.token].source, 'hotel-miu-board');

const delta = batchQtyDelta(
  [{ prodKey: 10, prodName: '수국', displayName: '수국', qty: 220, unit: '박스' }],
  [{ prodKey: 10, prodName: '수국', displayName: '수국', qty: 200, unit: '박스' }],
);
assert.equal(delta.length, 1);
assert.equal(delta[0].qty, -20);

const addDelta = batchQtyDelta(
  [{ prodKey: 10, prodName: '수국', displayName: '수국', qty: 220, unit: '박스' }],
  [{ prodKey: 10, prodName: '수국', displayName: '수국', qty: 250, unit: '박스' }],
);
assert.equal(addDelta[0].qty, 30);
assert.equal(nextBatchNo([{ batchNo: 1 }, { BatchNo: 2 }]), 3);
assert.equal(isDraftBatch({ status: HOTEL_MIU_BATCH_DRAFT }), true);
assert.equal(isDraftBatch({ status: 'REGISTERED' }), false);
assert.equal(batchLineTotal([{ qty: 6 }, { qty: 12 }]), 18);
assert.equal(mergeAllBatchLines([
  { lines: [{ prodKey: 1, prodName: 'A', qty: 6, unit: '단' }] },
  { lines: [{ prodKey: 1, prodName: 'A', qty: 6, unit: '단' }] },
])[0].qty, 12);

assert.deepEqual(HOTEL_MIU_DEFAULT_VENDOR_LABELS, ['라움', '신라', '쵸이문', '미우']);
const weekOpts = hotelMiuWeekOptions('2026-34-01');
assert.equal(weekOpts.length, 4);
assert.deepEqual(weekOpts.map((w) => w.week), ['34-01', '34-02', '34-03', '34-04']);
assert.equal(weekOpts[0].year, '2026');
assert.equal(weekOpts[0].isDefault, true);
assert.deepEqual(hotelMiuWeekOptions('2026-34-03').map((w) => w.week), ['34-03', '34-04', '35-01', '35-02']);
assert.deepEqual(hotelMiuWeekOptions('2026-52-04').map((w) => `${w.year}-${w.week}`), [
  '2026-52-04', '2027-01-01', '2027-01-02', '2027-01-03',
]);

const sampleCusts = [
  { CustKey: 680, CustName: '트라움에스앤씨' },
  { CustKey: 656, CustName: '신라호텔' },
  { CustKey: 900, CustName: '신라/중-화' },
  { CustKey: 12, CustName: '쵸이문' },
  { CustKey: 77, CustName: '미우' },
  { CustKey: 88, CustName: '미우플라워' },
  { CustKey: 456, CustName: '아이엠' },
];
assert.equal(pickHotelMiuCustomer(sampleCusts, '라움').custKey, 680);
assert.equal(pickHotelMiuCustomer(sampleCusts, '신라').custKey, 656);
assert.equal(pickHotelMiuCustomer(sampleCusts, '쵸이문').custKey, 12);
assert.equal(pickHotelMiuCustomer(sampleCusts, '미우').custKey, 77);
assert.equal(pickHotelMiuCustomer(sampleCusts, '미우').custName, '미우');
assert.equal(resolveHotelMiuDefaultVendors(sampleCusts).map((v) => v.custKey).join(','), '680,656,12,77');
assert.equal(pickHotelMiuCustomer([{ CustKey: 456, CustName: '아이엠' }], '미우'), null);

const page = fs.readFileSync('pages/sales/shilla-miu-board.js', 'utf8');
assert.doesNotMatch(page, /from ['"].*components\/Layout['"]/);
assert.doesNotMatch(page, /<Layout/);
assert.match(page, /호텔\+미우 통합게시판/);
assert.match(page, /source: 'hotel-miu-board'/);
assert.match(page, /\/api\/orders/);
assert.match(page, /status: HOTEL_MIU_BATCH_DRAFT/);
assert.match(page, /action: 'recordBatch'/);
assert.match(page, /action: 'markRegistered'/);
assert.match(page, /stopPropagation/);
assert.match(page, /pasteLock/);
assert.match(page, /합산으로 저장/);
assert.equal((page.match(/onPaste=\{onPaste\}/g) || []).length, 1, '붙여넣기는 페이지에 한 번만 붙인다');
assert.ok(page.indexOf("action: 'recordBatch'") < page.indexOf('/api/orders') || page.includes('saveToVendor'), '합산 저장이 주문등록보다 앞선다');
assert.match(page, /HOTEL_MIU_FAVORITE_PAGE/);
assert.match(page, /year, week/);
assert.match(page, /resolveHotelMiuDefaultVendors/);
assert.match(page, /hotelMiuWeekOptions/);
assert.match(page, /라움/);
assert.match(page, /신라/);
assert.match(page, /쵸이문/);
assert.match(page, /미우/);
assert.match(page, /\+ 추가/);
assert.doesNotMatch(page, /업체 이름 검색/);
assert.doesNotMatch(page, /placeholder="33-01"/);
assert.match(page, /href="\/sales\/shilla-miu-allocation"/);
assert.match(page, /잔량분배표/);
assert.doesNotMatch(page, /persistImportMatchMappings\(/);
assert.doesNotMatch(page, /ensureShipmentMaster/);

const parseApi = fs.readFileSync('pages/api/sales/hotel-miu-parse.js', 'utf8');
assert.match(parseApi, /mergeBoardMappings\(loadMappings\(true\), overlay\)/);
assert.match(parseApi, /rankJamoCandidates/);
assert.doesNotMatch(parseApi, /from ['"].*persistImportMappings['"]/);
assert.doesNotMatch(parseApi, /persistImportMatchMappings\(/);
assert.doesNotMatch(parseApi, /saveMapping\(/);

const intakeApi = fs.readFileSync('pages/api/sales/hotel-miu-intake.js', 'utf8');
assert.match(intakeApi, /WebHotelMiuProductMap/);
assert.match(intakeApi, /WebHotelMiuIntakeBatch/);
assert.match(intakeApi, /HOTEL_MIU_BATCH_DRAFT/);
assert.match(intakeApi, /action === 'markRegistered'/);
assert.match(intakeApi, /Status=@st/);
assert.doesNotMatch(intakeApi, /INSERT INTO Order(?:Master|Detail)/);
assert.doesNotMatch(intakeApi, /INSERT INTO Shipment/);
assert.doesNotMatch(intakeApi, /from ['"].*persistImportMappings['"]/);
assert.doesNotMatch(intakeApi, /persistImportMatchMappings\(/);

const orderApi = fs.readFileSync('pages/api/orders/index.js', 'utf8');
assert.match(orderApi, /ensureShipmentMaster = String\(source \|\| ''\)\.toLowerCase\(\) === 'raum-pnl'/);
assert.match(orderApi, /const isDelta = true/);

const alloc = fs.readFileSync('pages/sales/shilla-miu-allocation.js', 'utf8');
assert.match(alloc, /href="\/sales\/shilla-miu-board"/);
assert.match(alloc, /주문입력/);
assert.match(alloc, /잔량분배표/);

const layout = fs.readFileSync('components/Layout.js', 'utf8');
assert.match(layout, /href: '\/sales\/shilla-miu-board'/);
assert.match(layout, /호텔\+미우 통합게시판/);

const contract = JSON.parse(fs.readFileSync('docs/contracts/hotel-miu-intake.json', 'utf8'));
assert.equal(contract.id, 'hotel-miu-intake');
assert.deepEqual(contract.businessIdentity, ['OrderYear', 'OrderWeek', 'CustKey', 'ProdKey']);
assert.ok(contract.crossYearFixture.required);
assert.equal(contract.actions.find((a) => a.name === 'REGISTER_ORDER_ADD').orderDetail, 'create-positive');
assert.equal(contract.actions.find((a) => a.name === 'REGISTER_ORDER_ADD').shipmentDetail, 'preserve');
assert.equal(contract.actions.find((a) => a.name === 'REVISE_BATCH_DECREASE').orderDetail, 'decrease');

const boardContract = JSON.parse(fs.readFileSync('docs/contracts/shilla-miu-board.json', 'utf8'));
assert.ok(boardContract.scope.includes('pages/sales/shilla-miu-allocation.js'));
assert.ok(!boardContract.scope.includes('pages/sales/shilla-miu-board.js'));

const migration = fs.readFileSync('docs/migrations/2026-08-19_web_hotel_miu_intake.sql', 'utf8');
assert.match(migration, /CREATE TABLE dbo\.WebHotelMiuIntakeBatch/);
assert.match(migration, /CREATE TABLE dbo\.WebHotelMiuProductMap/);
assert.match(migration, /OrderYear NVARCHAR\(4\)/);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(pkg.scripts['test:erp-contract'], /hotelMiuIntake\.test\.js/);

console.log('hotelMiuIntake tests passed');
