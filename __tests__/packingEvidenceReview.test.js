const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const component = fs.readFileSync(path.join(__dirname, '../components/import-tools/PackingEvidenceReview.js'), 'utf8');
const preview = fs.readFileSync(path.join(__dirname, '../lib/importPackingPdfPreview.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../styles/PackingEvidenceReview.module.css'), 'utf8');

test('review component exposes the integration contract and keeps ERP out of scope', () => {
  for (const selector of ['evidence-review', 'pdf-preview', 'field-gw', 'field-cw', 'field-freight', 'evidence-confirm']) {
    assert.ok(component.includes(selector), `missing ${selector}`);
  }
  assert.match(component, /open = true/);
  assert.match(component, /if \(!open\) return null/);
  assert.match(component, /confirmed: row\?\.confirmed === true/);
  assert.match(component, /reason: stringValue\(row\?\.reason\)/);
  assert.match(component, /await onConfirm\?\.\(submission\)/);
  assert.match(component, /확인값 적용 · 결과 재생성/);
  assert.match(component, /ERP DB에 저장하지 않습니다/);
  assert.match(component, /원본 PDF · 인식값 검증/);
  assert.match(component, /data-testid="source-row-confirm"/);
  assert.match(component, /data-pdf-ready=\{pdfReady \? 'true' : 'false'\}/);
  assert.match(component, /onInvalidate\?\.\(\)/);
  assert.match(component, /sourceInvoiceIdentity\?\.sourceInvoiceIndex === invoiceIndex/);
  assert.match(component, /product\?\.sourceName === sourceRow\?\.description \|\| product\?\.matchingDescription === sourceRow\?\.description/);
  assert.match(component, /missingSourceReasonCount/);
  assert.match(component, /reason: stringValue\(sourceDrafts\[key\]\?\.reason\)/);
  assert.match(component, /PDF 다시 시도/);
  assert.match(component, /너비 맞춤/);
  assert.doesNotMatch(component + preview, /fetch\(|XMLHttpRequest|\/api\/|mssql|ShipmentDetail|StockMaster/);
});

test('source row labels stay compact and use Korean labels instead of parser field names', () => {
  for (const [field, label] of [['pcs', '박스'], ['total_bunch', '단수'], ['total_stems', '송이 수'], ['steam_box', '박스당 송이'], ['u_price', '단가'], ['t_price', '금액'], ['bunch_st', '단당 송이'], ['stems', '송이 수'], ['price', '단가']]) {
    assert.match(component, new RegExp(`${field}: '${label}'`));
  }
  assert.match(css, /max-height: min\(38vh, 390px\)/);
  assert.match(css, /\.sourceEditFields \{ display: flex; flex-wrap: wrap/);
  assert.match(component, /미매칭 · 결과에서 선택 필요/);
});

test('PDF preview is bounded, local-worker-only, and never guesses a text match', () => {
  assert.match(preview, /MAX_PDF_BYTES = 20 \* 1024 \* 1024/);
  assert.match(preview, /MAX_PAGES = 100/);
  assert.match(preview, /MAX_CANVAS_PIXELS/);
  assert.match(preview, /pixelWidth \* pixelHeight > MAX_CANVAS_PIXELS/);
  assert.doesNotMatch(preview, /Math\.max\(0\.1, Math\.min/);
  assert.match(preview, /new Worker\(new URL\('\.\/importAwbWorker\.js', import\.meta\.url\)/);
  assert.match(preview, /matches\.length > 1\) return null/);
  assert.match(preview, /isValidNormalizedBBox\(evidence\?\.bbox\)/);
  assert.match(preview, /task\.cancel\(\)/);
  assert.match(preview, /generation !== renderGeneration/);
  assert.match(preview, /nativeWorker\?\.terminate\(\)/);
  assert.doesNotMatch(preview, /https?:\/\//);
});

test('exact quote and normalized bbox helpers reject ambiguity and invalid fallback regions', async () => {
  const { findUniqueQuoteItems, isValidNormalizedBBox } = await import('../lib/importPackingPdfPreview.js');
  const items = [{ str: 'Gross Weight' }, { str: '12.5 kg' }, { str: 'footer' }];
  assert.deepEqual(findUniqueQuoteItems(items, 'Gross Weight 12.5 kg'), items.slice(0, 2));
  assert.equal(findUniqueQuoteItems([...items, { str: 'Gross Weight 12.5 kg' }], 'Gross Weight 12.5 kg'), null);
  assert.equal(findUniqueQuoteItems(items, '12.6 kg'), null);
  assert.equal(isValidNormalizedBBox([0.1, 0.2, 0.3, 0.4]), true);
  for (const bbox of [[-0.1, 0, 0.2, 0.2], [0, 0, 0, 0.2], [0.9, 0.9, 0.2, 0.2], [0, 0, NaN, 1]]) {
    assert.equal(isValidNormalizedBBox(bbox), false);
  }
});

test('responsive layout includes the required desktop, tablet, and phone breakpoints', () => {
  assert.match(css, /grid-template-columns: minmax\(0, 1\.25fr\) minmax\(430px, \.75fr\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /overflow: auto/);
});
