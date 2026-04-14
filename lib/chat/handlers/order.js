// lib/chat/handlers/order.js — 주문 조회
import { query, sql } from '../../db';
import { extractWeek } from '../router';
import { findCustomer } from '../entities';

export async function handleOrderLookup(text, user) {
  const week = extractWeek(text);
  const cust = await findCustomer(text);

  if (!cust) {
    return {
      messages: [
        { type: 'text', content: '어느 거래처의 주문을 조회할까요?\n예시: "꽃길 15-01 주문"' },
      ],
    };
  }

  // 기본 조회 범위: 지정 차수 or 최근 차수
  let whereWeek = '';
  const params = { ck: { type: sql.Int, value: cust.CustKey } };
  if (week) {
    whereWeek = ' AND om.OrderWeek = @wk';
    params.wk = { type: sql.NVarChar, value: week };
  } else {
    // 최근 차수 자동 탐색
    const last = await query(
      `SELECT TOP 1 OrderWeek FROM OrderMaster
        WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0
        ORDER BY OrderWeek DESC`,
      { ck: { type: sql.Int, value: cust.CustKey } }
    );
    if (!last.recordset[0]) {
      return { messages: [{ type: 'text', content: `📭 ${cust.CustName}의 주문 내역이 없습니다.` }] };
    }
    whereWeek = ' AND om.OrderWeek = @wk';
    params.wk = { type: sql.NVarChar, value: last.recordset[0].OrderWeek };
  }

  const rows = await query(
    `SELECT om.OrderWeek, p.ProdName, p.OutUnit, od.OrderQuantity
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderKey = om.OrderKey
       JOIN Product p ON p.ProdKey = od.ProdKey
      WHERE om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0 ${whereWeek}
      ORDER BY p.ProdName`,
    params
  );

  if (rows.recordset.length === 0) {
    return {
      messages: [{ type: 'text', content: `📭 ${cust.CustName} · ${params.wk.value}차 주문 내역이 없습니다.` }],
    };
  }

  const totalQty = rows.recordset.reduce((s, r) => s + (r.OrderQuantity || 0), 0);

  return {
    messages: [
      { type: 'text', content: `📋 ${cust.CustName} · ${params.wk.value}차 주문 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${cust.CustName} · ${params.wk.value}`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: r.ProdName,
            value: `${r.OrderQuantity} ${r.OutUnit || ''}`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${totalQty.toLocaleString()}${rows.recordset.length > 20 ? ' (상위 20개만 표시)' : ''}`,
        },
      },
    ],
  };
}
