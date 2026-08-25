// 도착원가 원장 — 다양한 원가자료 엑셀의 메타데이터·원가표 파서
//
// 이 파일은 원본 엑셀의 계산식을 다시 만들어 전산 원가를 덮어쓰지 않는다.
// 엑셀에 표시된 원가를 원본값으로 보존하고, 사용자가 선택한 배분기준은
// 별도 웹 원장에 저장한다. 원본 열이 있는 경우에만 기준별 미리보기 값을 계산한다.

import XLSX from 'xlsx';
import { findMappingFuzzy } from './parseMappings.js';

const COUNTRY_ALIASES = [
  ['에콰도르', /ecuador|에콰도르/i],
  ['콜롬비아', /colombia|콜롬비아/i],
  ['중국', /china|중국|melody|cloud/i],
  ['네덜란드', /netherlands|holland|(?:^|\s)nl\b|1nl|holex|네덜란드/i],
  ['베트남', /vietnam|베트남/i],
  ['태국', /thailand|태국/i],
];

const FLOWER_ALIASES = [
  ['수국', /hydrangea|수국/i],
  ['장미', /rose|roses|자연장미|장미/i],
  ['카네이션', /carnation|카네이션/i],
  ['알스트로', /alstroemeria|alstromeria|알스트로/i],
  ['리시안', /lisianthus|eustoma|리시안/i],
  ['루스커스', /ruscus|루스커스/i],
  ['튤립', /tulip|튤립/i],
  ['안개', /gypsophila|baby.?s.?breath|안개/i],
  ['유칼립투스', /eucalyptus|유칼립투스/i],
  ['델피늄', /delphinium|델피늄/i],
  ['아마릴리스', /amaryllis|아마릴리스/i],
  ['아스틸베', /astilbe|아스틸베/i],
  ['호접난', /orchid|호접난|호접란/i],
];

function text(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

export function normalizeArrivalText(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\[\]【】()（）{}<>]/g, ' ')
    .replace(/[/:,·|_\\-]+/g, ' ')
    .replace(/\b(?:mel|cloud|fresh|preserved|china|colombia|ecuador|nl)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickField(row, ...keys) {
  if (!row) return undefined;
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return undefined;
}

export function compactFarmName(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9가-힣]/g, '');
}

const FARM_ALIAS_GROUPS = [
  ['lozarte', 'lorzate', 'losarte', 'lozarte'],
  ['piedrasanta', 'pietrasanta'],
  ['lalinda'],
  ['greenland'],
];

function farmAliasKey(compact) {
  const stripped = String(compact || '').replace(/^(finca|farm|flores|flowers|the)/, '');
  for (const group of FARM_ALIAS_GROUPS) {
    if (group.includes(compact) || group.includes(stripped)) return group[0];
  }
  return stripped || compact;
}

export function pickDisplayedArrivalCost({
  sourceStem = null,
  sourceUnit = null,
  unit = '',
  unitCount = null,
} = {}) {
  const stem = Number(sourceStem);
  const bunch = Number(sourceUnit);
  const count = Number(unitCount);
  const hasStem = Number.isFinite(stem) && stem > 0;
  const hasBunch = Number.isFinite(bunch) && bunch > 0;
  const same = hasStem && hasBunch && Math.abs(bunch - stem) < 1;
  const bunchUnit = /단|박스|box|bunch/i.test(text(unit));
  if (bunchUnit) {
    if (hasBunch && !same) return bunch;
    if (hasStem && count > 1) return stem * count;
    if (hasBunch) return bunch;
    if (hasStem) return stem;
    return null;
  }
  if (hasStem) return stem;
  if (hasBunch) return bunch;
  return null;
}

export function inferArrivalQtyUnit({
  quantityHeader = '',
  unitCountHeader = '',
  unitCostHeader = '',
  unitCount = null,
  unitLabel = '',
  product = null,
} = {}) {
  const qtyH = headerKey(quantityHeader);
  const countH = headerKey(unitCountHeader);
  const costH = headerKey(unitCostHeader);
  const labelH = headerKey(unitLabel);
  if (/박스|box/.test(qtyH) && !/단|bunch/.test(qtyH)) return '박스';
  if (/단|bunch/.test(qtyH) && !/박스|box/.test(qtyH)) return '단';
  if (/박스|box/.test(costH) && !/단|bunch/.test(costH)) return '박스';
  if (/단|bunch/.test(costH)) return '단';
  if (/단당|bunchof|stemsper/.test(countH) || (Number(unitCount) > 0)) return '단';
  if (/박스|box/.test(labelH) && !/단|bunch/.test(labelH)) return '박스';
  if (/단|bunch/.test(labelH) && !/박스|box/.test(labelH)) return '단';
  const out = text(pickField(product, 'OutUnit', 'OutUnit'));
  if (/박스|box/i.test(out)) return '박스';
  if (/단|bunch/i.test(out)) return '단';
  if (/송이|stem/i.test(out)) return '송이';
  return '단';
}

