// lib/chat/handlers/stock.js — 재고 조회
import fs from 'fs/promises';
import path from 'path';
import { query, sql } from '../../db';
import { findProduct } from '../entities';
import { buildDisambiguationForText } from '../disambiguation';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
let mappingCache = null;

const STOCK_KO_KEYWORDS = {
  '수국': 'HYDRANGEA',
  '장미': 'ROSE',
  '카네이션': 'CARNATION',
  '카네': 'CARNATION',
  '알스트로': 'ALSTROEMERIA',
  '콜롬비아': 'COLOMBIA',
  '콜': 'COLOMBIA',
};

const STOCK_FLOWER_KEYWORDS = new Set(['수국', '장미', '카네이션', '카네', '알스트로']);
const STOCK_COUNTRY_KEYWORDS = new Set(['콜롬비아', '콜']);
const STOCK_DISPLAY_NAMES = {
  COLOMBIA: '콜롬비아',
  HYDRANGEA: '수국',
  ROSE: '장미',
  CARNATION: '카네이션',
  ALSTROEMERIA: '알스트로',
};
const MANUAL_STOCK_CHANGE_SQL = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

function extractWeekLocal(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(?:-|차\s*)\s*(\d{1,2})/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const major = String(text || '').match(/(\d{1,2})\s*차/);
  if (major) return `${major[1].padStart(2, '0')}-01`;
  return null;
}

async function getLatestWeek() {
  const r = await query(
    `SELECT TOP 1 w
       FROM (
         SELECT OrderWeek AS w FROM OrderMaster WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderWeek AS w FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderWeek AS w FROM StockMaster WHERE OrderWeek LIKE '__-__'
       ) x
      ORDER BY w DESC`,
    {}
  );
  return r.recordset?.[0]?.w || null;
}

async function findFlowerInText(text) {
  const r = await query(
    `SELECT FlowerName
       FROM Product
      WHERE ISNULL(isDeleted,0)=0
        AND FlowerName IS NOT NULL
        AND FlowerName <> ''
      GROUP BY FlowerName
      ORDER BY LEN(FlowerName) DESC`,
    {}
  );
  const rows = r.recordset || [];
  const direct = rows.find(f => text.includes(f.FlowerName))?.FlowerName;
  if (direct) return direct;
  for (const [ko, en] of Object.entries(STOCK_KO_KEYWORDS)) {
    if (!STOCK_FLOWER_KEYWORDS.has(ko) || !text.includes(ko)) continue;
    const byAlias = rows.find(f => String(f.FlowerName || '').toUpperCase().includes(en))?.FlowerName;
    return byAlias || en;
  }
  return null;
}

function findCountryInText(text) {
  if (!/콜롬비아|콜\b/i.test(String(text || ''))) return null;
  return 'COLOMBIA';
}

function hasOnlyGenericStockTokens(text) {
  const tokens = extractSearchTokens(text);
  if (!tokens.length) return false;
  return tokens.every(t => STOCK_FLOWER_KEYWORDS.has(t) || STOCK_COUNTRY_KEYWORDS.has(t));
}

