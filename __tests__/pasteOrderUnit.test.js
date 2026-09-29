const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { parseExplicitOrderUnit, resolvePasteOrderUnit, resolvePasteMixedQuantity } = await import('../lib/pasteOrderUnit.js');
  const { parseNaturalInlineOrderLine, parseNaturalSectionActionLine } = await import('../lib/pasteNaturalInlineOrder.js');
  const {chooseSalesPasteParsedOrders}=await import('../lib/salesPasteOrder.js');
  const {buildPasteMixedActionPreview,validatePasteMixedBatchIntent}=await import('../lib/pasteMixedBatch.js');
  const mixed=parseNaturalSectionActionLine('화이트 6박스+17스팀 추가');
  assert.equal(mixed.productName,'화이트','box quantity must never remain in the product name');
  assert.deepEqual(mixed.quantityParts,[{qty:6,unit:'박스'},{qty:17,unit:'스팀'}]);
  const mixedItem={...mixed,inputName:'수국 화이트',prodKey:889,qty:6,unit:'박스'};
  const mixedProd={ProdKey:889,OutUnit:'박스',SteamOf1Box:30};
  const converted=resolvePasteMixedQuantity(mixedItem,mixedProd);
  assert.equal(converted.qty,197);assert.equal(converted.unit,'송이');
  const preview=buildPasteMixedActionPreview({type:'ADD',qty:converted.qty,unit:converted.unit,orderQty:40,shipmentQty:40,product:mixedProd});
  assert.ok(Math.abs(preview.shipmentAfter-(46+17/30))<1e-9);
  assert.ok(Math.abs(preview.orderAfter-(46+17/30))<1e-9);
  assert.equal(resolvePasteMixedQuantity(converted,{...mixedProd,SteamOf1Box:40}).qty,257,'manual/saved rematch recalculates from parts, never converts the old scalar again');
  for(const product of [null,{...mixedProd,SteamOf1Box:0},{...mixedProd,SteamOf1Box:undefined}]){
    const invalid=resolvePasteMixedQuantity(mixedItem,product);
    assert.equal(invalid.qty,0);assert.ok(invalid.mixedQuantityError);
    assert.equal(validatePasteMixedBatchIntent([{custMatch:{CustKey:478},items:[invalid]}]).valid,false);
  }
  assert.equal(parseNaturalInlineOrderLine('영림원예 - 화이트 6박스 + (17st) 취소').quantityParts[1].qty,17);
  const source='2026년 39-02차\n영림원예\n화이트 6박스+17스팀 추가\n10/6 (화) 출고건입니다';
  const natural={orders:[{custName:'영림원예',items:[mixedItem]}]};
  const selection=chooseSalesPasteParsedOrders({text:source,naturalParsed:natural,llmParsed:{orders:[{items:[{inputName:'화이트 6박스+',qty:17}]}]}});
  assert.equal(selection.source,'rules-mixed-units');assert.deepEqual(selection.orders,natural.orders);
  assert.throws(()=>chooseSalesPasteParsedOrders({text:source,naturalParsed:{orders:[]}}),/혼합수량/);
  assert.throws(()=>chooseSalesPasteParsedOrders({text:source+'\n블루 1박스 추가',naturalParsed:natural}),/모든 품목/);
  assert.throws(()=>chooseSalesPasteParsedOrders({text:'화이트 -6박스+17스팀 추가',naturalParsed:{orders:[]}}),/혼합수량/);
  assert.throws(()=>chooseSalesPasteParsedOrders({text:'화이트 6박스+17스팀+2스팀 추가',naturalParsed:{orders:[]}}),/혼합수량/);
  assert.equal(resolvePasteMixedQuantity(mixedItem,{...mixedProd,SteamOf1Box:Infinity}).qty,0);
  const {resolveOrderWeekQuery}=await import('../lib/orderUtils.js');
  assert.notEqual(resolveOrderWeekQuery('2025-39-02').year,resolveOrderWeekQuery('2026-39-02').year,'mixed normalization must not collapse cross-year scopes');
  assert.equal(mixedItem.qty,6,'source parts and scalar input are immutable');

  for (const token of ['박스', '박 스', 'BOX', 'box', 'boxes', 'bx']) {
    assert.equal(parseExplicitOrderUnit(token), '박스', token);
  }
  for (const token of ['단', 'BUNCH', 'bunches', 'bun']) {
    assert.equal(parseExplicitOrderUnit(token), '단', token);
  }
  for (const token of ['송이', '송 이', '송이(대)', '송이 ( 대 )', '대', '개', '스팀', '스팀(대)', '스팀 ( 대 )', '스템', '스템(대)', 'st', 'ST', 'stem', 'stems', 'steam', 'ea']) {
    assert.equal(parseExplicitOrderUnit(token), '송이', token);
  }

  const alstro = { ProdKey: 8799, OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 };
  assert.equal(resolvePasteOrderUnit({ prod: alstro, parsedUnit: '박스', unitExplicit: true }), '박스');
  assert.equal(resolvePasteOrderUnit({ prod: alstro, parsedUnit: '단', unitExplicit: true }), '단');
  assert.equal(resolvePasteOrderUnit({ prod: alstro, parsedUnit: '', unitExplicit: false }), '단');

  const boxedProduct = { ProdKey: 8800, OutUnit: '박스' };
  assert.equal(
    resolvePasteOrderUnit({ prod: boxedProduct, parsedUnit: '송이(대)', unitExplicit: true, prodUnitMap: { 8800: '박스' } }),
    '송이',
    'explicit 송이(대) wins over Product.OutUnit and prior box history',
  );
  assert.equal(parseNaturalInlineOrderLine('은성꽃도매 - 비스위트 10송이(대) 추가').unitText, '송이(대)');
  assert.equal(parseNaturalSectionActionLine('비스위트 10스 템 ( 대 ) 취소').unitText.replace(/\s+/g, ''), '스템(대)');
  const dae = parseNaturalSectionActionLine('수국 화이트 5대 추가');
  assert.equal(dae.quantityText, '5');
  assert.equal(parseExplicitOrderUnit(dae.unitText), '송이');
  const st = parseNaturalSectionActionLine('수국 화이트 5st 추가');
  assert.equal(st.quantityText, '5');
  assert.equal(parseExplicitOrderUnit(st.unitText), '송이');

  const root = path.join(__dirname, '..');
  const parser = fs.readFileSync(path.join(root, 'pages/api/orders/parse-paste.js'), 'utf8');
  const paste = fs.readFileSync(path.join(root, 'pages/orders/paste.js'), 'utf8');
  assert.match(parser, /unit:\s*\(item\.unitExplicit \|\| parsedExplicitUnit\)\s*\?\s*normNatUnit/, '서버 응답은 규칙/LLM의 명시 단위를 매칭 기본단위보다 우선해야 한다.');
  assert.match(parser, /unitExplicit:\s*Boolean\(item\.unitExplicit \|\| parsedExplicitUnit\)/, '서버 응답이 규칙/LLM 명시 단위 여부를 화면까지 전달해야 한다.');
  assert.match(paste, /resolvePasteOrderUnit\([\s\S]*unitExplicit:\s*it\.unitExplicit/, '화면 미리보기와 API payload 단위는 명시 단위 우선 helper를 사용해야 한다.');
  assert.match(paste, /memo:\s*`붙여넣기 일괄\$\{type[\s\S]*\$\{t\.qty\}\$\{t\.unit\}/, '감사 메모에 원문 수량과 보존 단위를 함께 남겨야 한다.');

  console.log('paste order explicit unit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
