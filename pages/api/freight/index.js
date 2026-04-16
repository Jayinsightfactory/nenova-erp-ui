// pages/api/freight/index.js
// GET (no params)              → 스냅샷 리스트 + WarehouseMaster join
// GET ?warehouseKey=N          → 라이브 계산 데이터 (스냅샷 없어도 OK)
// POST                         → 스냅샷 저장 (기존 active 있으면 soft-delete 후 INSERT)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { computeFreightCost, normalizeFlower } from '../../../lib/freightCalc';

const DEFAULT_CUSTOMS = {
  bakSangRate: 370,
  handlingFee: 33000,
  quarantinePerItem: 10000,
  domesticFreight: 99000,
  deductFee: 40000,
  extraFee: 0,
};

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET')  return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success:false, error: err.message });
  }
});

async function handleGet(req, res) {
  const { warehouseKey, awb } = req.query;

  // AWB 그룹 조회 — 같은 AWB의 모든 WarehouseKey 합산
  if (awb) {
    const r = await query(
      `SELECT WarehouseKey FROM WarehouseMaster
         WHERE OrderNo=@awb AND isDeleted=0
         ORDER BY WarehouseKey`,
      { awb: { type: sql.NVarChar, value: awb } }
    );
    const keys = r.recordset.map(x => x.WarehouseKey);
    if (keys.length === 0) return res.status(404).json({ success:false, error:`AWB ${awb} 원장 없음` });
    return await loadFreightData(res, keys, awb);
  }

  if (!warehouseKey) {
    // WarehouseMaster 전체 로드 후 JS에서 AWB 기준 그룹화 (STRING_AGG 호환성 회피)
    const wmRes = await query(
      `SELECT WarehouseKey, ISNULL(OrderNo,'') AS AWB, OrderYear, OrderWeek,
          FarmName, InvoiceNo, CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate,
          GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
         FROM WarehouseMaster WHERE isDeleted=0`
    );
    const fkRes = await query(
      `SELECT WarehouseKey, FreightKey, CreateDtm FROM FreightCost WHERE isDeleted=0`
    );
    // WarehouseKey → FreightKey 매핑 (최근 것 우선)
    const fkByWk = new Map();
    for (const f of fkRes.recordset.sort((a,b) => new Date(b.CreateDtm) - new Date(a.CreateDtm))) {
      if (!fkByWk.has(f.WarehouseKey)) fkByWk.set(f.WarehouseKey, f.FreightKey);
    }

    // AWB 기준 그룹화 (AWB 없으면 WarehouseKey 단위로 개별 그룹)
    const groupMap = new Map();
    for (const m of wmRes.recordset) {
      const groupKey = m.AWB ? `AWB:${m.AWB}` : `WK:${m.WarehouseKey}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          GroupKey: groupKey, AWB: m.AWB || '',
          PrimaryKey: m.WarehouseKey, AllKeys: [],
          MergeCount: 0,
          FarmName: m.FarmName, OrderWeek: m.OrderWeek, InvoiceNo: m.InvoiceNo, InputDate: m.InputDate,
          GrossWeight: 0, ChargeableWeight: 0, FreightRateUSD: null, DocFeeUSD: null,
          FreightKey: null,
        });
      }
      const g = groupMap.get(groupKey);
      g.AllKeys.push(m.WarehouseKey);
      g.MergeCount++;
      g.PrimaryKey = Math.min(g.PrimaryKey, m.WarehouseKey);
      if (m.GrossWeight != null) g.GrossWeight = (g.GrossWeight || 0) + Number(m.GrossWeight);
      if (m.ChargeableWeight != null) g.ChargeableWeight = (g.ChargeableWeight || 0) + Number(m.ChargeableWeight);
      if (m.FreightRateUSD != null && g.FreightRateUSD == null) g.FreightRateUSD = Number(m.FreightRateUSD);
      if (m.DocFeeUSD != null && g.DocFeeUSD == null) g.DocFeeUSD = Number(m.DocFeeUSD);
      if (m.InputDate > g.InputDate) g.InputDate = m.InputDate;
    }
    // FreightKey는 PrimaryKey 기준
    for (const g of groupMap.values()) {
      g.FreightKey = fkByWk.get(g.PrimaryKey) || null;
      g.AllKeys = g.AllKeys.join(',');
    }
    const groups = [...groupMap.values()].sort((a, b) => (b.InputDate || '').localeCompare(a.InputDate || ''));
    return res.status(200).json({ success: true, groups });
  }

  // 단일 WarehouseKey (하위 호환)
  const wk = parseInt(warehouseKey);
  return await loadFreightData(res, [wk], null);
}

async function loadFreightData(res, keys, awbLabel) {
  // keys: WarehouseKey 배열. awbLabel: AWB 문자열(그룹 표시용, null이면 단일)
  const keyList = keys.map(k => parseInt(k)).filter(Boolean);
  if (keyList.length === 0) return res.status(400).json({ success:false, error:'warehouseKey 없음' });
  const keyCSV = keyList.join(',');  // 숫자만이라 안전

  const [mRes, dRes, fRes, fcRes] = await Promise.all([
    query(
      `SELECT WarehouseKey, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo AS AWB,
          CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate,
          GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
         FROM WarehouseMaster WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0
         ORDER BY WarehouseKey`
    ),
    query(
      `SELECT wd.WarehouseKey, wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
          wd.UPrice, wd.TPrice, wd.OrderCode,
          p.ProdName, p.FlowerName, p.SteamOf1Bunch, p.Cost,
          p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
         FROM WarehouseDetail wd
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
         WHERE wd.WarehouseKey IN (${keyCSV})
         ORDER BY wd.WarehouseKey, wd.WdetailKey`
    ),
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`),
    // 스냅샷은 primary(최소) WarehouseKey 기준
    query(
      `SELECT TOP 1 * FROM FreightCost WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY CreateDtm DESC`
    ),
  ]);

  if (mRes.recordset.length === 0) return res.status(404).json({ success: false, error: '해당 BILL(AWB)을 찾을 수 없습니다.' });
  const masters = mRes.recordset;
  const primaryKey = Math.min(...masters.map(m => m.WarehouseKey));
  // 대표 마스터: primary 기준 + 집계값
  const master = {
    ...masters.find(m => m.WarehouseKey === primaryKey),
    AWB: awbLabel || masters[0].AWB,
    // 여러 원장일 때 GW/CW/Rate/DocFee 는 합산 or 첫 값 (합산이 의미상 맞음: 같은 AWB의 분할 업로드)
    GrossWeight: sumField(masters, 'GrossWeight'),
    ChargeableWeight: sumField(masters, 'ChargeableWeight'),
    FreightRateUSD: firstNonNullField(masters, 'FreightRateUSD'),
    DocFeeUSD: firstNonNullField(masters, 'DocFeeUSD'),
  };
  const rows = dRes.recordset;
  const flowers = fRes.recordset;
  const existingSnapshot = fcRes.recordset[0] || null;

  // 스냅샷 detail 있으면 로드
  let snapshotDetails = [];
  if (existingSnapshot) {
    const sdRes = await query(
      `SELECT * FROM FreightCostDetail WHERE FreightKey=@fk`,
      { fk: { type: sql.Int, value: existingSnapshot.FreightKey } }
    );
    snapshotDetails = sdRes.recordset;
  }

  // 카테고리별 박스수 집계 (LEFT JOIN에서 FlowerName 없으면 '미분류')
  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }

  // distinct FlowerName count (actually present in BILL with boxes > 0)
  const itemCount = [...boxByFlower.entries()].filter(([_, v]) => v > 0).length;

  const invoiceUSD = rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);

  // 스냅샷 값 우선, 없으면 Warehouse/기본값
  const snap = existingSnapshot;
  const liveMaster = {
    warehouseKey: master.WarehouseKey,
    gw: snap?.GrossWeight ?? master.GrossWeight ?? 0,
    cw: snap?.ChargeableWeight ?? master.ChargeableWeight ?? 0,
    rateUSD: snap?.FreightRateUSD ?? master.FreightRateUSD ?? 0,
    docFeeUSD: snap?.DocFeeUSD ?? master.DocFeeUSD ?? 0,
    exchangeRate: snap?.ExchangeRate ?? 0,
    invoiceUSD: snap?.InvoiceTotalUSD ?? invoiceUSD,
    itemCount,
  };
  const customs = snap ? {
    bakSangRate: Number(snap.BakSangRate) || DEFAULT_CUSTOMS.bakSangRate,
    handlingFee: Number(snap.HandlingFee) || DEFAULT_CUSTOMS.handlingFee,
    quarantinePerItem: Number(snap.QuarantinePerItem) || DEFAULT_CUSTOMS.quarantinePerItem,
    domesticFreight: Number(snap.DomesticFreight) || DEFAULT_CUSTOMS.domesticFreight,
    deductFee: Number(snap.DeductFee) || DEFAULT_CUSTOMS.deductFee,
    extraFee: Number(snap.ExtraFee) || DEFAULT_CUSTOMS.extraFee,
  } : { ...DEFAULT_CUSTOMS };
  const basis = snap?.WeightBasis || 'AUTO';

  // detail 집합 빌드
  // 같은 flowerName 여러 row일 때 boxQty는 첫 row에만 몰아서 넣는 방식으로 (엑셀 AC 블록과 동일)
  const flowerSeen = new Set();
  const details = rows.map(r => {
    const fn = (r.FlowerName || '').trim();
    const isFirst = !flowerSeen.has(fn);
    if (isFirst) flowerSeen.add(fn);
    const boxQty = isFirst ? (boxByFlower.get(fn) || 0) : 0;
    // 스냅샷에서 동일 ProdKey 찾아서 N/Q 복원
    const snapRow = snap ? snapshotDetails.find(s => s.ProdKey === r.ProdKey) : null;
    return {
      warehouseDetailKey: r.WdetailKey,
      prodKey: r.ProdKey,
      prodName: r.ProdName,
      flowerName: fn,
      farmName: r.OrderCode || null,
      boxQty,
      steamQty: Number(r.SteamQuantity) || 0,
      fobUSD: Number(r.UPrice) || 0,
      stemsPerBunch: snapRow?.StemsPerBunch != null ? Number(snapRow.StemsPerBunch) : (Number(r.SteamOf1Bunch) || 0),
      salePriceKRW: snapRow?.SalePriceKRW != null ? Number(snapRow.SalePriceKRW) : (Number(r.Cost) || 0),
      tariffRate: snapRow?.TariffRate != null ? Number(snapRow.TariffRate) : (r.P_TariffRate != null ? Number(r.P_TariffRate) : null),
    };
  });

  // Product 레벨 BoxWeight/BoxCBM 맵
  const productMeta = {};
  for (const r of rows) {
    if (r.P_BoxWeight != null || r.P_BoxCBM != null || r.P_TariffRate != null) {
      productMeta[r.ProdKey] = {
        boxWeight: r.P_BoxWeight != null ? Number(r.P_BoxWeight) : null,
        boxCBM: r.P_BoxCBM != null ? Number(r.P_BoxCBM) : null,
        tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
      };
    }
  }

  // Flower 기본값 맵 (normalized key)
  const flowerMeta = {};
  for (const f of flowers) {
    flowerMeta[normalizeFlower(f.FlowerName)] = {
      boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
      boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
      stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
      defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
    };
  }

  // 계산
  const result = computeFreightCost({
    master: liveMaster,
    basis,
    customs,
    details,
    productMeta,
    flowerMeta,
  });

  return res.status(200).json({
    success: true,
    warehouse: master,
    warehouseKeys: keyList,        // 포함된 WarehouseKey 전체
    primaryKey,
    mergeCount: masters.length,
    awb: awbLabel,
    snapshot: existingSnapshot,
    productMeta,
    flowerMeta,
    input: { master: liveMaster, basis, customs, details },
    result,
  });
}