async function getProductByKey(prodKey) {
  if (!prodKey) return null;
  const r = await query(
    `SELECT TOP 1 ProdKey, ProdName, DisplayName, FlowerName, CounName, OutUnit
       FROM Product
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } }
  );
  return r.recordset?.[0] || null;
}

async function getOrderMappings() {
  if (mappingCache) return mappingCache;
  try {
    const file = path.join(process.cwd(), 'data', 'order-mappings.json');
    const raw = await fs.readFile(file, 'utf8');
    mappingCache = JSON.parse(raw);
  } catch (_) {
    mappingCache = {};
  }
  return mappingCache;
}

function mappingKeyMatchesText(key, text) {
  const normalizedText = String(text || '').toLowerCase();
  const tokens = String(key || '')
    .replace(/[<>\[\](){}]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 2);
  if (!tokens.length) return false;
  return tokens.every(t => normalizedText.includes(t));
}

async function findMappedProductsInText(text, limit = 5) {
  const mappings = await getOrderMappings();
  const hits = [];
  const seen = new Set();
  const entries = Object.entries(mappings)
    .filter(([, v]) => v?.prodKey)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of entries) {
    if (!mappingKeyMatchesText(key, text)) continue;
    if (seen.has(value.prodKey)) continue;
    const prod = await getProductByKey(value.prodKey);
    if (prod) {
      hits.push(prod);
      seen.add(value.prodKey);
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

function stockModeLabel(mode) {
  return mode === 'incomingFarm' ? '입고 농장/수량' : '재고현황';
}

function stockPayloadMode(mode) {
  return mode === 'incomingFarm' ? 'incomingFarm' : 'weekStockStatus';
}

function shouldExcludeZero(text, payload = null) {
  if (payload?.hideZero === false || /(?:0|영|제로)\s*(?:포함)|전체\s*(?:포함|보기)|0도\s*(?:보여|포함)/.test(String(text || ''))) {
    return false;
  }
  return true;
}

function stockRemainValue(row) {
  return Number(row?.CalcRemain || 0);
}

function displayScopeName(value) {
  const raw = String(value || '').trim();
  return STOCK_DISPLAY_NAMES[raw.toUpperCase()] || raw;
}

function targetLabel({ prod, flower, country } = {}) {
  if (prod) return `${prod.FlowerName ? `${prod.FlowerName} / ` : ''}${prod.ProdName}`;
  return [country, flower].filter(Boolean).map(displayScopeName).join(' / ') || '전체';
}

function understoodStockText({ week, mode, prod, flower, country, rowCount, extraPath = '' }) {
  const modeLabel = stockModeLabel(mode);
  const target = targetLabel({ prod, flower, country });
  const pathLine = extraPath || (
    mode === 'incomingFarm'
      ? '검색 경로: 차수 정규화 → 품목/꽃종류 매칭 → WarehouseMaster/WarehouseDetail 농장별 입고수량 집계.'
      : '검색 경로: 차수 정규화 → 품목/꽃종류 매칭 → 전재고 + 입고 + 수동재고조정 - 출고분배 계산.'
  );
  return [
    `제가 이해한 조건: ${week}차, ${target}, ${modeLabel}.`,
    pathLine,
    Number.isFinite(rowCount) ? `조회된 후보/행: ${rowCount}건.` : null,
  ].filter(Boolean).join('\n');
}

function stockGroupTitle(row) {
  return [row?.CounName, row?.FlowerName].filter(Boolean).join(' ') || '기타';
}

function formatGroupedStockText(rows, { limit = 80 } = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    const title = stockGroupTitle(row);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(row);
  }
  const lines = [];
  let shown = 0;
  for (const [title, list] of groups.entries()) {
    if (shown >= limit) break;
    if (lines.length) lines.push('');
    lines.push(title);
    for (const row of list) {
      if (shown >= limit) break;
      lines.push(`${row.ProdName} ${fmt(stockRemainValue(row))}${row.OutUnit ? ` ${row.OutUnit}` : ''}`);
      shown += 1;
    }
  }
  return {
    text: lines.join('\n'),
    shown,
    groupCount: groups.size,
  };
}

function groupedStockCardRows(rows, { limit = 80 } = {}) {
  const out = [];
  let lastTitle = '';
  for (const row of rows || []) {
    if (out.length >= limit) break;
    const title = stockGroupTitle(row);
    if (title !== lastTitle) {
      out.push({ label: title, value: '' });
      lastTitle = title;
      if (out.length >= limit) break;
    }
    out.push({
      label: row.ProdName,
      value: `${fmt(stockRemainValue(row))} ${row.OutUnit || ''}`.trim(),
    });
  }
  return out.slice(0, limit);
}

function extractSearchTokens(text) {
  return Array.from(new Set(String(text || '')
    .replace(/\d{1,2}\s*(?:-|차\s*)\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*차/g, ' ')
    .replace(/현재차수|현재\s*차수|이번차수|이번\s*차수|재고현황|재고|잔량|입고농장|입고|농장|수량|확인|알려줘|차수|차/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
    .slice(0, 8)));
}

function expandSearchTokens(tokens) {
  const expanded = [];
  for (const token of tokens || []) {
    expanded.push(token);
    const mapped = STOCK_KO_KEYWORDS[token];
    if (mapped) expanded.push(mapped);
  }
  return Array.from(new Set(expanded));
}

function stockLikeTerms(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  const terms = [raw];
  for (const [ko, en] of Object.entries(STOCK_KO_KEYWORDS)) {
    if (upper === en || upper.includes(en) || raw.includes(ko)) {
      terms.push(ko, en);
    }
  }
  return Array.from(new Set(terms.filter(Boolean)));
}

function addLikeTerms(params, prefix, terms) {
  const keys = [];
  terms.forEach((term, i) => {
    const key = `${prefix}${i}`;
    params[key] = { type: sql.NVarChar, value: `%${term}%` };
    keys.push(key);
  });
  return keys;
}

function wantsIncomingFarmDetail(text, payload = null) {
  if (payload?.detail === true || payload?.groupBy === 'product') return true;
  return /(품목별|품목\s*별|품목|품종|상세|세부|라인|내역|원본)/.test(String(text || ''));
}

function wantsIncomingFarmSummary(text, payload = null) {
  if (payload?.groupBy === 'farm') return true;
  return /(농장별\s*합계|농장\s*합계|농장만|농장별로\s*합)/.test(String(text || ''));
}

function aggregateIncomingFarmRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const farmName = row.FarmName || '(농장 미입력)';
    const unit = row.OutUnit || '';
    const key = `${farmName}\u0001${unit}`;
    const prev = map.get(key) || { FarmName: farmName, OutUnit: unit, InQty: 0, ItemCount: 0 };
    prev.InQty += Number(row.InQty || 0);
    prev.ItemCount += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) =>
    String(a.FarmName || '').localeCompare(String(b.FarmName || ''), 'ko') ||
    String(a.OutUnit || '').localeCompare(String(b.OutUnit || ''), 'ko')
  );
}

function groupIncomingRowsByProduct(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const prodKey = row.ProdKey || row.ProdName || '';
    const unit = row.OutUnit || '';
    const key = `${prodKey}\u0001${unit}`;
    const group = map.get(key) || {
      ProdKey: row.ProdKey,
      ProdName: row.ProdName || '',
      FlowerName: row.FlowerName || '',
      CounName: row.CounName || '',
      OutUnit: unit,
      InQty: 0,
      farms: new Map(),
    };
    const farmName = row.FarmName || '(농장 미입력)';
    const qty = Number(row.InQty || 0);
    group.InQty += qty;
    group.farms.set(farmName, (group.farms.get(farmName) || 0) + qty);
    map.set(key, group);
  }
  return [...map.values()]
    .map(group => ({
      ...group,
      farmRows: [...group.farms.entries()]
        .map(([FarmName, InQty]) => ({ FarmName, InQty }))
        .sort((a, b) => String(a.FarmName || '').localeCompare(String(b.FarmName || ''), 'ko')),
    }))
    .sort((a, b) =>
      String(a.FlowerName || '').localeCompare(String(b.FlowerName || ''), 'ko') ||
      String(a.ProdName || '').localeCompare(String(b.ProdName || ''), 'ko')
    );
}

function formatIncomingProductFarmLine(group) {
  const unit = group.OutUnit || '';
  const farmText = group.farmRows
    .map(f => `${f.FarmName} ${fmt(f.InQty)}${unit ? ` ${unit}` : ''}`)
    .join(', ');
  const totalText = group.farmRows.length > 1
    ? ` (합계 ${fmt(group.InQty)}${unit ? ` ${unit}` : ''})`
    : '';
  return `${group.ProdName}: ${farmText}${totalText}`;
}

async function findProductCandidates(text, limit = 6) {
  const tokens = expandSearchTokens(extractSearchTokens(text));
  const mapped = await findMappedProductsInText(text, limit).catch(() => []);
  if (!tokens.length) return mapped.slice(0, limit);
  const where = tokens
    .map((_, i) => `(p.ProdName LIKE @t${i} OR ISNULL(p.DisplayName,'') LIKE @t${i} OR p.FlowerName LIKE @t${i} OR p.CounName LIKE @t${i})`)
    .join(' OR ');
  const params = {};
  tokens.forEach((t, i) => {
    params[`t${i}`] = { type: sql.NVarChar, value: `%${t}%` };
  });
  const top = Math.max(1, Math.min(Number(limit) || 6, 12));
  const r = await query(
    `SELECT TOP ${top}
            p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
            CASE
              ${tokens.map((_, i) => `WHEN p.ProdName LIKE @t${i} THEN ${i + 1}`).join('\n              ')}
              ELSE 99
            END AS RankNo
       FROM Product p
      WHERE ISNULL(p.isDeleted,0)=0
        AND (${where})
      ORDER BY RankNo, p.FlowerName, p.CounName, p.ProdName`,
    params
  );
  const rows = r.recordset || [];
  const seen = new Set(mapped.map(p => p.ProdKey));
  return [
    ...mapped,
    ...rows.filter(p => !seen.has(p.ProdKey)),
  ].slice(0, limit);
}

async function findProductByAllTokens(text) {
  const baseTokens = extractSearchTokens(text);
  if (baseTokens.length < 2) return null;
  const tokenGroups = baseTokens.map(t => [t, STOCK_KO_KEYWORDS[t]].filter(Boolean));
  const where = tokenGroups
    .map((group, i) => `(${group.map((_, j) => `(p.ProdName LIKE @t${i}_${j} OR ISNULL(p.DisplayName,'') LIKE @t${i}_${j} OR p.FlowerName LIKE @t${i}_${j} OR p.CounName LIKE @t${i}_${j})`).join(' OR ')})`)
    .join(' AND ');
  const params = {};
  tokenGroups.forEach((group, i) => {
    group.forEach((t, j) => {
      params[`t${i}_${j}`] = { type: sql.NVarChar, value: `%${t}%` };
    });
  });
  const r = await query(
    `SELECT TOP 1 p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
       FROM Product p
      WHERE ISNULL(p.isDeleted,0)=0
        AND ${where}
      ORDER BY
        CASE WHEN p.ProdName LIKE @t${baseTokens.length - 1}_0 OR ISNULL(p.DisplayName,'') LIKE @t${baseTokens.length - 1}_0 THEN 0 ELSE 1 END,
        p.FlowerName, p.CounName, p.ProdName`,
    params
  );
  return r.recordset?.[0] || null;
}

async function buildStockTargetClarification(text, week, mode, reason = '') {
  const modeLabel = stockModeLabel(mode);
  const candidates = await findProductCandidates(text, 8).catch(() => []);
  const choices = [];
  const seenFlowers = new Set();

  for (const p of candidates.slice(0, 6)) {
    choices.push({
      label: `${p.ProdName} ${modeLabel}`,
      sub: `${p.CounName || ''} / ${p.FlowerName || ''}`.trim(),
      text: `${week ? `${week}차 ` : ''}${p.ProdName} ${modeLabel}`,
      payload: {
        intent: 'stock',
        mode: stockPayloadMode(mode),
        ...(week ? { week } : {}),
        prodKey: p.ProdKey,
      },
    });

    if (p.FlowerName && !seenFlowers.has(p.FlowerName)) {
      seenFlowers.add(p.FlowerName);
      choices.push({
        label: `${p.FlowerName} 전체 ${modeLabel}`,
        sub: '품목 하나가 아니라 꽃종류 전체 합계',
        text: `${week ? `${week}차 ` : ''}${p.FlowerName} ${modeLabel}`,
        payload: {
          intent: 'stock',
          mode: stockPayloadMode(mode),
          scope: 'flower',
          flower: p.FlowerName,
          ...(week ? { week } : {}),
        },
      });
    }
  }

  const prompt = week
    ? `제가 이해한 질문은 "${week}차 ${modeLabel}"입니다. 품목 기준만 확인해 주세요.`
    : `제가 이해한 질문은 "${modeLabel}"입니다. 차수와 품목 기준을 확인해 주세요.`;

  if (!choices.length) {
    return {
      messages: [
        { type: 'text', content: `${reason || '품목 기준을 확정하지 못했습니다.'}\n질문 의도는 ${modeLabel} 조회로 이해했어요. 품목명이나 꽃종류를 한 번만 더 적어주세요.` },
        {
          type: 'actions',
          actions: [
            { label: '예시: 20-1차 카네이션 재고현황', text: '20-1차 카네이션 재고현황' },
            { label: '예시: 20-1차 로다스 입고농장', text: '20-1차 로다스 입고농장 및 수량' },
          ],
        },
      ],
    };
  }

  return {
    messages: [
      { type: 'text', content: reason ? `${reason}\n${prompt}` : prompt },
      { type: 'choices', prompt: '맞는 기준을 선택하면 바로 조회합니다.', choices: choices.slice(0, 8) },
    ],
  };
}

async function resolveWeekTarget(text, payload) {
  const payloadProd = await getProductByKey(payload?.prodKey);
  const payloadFlower = payload?.scope === 'flower' && payload?.flower ? payload.flower : payload?.flower;
  const payloadCountry = payload?.country || null;
  const country = payloadCountry || findCountryInText(text);
  const flowerFromText = payloadFlower || await findFlowerInText(text);
  if (!payloadProd && hasOnlyGenericStockTokens(text) && (flowerFromText || country)) {
    return { prod: null, flower: flowerFromText, country };
  }
  const mappedProd = payloadProd ? null : (await findMappedProductsInText(text, 1).catch(() => []))[0];
  const tokenProd = payloadProd || mappedProd ? null : await findProductByAllTokens(text).catch(() => null);
  const flower = payloadProd || mappedProd || tokenProd ? null : flowerFromText;
  const prod = payloadProd || mappedProd || tokenProd || (flower ? null : await findProduct(text));
  return { prod, flower, country };
}

async function runWeekIncomingFarmLookup(text, week, payload = null) {
  const { prod, flower, country } = await resolveWeekTarget(text, payload);
  const params = {
    week: { type: sql.NVarChar, value: week },
    ...(prod ? { pk: { type: sql.Int, value: prod.ProdKey } } : {}),
  };
  const filters = [];
  if (prod) {
    filters.push('wd.ProdKey=@pk');
  } else {
    if (flower) {
      const keys = addLikeTerms(params, 'flower', stockLikeTerms(flower));
      filters.push(`(${keys.map(k => `p.FlowerName LIKE @${k}`).join(' OR ')})`);
    }
    if (country) {
      const keys = addLikeTerms(params, 'country', stockLikeTerms(country));
      filters.push(`(${keys.map(k => `p.CounName LIKE @${k} OR ISNULL(p.CountryFlower,'') LIKE @${k}`).join(' OR ')})`);
    }
  }
  const filter = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const r = await query(
    `SELECT
        ISNULL(wm.FarmName, N'(농장 미입력)') AS FarmName,
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
        SUM(ISNULL(wd.OutQuantity,0)) AS InQty
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek=@week
        AND ISNULL(wm.isDeleted,0)=0
        AND ISNULL(p.isDeleted,0)=0
        ${filter}
      GROUP BY ISNULL(wm.FarmName, N'(농장 미입력)'),
               p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit
      ORDER BY p.FlowerName, p.ProdName, FarmName`,
    params
  );
  const rows = r.recordset || [];
  if (!rows.length) {
    return await buildStockTargetClarification(
      text,
      week,
      'incomingFarm',
      `${understoodStockText({ week, mode: 'incomingFarm', prod, flower, country, rowCount: 0 })}\n입고 농장 데이터가 바로 잡히지 않았습니다.`
    );
  }
  const total = rows.reduce((s, x) => s + Number(x.InQty || 0), 0);
  const detailMode = wantsIncomingFarmDetail(text, payload);
  const farmSummaryMode = wantsIncomingFarmSummary(text, payload);
  if (!detailMode && !farmSummaryMode) {
    const productRows = groupIncomingRowsByProduct(rows);
    const units = Array.from(new Set(productRows.map(x => x.OutUnit).filter(Boolean)));
    const unitText = units.length === 1 ? ` ${units[0]}` : '';
    const productLines = productRows
      .slice(0, 80)
      .map(formatIncomingProductFarmLine)
      .join('\n');
    return {
      messages: [
        {
          type: 'text',
          content: `${understoodStockText({ week, mode: 'incomingFarm', prod, flower, country, rowCount: productRows.length })}\n${week}차 ${targetLabel({ prod, flower, country })} 품목별 농장 입고수량 합계는 ${fmt(total)}${unitText}입니다.\n\n${productLines}`,
        },
        {
          type: 'card',
          card: {
            title: `${week}차 품목별 농장 입고수량`,
            subtitle: `${targetLabel({ prod, flower, country })} · 입고 라인 ${rows.length}건`,
            rows: productRows.slice(0, 80).map(x => ({
              label: x.ProdName,
              value: `${x.farmRows.map(f => `${f.FarmName} ${fmt(f.InQty)}${x.OutUnit ? ` ${x.OutUnit}` : ''}`).join(', ')}${x.farmRows.length > 1 ? ` · 합계 ${fmt(x.InQty)}${x.OutUnit ? ` ${x.OutUnit}` : ''}` : ''}`,
            })),
            footer: productRows.length > 80 ? `총 ${productRows.length}개 품목 중 80개 표시` : `총 ${productRows.length}개 품목`,
          },
        },
      ],
    };
  }
  if (farmSummaryMode) {
    const farmRows = aggregateIncomingFarmRows(rows);
    const units = Array.from(new Set(farmRows.map(x => x.OutUnit).filter(Boolean)));
    const unitText = units.length === 1 ? ` ${units[0]}` : '';
    const farmLines = farmRows
      .slice(0, 80)
      .map(x => `${x.FarmName} ${fmt(x.InQty)}${x.OutUnit ? ` ${x.OutUnit}` : ''}`)
      .join('\n');
    return {
      messages: [
        {
          type: 'text',
          content: `${understoodStockText({ week, mode: 'incomingFarm', prod, flower, country, rowCount: farmRows.length })}\n${week}차 ${targetLabel({ prod, flower, country })} 농장별 입고수량 합계는 ${fmt(total)}${unitText}입니다.\n\n${farmLines}`,
        },
        {
          type: 'card',
          card: {
            title: `${week}차 농장별 입고수량`,
            subtitle: `${targetLabel({ prod, flower, country })} · 품목 세부 ${rows.length}건 합산`,
            rows: farmRows.slice(0, 80).map(x => ({
              label: x.FarmName,
              value: `${fmt(x.InQty)} ${x.OutUnit || ''}`.trim(),
            })),
            footer: farmRows.length > 80 ? `총 ${farmRows.length}개 농장 중 80개 표시` : `총 ${farmRows.length}개 농장`,
          },
        },
      ],
    };
  }
  return {
    messages: [
      { type: 'text', content: `${understoodStockText({ week, mode: 'incomingFarm', prod, flower, country, rowCount: rows.length })}\n${week}차 ${targetLabel({ prod, flower, country })} 입고 농장/수량입니다. 총 ${fmt(total)}입니다.` },
      {
        type: 'card',
        card: {
          title: `${week}차 입고 농장`,
          subtitle: targetLabel({ prod, flower, country }),
          rows: rows.slice(0, 80).map(x => ({
            label: `${x.FarmName} / ${x.CounName || ''} ${x.FlowerName || ''} ${x.ProdName}`.trim(),
            value: `${fmt(x.InQty)} ${x.OutUnit || ''}`,
          })),
          footer: rows.length > 80 ? `총 ${rows.length}건 중 80건 표시` : `총 ${rows.length}건`,
        },
      },
    ],
  };
}

async function runWeekStockStatusLookup(text, week, payload = null) {
  const { prod, flower, country } = await resolveWeekTarget(text, payload);
  const params = {
    week: { type: sql.NVarChar, value: week },
    ...(prod ? { pk: { type: sql.Int, value: prod.ProdKey } } : {}),
  };
  const filters = [];
  if (prod) {
    filters.push('p.ProdKey=@pk');
  } else {
    if (flower) {
      const keys = addLikeTerms(params, 'flower', stockLikeTerms(flower));
      filters.push(`(${keys.map(k => `p.FlowerName LIKE @${k}`).join(' OR ')})`);
    }
    if (country) {
      const keys = addLikeTerms(params, 'country', stockLikeTerms(country));
      filters.push(`(${keys.map(k => `p.CounName LIKE @${k} OR ISNULL(p.CountryFlower,'') LIKE @${k}`).join(' OR ')})`);
    }
  }
  const filter = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const r = await query(
    `SELECT
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
        ISNULL(prev.prevStock, 0) AS PrevStock,
        ISNULL(wh.inQty, 0) AS WarehouseInQty,
        ISNULL(adj.adjustQty, 0) AS AdjustQty,
        ISNULL(wh.inQty, 0) + ISNULL(adj.adjustQty, 0) AS InQty,
        ISNULL(ship.outQty, 0) AS OutQty,
        ISNULL(prev.prevStock, 0) + ISNULL(wh.inQty, 0) + ISNULL(adj.adjustQty, 0) - ISNULL(ship.outQty, 0) AS CalcRemain,
        fix.Stock AS FixedRemain,
        fix.OrderWeek AS FixedWeek
       FROM Product p
       OUTER APPLY (
         SELECT TOP 1 ps.Stock AS prevStock
           FROM ProductStock ps
           JOIN StockMaster sm ON ps.StockKey=sm.StockKey
          WHERE ps.ProdKey=p.ProdKey
            AND sm.OrderWeek < @week
            AND sm.OrderWeek LIKE '__-__'
          ORDER BY sm.OrderWeek DESC
       ) prev
       OUTER APPLY (
         SELECT SUM(wd.OutQuantity) AS inQty
           FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
          WHERE wd.ProdKey=p.ProdKey
            AND wm.OrderWeek=@week
            AND ISNULL(wm.isDeleted,0)=0
       ) wh
       OUTER APPLY (
         SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS adjustQty
           FROM StockHistory sh
          WHERE sh.ProdKey=p.ProdKey
            AND sh.OrderWeek=@week
            AND ${MANUAL_STOCK_CHANGE_SQL}
       ) adj
       OUTER APPLY (
         SELECT SUM(sd.OutQuantity) AS outQty
           FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
          WHERE sd.ProdKey=p.ProdKey
            AND sm.OrderWeek=@week
            AND ISNULL(sm.isDeleted,0)=0
       ) ship
       OUTER APPLY (
         SELECT TOP 1 ps.Stock, sm.OrderWeek
           FROM ProductStock ps
           JOIN StockMaster sm ON ps.StockKey=sm.StockKey
          WHERE ps.ProdKey=p.ProdKey
            AND sm.OrderWeek=@week
            AND sm.isFix=1
          ORDER BY sm.StockKey DESC
       ) fix
      WHERE ISNULL(p.isDeleted,0)=0
        ${filter}
        AND (
          ISNULL(prev.prevStock,0) <> 0 OR ISNULL(wh.inQty,0) <> 0
          OR ISNULL(adj.adjustQty,0) <> 0 OR ISNULL(ship.outQty,0) <> 0 OR fix.Stock IS NOT NULL
        )
      ORDER BY p.CounName, p.FlowerName, p.ProdName`,
    params
  );
  const rows = r.recordset || [];
  if (!rows.length) {
    return await buildStockTargetClarification(
      text,
      week,
      'weekStockStatus',
      `${understoodStockText({ week, mode: 'weekStockStatus', prod, flower, country, rowCount: 0 })}\n재고현황 데이터가 바로 잡히지 않았습니다.`
    );
  }
  const hideZero = shouldExcludeZero(text, payload);
  const visibleRows = hideZero ? rows.filter(x => stockRemainValue(x) !== 0) : rows;
  const totalRemain = visibleRows.reduce((s, x) => s + stockRemainValue(x), 0);
  const titleName = targetLabel({ prod, flower, country });
  const units = Array.from(new Set(visibleRows.map(x => x.OutUnit).filter(Boolean)));
  const unitText = units.length === 1 ? ` ${units[0]}` : '';
  if (!visibleRows.length) {
    return {
      messages: [
        {
          type: 'text',
          content: `${understoodStockText({
            week,
            mode: 'weekStockStatus',
            prod,
            flower,
            country,
            rowCount: rows.length,
            extraPath: '검색 경로: 전차수 ProductStock → 현차수 입고 → 수동재고조정 → 현차수 출고분배 → 계산잔량 산출.',
          })}\n${hideZero ? '0 잔량을 제외하니 표시할 품목이 없습니다.' : '표시할 잔량이 없습니다.'}`,
        },
      ],
    };
  }
  const grouped = formatGroupedStockText(visibleRows, { limit: 80 });
  return {
    messages: [
      {
        type: 'text',
        content: `${understoodStockText({
          week,
          mode: 'weekStockStatus',
          prod,
          flower,
          country,
          rowCount: visibleRows.length,
          extraPath: '검색 경로: 전차수 ProductStock → 현차수 입고 → 수동재고조정 → 현차수 출고분배 → 계산잔량 산출.',
        })}\n${week}차 ${titleName} 계산잔량은 ${fmt(totalRemain)}${unitText}입니다.${hideZero ? ' 0 잔량은 제외했습니다.' : ' 0 잔량도 포함했습니다.'}\n\n${grouped.text}`,
      },
      {
        type: 'card',
        card: {
          title: `${week}차 ${titleName} 계산잔량`,
          subtitle: '전재고 + 입고 + 수동재고조정 - 출고 기준',
          rows: groupedStockCardRows(visibleRows, { limit: 80 }),
          footer: `${hideZero ? '0 제외 · ' : ''}${visibleRows.length > 80 ? `총 ${visibleRows.length}건 중 80건 표시` : `총 ${visibleRows.length}건`} · 잔량합계 ${fmt(totalRemain)}${unitText}`,
        },
      },
    ],
  };
}

export async function handleStockLookup(text, user, payload = null) {
  let week = payload?.week || extractWeekLocal(text);
  if (!week && /(현재\s*차수|현재차수|이번\s*차수|이번차수)/.test(text)) {
    week = await getLatestWeek();
  }
  if (week && (payload?.mode === 'incomingFarm' || payload?.mode === 'weekIncomingFarm')) {
    return await runWeekIncomingFarmLookup(text, week, payload);
  }
  if (week && payload?.mode === 'weekStockStatus') {
    return await runWeekStockStatusLookup(text, week, payload);
  }
  if (week && /(입고\s*농장|입고농장|농장|입고.*수량|수량.*입고)/.test(text)) {
    return await runWeekIncomingFarmLookup(text, week, payload);
  }
  if (week && /(재고\s*현황|재고현황|잔량|재고)/.test(text)) {
    return await runWeekStockStatusLookup(text, week, payload);
  }

  // 디스앰비기에이션 (부족 모드 제외 — 부족은 명확)
  if (!payload && !/부족|마이너스|음수/.test(text)) {
    const disambig = await buildDisambiguationForText(text, { intent: 'stock' });
    if (disambig) return disambig;
  }
  // 원산지 기반 재고 합계
  if (payload?.scope === 'origin' && payload?.country) {
    return await runStockOriginLookup(payload.country);
  }
  // 꽃 종류 기반 재고 합계
  if (payload?.scope === 'flower' && payload?.flower) {
    return await runStockFlowerLookup(payload.flower);
  }

  // "재고 부족" 전용 모드
  if (/부족|마이너스|음수/.test(text)) {
    const rows = await query(
      `SELECT TOP 20 p.ProdName, p.OutUnit,
              ISNULL(latest.Stock, ISNULL(p.Stock,0)) AS CurrentStock
         FROM Product p
    OUTER APPLY (
      SELECT TOP 1 ps.Stock
        FROM ProductStock ps
        JOIN StockMaster sm ON sm.StockKey = ps.StockKey
       WHERE ps.ProdKey = p.ProdKey
       ORDER BY sm.OrderWeek DESC, sm.StockKey DESC
    ) latest
        WHERE ISNULL(p.isDeleted,0)=0
          AND ISNULL(latest.Stock, ISNULL(p.Stock,0)) <= 0
        ORDER BY ISNULL(latest.Stock, ISNULL(p.Stock,0)) ASC`,
      {}
    );
    if (rows.recordset.length === 0) {
      return { messages: [{ type: 'text', content: '✅ 재고 부족 품목이 없습니다.' }] };
    }
    return {
      messages: [
        { type: 'text', content: `⚠️ 재고 부족 품목 ${rows.recordset.length}건` },
        {
          type: 'card',
          card: {
            title: '재고 부족 / 마이너스 품목',
            rows: rows.recordset.map(r => ({
              label: r.ProdName,
              value: `${r.CurrentStock ?? 0} ${r.OutUnit || ''}`,
            })),
            footer: '상위 20개',
          },
        },
      ],
    };
  }

  const prod = await findProduct(text);
  if (!prod) {
    return await buildStockTargetClarification(text, week, 'weekStockStatus', '재고 조회 의도는 이해했지만 품목을 확정하지 못했습니다.');
  }

  const r = await query(
    `SELECT p.ProdName, p.OutUnit, p.BunchOf1Box, p.SteamOf1Box,
            ISNULL(latest.Stock, ISNULL(p.Stock,0)) AS CurrentStock,
            latest.OrderWeek AS StockWeek,
            latest.CreateDtm AS StockDtm
       FROM Product p
  OUTER APPLY (
    SELECT TOP 1 ps.Stock, sm.OrderWeek, sm.CreateDtm
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey = ps.StockKey
     WHERE ps.ProdKey = p.ProdKey
     ORDER BY sm.OrderWeek DESC, sm.StockKey DESC
  ) latest
      WHERE p.ProdKey = @pk`,
    { pk: { type: sql.Int, value: prod.ProdKey } }
  );
  const row = r.recordset[0];
  if (!row) {
    return { messages: [{ type: 'text', content: `❓ ${prod.ProdName} 정보를 찾을 수 없습니다.` }] };
  }

  return {
    messages: [
      {
        type: 'card',
        card: {
          title: `📦 ${row.ProdName}`,
          subtitle: '재고 현황',
          rows: [
            { label: '현재 재고', value: `${(row.CurrentStock ?? 0).toLocaleString()} ${row.OutUnit || ''}` },
            { label: '박스당 단수', value: `${row.BunchOf1Box || 0}` },
            { label: '박스당 송이', value: `${row.SteamOf1Box || 0}` },
          ],
          footer: row.StockWeek ? `기준 차수: ${row.StockWeek}${row.StockDtm ? ` · 갱신: ${new Date(row.StockDtm).toLocaleString('ko-KR')}` : ''}` : '',
        },
      },
    ],
  };
}

// ── 원산지별 재고 합계
async function runStockOriginLookup(country) {
  const rows = await query(
    `SELECT p.ProdName, p.FlowerName, p.OutUnit,
            ISNULL(latest.Stock, ISNULL(p.Stock,0)) AS Qty
       FROM Product p
  OUTER APPLY (
    SELECT TOP 1 ps.Stock
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey = ps.StockKey
     WHERE ps.ProdKey = p.ProdKey
     ORDER BY sm.OrderWeek DESC, sm.StockKey DESC
  ) latest
      WHERE ISNULL(p.isDeleted,0)=0 AND p.CounName=@co
      ORDER BY ISNULL(latest.Stock, ISNULL(p.Stock,0)) DESC`,
    { co: { type: sql.NVarChar, value: country } }
  );
  if (rows.recordset.length === 0) {
    return { messages: [{ type: 'text', content: `📭 원산지 "${country}" 품목이 없습니다.` }] };
  }
  const total = rows.recordset.reduce((s, r) => s + (r.Qty || 0), 0);
  return {
    messages: [
      { type: 'text', content: `🌍 원산지 "${country}" 재고 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${country}산 재고`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: `${r.FlowerName || ''} ${r.ProdName}`.trim(),
            value: `${(r.Qty || 0).toLocaleString()} ${r.OutUnit || ''}`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${total.toLocaleString()}`,
        },
      },
    ],
  };
}

