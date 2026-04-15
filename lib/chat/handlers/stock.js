// lib/chat/handlers/stock.js — 재고 조회
import { query, sql } from '../../db';
import { findProduct } from '../entities';
import { buildDisambiguationForText } from '../disambiguation';

export async function handleStockLookup(text, user, payload = null) {
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
    return {
      messages: [
        { type: 'text', content: '어떤 품목의 재고를 조회할까요?\n예시: "루스커스 재고" / "카네이션 Novia 재고"' },
      ],
    };
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
