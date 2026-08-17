import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseOrderImportMetadata, parseOrderImportSheetRows } from '../lib/orderImportParse.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal } from '../lib/orderShipmentList.js';

const meta = parseOrderImportMetadata([['남대문청화 35차 예상 출고리스트(8월30일 출고)']]);
assert.deepEqual(meta, { customerName:'남대문청화', majorWeek:'35' });
const matchedCustomer = resolveImportCustomer('남대문청화', [
  { CustKey: 77, CustName: '남대문 청화', CustCode: '', OrderCode: '', CustArea: '' },
], { savedMappings: {} });
assert.equal(matchedCustomer.custKey, 77, '붙여넣기와 같은 정규화 규칙으로 공백이 다른 업체명을 매칭해야 한다');
const parsedOrderRows = parseOrderImportSheetRows([
  ['품 명', '칼 라', '주문수량', '출고수량', '단가', '비 고'],
  ['콜롬비아 장미\n*50cm', '프리덤', 20, null, 12700, null],
  ['주말도착건', '프리덤', 10, null, 12700, '9/1 화요일 출고'],
  [null, '수국 블루', 1, null, 2800, null],
  [null, '합계(박스)', 31, 0, '단 단가', null],
], { sourceName:'남대문청화 fixture' }).rows;
assert.equal(parsedOrderRows.length, 2, '품명 세부정보와 합계행은 별도 주문 품목이 아니어야 한다');
assert.equal(parsedOrderRows[0].inputName, '프리덤');
assert.equal(parsedOrderRows[0].qty, 30, '같은 실제 품목의 수량은 합산해야 한다');
assert.deepEqual(parsedOrderRows[0].detailLabels, ['콜롬비아 장미 *50cm', '주말도착건']);
assert.equal(parsedOrderRows[1].inputName, '수국 블루', '주말도착건은 수국 블루의 매칭어에 포함되면 안 된다');
const rows = initializeShipDateAllocations([{prodKey:1,qty:5,unit:'박스'}], '2026-35-01', {1:'2026-08-30',2:'2026-09-01'});
assert.deepEqual(rows[0].allocations, {'2026-08-30':5});
const moved = moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 2);
assert.deepEqual(moved.allocations, {'2026-08-30':3,'2026-09-01':2});
assert.equal(allocationTotal(moved), 5);
assert.throws(()=>moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 6), /초과/);
const api = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/shipment-list-source.js'),'utf8');
assert.match(api,/om\.OrderYear=@year AND om\.OrderWeek=@week AND om\.CustKey=@ck/);
assert.match(api,/sm\.OrderYear=@year AND sm\.OrderWeek=@week AND sm\.CustKey=@ck/);
const parseApi = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/import-parse.js'),'utf8');
assert.match(parseApi,/resolveImportCustomer\(parsedMetadata\.customerName/);
const page = fs.readFileSync(path.join(process.cwd(),'pages/orders/import.js'),'utf8');
assert.ok(page.indexOf('1. 파일을 드래그하거나 클릭하여 업로드') < page.indexOf('2. 자동 매칭 결과 확인'), '업로드가 거래처·차수 매칭보다 먼저 보여야 한다');
assert.ok(page.indexOf('📥 출고리스트 엑셀 만들기') < page.indexOf('품목 매칭 결과'), '출고리스트 생성 UI가 품목 매칭표보다 위에 있어야 한다');
console.log('order shipment list tests passed');
