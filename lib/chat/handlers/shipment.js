// lib/chat/handlers/shipment.js — 출고/확정 조회
import { query, sql } from '../../db';
import { extractWeek } from '../router';
import { findCustomer, findCustomersMulti } from '../entities';
import { buildDisambiguationForText } from '../disambiguation';

function shipmentUnderstanding({ cust, week, mode, rowCount }) {
  return [
    `제가 이해한 조건: ${week || '차수 미지정'}차, 거래처 ${cust?.CustName || '미지정'}, ${mode || '출고 조회'}.`,
    '검색 경로: 차수 정규화 → 거래처명 후보 매칭 → ShipmentMaster/ShipmentDetail/Product 조인 → 품목별 출고수량 집계.',
    Number.isFinite(rowCount) ? `조회된 후보/행: ${rowCount}건.` : null,
  ].filter(Boolean).join('\n');
}

async function buildCustomerChoices(text, week, mode = 'items') {
  const found = await findCustomersMulti(text, 8).catch(() => ({ candidates: [] }));
  const candidates = found?.candidates || [];
  if (candidates.length <= 1) return null;
  return {
    messages: [
      {
        type: 'text',
        content: `제가 이해한 조건: ${week || '차수 미지정'}차 출고 품목수량 조회입니다.\n거래처명이 여러 후보와 맞습니다. 조회할 업체를 선택해 주세요.`,
      },
      {
        type: 'choices',
        prompt: '거래처 후보',
        choices: candidates.map(c => ({
          label: `${week ? `${week}차 ` : ''}${c.CustName} 출고 품목수량`,
          sub: c.CustArea || '',
          text: `${week ? `${week}차 ` : ''}${c.CustName} 출고 품목수량`,
          payload: { intent: 'shipment', mode, custKey: c.CustKey, ...(week ? { week } : {}) },
        })),
      },
    ],
    _askback: true,
  };
}

async function getCustomerByKey(custKey) {
  if (!custKey) return null;
  const r = await query(
    `SELECT TOP 1 CustKey, CustName, CustArea
       FROM Customer
      WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`,
    { ck: { type: sql.Int, value: Number(custKey) } }
  );
  return r.recordset?.[0] || null;
}

function normalizeShipmentWeeks(value) {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.map(v => String(v || '').trim()).filter(v => /^\d{2}-\d{2}$/.test(v)))];
}

function shipmentWeekLabel(weeks) {
  const list = normalizeShipmentWeeks(weeks);
  return list.length > 1 ? list.join(', ') : (list[0] || '');
}