export function parseArrivalNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[₩$€£,\s]/g, '').replace(/%$/, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function headerKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[()（）/\\[\]:：·]/g, '');
}

function isNumeric(value) {
  return parseArrivalNumber(value) != null;
}

function findIndex(headers, predicate) {
  return headers.findIndex((h) => predicate(headerKey(h), text(h)));
}

function findAllIndices(headers, predicate) {
  return headers.reduce((out, h, i) => (predicate(headerKey(h), text(h)) ? out.concat(i) : out), []);
}

function firstMatchingValue(aoa, pattern, maxRows = 18) {
  for (let r = 0; r < Math.min(maxRows, aoa.length); r += 1) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (!pattern.test(text(row[c]))) continue;
      for (let j = c + 1; j < Math.min(row.length, c + 5); j += 1) {
        const value = row[j];
        if (value != null && text(value) !== '') return value;
      }
      if (r + 1 < aoa.length) {
        const below = aoa[r + 1]?.[c];
        if (below != null && text(below) !== '') return below;
      }
    }
  }
  return null;
}

function labeledWeightNumber(aoa, labels, maxRows = 18) {
  const wanted = labels.map((label) => headerKey(label)).filter(Boolean);
  for (let r = 0; r < Math.min(maxRows, aoa.length); r += 1) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (!wanted.includes(headerKey(row[c]))) continue;
      for (let j = c + 1; j < Math.min(row.length, c + 5); j += 1) {
        const n = parseArrivalNumber(row[j]);
        if (n != null) return n;
      }
      const below = parseArrivalNumber(aoa[r + 1]?.[c]);
      if (below != null) return below;
    }
  }
  return null;
}

function firstText(aoa, pattern, maxRows = 8) {
  for (let r = 0; r < Math.min(maxRows, aoa.length); r += 1) {
    for (const cell of aoa[r] || []) {
      const value = text(cell);
      if (value && pattern.test(value)) return value;
    }
  }
  return '';
}

function inferCountry(source) {
  const value = text(source);
  return COUNTRY_ALIASES.find(([, re]) => re.test(value))?.[0] || '';
}

export function inferArrivalFlower(source) {
  const value = text(source);
  return FLOWER_ALIASES.find(([, re]) => re.test(value))?.[0] || '';
}

export function canonicalArrivalFlowerName(source) {
  return inferArrivalFlower(source) || text(source);
}

