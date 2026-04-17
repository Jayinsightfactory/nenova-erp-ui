// pages/api/incoming-price/index.js
// GET               → 차수 목록
// GET ?weeks=w1,w2  → 다중 차수 농장 입고단가 피벗 + 크레딧
// PUT               → 크레딧 저장 { farmName, orderWeek, creditUSD, memo }

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET')  return await handleGet(req, res);
    if (req.method === 'PUT')  return await handlePutCredit(req, res);
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function handleGet(req, res) {
  const { weeks: weeksParam } = req.query;

  // 차수 목록
  if (!weeksParam) {
    const r = await query(
      `SELECT DISTINCT OrderWeek FROM WarehouseMaster
       WHERE isDeleted=0 AND OrderWeek IS NOT NULL AND OrderWeek<>''
       ORDER BY OrderWeek DESC`
    );
    return res.status(200).json({ success: true, weeks: r.recordset.map(x => x.OrderWeek) });
  }

  const selectedWeeks = weeksParam.split(',').map(w => w.trim()).filter(Boolean);
  if (selectedWeeks.length === 0) {
    return res.status(200).json({ success: true, weeks: [], farms: [], rows: [], totals: {}, credits: {} });
  }

  // 다중 차수 IN 절 파라미터 빌드
  const weekParams = {};
  const weekPlaceholders = selectedWeeks.map((w, i) => {
    weekParams[`w${i}`] = { type: sql.NVarChar, value: w };
    return `@w${i}`;
  }).join(',');

  const [detailRes, creditRes] = await Promise.all([
    query(
      `SELECT
         wm.FarmName,
         wm.OrderWeek,
         p.CounName    AS country,
         p.FlowerName  AS flower,
         p.ProdName    AS prodName,
         ISNULL(p.DisplayName, p.ProdName) AS displayName,
         p.ProdKey,
         wd.UPrice,
         wd.TPrice,
         wd.BoxQuantity,
         wd.BunchQuantity,
         wd.SteamQuantity,
         wd.OutQuantity
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey = p.ProdKey
       WHERE wm.OrderWeek IN (${weekPlaceholders}) AND wm.isDeleted = 0
       ORDER BY wm.FarmName, p.CounName, p.FlowerName, p.ProdName`,
      weekParams
    ),
    query(
      `SELECT FarmName, OrderWeek, CreditUSD, Memo
       FROM FarmCredit
       WHERE OrderWeek IN (${weekPlaceholders}) AND isDeleted = 0`,
      weekParams
    ).catch(() => ({ recordset: [] })),
  ]);

  const rows = detailRes.recordset;
  const FREIGHT_NAMES = /^운송료$|^운송비$|^항공료$|^국내.*운송|^FREIGHT$|^SHIPPING/i;

  // 농장 목록 (순서 유지)
  const farms = [...new Set(rows.map(r => r.FarmName).filter(Boolean))];

  // 품목 키: country|flower|prodName|prodKey
  const productMap = new Map();
  const freightMap = new Map();  // farmName → tPrice 합계

  for (const r of rows) {
    const farmName = r.FarmName || '';
    const isFreight = FREIGHT_NAMES.test(r.ProdName || '');
    const tPrice = Number(r.TPrice) || 0;

    if (isFreight) {
      freightMap.set(farmName, (freightMap.get(farmName) || 0) + tPrice);
      continue;
    }

    const key = `${r.country||''}|${r.flower||''}|${r.prodName||''}|${r.ProdKey||''}`;
    if (!productMap.has(key)) {
      productMap.set(key, {
        country:     r.country || '',
        flower:      r.flower || '',
        prodName:    r.prodName || '',
        displayName: r.displayName || r.prodName || '',
        prodKey:     r.ProdKey,
        prices: {},
      });
    }
    const item = productMap.get(key);
    if (!item.prices[farmName]) {
      item.prices[farmName] = { uPrice: Number(r.UPrice) || 0, tPrice: 0, qty: 0 };
    }
    item.prices[farmName].tPrice += tPrice;
    item.prices[farmName].qty    += Number(r.BunchQuantity || r.BoxQuantity || r.OutQuantity) || 0;
  }

  // 농장별 소계
  const totals = {};
  for (const farm of farms) {
    let subtotal = 0;
    for (const item of productMap.values()) {
      subtotal += item.prices[farm]?.tPrice || 0;
    }
    totals[farm] = {
      subtotal,
      freightTPrice: freightMap.get(farm) || 0,
    };
  }

  // 크레딧: 다중 차수 합산
  const credits = {};
  for (const c of creditRes.recordset) {
    const farm = c.FarmName;
    if (!credits[farm]) credits[farm] = { creditUSD: 0, memo: '' };
    credits[farm].creditUSD += Number(c.CreditUSD) || 0;
    if (c.Memo) credits[farm].memo = credits[farm].memo
      ? `${credits[farm].memo} / ${c.Memo}` : c.Memo;
  }

  return res.status(200).json({
    success: true,
    weeks: selectedWeeks,
    farms,
    rows: [...productMap.values()],
    totals,
    credits,
  });
}

async function handlePutCredit(req, res) {
  const { farmName, orderWeek, creditUSD, memo } = req.body;
  if (!farmName || !orderWeek) return res.status(400).json({ success: false, error: 'farmName, orderWeek 필수' });

  await query(
    `IF EXISTS (SELECT 1 FROM FarmCredit WHERE FarmName=@farm AND OrderWeek=@week AND isDeleted=0)
       UPDATE FarmCredit SET CreditUSD=@credit, Memo=@memo, UpdateDtm=GETDATE()
       WHERE FarmName=@farm AND OrderWeek=@week AND isDeleted=0
     ELSE
       INSERT INTO FarmCredit (FarmName, OrderWeek, CreditUSD, Memo) VALUES (@farm, @week, @credit, @memo)`,
    {
      farm:   { type: sql.NVarChar, value: farmName },
      week:   { type: sql.NVarChar, value: orderWeek },
      credit: { type: sql.Decimal,  value: Number(creditUSD) || 0, precision: 10, scale: 2 },
      memo:   { type: sql.NVarChar, value: memo || '' },
    }
  );
  return res.status(200).json({ success: true });
}