async function runCustomerShipmentItems(cust, weekInput, payload = null) {
  const weeks = normalizeShipmentWeeks(weekInput);
  if (!weeks.length) {
    return { messages: [{ type: 'text', content: '조회할 차수를 선택해 주세요.' }], _askback: true };
  }
  const weekLabel = shipmentWeekLabel(weeks);
  const weekParams = {};
  const weekPlaceholders = weeks.map((w, i) => {
    const key = `wk${i}`;
    weekParams[key] = { type: sql.NVarChar, value: w };
    return `@${key}`;
  });
  const params = {
    ck: { type: sql.Int, value: cust.CustKey },
    ...weekParams,
  };
  let prodFilter = '';
  if (payload?.prodKey) {
    prodFilter = 'AND p.ProdKey=@pk';
    params.pk = { type: sql.Int, value: Number(payload.prodKey) };
  }
  const rows = await query(
    `SELECT
        p.ProdKey,
        p.ProdName,
        p.DisplayName,
        p.FlowerName,
        p.CounName,
        p.OutUnit,
        SUM(ISNULL(sd.OutQuantity,0)) AS OutQty,
        SUM(ISNULL(sd.Amount,0)) AS Amount,
        COUNT(*) AS RowCnt,
        MAX(CASE WHEN sm.isFix=1 THEN 1 ELSE 0 END) AS isFix
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Product p ON p.ProdKey=sd.ProdKey
      WHERE sm.CustKey=@ck
        AND sm.OrderWeek IN (${weekPlaceholders.join(',')})
        ${prodFilter}
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(p.isDeleted,0)=0
      GROUP BY p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
      ORDER BY p.FlowerName, p.CounName, p.ProdName`,
    params
  );
  const list = rows.recordset || [];
  const targetName = payload?.prodName || payload?.productName || '';
  if (!list.length) {
    return { messages: [{ type: 'text', content: `${shipmentUnderstanding({ cust, week: weekLabel, mode: targetName ? `출고 품목수량 (${targetName})` : '출고 품목수량', rowCount: 0 })}\n📭 ${cust.CustName} ${weekLabel}차 ${targetName ? `${targetName} ` : ''}출고 품목수량이 없습니다.` }] };
  }
  const totalQty = list.reduce((s, r) => s + Number(r.OutQty || 0), 0);
  const totalAmount = list.reduce((s, r) => s + Number(r.Amount || 0), 0);
  const isFix = list.some(r => Number(r.isFix || 0) === 1);
  const sumSuffix = weeks.length > 1 ? ' 합산' : '';

  return {
    messages: [
      {
        type: 'text',
        content: `${shipmentUnderstanding({ cust, week: weekLabel, mode: targetName ? `출고 품목수량 (${targetName})${sumSuffix}` : `출고 품목수량${sumSuffix}`, rowCount: list.length })}\n${weekLabel}차 ${cust.CustName} ${targetName ? `${targetName} ` : ''}출고 품목별 수량${sumSuffix}을 확인했습니다. ${isFix ? '확정 출고 기준' : '미확정/분배 기준'}이며 총 ${list.length}품목, 수량 합계 ${totalQty.toLocaleString('ko-KR')}입니다.`,
      },
      {
        type: 'card',
        card: {
          title: `${cust.CustName} · ${weekLabel} 출고 품목수량${sumSuffix}`,
          subtitle: isFix ? '확정 포함' : '미확정/분배 기준',
          rows: list.slice(0, 80).map(r => ({
            label: `${r.CounName || ''} ${r.FlowerName || ''} ${r.DisplayName || r.ProdName}`.trim(),
            value: `${Number(r.OutQty || 0).toLocaleString('ko-KR')} ${r.OutUnit || ''} · ${weekLabel}차`,
          })),
          footer: list.length > 80
            ? `총 ${list.length}품목 중 80품목 표시 · 공급가액 ${totalAmount.toLocaleString('ko-KR')}원`
            : `총 ${list.length}품목 · 공급가액 ${totalAmount.toLocaleString('ko-KR')}원`,
        },
      },
    ],
  };
}

