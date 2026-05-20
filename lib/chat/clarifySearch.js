// lib/chat/clarifySearch.js
// Ask-back helper that first searches real ERP data, then asks the user to confirm.
import { query, sql } from '../db';

function tokenize(text) {
  return Array.from(new Set(String(text || '')
    .replace(/\d{1,2}\s*(?:-|차\s*)\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*차/g, ' ')
    .replace(/현재차수|현재\s*차수|이번차수|이번\s*차수|조회|확인|알려줘|어떤|얼마나|몇|데이터|현황/g, ' ')
    .replace(/주문|출고|확정|미확정|재고|잔량|입고|농장|수량|매출|미수금|거래처|품목|꽃/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
    .slice(0, 8)));
}

async function getWeekCandidates(limit = 5) {
  const r = await query(
    `SELECT TOP ${Math.max(1, Math.min(Number(limit) || 5, 10))} w
       FROM (
         SELECT OrderWeek AS w FROM OrderMaster WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderWeek AS w FROM ShipmentMaster WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderWeek AS w FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
         UNION
         SELECT OrderWeek AS w FROM StockMaster WHERE OrderWeek LIKE '__-__'
       ) x
      ORDER BY w DESC`,
    {}
  ).catch(() => ({ recordset: [] }));
  return (r.recordset || []).map(x => x.w).filter(Boolean);
}

async function searchCustomers(text, limit = 5) {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const where = tokens.map((_, i) => `(CustName LIKE @t${i} OR ISNULL(CustArea,'') LIKE @t${i})`).join(' OR ');
  const params = {};
  tokens.forEach((t, i) => { params[`t${i}`] = { type: sql.NVarChar, value: `%${t}%` }; });
  const r = await query(
    `SELECT TOP ${Math.max(1, Math.min(Number(limit) || 5, 10))}
            CustKey, CustName, CustArea
       FROM Customer
      WHERE ISNULL(isDeleted,0)=0
        AND (${where})
      ORDER BY CustName`,
    params
  ).catch(() => ({ recordset: [] }));
  return r.recordset || [];
}

async function searchProducts(text, limit = 6) {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const where = tokens
    .map((_, i) => `(ProdName LIKE @t${i} OR ISNULL(DisplayName,'') LIKE @t${i} OR FlowerName LIKE @t${i} OR CounName LIKE @t${i})`)
    .join(' OR ');
  const params = {};
  tokens.forEach((t, i) => { params[`t${i}`] = { type: sql.NVarChar, value: `%${t}%` }; });
  const r = await query(
    `SELECT TOP ${Math.max(1, Math.min(Number(limit) || 6, 12))}
            ProdKey, ProdName, DisplayName, FlowerName, CounName, OutUnit
       FROM Product
      WHERE ISNULL(isDeleted,0)=0
        AND (${where})
      ORDER BY FlowerName, CounName, ProdName`,
    params
  ).catch(() => ({ recordset: [] }));
  return r.recordset || [];
}

function intentName(intent) {
  switch (intent) {
    case 'order': return '주문';
    case 'stock': return '재고';
    case 'shipment': return '출고/확정';
    case 'sales': return '매출';
    case 'receivable': return '미수금';
    default: return '업무 데이터';
  }
}

function choiceForCustomer(intent, cust, week) {
  const weekText = week ? `${week}차 ` : '';
  if (intent === 'receivable') {
    return {
      label: `${cust.CustName} 미수금`,
      sub: cust.CustArea || '',
      text: `${cust.CustName} 미수금`,
      payload: { intent: 'receivable', scope: 'customer', custName: cust.CustName },
    };
  }
  if (intent === 'sales') {
    return {
      label: `${cust.CustName} 매출`,
      sub: cust.CustArea || '',
      text: `${cust.CustName} 이번 달 매출`,
      payload: { intent: 'sales', scope: 'customer', custName: cust.CustName, period: 'thisMonth' },
    };
  }
  return {
    label: `${weekText}${cust.CustName} ${intentName(intent)}`,
    sub: cust.CustArea || '',
    text: `${weekText}${cust.CustName} ${intentName(intent)}`,
    payload: { intent, custKey: cust.CustKey, ...(week ? { week } : {}) },
  };
}

function choiceForProduct(intent, prod, week) {
  const target = prod.ProdName;
  if (intent === 'stock') {
    return {
      label: `${week ? `${week}차 ` : ''}${target} 재고현황`,
      sub: `${prod.CounName || ''} / ${prod.FlowerName || ''}`.trim(),
      text: `${week ? `${week}차 ` : ''}${target} 재고현황`,
      payload: { intent: 'stock', mode: 'weekStockStatus', prodKey: prod.ProdKey, ...(week ? { week } : {}) },
    };
  }
  if (intent === 'order') {
    return {
      label: `${week ? `${week}차 ` : ''}${target} 주문 합계`,
      sub: `${prod.CounName || ''} / ${prod.FlowerName || ''}`.trim(),
      text: `${week ? `${week}차 ` : ''}${target} 주문 합계`,
    };
  }
  return null;
}

export async function buildInvestigativeClarification(text, intent = 'unknown') {
  const [weeks, customers, products] = await Promise.all([
    getWeekCandidates(5),
    searchCustomers(text, 5),
    searchProducts(text, 6),
  ]);
  const week = weeks[0] || null;
  const choices = [];

  if (['order', 'shipment', 'sales', 'receivable'].includes(intent)) {
    for (const c of customers) choices.push(choiceForCustomer(intent, c, week));
  }
  if (['stock', 'order'].includes(intent)) {
    for (const p of products) {
      const choice = choiceForProduct(intent, p, week);
      if (choice) choices.push(choice);
    }
    const seenFlowers = new Set();
    for (const p of products) {
      if (!p.FlowerName || seenFlowers.has(p.FlowerName)) continue;
      seenFlowers.add(p.FlowerName);
      choices.push({
        label: `${week ? `${week}차 ` : ''}${p.FlowerName} 전체 재고현황`,
        sub: '품목 하나가 아니라 꽃종류 전체',
        text: `${week ? `${week}차 ` : ''}${p.FlowerName} 재고현황`,
        payload: { intent: 'stock', mode: 'weekStockStatus', scope: 'flower', flower: p.FlowerName, ...(week ? { week } : {}) },
      });
    }
  }

  const found = [
    weeks.length ? `차수 후보: ${weeks.slice(0, 3).join(', ')}` : null,
    customers.length ? `거래처 후보: ${customers.map(c => c.CustName).slice(0, 3).join(', ')}` : null,
    products.length ? `품목 후보: ${products.map(p => p.ProdName).slice(0, 3).join(', ')}` : null,
  ].filter(Boolean);

  const messages = [
    {
      type: 'text',
      content: `제가 먼저 네노바 DB에서 "${intentName(intent)}" 기준으로 관련 데이터를 찾아봤어요.\n${found.length ? found.join('\n') : '직접 맞는 후보가 적어서 기준 확인이 필요합니다.'}\n질문하신 게 아래 기준 중 하나가 맞나요?`,
    },
  ];

  if (choices.length) {
    messages.push({
      type: 'choices',
      prompt: '맞는 기준을 누르면 그 조건으로 바로 다시 조회합니다.',
      choices: choices.slice(0, 8),
    });
  } else {
    messages.push({
      type: 'actions',
      actions: [
        { label: '현재차수 재고', text: '현재차수 카네이션 재고현황' },
        { label: '입고 농장', text: '20-1차 로다스 입고농장 및 수량' },
        { label: '거래처 주문', text: '20-1차 꽃길 주문' },
      ],
    });
  }

  return { messages, _investigative: true };
}