// ── 꽃 종류별 재고 합계
async function runStockFlowerLookup(flower) {
  const rows = await query(
    `SELECT p.ProdName, p.CounName, p.OutUnit,
            ISNULL(latest.Stock, ISNULL(p.Stock,0)) AS Qty
       FROM Product p
  OUTER APPLY (
    SELECT TOP 1 ps.Stock
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey = ps.StockKey
     WHERE ps.ProdKey = p.ProdKey
     ORDER BY sm.OrderWeek DESC, sm.StockKey DESC
  ) latest
      WHERE ISNULL(p.isDeleted,0)=0 AND p.FlowerName=@fl
      ORDER BY ISNULL(latest.Stock, ISNULL(p.Stock,0)) DESC`,
    { fl: { type: sql.NVarChar, value: flower } }
  );
  if (rows.recordset.length === 0) {
    return { messages: [{ type: 'text', content: `📭 꽃 종류 "${flower}" 품목이 없습니다.` }] };
  }
  const total = rows.recordset.reduce((s, r) => s + (r.Qty || 0), 0);
  return {
    messages: [
      { type: 'text', content: `🌸 꽃 종류 "${flower}" 재고 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${flower} 재고`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: `${r.CounName || ''} ${r.ProdName}`.trim(),
            value: `${(r.Qty || 0).toLocaleString()} ${r.OutUnit || ''}`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${total.toLocaleString()}`,
        },
      },
    ],
  };
}
