// pages/api/freight/index.js
// GET (no params)              → 스냅샷 리스트 + WarehouseMaster join
// GET ?warehouseKey=N          → 라이브 계산 데이터 (스냅샷 없어도 OK)
// POST                         → 스냅샷 저장 (기존 active 있으면 soft-delete 후 INSERT)

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { computeFreightCost, normalizeFlower, isFreightForwarder, isFreightRow, autoDetectFlower, detectInvoiceCurrency } from '../../../lib/freightCalc';

const DEFAULT_CUSTOMS = {
  bakSangRate: 460,
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

  // AWB 그룹 조회 — 같은 AWB의 모든 WarehouseKey 합산 (대시/공백 무시)
  if (awb) {
    const normAWB = (awb || '').replace(/[-\s]/g, '').trim();
    const r = await query(
      `SELECT WarehouseKey FROM WarehouseMaster
         WHERE REPLACE(REPLACE(OrderNo,'-',''),' ','')=@awb AND isDeleted=0
         ORDER BY WarehouseKey`,
      { awb: { type: sql.NVarChar, value: normAWB } }
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

    // AWB 정규화 — 대시/공백 제거하여 "006-45360346" == "00645360346" 매칭
    const normalizeAWB = (awb) => (awb || '').replace(/[-\s]/g, '').trim();

    // AWB 기준 그룹화 (AWB 없으면 WarehouseKey 단위로 개별 그룹)
    const groupMap = new Map();
    for (const m of wmRes.recordset) {
      const normAWB = normalizeAWB(m.AWB);
      const groupKey = normAWB ? `AWB:${normAWB}` : `WK:${m.WarehouseKey}`;
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

  const [mRes, dRes, fRes, fcRes, curRes] = await Promise.all([
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
          wm.FarmName,
          p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.Cost,
          p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
         FROM WarehouseDetail wd
         INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
         WHERE wd.WarehouseKey IN (${keyCSV})
         ORDER BY wm.FarmName, wd.WdetailKey`
    ),
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`),
    // 스냅샷은 primary(최소) WarehouseKey 기준
    query(
      `SELECT TOP 1 * FROM FreightCost WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY CreateDtm DESC`
    ),
    // CurrencyMaster 전체 (USD/EUR/JPY/CNY/KRW 등)
    query(`SELECT CurrencyCode, CurrencyName, ExchangeRate FROM CurrencyMaster WHERE IsActive=1`),
  ]);

  // 통화별 환율 맵 { USD: 1300, EUR: 1420, CNY: 188, JPY: 8.9, KRW: 1 }
  const currencyRates = { KRW: 1 };
  for (const c of (curRes.recordset || [])) {
    currencyRates[c.CurrencyCode] = Number(c.ExchangeRate) || 0;
  }

  if (mRes.recordset.length === 0) return res.status(404).json({ success: false, error: '해당 BILL(AWB)을 찾을 수 없습니다.' });
  const mastersAll = mRes.recordset;
  // FREIGHTWISE (항공 운송사) 원장 분리
  const freightMasters = mastersAll.filter(m => isFreightForwarder(m.FarmName));
  const flowerMasters  = mastersAll.filter(m => !isFreightForwarder(m.FarmName));
  const masters = flowerMasters.length > 0 ? flowerMasters : mastersAll;
  const primaryKey = Math.min(...masters.map(m => m.WarehouseKey));
  const allRows = dRes.recordset;
  // 운송료 행 분리: FarmName 이 운송사이거나 ProdName 이 '운송료' 등인 행
  const freightRows = allRows.filter(r => isFreightRow(r));
  const rows = allRows.filter(r => !isFreightRow(r));
  // FREIGHTWISE / 운송료 행에서 항공료 + GW/Rate/DocFee 추출
  // 패턴 A (Rate×Weight): UPrice=작은값(Rate), BunchQuantity=큰값(GW kg), TPrice=Rate*GW
  //   예: FREIGHTWISE Colombia — UPrice=2.85, BunchQty=976, TPrice=2781.6
  // 패턴 B (총액 1건):  UPrice=큰값(총 항공료), BunchQuantity≤1
  //   예: Yunnan Melody 운송료 — UPrice=11214, BunchQty=1, TPrice=11214
  const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
  // BunchQty>1 이면 Rate×Weight 패턴 (GW/Rate 추출 가능), 아니면 총액 패턴
  const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
  const freightDocRows = freightRows.filter(r => (Number(r.UPrice) || 0) === 0 && Number(r.TPrice) > 0);
  const extractedGW   = isRatePattern ? (Number(freightMainRow.BunchQuantity) || 0) : 0;
  const extractedRate  = isRatePattern ? (Number(freightMainRow.UPrice) || 0) : 0;
  const extractedDoc   = freightDocRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);

  // 품목명이 "GROSS WEIGHT" / "CHARGEABLE WEIGHT" 인 특수행에서 무게값 추출
  // 실제 DB: 오타 "weigth" + 무게값이 BunchQuantity/SteamQuantity 어느 쪽에든 올 수 있음
  // (Yunnan Melody 는 SteamQuantity 에 554, FREIGHTWISE 는 BunchQuantity 에)
  const isGwName = (n) => /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(n || '').trim());
  const isCwName = (n) => /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(n || '').trim());
  // Box/Bunch/Steam 중 1보다 큰 최대값 = 실제 무게 (더미값 1은 스킵)
  const weightOfRow = (r) => {
    const vals = [Number(r.BoxQuantity) || 0, Number(r.BunchQuantity) || 0, Number(r.SteamQuantity) || 0];
    const realVals = vals.filter(v => v > 1);
    return realVals.length > 0 ? Math.max(...realVals) : 0;
  };
  const gwRows = allRows.filter(r => isGwName(r.ProdName));
  const cwRows = allRows.filter(r => isCwName(r.ProdName));
  const extractedGwFromRow = gwRows.reduce((a, r) => a + weightOfRow(r), 0);
  const extractedCwFromRow = cwRows.reduce((a, r) => a + weightOfRow(r), 0);

  // 대표 마스터: primary 기준 + 집계값 + FREIGHTWISE 에서 추출한 GW/Rate/DocFee fallback
  const master = {
    ...masters.find(m => m.WarehouseKey === primaryKey),
    AWB: awbLabel || mastersAll[0].AWB,
    // 1순위: BILL 내 'Gross weigth'/'Chargeable weigth' 행 (가장 신뢰도 높음)
    // 2순위: WarehouseMaster 필드 (1 같은 더미값인 경우 많아 후순위)
    // 3순위: FREIGHTWISE 행 (Rate×Weight 패턴)
    GrossWeight: (extractedGwFromRow > 1 ? extractedGwFromRow : null) || sumField(masters, 'GrossWeight') || (extractedGW > 0 ? extractedGW : null),
    ChargeableWeight: (extractedCwFromRow > 1 ? extractedCwFromRow : null) || sumField(masters, 'ChargeableWeight') || (extractedGW > 0 ? extractedGW : null),
    FreightRateUSD: firstNonNullField(masters, 'FreightRateUSD') || (extractedRate > 0 ? extractedRate : null),
    DocFeeUSD: firstNonNullField(masters, 'DocFeeUSD') || (extractedDoc > 0 ? extractedDoc : null),
  };
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

  // 자동 카테고리 매핑 — FlowerName 이 '기타'/'미분류' 인 품목은 ProdName 키워드로 재분류
  // 예: [MEL] CHINA / 리모늄 미스티 블루 (FlowerName='기타') → '리모니움'
  const autoMapped = [];
  for (const r of rows) {
    const orig = (r.FlowerName || '').trim();
    const detected = autoDetectFlower(r.ProdName, orig);
    if (detected !== orig) {
      r.FlowerName = detected;  // rows 배열의 행 자체 수정
      autoMapped.push({ prodName: r.ProdName, from: orig || '(없음)', to: detected });
    }
  }

  // 웹 전용 카테고리 오버라이드 적용 (Product.FlowerName 은 건드리지 않고 표시만 변경)
  const { loadOverrides } = await import('../../../lib/categoryOverrides');
  const catOverrides = loadOverrides();
  for (const r of rows) {
    const ov = r.ProdKey ? catOverrides[r.ProdKey] : null;
    if (ov && ov.category) {
      r.FlowerName = ov.category;
      r._categoryOverride = { category: ov.category, note: ov.note || '' };
    }
  }

  // 카테고리별 박스수 집계 (재분류 후 기준)
  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }

  // distinct FlowerName count (actually present in BILL)
  const itemCount = [...boxByFlower.entries()].filter(([_, v]) => v > 0).length
    || [...new Set(rows.map(r => (r.FlowerName || '').trim()))].filter(Boolean).length;

  const invoiceUSD = rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);

  // 인보이스 통화 자동 감지 (Product.CounName 기반) + CurrencyMaster 에서 환율 제안
  const invoiceCurrency = detectInvoiceCurrency(rows.map(r => ({ counName: r.CounName })));
  const suggestedExchangeRate = currencyRates[invoiceCurrency] || 0;
  // 감지된 국가 분포 (UI 에서 배지로 표시)
  const counCounter = {};
  for (const r of rows) {
    const cn = (r.CounName || '').trim();
    if (cn) counCounter[cn] = (counCounter[cn] || 0) + 1;
  }
  const countryDistribution = Object.entries(counCounter).sort((a, b) => b[1] - a[1]);

  // 스냅샷 값 우선, 없으면 Warehouse → 통화환율 제안값 → 0 순서
  const snap = existingSnapshot;
  const liveMaster = {
    warehouseKey: master.WarehouseKey,
    gw: snap?.GrossWeight ?? master.GrossWeight ?? 0,
    cw: snap?.ChargeableWeight ?? master.ChargeableWeight ?? 0,
    rateUSD: snap?.FreightRateUSD ?? master.FreightRateUSD ?? 0,
    docFeeUSD: snap?.DocFeeUSD ?? master.DocFeeUSD ?? 0,
    // 환율: 스냅샷 > 0 이면 사용, 아니면 CurrencyMaster 의 자동 제안값
    exchangeRate: (snap?.ExchangeRate > 0 ? snap.ExchangeRate : suggestedExchangeRate) || 0,
    invoiceUSD: snap?.InvoiceTotalUSD ?? invoiceUSD,
    itemCount,
    actualFreightUSD: actualFreightUSD > 0 ? actualFreightUSD : null,
    // 통화 정보 (UI 표시용)
    invoiceCurrency,
    suggestedExchangeRate,
    exchangeRateAutoFilled: !(snap?.ExchangeRate > 0) && suggestedExchangeRate > 0,
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

  // Flower 기본값 맵 (normalized key) — steamQty fallback 계산에 필요해서 details 생성 전에 빌드
  const flowerMeta = {};
  for (const f of flowers) {
    flowerMeta[normalizeFlower(f.FlowerName)] = {
      boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
      boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
      stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
      defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
    };
  }

  // 송이수 fallback — WarehouseDetail.SteamQuantity 가 0 이면 Bunch/Box 단위에서 환산.
  // 입고 엑셀(Packing) 에 TOTAL STEAM 컬럼 없이 BOX/BUNCH 만 있는 경우 대응.
  const resolveSteamQty = (r) => {
    const sq = Number(r.SteamQuantity) || 0;
    if (sq > 0) return sq;
    const spb = Number(r.SteamOf1Bunch) || 0;       // Product.SteamOf1Bunch (단당 송이)
    const bq = Number(r.BunchQuantity) || 0;
    if (bq > 0 && spb > 0) return bq * spb;
    const boxQ = Number(r.BoxQuantity) || 0;
    const fm = flowerMeta[normalizeFlower(r.FlowerName || '')];
    const stemsPerBox = Number(fm?.stemsPerBox) || 0;
    if (boxQ > 0 && stemsPerBox > 0) return boxQ * stemsPerBox;
    return 0;
  };

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
      farmName: r.FarmName || null,
      orderCode: r.OrderCode || null,
      boxQty,                                                        // 카테고리 분배용(첫 행에만 몰아 넣음)
      rawBoxQty: Number(r.BoxQuantity) || 0,                         // 행별 박스수 — client fallback 용
      bunchQty: Number(r.BunchQuantity) || 0,                        // 행별 단수 — client fallback 용
      steamQty: resolveSteamQty(r),
      fobUSD: Number(r.UPrice) || 0,                                 // DB 단가 (보통 송이당, 단가 단위는 OutUnit 에 따름)
      totalPriceUSD: Number(r.TPrice) || 0,                          // 원장에 기록된 총단가 (표시용)
      stemsPerBunch: snapRow?.StemsPerBunch != null ? Number(snapRow.StemsPerBunch) : (Number(r.SteamOf1Bunch) || 0),
      salePriceKRW: snapRow?.SalePriceKRW != null ? Number(snapRow.SalePriceKRW) : (Number(r.Cost) || 0),
      tariffRate: snapRow?.TariffRate != null ? Number(snapRow.TariffRate) : (r.P_TariffRate != null ? Number(r.P_TariffRate) : null),
      categoryOverride: r._categoryOverride || null,  // 웹 오버라이드 적용됐으면 {category, note}
      origFlowerName: catOverrides[r.ProdKey] ? null : null, // 원본은 DB에 남아있음
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

  // 계산
  const result = computeFreightCost({
    master: liveMaster,
    basis,
    customs,
    details,
    productMeta,
    flowerMeta,
  });

  // 자동 카테고리 매핑된 품목 정보를 경고에 추가
  if (autoMapped.length > 0) {
    const summary = autoMapped.slice(0, 5).map(m => `${m.prodName?.substring(0, 30)} → ${m.to}`).join(', ');
    const extra = autoMapped.length > 5 ? ` 외 ${autoMapped.length - 5}건` : '';
    result.warnings = result.warnings || [];
    result.warnings.unshift({
      level: 'warn',
      msg: `품목명 키워드로 카테고리 자동 매핑: ${summary}${extra}. 정확하지 않으면 품목관리 > 제품정보 에서 FlowerName 수정.`,
    });
  }

  return res.status(200).json({
    success: true,
    warehouse: master,
    warehouseKeys: keyList,        // 포함된 WarehouseKey 전체
    primaryKey,
    mergeCount: masters.length,
    freightForwarder: freightMasters.length > 0 ? {
      farmNames: [...new Set(freightMasters.map(m => m.FarmName))],
      invoiceCount: freightMasters.length,
      actualFreightUSD,
    } : null,
    awb: awbLabel,
    autoMapped,                                        // 카테고리 자동매핑 내역
    currencyRates,                                     // 활성 통화 전체 환율 맵 {USD,EUR,CNY,JPY}
    invoiceCurrency: liveMaster.invoiceCurrency,       // 감지된 대표 통화
    countryDistribution,                               // [[국가명, 품목수], ...]
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
