// lib/chat/handlers/shipment.js — 출고/확정 조회
import { query, sql } from '../../db';
import { extractWeek } from '../router';
import { findCustomer } from '../entities';
import { buildDisambiguationForText } from '../disambiguation';

export async function handleShipmentLookup(text, user, payload = null) {
  // 디스앰비기에이션 — 첫 진입일 때만
  if (!payload) {
    const disambig = await buildDisambiguationForText(text, { intent: 'shipment' });
    if (disambig) return disambig;
  }
  // payload 의 scope='origin' 은 원산지 기반 출고 합계
  if (payload?.scope === 'origin' && payload?.country) {
    return await runShipmentOriginLookup(payload.country, payload.week || null);
  }

  const week = payload?.week || extractWeek(text);
  const cust = await findCustomer(text);
  const isConfirm = /확정/.test(text) && !/미확정/.test(text);
  const isUnconfirm = /미확정/.test(text);
  const isToday = /오늘/.test(text);

  // "오늘 출고 확정 업체"
  if (isToday && (isConfirm || /출고/.test(text))) {
    const rows = await query(
      `SELECT DISTINCT c.CustName, sm.OrderWeek, sm.isFix
         FROM ShipmentMaster sm
         JOIN Customer c ON c.CustKey = sm.CustKey
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        WHERE CONVERT(date, sd.ShipmentDtm) = CONVERT(date, GETDATE())
          AND ISNULL(sm.isDeleted,0) = 0 ${isConfirm ? 'AND sm.isFix = 1' : ''}
        ORDER BY c.CustName`,
      {}
    );
    if (rows.recordset.length === 0) {
      return { messages: [{ type: 'text', content: '📭 오늘 출고 예정/확정된 거래처가 없습니다.' }] };
    }
    return {
      messages: [
        { type: 'text', content: `🚚 오늘 출고 ${isConfirm ? '확정' : '예정'} 업체 ${rows.recordset.length}곳` },
        {
          type: 'card',
          card: {
            title: '오늘 출고 업체',
            rows: rows.recordset.map(r => ({
              label: r.CustName,
              value: `${r.OrderWeek} ${r.isFix ? '🔒확정' : '미확정'}`,
            })),
          },
        },
      ],
    };
  }

  // "15차 미확정 업체"
  if (week && isUnconfirm) {
    const rows = await query(
      `SELECT c.CustName, sm.OrderWeek
         FROM ShipmentMaster sm
         JOIN Customer c ON c.CustKey = sm.CustKey
        WHERE sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0) = 0 AND sm.isFix = 0
        ORDER BY c.CustName`,
      { wk: { type: sql.NVarChar, value: week } }
    );
    if (rows.recordset.length === 0) {
      return { messages: [{ type: 'text', content: `✅ ${week}차 미확정 업체가 없습니다.` }] };
    }
    return {
      messages: [
        { type: 'text', content: `⏳ ${week}차 미확정 업체 ${rows.recordset.length}곳` },
        {
          type: 'card',
          card: {
            title: `${week}차 미확정`,
            rows: rows.recordset.map(r => ({ label: r.CustName, value: '미확정' })),
          },
        },
      ],
    };
  }

  // 특정 거래처 + 차수 확정 상태
  if (cust && week) {
    const r = await query(
      `SELECT sm.ShipmentKey, sm.isFix,
              (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey) AS itemCount,
              (SELECT SUM(sd.Amount) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey) AS totalAmount
         FROM ShipmentMaster sm
        WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0`,
      {
        ck: { type: sql.Int, value: cust.CustKey },
        wk: { type: sql.NVarChar, value: week },
      }
    );
    const row = r.recordset[0];
    if (!row) {
      return { messages: [{ type: 'text', content: `📭 ${cust.CustName} ${week}차 출고 정보가 없습니다.` }] };
    }
    return {
      messages: [
        {
          type: 'card',
          card: {
            title: `🚚 ${cust.CustName} · ${week}`,
            rows: [
              { label: '확정 여부', value: row.isFix ? '🔒 확정' : '⏳ 미확정' },
              { label: '품목 수', value: `${row.itemCount || 0}개` },
              { label: '공급가액', value: `${(row.totalAmount || 0).toLocaleString()}원` },
            ],
          },
        },
      ],
    };
  }

  return {
    messages: [
      {
        type: 'text',
        content: '출고 조회 예시:\n• "오늘 출고 확정 업체"\n• "15차 미확정 업체"\n• "꽃길 15-01 출고"',
      },
    ],
  };
}

// ── 원산지(Product.CounName) 기반 출고 합계 조회
async function runShipmentOriginLookup(country, week) {
  const params = { co: { type: sql.NVarChar, value: country } };
  let weekClause = '';
  if (week) {
    weekClause = ' AND sm.OrderWeek = @wk';
    params.wk = { type: sql.NVarChar, value: week };
  }

  const rows = await query(
    `SELECT p.ProdName, p.FlowerName, p.OutUnit,
            SUM(sd.Amount)            AS Amt,
            COUNT(DISTINCT sm.CustKey) AS CustCnt,
            SUM(CASE WHEN sm.isFix=1 THEN 1 ELSE 0 END) AS FixCnt,
            COUNT(*) AS TotalCnt
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p         ON p.ProdKey     = sd.ProdKey
      WHERE ISNULL(sm.isDeleted,0)=0 AND p.CounName=@co ${weekClause}
      GROUP BY p.ProdName, p.FlowerName, p.OutUnit
      ORDER BY SUM(sd.Amount) DESC`,
    params
  );

  if (rows.recordset.length === 0) {
    return {
      messages: [{
        type: 'text',
        content: `📭 원산지 "${country}" · ${week || '전체 차수'} 출고 내역이 없습니다.`,
      }],
    };
  }
  const totalAmt = rows.recordset.reduce((s, r) => s + (r.Amt || 0), 0);

  return {
    messages: [
      { type: 'text', content: `🌍 원산지 "${country}" · ${week || '전체'}차 출고 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${country}산 출고 · ${week || '전체'}`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: `${r.FlowerName || ''} ${r.ProdName}`.trim(),
            value: `${(r.Amt || 0).toLocaleString()}원`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${totalAmt.toLocaleString()}원`,
        },
      },
    ],
  };
}
