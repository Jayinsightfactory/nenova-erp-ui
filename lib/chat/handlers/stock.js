// lib/chat/handlers/stock.js — 재고 조회
import { query, sql } from '../../db';
import { findProduct } from '../entities';
import { buildDisambiguationForText } from '../disambiguation';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

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
  return (r.recordset || []).find(f => text.includes(f.FlowerName))?.FlowerName || null;
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

function stockModeLabel(mode) {
  return mode === 'incomingFarm' ? '입고 농장/수량' : '재고현황';
}

function stockPayloadMode(mode) {
  return mode === 'incomingFarm' ? 'incomingFarm' : 'weekStockStatus';
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

async function findProductCandidates(text, limit = 6) {
  const tokens = extractSearchTokens(text);
  if (!tokens.length) return [];
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
  return r.recordset || [];
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
  const flower = payloadProd ? null : (payloadFlower || await findFlowerInText(text));
  const prod = payloadProd || (flower ? null : await findProduct(text));
  return { prod, flower };
}

async function runWeekIncomingFarmLookup(text, week, payload = null) {
  const { prod, flower } = await resolveWeekTarget(text, payload);
  const filter = prod ? 'AND wd.ProdKey=@pk' : flower ? 'AND p.FlowerName=@flower' : '';
  const params = {
    week: { type: sql.NVarChar, value: week },
    ...(prod ? { pk: { type: sql.Int, value: prod.ProdKey } } : {}),
    ...(flower ? { flower: { type: sql.NVarChar, value: flower } } : {}),
  };
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
      `${week}차 ${prod?.ProdName || flower || ''} 입고 농장 데이터가 바로 잡히지 않았습니다.`
    );
  }
  const total = rows.reduce((s, x) => s + Number(x.InQty || 0), 0);
  return {
    messages: [
      { type: 'text', content: `${week}차 ${prod?.ProdName || flower || '전체'} 입고 농장/수량입니다. 총 ${fmt(total)}입니다.` },
      {
        type: 'card',
        card: {
          title: `${week}차 입고 농장`,
          subtitle: prod?.ProdName || flower || '전체',
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
  const { prod, flower } = await resolveWeekTarget(text, payload);
  if (!prod && !flower) {
    return await buildStockTargetClarification(text, week, 'weekStockStatus');
  }
  const filter = prod ? 'AND p.ProdKey=@pk' : 'AND p.FlowerName=@flower';
  const params = {
    week: { type: sql.NVarChar, value: week },
    ...(prod ? { pk: { type: sql.Int, value: prod.ProdKey } } : {}),
    ...(flower ? { flower: { type: sql.NVarChar, value: flower } } : {}),
  };
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
            AND sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고')
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
      `${week}차 ${prod?.ProdName || flower} 재고현황 데이터가 바로 잡히지 않았습니다.`
    );
  }
  const totalPrev = rows.reduce((s, x) => s + Number(x.PrevStock || 0), 0);
  const totalIn = rows.reduce((s, x) => s + Number(x.InQty || 0), 0);
  const totalOut = rows.reduce((s, x) => s + Number(x.OutQty || 0), 0);
  const totalCalc = rows.reduce((s, x) => s + Number(x.CalcRemain || 0), 0);
  const fixedRows = rows.filter(x => x.FixedRemain !== null && x.FixedRemain !== undefined);
  const totalFixed = fixedRows.reduce((s, x) => s + Number(x.FixedRemain || 0), 0);
  const titleName = prod?.ProdName || flower;
  const summaryRemain = fixedRows.length === rows.length ? totalFixed : totalCalc;
  return {
    messages: [
      {
        type: 'text',
        content: `${week}차 ${titleName} 재고현황입니다. ${fixedRows.length === rows.length ? '확정 잔량 기준' : '계산 잔량 기준'}으로 ${fmt(summaryRemain)}입니다. 계산식은 전재고 ${fmt(totalPrev)} + 입고/조정 ${fmt(totalIn)} - 출고분배 ${fmt(totalOut)}입니다.`,
      },
      {
        type: 'card',
        card: {
          title: `${week}차 ${titleName} 재고현황`,
          subtitle: fixedRows.length ? `확정 스냅샷 ${fixedRows.length}/${rows.length}건 있음` : '미확정 계산값',
          rows: rows.slice(0, 80).map(x => ({
            label: `${x.CounName || ''} ${x.FlowerName || ''} ${x.ProdName}`.trim(),
            value: `전 ${fmt(x.PrevStock)} + 입고 ${fmt(x.WarehouseInQty)}${Number(x.AdjustQty || 0) ? ` / 조정 ${fmt(x.AdjustQty)}` : ''} - 출고 ${fmt(x.OutQty)} = ${fmt(x.CalcRemain)}${x.FixedRemain !== null && x.FixedRemain !== undefined ? ` / 확정 ${fmt(x.FixedRemain)}` : ''} ${x.OutUnit || ''}`,
          })),
          footer: rows.length > 80 ? `총 ${rows.length}건 중 80건 표시` : `총 ${rows.length}건`,
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
      `SELECT TOP 20 p.ProdName, p.OutUnit, ps.CurrentStock
         FROM Product p
    LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey
        WHERE ISNULL(p.isDeleted,0)=0
          AND ISNULL(ps.CurrentStock,0) <= 0
        ORDER BY ISNULL(ps.CurrentStock,0) ASC`,
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
            ps.CurrentStock, ps.UpdateDtm
       FROM Product p
  LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey
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
          footer: row.UpdateDtm ? `갱신: ${new Date(row.UpdateDtm).toLocaleString('ko-KR')}` : '',
        },
      },
    ],
  };
}

// ── 원산지별 재고 합계
async function runStockOriginLookup(country) {
  const rows = await query(
    `SELECT p.ProdName, p.FlowerName, p.OutUnit, ISNULL(ps.CurrentStock,0) AS Qty
       FROM Product p
  LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey
      WHERE ISNULL(p.isDeleted,0)=0 AND p.CounName=@co
      ORDER BY ISNULL(ps.CurrentStock,0) DESC`,
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
    `SELECT p.ProdName, p.CounName, p.OutUnit, ISNULL(ps.CurrentStock,0) AS Qty
       FROM Product p
  LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey
      WHERE ISNULL(p.isDeleted,0)=0 AND p.FlowerName=@fl
      ORDER BY ISNULL(ps.CurrentStock,0) DESC`,
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
