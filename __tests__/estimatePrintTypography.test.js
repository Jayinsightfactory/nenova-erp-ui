// 실행: node --test __tests__/estimatePrintTypography.test.js
// 순수 HTML/CSS 계약만 검사한다. 브라우저 computed style/1920x1080 QA는 메인 담당.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEstimateHtml,
  formatExePrintDate,
  numToKorean,
} from '../lib/estimatePrintHtml.js';
import { prepareEstimatePrintRows } from '../lib/estimatePrintPrepare.js';

const rows = Object.freeze([
  Object.freeze({
    _exePrint: true, ProdKey: 10, ProdName: 'ROSE / Moon Light 50cm',
    EstimateType: '정상출고', Quantity: 12, Unit: '단', UnitQuantity: '12단',
    Cost: 11000, Amount: 120000, Vat: 12000, Descr: '출고 메모',
  }),
  Object.freeze({
    _exePrint: true, ProdKey: 10, ProdName: 'ROSE / Moon Light 50cm',
    EstimateType: '정상출고', Quantity: 8, Unit: '단', UnitQuantity: '8단',
    Cost: 12000, Amount: 87273, Vat: 8727, Descr: '다른 단가',
  }),
  Object.freeze({
    _exePrint: true, ProdKey: 20, ProdName: '[불량차감] CARNATION Novia',
    EstimateType: '불량차감', Quantity: -1, Unit: '단', UnitQuantity: '-1단',
    Cost: 5000, Amount: -4545, Vat: -455, Descr: '수입부 메모',
  }),
]);

