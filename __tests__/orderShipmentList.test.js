import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseOrderImportMetadata, parseOrderImportSheetRows } from '../lib/orderImportParse.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal } from '../lib/orderShipmentList.js';
import { clearImportProductMatchForName, matchImportRows } from '../lib/orderImportMatch.js';

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
assert.equal(parsedOrderRows[0].matchName, '콜롬비아 장미 50cm 프리덤', '국가·화종·규격 문맥을 유지해 동명 품목 오매칭을 막아야 한다');
assert.equal(parsedOrderRows[0].qty, 30, '같은 실제 품목의 수량은 합산해야 한다');
assert.deepEqual(parsedOrderRows[0].detailLabels, ['콜롬비아 장미 *50cm', '주말도착건']);
assert.equal(parsedOrderRows[1].inputName, '수국 블루', '주말도착건은 수국 블루의 매칭어에 포함되면 안 된다');
const rows = initializeShipDateAllocations([{prodKey:1,qty:5,unit:'박스'}], '2026-35-01', {1:'2026-08-30',2:'2026-09-01'});
assert.deepEqual(rows[0].allocations, {'2026-08-30':5});
const moved = moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 2);
assert.deepEqual(moved.allocations, {'2026-08-30':3,'2026-09-01':2});
assert.equal(allocationTotal(moved), 5);
assert.throws(()=>moveShipmentQuantity(rows[0], '2026-08-30', '2026-09-01', 6), /초과/);
const roseProducts = [
  { ProdKey: 101, ProdName: 'ROSE / Freedom 50cm', DisplayName: '장미 프리덤', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
  { ProdKey: 202, ProdName: 'ROSE / Freedom Select 50cm', DisplayName: '장미 프리덤 셀렉트', FlowerName: '장미', CounName: '콜롬비아', OutUnit: '단' },
];
const rematched = matchImportRows([{ rowNo:1, inputName:'장미 프리덤', qty:10, unit:'단' }], {
  allProducts: roseProducts,
  productByKey: new Map(roseProducts.map(p => [p.ProdKey, p])),
  prodUnitMap: {},
  unitCatalog: {},
  savedMappings: {
    '장미 프리덤': { prodKey:202, prodName:roseProducts[1].ProdName, displayName:roseProducts[1].DisplayName, flowerName:'장미', counName:'콜롬비아', unit:'단' },
  },
});
assert.equal(rematched[0].prodKey, 202, '사용자가 저장한 업로드 품목 매핑은 장미 자동 후보 재정렬보다 우선해야 한다');
assert.equal(rematched[0].fromMapping, true, '재업로드 결과는 저장매핑 사용 상태를 표시해야 한다');
const renamed = clearImportProductMatchForName({ inputName:'블루', matchName:'수국 블루', prodKey:3086, suggestedProducts:[{prodKey:3086}] }, '화이트');
assert.equal(renamed.matchName, '수국 화이트', '입력 품목명을 바꾸면 화종 문맥은 유지해야 한다');
assert.equal(renamed.prodKey, null, '입력 품목명을 바꾸면 이전 품목 매칭을 즉시 해제해야 한다');
assert.deepEqual(renamed.suggestedProducts, [], '입력 품목명을 바꾸면 이전 추천 후보를 재사용하면 안 된다');
const api = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/shipment-list-source.js'),'utf8');
assert.match(api,/om\.OrderYear=@year AND om\.OrderWeek=@week AND om\.CustKey=@ck/);
assert.match(api,/sm\.OrderYear=@year AND sm\.OrderWeek=@week AND sm\.CustKey=@ck/);
const parseApi = fs.readFileSync(path.join(process.cwd(),'pages/api/orders/import-parse.js'),'utf8');
assert.match(parseApi,/resolveImportCustomer\(parsedMetadata\.customerName/);
assert.match(parseApi, /mergeCustomerProductMappings\(globalMappings, custKey, true\)/,
  '업로드 파싱은 선택·자동매칭된 업체의 품목 매칭을 공용매칭보다 우선해야 한다');
const persistSource = fs.readFileSync(path.join(process.cwd(),'lib/persistImportMappings.js'),'utf8');
assert.match(persistSource, /mappingMatchType === 'manual'[\s\S]*it\.fromMapping && it\.mappingScope !== 'customer'/,
  '자동 추론 결과는 저장매핑으로 강제 학습하지 않아야 한다');
assert.doesNotMatch(persistSource, /confidenceLabel === 'high'/,
  '신뢰도만으로 자동 매칭을 영구 저장하면 오매칭이 자기강화된다');
const page = fs.readFileSync(path.join(process.cwd(),'pages/orders/import.js'),'utf8');
assert.ok(page.indexOf('1. 파일을 드래그하거나 클릭하여 업로드') < page.indexOf('2. 자동 매칭 결과 확인'), '업로드가 거래처·차수 매칭보다 먼저 보여야 한다');
assert.ok(page.indexOf('📥 출고리스트 엑셀 만들기') < page.indexOf('품목 매칭 결과'), '출고리스트 생성 UI가 품목 매칭표보다 위에 있어야 한다');
assert.match(page, /const saved = onPersistMapping \? await onPersistMapping\(row, prod\) : true;/,
  '품목 선택 UI는 서버 저장매핑 완료를 기다린 뒤 현재 품목을 확정해야 한다');
assert.match(page, /return persistItemMapping\(row, prod, \{[\s\S]*custKey: cust\?\.CustKey \|\| null/,
  '수동 품목 변경 저장 결과가 선택 UI까지 전달돼야 한다');
assert.match(page, /fd\.append\('custKey', String\(cust\.CustKey\)\)/,
  '업로드 파싱에도 선택 업체를 전달해 업체별 저장매칭을 적용해야 한다');
assert.doesNotMatch(page, /maxHeight: 660|[Mm]axHeight: 230|[Mm]axHeight: 210/,
  '원본 시트·합산표·진행 로그는 내부 세로 스크롤 대신 페이지 전체 스크롤을 사용해야 한다');
assert.match(page, /e\.target\.value = '';/, '같은 엑셀 파일을 다시 선택해도 onChange가 재실행되도록 파일 입력을 초기화해야 한다');
assert.match(page, /전체 제외/, '업로드 매칭표에서 전체 제외가 가능해야 한다');
assert.match(page, /전체 제외 해제/, '전체 제외를 한 번에 해제할 수 있어야 한다');
assert.match(page, /setImportItemsSkip\(items, true\)/, '전체 제외는 행 skip만 바꾸고 주문원장을 쓰지 않아야 한다');
assert.match(page, /주문등록 결과/, '주문등록 후 결과를 화면에 남겨야 한다');
assert.match(page, /apiGet\('\/api\/orders', \{ custName: cust\.CustName, week, year: weekQuery\.year \}\)/,
  '등록 결과 조회는 OrderYear와 차수를 함께 써야 한다');
assert.match(page, /현재 DB 주문 내역/, '등록 후 ViewOrder 기준 주문 내역을 보여줘야 한다');
assert.match(page, /원본 Excel 시트/, '업로드한 실제 Excel 시트를 매칭 결과 옆에 보여줘야 한다');
assert.match(page, /원본 Excel 시트 \+ 행별 ERP 매칭/, '원본 Excel 행과 ERP 매칭값을 한 표의 인접 셀로 보여줘야 한다');
assert.match(page, /ERP 매칭 품목/, '원본 시트 오른쪽에 매칭 품목 열이 있어야 한다');
assert.match(page, /findOrderImportMatchInsertIndex\(preview\)/, '매칭 열은 발주수량 위치를 찾아 그 바로 뒤에 삽입해야 한다');
assert.match(page, /최종수량/, '원본 시트 오른쪽에서 합산 최종수량을 확인하고 수정할 수 있어야 한다');
assert.match(page, /전체 상세 편집표 열기/, '복잡한 입력명과 추천 후보는 접을 수 있는 상세 편집표로 남겨야 한다');
assert.match(page, /합산된 매칭수량/, '등록 전 합산 품목과 수량을 보여줘야 한다');
assert.match(page, /주문등록 시작/, '등록은 사용자가 명시적으로 시작해야 한다');
assert.match(page, /주문등록 진행 로그/, '등록 처리 단계와 종료 상태를 화면에 남겨야 한다');
console.log('order shipment list tests passed');
