// lib/chat/handlers/receivable.js — 미수금 조회
import { query, sql } from '../../db';
import { findCustomer } from '../entities';

export async function handleReceivableLookup(text, user) {
  const cust = await findCustomer(text);

  // 특정 거래처 미수금
  if (cust) {
    // ReceivableLedger 구조가 환경마다 다를 수 있어 유연하게 처리
    const r = await query(
      `SELECT SUM(ISNULL(Amount,0)) AS balance, COUNT(*) AS cnt
         FROM ReceivableLedger
        WHERE CustKey = @ck`,
      { ck: { type: sql.Int, value: cust.CustKey } }
    ).catch(() => null);

    if (!r || !r.recordset[0]) {
      return {
        messages: [{ type: 'text', content: `❓ ${cust.CustName} 미수금 정보를 찾을 수 없습니다.` }],
      };
    }
    const row = r.recordset[0];
    return {
      messages: [
        {
          type: 'card',
          card: {
            title: `💳 ${cust.CustName} 미수금`,
            rows: [
              { label: '잔액', value: `${(row.balance || 0).toLocaleString()}원` },
              { label: '거래 건수', value: `${row.cnt || 0}건` },
            ],
          },
        },
      ],
    };
  }

  // 전체 미수금 TOP
  const r = await query(
    `SELECT TOP 10 c.CustName, SUM(ISNULL(rl.Amount,0)) AS balance
       FROM ReceivableLedger rl
       JOIN Customer c ON c.CustKey = rl.CustKey
   GROUP BY c.CustName
     HAVING SUM(ISNULL(rl.Amount,0)) > 0
   ORDER BY SUM(ISNULL(rl.Amount,0)) DESC`,
    {}
  ).catch(() => null);

  if (!r || r.recordset.length === 0) {
    return { messages: [{ type: 'text', content: '✅ 미수금 있는 거래처가 없습니다.' }] };
  }

  const total = r.recordset.reduce((s, x) => s + (x.balance || 0), 0);
  return {
    messages: [
      { type: 'text', content: `💳 미수금 상위 10개 거래처 (합계 ${total.toLocaleString()}원)` },
      {
        type: 'card',
        card: {
          title: '미수금 TOP 10',
          rows: r.recordset.map(x => ({
            label: x.CustName,
            value: `${(x.balance || 0).toLocaleString()}원`,
          })),
        },
      },
    ],
  };
}