const fixture = Object.freeze({
  custName: '테스트 거래처', bigoLabel: '30차 종합견적서',
  printDate: '2026-08-05', logoDataUrl: 'data:image/png;base64,AA==', rows,
});
const formatNumber = (n) => Number(n || 0).toLocaleString();
const build = (overrides = {}) => buildEstimateHtml({ ...fixture, ...overrides });
const tbody = (html) => html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
const itemLines = (html) => [...tbody(html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
    .map((cell) => cell[1]));

function cssRule(html, selector) {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `렌더링되는 실제 selector가 있어야 한다: ${selector}`);
  return Object.fromEntries(match[1].split(';').filter((part) => part.includes(':'))
    .map((part) => {
      const index = part.indexOf(':');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
}

function assertTypography(html) {
  const body = cssRule(html, 'body');
  assert.match(body['font-family'], /^Gulim,'굴림',/);
  assert.equal(body.padding, '10mm 15mm');
  const title = cssRule(html, 'h1');
  assert.equal(title['font-size'], '16pt');
  assert.equal(title['font-weight'], 'bold');
  assert.equal(title['text-decoration'], 'underline');
  assert.match(title['font-family'], /^Gulim,'굴림',/);
  const item = cssRule(html, '.item-table tbody td');
  assert.equal(item['font-size'], '8pt');
  assert.equal(item.height, '6.35mm');
  const header = cssRule(html, '.item-th');
  assert.equal(header['font-size'], '9pt');
  assert.equal(header['font-weight'], 'bold');
  assert.equal(header.height, '6.35mm');
  assert.equal(cssRule(html, '.info-table td.info-key')['font-size'], '9pt');
  assert.equal(cssRule(html, '.info-table td.info-key')['font-weight'], 'bold');
  assert.equal(cssRule(html, '.info-table td.info-val')['font-size'], '8pt');
  assert.equal(cssRule(html, '.foot-row td')['font-size'], '9pt');
  assert.equal(cssRule(html, '.foot-row td')['font-weight'], 'bold');
  for (const selector of ['.amt-ko', '.amt-num']) {
    assert.equal(cssRule(html, selector)['font-size'], '10pt');
    assert.equal(cssRule(html, selector)['font-weight'], 'bold');
  }
  assert.match(html, /@page\s*\{\s*size:A4;\s*margin:0;/);
  assert.doesNotMatch(html, /\b(?:zoom|transform)\s*:/, '출력 전체 확대를 추가하지 않는다.');
}

test('EXE typography is declared on rendered cells, not an unused item-td class', () => {
  for (const printFormat of ['estimate', 'supply', 'statement']) {
    assertTypography(build({ printFormat }));
  }
  const html = build();
  assert.match(html, /<h1>견 적 서<\/h1>/);
  assert.match(html, /class="info-val">2026\/08\/05<\/td>/);
  for (const match of tbody(html).matchAll(/<td\b[^>]*style="([^"]*)"/g)) {
    const fontSize = match[1].match(/font-size\s*:\s*([^;]+)/);
    if (fontSize) assert.equal(fontSize[1], '8pt', '본문 inline style이 8pt를 덮지 않는다.');
  }
  assert.throws(() => assertTypography(html.replace(
    '.item-table tbody td { font-size:8pt;', '.item-table tbody td { font-size:9pt;',
  )), '본문 9pt near-miss는 실패해야 한다.');
  assert.throws(() => assertTypography(html.replace(
    '.item-table tbody td {', '.item-td {',
  )), '사용되지 않는 class 선언만 있으면 실패해야 한다.');
});

test('EXE row order, separate prices, seven columns, totals and deduction options are preserved', () => {
  const html = build();
  const lines = itemLines(html);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.length === 7));
  assert.deepEqual(lines.map((line) => line[1]), rows.map((row) => row.ProdName));
  assert.deepEqual(lines.map((line) => line[2]), ['12단', '8단', '-1단']);
  assert.deepEqual(lines.map((line) => line[3]), rows.map((row) => formatNumber(row.Cost)));
  assert.deepEqual(lines.map((line) => line[4]), rows.map((row) => formatNumber(row.Amount)));
  assert.deepEqual(lines.map((line) => line[5]), rows.map((row) => formatNumber(row.Vat)));
  assert.deepEqual(lines.map((line) => line[6]), ['출고 메모', '다른 단가', '']);
  assert.equal(itemLines(build({ showDeductionDescr: true }))[2][6], '수입부 메모');
  assert.ok(html.includes(`(￦ ${formatNumber(223000)}원)`));
  const zeroRow = Object.freeze({ ...rows[0], Quantity: 0, ProdName: 'ZERO_NOT_PRINTED' });
  const withZero = build({ rows: Object.freeze([...rows, zeroRow]) });
  assert.equal(itemLines(withZero).length, 3);
  assert.ok(!withZero.includes('ZERO_NOT_PRINTED'));
  assert.ok(withZero.includes(`(￦ ${formatNumber(223000)}원)`));
});

test('all formats keep existing amount preparation without mutating input or options', () => {
  const before = structuredClone(fixture);
  for (const printFormat of ['estimate', 'supply', 'statement']) {
    const options = Object.freeze({ ...fixture, printFormat, aggregate: true, showBoxQty: false });
    const html = buildEstimateHtml(options);
    const prepared = prepareEstimatePrintRows(rows, { printFormat });
    assert.equal(itemLines(html).length, prepared.rows.length);
    const suffix = printFormat === 'supply' ? ' / 분배단가=공급가액' : '';
    assert.ok(html.includes(`(￦ ${formatNumber(prepared.totals.total)}원${suffix})`));
    if (printFormat === 'supply') assert.equal(prepared.totals.total, 245300);
    assert.deepEqual(fixture, before);
    assert.equal(options.rows, rows);
  }
});

test('empty and omitted rows render valid zero totals without a dummy item', () => {
  for (const printFormat of ['estimate', 'supply', 'statement']) {
    for (const emptyRows of [Object.freeze([]), undefined, null]) {
      const html = build({ rows: emptyRows, printFormat });
      assert.equal(itemLines(html).length, 0);
      assert.match(html, /금 액 : 영원 정/);
      assert.ok(html.includes('(￦ 0원'));
      assert.match(html, /<thead>[\s\S]*<tfoot>/);
      assert.match(html, /<\/body><\/html>$/);
    }
  }
});

test('header, title, serial, memo, product, unit and logo attributes escape HTML near-misses', () => {
  const attack = '\"></title><script>window.close()</script><img src=x onload=alert(1)> & \'가\'';
  const escaped = '&quot;&gt;&lt;/title&gt;&lt;script&gt;window.close()&lt;/script&gt;&lt;img src=x onload=alert(1)&gt; &amp; &#39;가&#39;';
  const html = build({
    custName: attack, bigoLabel: attack, serialNo: attack, logoDataUrl: attack,
    rows: [Object.freeze({ ...rows[0], ProdName: attack, UnitQuantity: attack, Descr: attack })],
  });
  assert.ok(html.includes(`<title>견적서 — ${escaped}</title>`));
  assert.ok(html.includes(`<b>${escaped}</b>`));
  assert.equal((html.match(new RegExp(`class="info-val">${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')) || []).length, 2);
  assert.ok(html.includes(`<img src="${escaped}" alt="NENOVA"`));
  assert.deepEqual(itemLines(html)[0].filter((cell) => cell === escaped), [escaped, escaped, escaped]);
  assert.equal((html.match(/<img\b/g) || []).length, 1);
  assert.doesNotMatch(html, /<script\b/i);
  const imgTag = html.match(/<img\b[^>]*>/i)[0];
  const attributeNames = [...imgTag.matchAll(/\s([a-z][\w:-]*)\s*=\s*"[^"]*"/gi)]
    .map((match) => match[1]);
  assert.deepEqual(attributeNames, ['src', 'alt', 'onerror'],
    'src 내부의 escaped onload 텍스트는 실제 이벤트 속성으로 해석하면 안 된다.');
  const safe = build({ custName: 'A & B < C > D "E" \'F\' &lt;img&gt;' });
  assert.ok(safe.includes('A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39; &amp;lt;img&amp;gt;'));
  assert.ok(build().includes('src="data:image/png;base64,AA=="'), '정상 base64 로고는 보존한다.');
  assert.ok(build({ serialNo: undefined, printDate: attack }).includes(`class="info-val">${escaped}</td>`));
});

test('HTML has no automatic print/close script and pure helpers retain their behavior', () => {
  const html = build();
  assert.doesNotMatch(html, /<script\b|window\.(?:onload|print|close|onafterprint)|\b(?:parent|top)\./i);
  assert.equal(formatExePrintDate('2026-8-5'), '2026/08/05');
  assert.equal(formatExePrintDate('2026.08.05'), '2026/08/05');
  assert.equal(formatExePrintDate('2026/08/05'), '2026/08/05');
  assert.equal(formatExePrintDate('serial-123'), 'serial-123');
  assert.equal(formatExePrintDate(undefined), '');
  assert.equal(numToKorean(0), '영원 정');
  assert.equal(numToKorean(223000), '이십이만삼천원 정');
  assert.equal(numToKorean(-223000), numToKorean(223000));
});