function sumField(arr, field) {
  const vals = arr.map(x => Number(x[field])).filter(v => !Number.isNaN(v) && v !== 0);
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
}
function firstNonNullField(arr, field) {
  for (const x of arr) if (x[field] != null) return Number(x[field]);
  return null;
}

async function handlePost(req, res) {
  const { warehouseKey, basis = 'AUTO', master, customs, rows } = req.body;
  if (!warehouseKey) return res.status(400).json({ success:false, error:'warehouseKey 필수' });
  if (!master || !master.gw || !master.cw || !master.rateUSD || !master.exchangeRate) {
    return res.status(400).json({ success:false, error:'GW / CW / Rate / 환율 필수' });
  }
  const c = { ...DEFAULT_CUSTOMS, ...(customs || {}) };

  // 현재 Product/Flower 데이터 다시 조회 (latest로 계산)
  const [fRes, pRes] = await Promise.all([
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`),
    query(`SELECT ProdKey, BoxWeight, BoxCBM, TariffRate FROM Product WHERE isDeleted=0`),
  ]);
  const productMeta = {};
  for (const p of pRes.recordset) {
    productMeta[p.ProdKey] = {
      boxWeight: p.BoxWeight != null ? Number(p.BoxWeight) : null,
      boxCBM: p.BoxCBM != null ? Number(p.BoxCBM) : null,
      tariffRate: p.TariffRate != null ? Number(p.TariffRate) : null,
    };
  }
  const flowerMeta = {};
  for (const f of fRes.recordset) {
    flowerMeta[normalizeFlower(f.FlowerName)] = {
      boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
      boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
      stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
      defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
    };
  }

  // 재계산 (저장 전 최종 값)
  const calc = computeFreightCost({
    master: { ...master, warehouseKey },
    basis,
    customs: c,
    details: rows,
    productMeta,
    flowerMeta,
  });

  // 트랜잭션: 기존 active 스냅샷 soft-delete → 신규 INSERT → Detail bulk
  const result = await withTransaction(async (tQuery) => {
    await tQuery(
      `UPDATE FreightCost SET isDeleted=1, UpdateID=@uid, UpdateDtm=GETDATE()
         WHERE WarehouseKey=@wk AND isDeleted=0`,
      { wk: { type: sql.Int, value: parseInt(warehouseKey) }, uid: { type: sql.NVarChar, value: req.user.userId } }
    );
    const fcRes = await tQuery(
      `INSERT INTO FreightCost
        (WarehouseKey, WeightBasis, ExchangeRate, GrossWeight, ChargeableWeight,
         FreightRateUSD, DocFeeUSD, InvoiceTotalUSD,
         BakSangRate, HandlingFee, QuarantinePerItem, DomesticFreight, DeductFee, ExtraFee,
         CreateID, CreateDtm, isDeleted)
       OUTPUT INSERTED.FreightKey
       VALUES (@wk, @basis, @ex, @gw, @cw, @rate, @doc, @inv,
               @bs, @hd, @qp, @dm, @df, @ef, @uid, GETDATE(), 0)`,
      {
        wk:    { type: sql.Int,      value: parseInt(warehouseKey) },
        basis: { type: sql.NVarChar, value: calc.header.basis },
        ex:    { type: sql.Float,    value: Number(master.exchangeRate) },
        gw:    { type: sql.Float,    value: Number(master.gw) },
        cw:    { type: sql.Float,    value: Number(master.cw) },
        rate:  { type: sql.Float,    value: Number(master.rateUSD) },
        doc:   { type: sql.Float,    value: Number(master.docFeeUSD) || 0 },
        inv:   { type: sql.Float,    value: Number(master.invoiceUSD) || 0 },
        bs:    { type: sql.Float,    value: Number(c.bakSangRate) },
        hd:    { type: sql.Float,    value: Number(c.handlingFee) },
        qp:    { type: sql.Float,    value: Number(c.quarantinePerItem) },
        dm:    { type: sql.Float,    value: Number(c.domesticFreight) },
        df:    { type: sql.Float,    value: Number(c.deductFee) },
        ef:    { type: sql.Float,    value: Number(c.extraFee) },
        uid:   { type: sql.NVarChar, value: req.user.userId },
      }
    );
    const freightKey = fcRes.recordset[0].FreightKey;

    // Detail bulk insert
    let idx = 0;
    for (const row of calc.rows) {
      await tQuery(
        `INSERT INTO FreightCostDetail
           (FreightKey, WarehouseDetailKey, ProdKey, ProdName, FlowerName, FarmName,
            SteamQty, FOBUSD, BoxQty, BoxWeightUsed, BoxCBMUsed, StemsPerBoxUsed,
            StemsPerBunch, SalePriceKRW, TariffRate,
            FreightPerStemUSD, CNF_USD, CNF_KRW, TariffKRW, CustomsPerStem,
            ArrivalPerStem, ArrivalPerBunch, SalePriceExVAT,
            ProfitPerBunch, ProfitRate, TotalSaleKRW, TotalProfitKRW, SortOrder)
         VALUES
           (@fk, @wdk, @pk, @pn, @fn, @farm,
            @sq, @fob, @bq, @bw, @bc, @spb,
            @spb2, @sp, @tr,
            @g, @h, @j, @k, @l,
            @m, @o, @p,
            @s, @t, @u, @v, @so)`,
        {
          fk:   { type: sql.Int,      value: freightKey },
          wdk:  { type: sql.Int,      value: row.warehouseDetailKey ?? null },
          pk:   { type: sql.Int,      value: row.prodKey },
          pn:   { type: sql.NVarChar, value: row.prodName || '' },
          fn:   { type: sql.NVarChar, value: row.flowerName || '' },
          farm: { type: sql.NVarChar, value: row.farmName || '' },
          sq:   { type: sql.Float,    value: row.steamQty ?? null },
          fob:  { type: sql.Float,    value: row.fobUSD ?? null },
          bq:   { type: sql.Float,    value: row.boxQty ?? null },
          bw:   { type: sql.Float,    value: row.boxWeightUsed ?? null },
          bc:   { type: sql.Float,    value: row.boxCBMUsed ?? null },
          spb:  { type: sql.Float,    value: row.stemsPerBoxUsed ?? null },
          spb2: { type: sql.Float,    value: row.stemsPerBunch ?? null },
          sp:   { type: sql.Float,    value: row.salePriceKRW ?? null },
          tr:   { type: sql.Float,    value: row.tariffRate ?? null },
          g:    { type: sql.Float,    value: row.freightPerStemUSD ?? null },
          h:    { type: sql.Float,    value: row.cnfUSD ?? null },
          j:    { type: sql.Float,    value: row.cnfKRW ?? null },
          k:    { type: sql.Float,    value: row.tariffKRW ?? null },
          l:    { type: sql.Float,    value: row.customsPerStem ?? null },
          m:    { type: sql.Float,    value: row.arrivalPerStem ?? null },
          o:    { type: sql.Float,    value: row.arrivalPerBunch ?? null },
          p:    { type: sql.Float,    value: row.salePriceExVAT ?? null },
          s:    { type: sql.Float,    value: row.profitPerBunch ?? null },
          t:    { type: sql.Float,    value: row.profitRate ?? null },
          u:    { type: sql.Float,    value: row.totalSaleKRW ?? null },
          v:    { type: sql.Float,    value: row.totalProfitKRW ?? null },
          so:   { type: sql.Int,      value: idx++ },
        }
      );
    }
    return { freightKey };
  });

  return res.status(200).json({ success: true, ...result, saved: calc.rows.length });
}
