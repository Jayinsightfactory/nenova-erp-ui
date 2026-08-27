const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { parseExplicitOrderUnit, resolvePasteOrderUnit } = await import('../lib/pasteOrderUnit.js');
  const { parseNaturalInlineOrderLine, parseNaturalSectionActionLine } = await import('../lib/pasteNaturalInlineOrder.js');

  for (const token of ['박스', '박 스', 'BOX', 'box', 'boxes', 'bx']) {
    assert.equal(parseExplicitOrderUnit(token), '박스', token);
  }
  for (const token of ['단', 'BUNCH', 'bunches', 'bun']) {
    assert.equal(parseExplicitOrderUnit(token), '단', token);
  }
  for (const token of ['송이', '송 이', '송이(대)', '송이 ( 대 )', '스팀', '스팀(대)', '스팀 ( 대 )', '스템', '스템(대)', 'stem', 'stems', 'steam']) {
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

  const root = path.join(__dirname, '..');
  const parser = fs.readFileSync(path.join(root, 'pages/api/orders/parse-paste.js'), 'utf8');
  const paste = fs.readFileSync(path.join(root, 'pages/orders/paste.js'), 'utf8');
  assert.match(parser, /unit:\s*item\.unitExplicit\s*\?\s*normNatUnit/, '서버 응답은 명시 단위를 매칭 기본단위보다 우선해야 한다.');
  assert.match(parser, /unitExplicit:\s*Boolean\(item\.unitExplicit\)/, '서버 응답이 명시 단위 여부를 화면까지 전달해야 한다.');
  assert.match(paste, /resolvePasteOrderUnit\([\s\S]*unitExplicit:\s*it\.unitExplicit/, '화면 미리보기와 API payload 단위는 명시 단위 우선 helper를 사용해야 한다.');
  assert.match(paste, /memo:\s*`붙여넣기 일괄\$\{type[\s\S]*\$\{t\.qty\}\$\{t\.unit\}/, '감사 메모에 원문 수량과 보존 단위를 함께 남겨야 한다.');

  console.log('paste order explicit unit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