export function arrivalFlowersFromTexts(texts = []) {
  const found = new Set();
  for (const value of texts) {
    const inferred = inferArrivalFlower(value);
    if (inferred) {
      found.add(inferred);
      continue;
    }
    const raw = text(value);
    if (raw && raw.length <= 12 && /^[가-힣]+$/.test(raw)) found.add(raw);
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function arrivalFlowerInferSql(expr) {
  const whens = FLOWER_ALIASES.map(([name, re]) => {
    const likes = String(re.source).split('|').map((part) => {
      const token = part.replace(/[^a-zA-Z가-힣]/g, '');
      if (token.length < 2 || token.toLowerCase() === 'roses') return '';
      return `${expr} LIKE N'%${token.replace(/'/g, "''")}%'`;
    }).filter(Boolean);
    if (!likes.length) return '';
    return `WHEN ${likes.join(' OR ')} THEN N'${name.replace(/'/g, "''")}'`;
  }).filter(Boolean);
  return `CASE ${whens.join(' ')} END`;
}

export function arrivalFlowerLikeTerms(flower) {
  const raw = text(flower);
  if (!raw) return [];
  const terms = new Set([raw]);
  const canonical = inferArrivalFlower(raw);
  if (canonical) terms.add(canonical);
  for (const [name, re] of FLOWER_ALIASES) {
    if (name !== raw && name !== canonical && !re.test(raw)) continue;
    terms.add(name);
    String(re.source).split('|').forEach((part) => {
      const token = part.replace(/[^a-zA-Z가-힣]/g, '');
      if (token.length >= 2) terms.add(token);
    });
  }
  return [...terms].slice(0, 6);
}

function inferSheetOrderWeek(sheetName) {
  const match = text(sheetName).match(/^(\d{1,2})\s*[-_]\s*(\d{1,2})[A-Za-z]?$/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : '';
}

function inferOrderWeek(source) {
  const match = text(source).match(/(?:^|\s|차수\s*)\d{1,2}\s*-\s*\d{1,2}(?:\s|$)/i);
  return match ? match[0].match(/\d{1,2}\s*-\s*\d{1,2}/)[0].replace(/\s+/g, '') : '';
}

function findTableHeader(aoa) {
  let best = null;
  for (let r = 0; r < Math.min(aoa.length, 80); r += 1) {
    const headers = aoa[r] || [];
    const keys = headers.map(headerKey);
    const product = findIndex(headers, (k) => /colorgrade|품목명|품목|상품명|product/.test(k));
    const qty = findIndex(headers, (k) => /^(수량|입고수량|quantity|qty)(단|박스|box|bunch)?$/.test(k));
    const landed = findAllIndices(headers, (k) => /도착원가|arrivalcost|landedcost/.test(k));
    if (product < 0 || qty < 0 || landed.length === 0) continue;
    const score = 10 + landed.length + (keys.some(k => /fob/.test(k)) ? 2 : 0) + (keys.some(k => /관세/.test(k)) ? 1 : 0);
    if (!best || score > best.score) best = { rowIndex: r, headers, score };
  }
  return best;
}

function buildProductLookups(products) {
  const list = (products || []).map((p) => ({
    ...p,
    ProdKey: pickField(p, 'ProdKey', 'ProdKey'),
    OutUnit: pickField(p, 'OutUnit', 'OutUnit'),
    FlowerName: pickField(p, 'FlowerName', 'FlowerName'),
    _names: [p.ProdName, p.DisplayName, p.ProdName, p.DisplayName].map(normalizeArrivalText).filter(Boolean),
  }));
  return list;
}

function matchProduct(rawName, products, mappings = {}) {
  const query = normalizeArrivalText(rawName);
  if (!query) return null;
  const learned = findMappingFuzzy(rawName, mappings);
  const learnedKey = Number(learned?.value?.prodKey || 0);
  if (learnedKey > 0) {
    const learnedProduct = products.find((product) => Number(pickField(product, 'ProdKey', 'ProdKey')) === learnedKey);
    if (learnedProduct) return learnedProduct;
  }
  let best = null;
  let bestScore = 0;
  for (const product of products) {
    for (const name of product._names) {
      if (!name) continue;
      let score = 0;
      if (query === name) score = 1;
      else if (query.includes(name) || name.includes(query)) score = 0.92;
      else {
        const qTokens = new Set(query.split(' ').filter((x) => x.length >= 2));
        const nTokens = new Set(name.split(' ').filter((x) => x.length >= 2));
        const overlap = [...qTokens].filter((x) => nTokens.has(x)).length;
        score = overlap / Math.max(1, Math.min(qTokens.size, nTokens.size));
      }
      if (inferArrivalFlower(rawName) && product.FlowerName && inferArrivalFlower(rawName) === product.FlowerName) score += 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }
  }
  return bestScore >= 0.88 ? best : null;
}

export function matchArrivalFarm(rawName, farms) {
  const query = farmAliasKey(compactFarmName(rawName));
  if (!query || query.length < 2) return null;
  let best = null;
  let bestScore = 0;
  let ties = 0;
  for (const farm of farms || []) {
    const name = farmAliasKey(compactFarmName(pickField(farm, 'FarmName', 'FarmName')));
    if (!name) continue;
    let score = 0;
    if (name === query) score = 1;
    else if (name.includes(query) && query.length >= 4) score = 0.9;
    else if (query.includes(name) && name.length >= 4) score = 0.88;
    if (score > bestScore) {
      bestScore = score;
      best = farm;
      ties = 1;
    } else if (score === bestScore && score > 0) {
      ties += 1;
    }
  }
  if (!best || bestScore < 0.86 || ties !== 1) return null;
  return {
    ...best,
    FarmKey: pickField(best, 'FarmKey', 'FarmKey'),
    FarmName: pickField(best, 'FarmName', 'FarmName'),
  };
}

// 콜롬비아 수국 Color Grade 원가자료(29-1 수국 원가자료.xlsx)에 저장된 엑셀 수식.
// 34-2처럼 입력값만 있고 도착원가 열이 비어 있는 사본도 같은 식으로 표시 원가를 채운다.
const HYDRANGEA_PAPER_PER_GW_KRW = 410;
const HYDRANGEA_QUARANTINE_PER_ITEM_KRW = 10000;

function labeledNumber(aoa, pattern) {
  return parseArrivalNumber(firstMatchingValue(aoa, pattern, 18));
}

function isColorGradeHydrangeaTable(headers) {
  const keys = headers.map(headerKey);
  return keys.some((k) => k === 'colorgrade' || k.includes('colorgrade'))
    && keys.some((k) => /도착원가/.test(k))
    && keys.some((k) => k === 'fob');
}

function sumColumn(aoa, startRow, colIndex) {
  let total = 0;
  for (let r = startRow; r < aoa.length; r += 1) {
    const qty = parseArrivalNumber(aoa[r]?.[colIndex]);
    if (qty > 0) total += qty;
  }
  return total;
}

function hydrangeaSheetEconomics(aoa, quantityIdx, dataStartRow) {
  const fx = labeledNumber(aoa, /환율|exchange.?rate/i);
  const gw = labeledNumber(aoa, /^(gw|gross\s*weigh)/i);
  const cw = labeledNumber(aoa, /^(cw|chargeable)/i);
  const rate = labeledNumber(aoa, /^rate$/i);
  const docFee = labeledNumber(aoa, /^서류$/);
  const customsFee = labeledNumber(aoa, /통관\s*수수료/);
  const itemCount = labeledNumber(aoa, /품목수/);
  const domestic = labeledNumber(aoa, /국내\s*운송비/);
  const deduct = labeledNumber(aoa, /검역차감|겸역차감/);
  let paper = labeledNumber(aoa, /^백상$/);
  let quarantineFee = labeledNumber(aoa, /검역\s*수수료/);
  if (!(paper > 0) && gw > 0) paper = gw * HYDRANGEA_PAPER_PER_GW_KRW;
  if (!(quarantineFee > 0) && itemCount > 0) quarantineFee = itemCount * HYDRANGEA_QUARANTINE_PER_ITEM_KRW;
  let qtyTotal = labeledNumber(aoa, /총수량/);
  if (!(qtyTotal > 0)) qtyTotal = sumColumn(aoa, dataStartRow, quantityIdx);
  const airFreight = (Number(docFee) || 0) + ((rate > 0 && cw > 0) ? rate * cw : 0);
  const otherTotal = (Number(paper) || 0)
    + (Number(customsFee) || 0)
    + (Number(quarantineFee) || 0)
    + (Number(domestic) || 0)
    + (Number(deduct) || 0);
  if (!(fx > 0) || !(qtyTotal > 0) || !(airFreight > 0)) return null;
  return {
    fx,
    gw,
    cw,
    airFreight,
    qtyTotal,
    otherTotal,
    freightPerStemUSD: airFreight / qtyTotal,
    otherPerStemKRW: otherTotal / qtyTotal,
  };
}

function fillHydrangeaLandedCost(row, columns, economics) {
  const fob = parseArrivalNumber(row[columns.fob]);
  if (fob == null || !(fob >= 0) || !economics) return null;
  const unitCount = parseArrivalNumber(row[columns.unitCount]) || 1;
  const customs = parseArrivalNumber(row[columns.customsPerUnit]) || 0;
  const cnfKrw = (fob + economics.freightPerStemUSD) * economics.fx;
  const stem = cnfKrw + customs + economics.otherPerStemKRW;
  if (!(stem > 0)) return null;
  return {
    freightPerUnitUSD: economics.freightPerStemUSD,
    otherPerUnitKRW: economics.otherPerStemKRW,
    sourceStem: stem,
    sourceUnit: stem * unitCount,
    exchangeRate: economics.fx,
    grossWeight: economics.gw,
    chargeableWeight: economics.cw,
    freightUSD: economics.airFreight,
  };
}

const XLSX_READ_OPTS = { cellDates: false, cellNF: false, cellStyles: false, cellFormula: true, sheetStubs: true };

function cellAddress(value) {
  return String(value || '').replace(/\$/g, '').toUpperCase();
}

function evalArithmetic(expr) {
  const safe = String(expr || '').replace(/\s+/g, '');
  if (!safe || !/^[-+*/().\d]+$/.test(safe)) return null;
  try {
    const value = Function(`"use strict"; return (${safe});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function evalSheetCell(ws, addr, seen = new Set()) {
  const key = cellAddress(addr);
  if (!key || !/^[A-Z]+[0-9]+$/.test(key)) return 0;
  if (seen.has(key)) return Number(ws[key]?.v) || 0;
  seen.add(key);
  const cell = ws[key];
  if (!cell) return 0;
  const cached = cell.t !== 'z' && cell.v != null && cell.v !== '' ? parseArrivalNumber(cell.v) : null;
  if (cached != null && !(cell.t === 'z')) return cached;
  if (!cell.f) return cached || 0;
  const value = evalSheetFormula(ws, cell.f, seen);
  if (value == null) return cached || 0;
  cell.t = 'n';
  cell.v = value;
  return value;
}

const MAX_SUM_CELLS = 500;

function evalSheetFormula(ws, formula, seen) {
  let expr = String(formula || '').replace(/\$/g, '').trim();
  if (expr.startsWith('=')) expr = expr.slice(1);
  if (!expr || /^_xlfn\./i.test(expr)) return null;
  expr = expr.replace(/SUM\(([^)]+)\)/gi, (_, range) => {
    const [startAddr, endAddr] = String(range).split(':').map((part) => cellAddress(part));
    if (!startAddr || !endAddr) return '(0)';
    const start = XLSX.utils.decode_cell(startAddr);
    const end = XLSX.utils.decode_cell(endAddr);
    if (![start.r, start.c, end.r, end.c].every(Number.isFinite)) return '(0)';
    const rowCount = Math.abs(end.r - start.r) + 1;
    const colCount = Math.abs(end.c - start.c) + 1;
    if (rowCount * colCount > MAX_SUM_CELLS) return '(0)';
    let sum = 0;
    for (let r = Math.min(start.r, end.r); r <= Math.max(start.r, end.r); r += 1) {
      for (let c = Math.min(start.c, end.c); c <= Math.max(start.c, end.c); c += 1) {
        sum += evalSheetCell(ws, XLSX.utils.encode_cell({ r, c }), seen);
      }
    }
    return `(${sum})`;
  });
  expr = expr.replace(/[A-Z]+[0-9]+/gi, (ref) => {
    const value = evalSheetCell(ws, ref, seen);
    return `(${Number(value) || 0})`;
  });
  return evalArithmetic(expr);
}

export function hydrateSheetFormulas(ws) {
  if (!ws) return ws;
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    const cell = ws[key];
    if (!cell?.f) continue;
    const missing = cell.t === 'z' || cell.v == null || cell.v === '';
    if (missing) evalSheetCell(ws, key, new Set());
  }
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    if (ws[key]?.t === 'z' && !ws[key].f) delete ws[key];
  }
  return ws;
}

const MAX_MERGE_CELLS = 400;

export function expandMergedCells(ws) {
  const merges = ws?.['!merges'];
  if (!ws || !Array.isArray(merges) || merges.length === 0) return ws;
  const used = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  for (const range of merges) {
    const origin = ws[XLSX.utils.encode_cell(range.s)];
    if (!origin || (origin.v == null && origin.w == null && !origin.f)) continue;
    const r0 = used ? Math.max(range.s.r, used.s.r) : range.s.r;
    const c0 = used ? Math.max(range.s.c, used.s.c) : range.s.c;
    const r1 = used ? Math.min(range.e.r, used.e.r) : range.e.r;
    const c1 = used ? Math.min(range.e.c, used.e.c) : range.e.c;
    if (r1 < r0 || c1 < c0) continue;
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_MERGE_CELLS) continue;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (r === range.s.r && c === range.s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const current = ws[addr];
        if (current && current.v != null && current.v !== '') continue;
        ws[addr] = { t: origin.t || 's', v: origin.v, w: origin.w };
      }
    }
  }
  return ws;
}

function findArrivalColumns(headers) {
  const keys = headers.map(headerKey);
  const landed = findAllIndices(headers, (k) => /도착원가|arrivalcost|landedcost/.test(k));
  const stem = landed.find((i) => /송이|stem|ea/.test(keys[i])) ?? landed[0];
  const unit = landed.find((i) => /단|box|bunch|unit|박스/.test(keys[i])) ?? landed[landed.length - 1];
  return {
    farm: findIndex(headers, (k) => /^(농장|농장명|farm|grower|finca|farmname)$/.test(k)),
    product: findIndex(headers, (k) => /colorgrade|품목명|품목|상품명|product/.test(k)),
    quantity: findIndex(headers, (k) => /^(수량|입고수량|quantity|qty)(단|박스|box|bunch)?$/.test(k)),
    fob: findIndex(headers, (k) => /fob|매입단가|구매단가/.test(k)),
    freightPerUnit: findIndex(headers, (k) => /운송비|운임비|freight/.test(k) && !/항공료/.test(k)),
    customsPerUnit: findIndex(headers, (k) => /^관세|관세/.test(k)),
    otherPerUnit: findIndex(headers, (k) => /그외통관|otherclearance|통관비송이|통관비단/.test(k)),
    unitCount: findIndex(headers, (k) => /단당수량|stemsper|bunchof/.test(k)),
    unitLabel: findIndex(headers, (k) => /^(단위|unit)$/.test(k)),
    stemCost: stem,
    unitCost: unit,
    vatCost: findIndex(headers, (k) => /부가세|vat|세포함/.test(k)),
  };
}

function pickFarmRaw(row, columns, metaFarm) {
  if (columns.farm >= 0 && text(row[columns.farm])) return text(row[columns.farm]);
  return metaFarm || '';
}

function inferMeta({ aoa, sheetName, fileName, defaultOrderYear, defaultOrderWeek }) {
  const headText = aoa.slice(0, 18).flat().map(text).filter(Boolean).join(' | ');
  // 다중 시트 workbook은 파일명이 29-1이어도 시트가 29-2일 수 있다.
  // 시트명·시트 내부 차수를 파일명보다 우선한다.
  const orderWeek = inferSheetOrderWeek(sheetName)
    || inferOrderWeek(`${sheetName} ${headText}`)
    || inferOrderWeek(fileName)
    || text(defaultOrderWeek || '');
  // NL 원가표의 검역/차감 표 안에 Colombia가 함께 적혀 있어 전체 시트 문자열을
  // 먼저 검색하면 국가가 콜롬비아로 오인된다. 파일명·시트명 표기를 우선한다.
  const country = inferCountry(`${fileName} ${sheetName}`) || inferCountry(headText);
  const exchangeRate = parseArrivalNumber(firstMatchingValue(aoa, /환율|exchange.?rate/i));
  const grossWeight = labeledWeightNumber(aoa, ['GW', 'GrossWeight', 'Gross Weight', '그로스웨이트'])
    ?? parseArrivalNumber(firstMatchingValue(aoa, /gross\s*weigh|grossweight|^gw$/i));
  const chargeableWeight = labeledWeightNumber(aoa, ['CW', 'ChargeableWeight', 'Chargeable Weight', 'Chargeable', '차져블웨이트', '차저블웨이트'])
    ?? parseArrivalNumber(firstMatchingValue(aoa, /chargeable|chargeableweight|^cw$|vracht/i));
  const invoiceUSD = parseArrivalNumber(firstMatchingValue(aoa, /총금액\s*invoice|invoice\s*total|invoice/i));
  const freightUSD = parseArrivalNumber(firstMatchingValue(aoa, /항공료|운송료|freight\s*total/i));
  const farmText = firstText(aoa, /holex|melody|cloud|farm|농장|grower|supplier/i, 3);
  return {
    orderYear: String(defaultOrderYear || new Date().getFullYear()).slice(0, 4),
    orderWeek,
    country,
    exchangeRate,
    grossWeight,
    chargeableWeight,
    invoiceUSD,
    freightUSD,
    farmNameRaw: farmText && !/원가자료/i.test(farmText) ? farmText : '',
  };
}

function compactArrivalRawJson(row, headers, meta) {
  const cells = {};
  const width = Math.max(headers.length, row.length);
  for (let i = 0; i < width; i += 1) {
    if (row[i] == null || row[i] === '') continue;
    cells[text(headers[i]) || String(i)] = row[i];
  }
  return JSON.stringify({
    cells,
    meta: {
      orderWeek: meta.orderWeek,
      country: meta.country,
      grossWeight: meta.grossWeight,
      chargeableWeight: meta.chargeableWeight,
      exchangeRate: meta.exchangeRate,
    },
  });
}

function addBasisMetrics(rows, productsByKey) {
  const groups = new Map();
  for (const row of rows) {
    const product = row.prodKey ? productsByKey.get(Number(row.prodKey)) : null;
    const qty = Number(row.quantity) || 0;
    const stemsPerBox = Number(product?.SteamOf1Box || 0) || 1;
    row.weightMetric = qty * ((Number(product?.BoxWeight) || 0) / stemsPerBox || 1);
    row.volumeMetric = qty * ((Number(product?.BoxCBM) || 0) / stemsPerBox || 1);
    row.valueMetric = qty * (Number(row.fobUSD) || 0);
    const key = `${row.orderYear}|${row.orderWeek}|${row.country}|${row.sheetName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    for (const basis of ['weightMetric', 'volumeMetric', 'valueMetric']) {
      const total = group.reduce((sum, row) => sum + (Number(row[basis]) || 0), 0);
      for (const row of group) row[`${basis}Share`] = total > 0 ? Number(row[basis]) / total : 0;
    }
  }
  return rows;
}

export function calculateArrivalCost(row, basis = row.allocationBasis || 'SOURCE') {
  const source = Number(row.sourceArrivalCostKRW || row.sourceArrivalCostPerUnitKRW || 0);
  if (basis === 'SOURCE') return { cost: source, calculated: false, reason: '엑셀 표시 원가' };
  const qty = Number(row.quantity) || 0;
  const fx = Number(row.exchangeRate) || 0;
  const fob = Number(row.fobUSD) || 0;
  const freightTotal = Number(row.freightUSD) || 0;
  const share = basis === 'WEIGHT'
    ? Number(row.weightMetricShare || 0)
    : basis === 'VOLUME'
      ? Number(row.volumeMetricShare || 0)
      : basis === 'VALUE'
        ? Number(row.valueMetricShare || 0)
        : (qty > 0 ? 1 / Math.max(1, Number(row.groupLineCount || 1)) : 0);
  if (!(qty > 0 && fx > 0 && fob >= 0 && freightTotal >= 0 && share >= 0)) {
    return { cost: source, calculated: false, reason: '원가 계산에 필요한 원본값 부족' };
  }
  const freightPerUnitUSD = freightTotal * share / qty;
  const customs = Number(row.customsPerUnitKRW) || 0;
  const other = Number(row.otherPerUnitKRW) || 0;
  const cost = (fob + freightPerUnitUSD) * fx + customs + other;
  return { cost: Number.isFinite(cost) ? cost : source, calculated: true, reason: '' };
}

/**
 * 원가자료 workbook 전체 시트를 읽는다. 매칭 실패 행도 버리지 않고 반환한다.
 */
export function parseArrivalCostWorkbook(input, {
  fileName = '',
  orderYear,
  orderWeek,
  products = [],
  farms = [],
  mappings = {},
} = {}) {
  const workbook = typeof input === 'string'
    ? XLSX.readFile(input, XLSX_READ_OPTS)
    : XLSX.read(input, { type: 'buffer', ...XLSX_READ_OPTS });
  const productsList = buildProductLookups(products);
  const productsByKey = new Map(productsList.map((p) => [Number(p.ProdKey), p]));
  const rows = [];
  const sheetStats = [];
  let detectedTableCount = 0;

  for (const sheetName of workbook.SheetNames) {
    hydrateSheetFormulas(workbook.Sheets[sheetName]);
    expandMergedCells(workbook.Sheets[sheetName]);
    const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: null });
    const table = findTableHeader(aoa);
    if (!table) continue;
    detectedTableCount += 1;
    const meta = inferMeta({ aoa, sheetName, fileName, defaultOrderYear: orderYear, defaultOrderWeek: orderWeek });
    const columns = findArrivalColumns(table.headers);
    const qtyHeaderText = table.headers[columns.quantity];
    const unitCountHeaderText = table.headers[columns.unitCount];
    const unitCostHeaderText = table.headers[columns.unitCost];
    let productIdx = columns.product;
    let quantityIdx = columns.quantity;
    let shiftFarm = -1;
    const probe = aoa[table.rowIndex + 1] || [];
    if (productIdx >= 0 && quantityIdx >= 0 && !isNumeric(probe[quantityIdx]) && isNumeric(probe[quantityIdx + 1])) {
      shiftFarm = productIdx;
      productIdx += 1;
      quantityIdx += 1;
      for (const key of ['fob', 'freightPerUnit', 'customsPerUnit', 'otherPerUnit', 'unitCount', 'unitLabel', 'stemCost', 'unitCost', 'vatCost']) {
        if (columns[key] >= 0) columns[key] += 1;
      }
    }
    // 수국 자료처럼 Color Grade가 c1, 농장명이 c0에 있고 수량은 c4에
    // 떨어져 있는 양식은 품목/수량 열을 옮기지 않고 앞 열을 농장으로 취급한다.
    if (shiftFarm < 0 && productIdx > 0 && text(probe[productIdx]) && !isNumeric(probe[productIdx]) && text(probe[productIdx - 1])) {
      shiftFarm = productIdx - 1;
    }
    if (shiftFarm < 0 && columns.farm >= 0) shiftFarm = columns.farm;
    const farmRawDefault = meta.farmNameRaw;
    let lastFarmRaw = shiftFarm >= 0 ? '' : farmRawDefault;
    const economics = isColorGradeHydrangeaTable(table.headers)
      ? hydrangeaSheetEconomics(aoa, quantityIdx, table.rowIndex + 1)
      : null;
    let sheetRows = 0;
    for (let r = table.rowIndex + 1; r < aoa.length; r += 1) {
      const row = aoa[r] || [];
      const farmCell = shiftFarm >= 0 ? text(row[shiftFarm]) : text(row[0]);
      const quantity = parseArrivalNumber(row[quantityIdx]);
      if (!(quantity > 0)) {
        const banner = farmCell || (shiftFarm !== productIdx ? text(row[productIdx]) : '');
        if (
          banner
          && !isNumeric(banner)
          && !/^(total|합계|grand total|소계)$/i.test(banner)
          && !matchProduct(banner, productsList, mappings)
        ) {
          lastFarmRaw = banner;
        }
        continue;
      }
      const rawName = text(row[productIdx]);
      if (!rawName || /^(total|합계|grand total|소계)$/i.test(rawName)) continue;
      const product = matchProduct(rawName, productsList, mappings);
      let farmNameRaw = shiftFarm >= 0 ? text(row[shiftFarm]) : farmRawDefault;
      if (!farmNameRaw) farmNameRaw = lastFarmRaw;
      if (farmNameRaw) lastFarmRaw = farmNameRaw;
      const farm = matchArrivalFarm(farmNameRaw, farms);
      let sourceStem = parseArrivalNumber(row[columns.stemCost]);
      let sourceUnit = parseArrivalNumber(row[columns.unitCost]);
      const unitCount = parseArrivalNumber(row[columns.unitCount]);
      const unit = inferArrivalQtyUnit({
        quantityHeader: qtyHeaderText,
        unitCountHeader: unitCountHeaderText,
        unitCostHeader: unitCostHeaderText,
        unitCount,
        unitLabel: columns.unitLabel >= 0 ? text(row[columns.unitLabel]) : '',
        product,
      });
      let sourceArrivalCost = pickDisplayedArrivalCost({ sourceStem, sourceUnit, unit, unitCount });
      const filled = !(sourceArrivalCost > 0) ? fillHydrangeaLandedCost(row, columns, economics) : null;
      if (filled) {
        sourceStem = filled.sourceStem;
        sourceUnit = filled.sourceUnit;
        sourceArrivalCost = pickDisplayedArrivalCost({
          sourceStem, sourceUnit, unit, unitCount: unitCount || parseArrivalNumber(row[columns.unitCount]) || 1,
        });
      }
      if (!(sourceArrivalCost > 0)) continue;
      const nextCostValue = columns.unitCost >= 0 ? parseArrivalNumber(row[columns.unitCost + 1]) : null;
      const sourceVat = parseArrivalNumber(row[columns.vatCost])
        ?? (sourceUnit > 0 && nextCostValue > sourceUnit * 1.05 && nextCostValue < sourceUnit * 1.2 ? nextCostValue : null);
      const item = {
        orderYear: meta.orderYear,
        orderWeek: meta.orderWeek,
        countryName: meta.country || inferCountry(rawName),
        flowerNameRaw: inferArrivalFlower(`${rawName} ${fileName} ${sheetName}`) || product?.FlowerName || '',
        productNameRaw: rawName,
        farmNameRaw,
        prodKey: pickField(product, 'ProdKey', 'ProdKey') || null,
        farmKey: pickField(farm, 'FarmKey', 'FarmKey') || null,
        unit,
        quantity,
        fobUSD: parseArrivalNumber(row[columns.fob]),
        freightPerUnitUSD: parseArrivalNumber(row[columns.freightPerUnit]) ?? filled?.freightPerUnitUSD ?? null,
        customsPerUnitKRW: parseArrivalNumber(row[columns.customsPerUnit]),
        otherPerUnitKRW: parseArrivalNumber(row[columns.otherPerUnit]) ?? filled?.otherPerUnitKRW ?? null,
        sourceArrivalCostPerStemKRW: sourceStem || sourceArrivalCost,
        sourceArrivalCostPerUnitKRW: sourceUnit || sourceArrivalCost,
        sourceArrivalCostKRW: sourceArrivalCost,
        sourceArrivalCostVatKRW: sourceVat || null,
        exchangeRate: filled?.exchangeRate || meta.exchangeRate,
        grossWeight: filled?.grossWeight || meta.grossWeight,
        chargeableWeight: filled?.chargeableWeight || meta.chargeableWeight,
        freightUSD: filled?.freightUSD || meta.freightUSD,
        invoiceUSD: meta.invoiceUSD,
        allocationBasis: 'SOURCE',
        matchStatus: product && farmNameRaw && farm ? 'MATCHED' : product ? 'FARM_REQUIRED' : 'PRODUCT_REQUIRED',
        sourceFileName: fileName,
        sheetName,
        sourceRow: r + 1,
        rawJson: compactArrivalRawJson(row, table.headers, meta),
      };
      item.selectedArrivalCostKRW = item.sourceArrivalCostKRW;
      rows.push(item);
      sheetRows += 1;
    }
    if (sheetRows > 0) sheetStats.push({ sheetName, orderWeek: meta.orderWeek, country: meta.country, rows: sheetRows });
  }

  addBasisMetrics(rows, productsByKey);
  return {
    sheetCount: sheetStats.length,
    sheetStats,
    detectedTableCount,
    rowCount: rows.length,
    matchedCount: rows.filter((r) => r.matchStatus === 'MATCHED').length,
    unmatchedCount: rows.filter((r) => r.matchStatus !== 'MATCHED').length,
    rows,
  };
}
