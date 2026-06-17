import { describe, expect, it } from 'vitest';

// paste.js helpers — flower context + exclude lines (inline copy for unit test)
const STOCK_CATEGORY_RE = /(수국|hydrangea|장미|rose|카네이션|carnation)/gi;

function stockNorm(text) {
  return String(text || '').toLowerCase().replace(STOCK_CATEGORY_RE, ' ').replace(/\s+/g, '').trim();
}

function normalizeFlowerContext(line) {
  const s = String(line || '').trim().replace(/\s+/g, '');
  return /^(수국|장미|카네이션)$/.test(s) ? s : '';
}

function applyFlowerContext(name, flowerContext) {
  const productName = String(name || '').trim();
  if (!productName || !flowerContext) return productName;
  return productName.includes(flowerContext) ? productName : `${flowerContext} ${productName}`;
}

function parseBaseStockText(text, { excludedLineNos = [] } = {}) {
  const rows = [];
  const skip = new Set(excludedLineNos || []);
  let currentFlower = '';
  String(text || '').split(/\r?\n/).forEach((raw, lineIdx) => {
    if (skip.has(lineIdx)) return;
    const line = raw.trim();
    if (!line) return;
    const flowerOnly = normalizeFlowerContext(line);
    if (flowerOnly && !/\d/.test(line)) {
      currentFlower = flowerOnly;
      return;
    }
    const m = line.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개)?$/);
    if (!m) return;
    const name = m[1].trim();
    const matchName = applyFlowerContext(name, currentFlower);
    rows.push({ name, matchName, flowerContext: currentFlower });
  });
  return { rows };
}

describe('parseBaseStockText flower context', () => {
  it('applies 수국 context to color names', () => {
    const { rows } = parseBaseStockText('수국\n블루 2\n라벤더 14');
    expect(rows[0].matchName).toBe('수국 블루');
    expect(rows[1].matchName).toBe('수국 라벤더');
  });

  it('skips excluded lines', () => {
    const text = '수국\n메모: 담당자 확인\n블루 2';
    const { rows } = parseBaseStockText(text, { excludedLineNos: [1] });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('블루');
  });
});

describe('stockNorm', () => {
  it('strips genus prefix for keying', () => {
    expect(stockNorm('수국 블루')).toBe(stockNorm('블루'));
  });
});