async function runWeekCustomerProductQty(week) {
  const rows = await query(
    `SELECT
        c.CustKey,
        c.CustName,
        p.ProdKey,
        p.ProdName,
        p.DisplayName,
        p.FlowerName,
        p.CounName,
        p.OutUnit,
        SUM(ISNULL(sd.OutQuantity,0)) AS OutQty,
        MAX(CASE WHEN sm.isFix=1 THEN 1 ELSE 0 END) AS isFix
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Customer c ON c.CustKey=sm.CustKey
       JOIN Product p ON p.ProdKey=sd.ProdKey
      WHERE sm.OrderWeek=@wk
        AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(c.isDeleted,0)=0
        AND ISNULL(p.isDeleted,0)=0
      GROUP BY c.CustKey, c.CustName, p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
      ORDER BY c.CustName, p.FlowerName, p.CounName, p.ProdName`,
    { wk: { type: sql.NVarChar, value: week } }
  );
  const list = rows.recordset || [];
  if (!list.length) {
    return { messages: [{ type: 'text', content: `제가 이해한 조건: ${week}차, 거래처별 출고 품목수량 조회입니다.\n검색 경로: ShipmentMaster/ShipmentDetail/Customer/Product 조인 → 거래처별 품목 집계.\n📭 ${week}차 출고 품목수량이 없습니다.` }] };
  }

  const byCustomer = new Map();
  for (const row of list) {
    const key = row.CustKey;
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { custName: row.CustName, isFix: false, items: [], totalQty: 0 });
    }
    const group = byCustomer.get(key);
    group.isFix = group.isFix || Number(row.isFix || 0) === 1;
    group.totalQty += Number(row.OutQty || 0);
    group.items.push(row);
  }

  const groups = [...byCustomer.values()];
  const totalQty = groups.reduce((s, g) => s + g.totalQty, 0);
  return {
    messages: [
      {
        type: 'text',
        content: `제가 이해한 조건: ${week}차, 거래처별 출고 품목수량 조회입니다.\n검색 경로: 차수 정규화 → ShipmentMaster/ShipmentDetail/Customer/Product 조인 → 거래처별 품목 집계.\n${week}차 거래처 ${groups.length}곳, 품목 행 ${list.length}건, 수량 합계 ${totalQty.toLocaleString('ko-KR')}입니다.`,
      },
      {
        type: 'card',
        card: {
          title: `${week}차 업체별 품목수량`,
          subtitle: '출고 기준',
          rows: groups.slice(0, 80).map(g => {
            const preview = g.items.slice(0, 4).map(x => {
              const name = x.DisplayName || x.ProdName;
              return `${name} ${Number(x.OutQty || 0).toLocaleString('ko-KR')}${x.OutUnit || ''}`;
            }).join(', ');
            return {
              label: g.custName,
              value: `${g.items.length}품목 · ${g.totalQty.toLocaleString('ko-KR')} · ${preview}${g.items.length > 4 ? ` 외 ${g.items.length - 4}` : ''}`,
            };
          }),
          footer: groups.length > 80 ? `총 ${groups.length}곳 중 80곳 표시` : `총 ${groups.length}곳`,
        },
      },
    ],
  };
}

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

  const payloadWeeks = normalizeShipmentWeeks(payload?.weeks);
  const week = payloadWeeks[0] || payload?.week || extractWeek(text);
  const wantsCustomerProductQty = /(업체별|거래처별).*(품목\s*수량|품목수량|품목별|수량)|(품목\s*수량|품목수량|품목별).*(업체별|거래처별)/.test(text);
  if (week && wantsCustomerProductQty) {
    return await runWeekCustomerProductQty(week);
  }
  if (!week && wantsCustomerProductQty) {
    return {
      messages: [
        {
          type: 'text',
          content: '질문 의도는 거래처별 출고 품목수량 조회로 이해했습니다.\n조회할 차수를 함께 알려주세요. 예: "20-1차 업체별 품목수량"',
        },
      ],
      _askback: true,
    };
  }
  if (!payload?.custKey && week && /(업체|거래처|출고)/.test(text)) {
    const customerChoices = await buildCustomerChoices(text, week, payload?.mode || 'items');
    if (customerChoices) return customerChoices;
  }
  const cust = (payload?.custKey ? await getCustomerByKey(payload.custKey) : null) || await findCustomer(text);
  const isConfirm = /확정/.test(text) && !/미확정/.test(text);
  const isUnconfirm = /미확정/.test(text);
  const isToday = /오늘/.test(text);
  const wantsItemQty = /(품목\s*수량|품목수량|품목별|출고\s*수량|출고수량|출고\s*물량|출고물량|분배\s*수량|분배수량|분배\s*물량|분배물량|출고\s*분배|출고분배|분배|수량|상세|내역)/.test(text) || payload?.mode === 'items';

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
    if (wantsItemQty) {
      return await runCustomerShipmentItems(cust, payloadWeeks.length ? payloadWeeks : week, payload);
    }

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
      return { messages: [{ type: 'text', content: `${shipmentUnderstanding({ cust, week, mode: '출고 상태', rowCount: 0 })}\n📭 ${cust.CustName} ${week}차 출고 정보가 없습니다.` }] };
    }
    return {
      messages: [
        {
          type: 'text',
          content: shipmentUnderstanding({ cust, week, mode: '출고 상태', rowCount: 1 }),
        },
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
