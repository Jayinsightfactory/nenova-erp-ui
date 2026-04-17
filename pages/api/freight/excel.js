// pages/api/freight/excel.js — 운송기준원가 엑셀 다운로드
// 원본 16-1 콜롬비아 원가자료.xlsx 레이아웃/서식 복제 (테두리/색/컬럼너비 포함)
// AWB 기준 합산: warehouseKeys=1,2,3 (같은 AWB의 여러 원장) 또는 awb=AWB번호로 조회

import XLSX from 'xlsx-js-style';  // SheetJS fork with style write support
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeFlower, isFreightForwarder, isFreightRow, autoDetectFlower, getDefaultStemsPerBunch, computeFreightCost } from '../../../lib/freightCalc';

export default withAuth(async function handler(req, res) {
  try {
    let keys = [];
    let awbLabel = '';
    let overrides = null;  // POST 로 전달된 client-side 편집값

    if (req.method === 'POST') {
      const body = req.body || {};
      awbLabel = body.awb || '';
      if (Array.isArray(body.warehouseKeys) && body.warehouseKeys.length > 0) {
        keys = body.warehouseKeys.map(Number).filter(Boolean);
      } else if (body.warehouseKey) {
        keys = [Number(body.warehouseKey)].filter(Boolean);
      } else if (awbLabel) {
        const normAWB = awbLabel.replace(/[-\s]/g, '').trim();
        const r = await query(
          `SELECT WarehouseKey FROM WarehouseMaster WHERE REPLACE(REPLACE(OrderNo,'-',''),' ','')=@awb AND isDeleted=0 ORDER BY WarehouseKey`,
          { awb: { type: sql.NVarChar, value: normAWB } }
        );
        keys = r.recordset.map(x => x.WarehouseKey);
      }
      overrides = {
        master: body.master || null,
        customs: body.customs || null,
        basis: body.basis || null,
        rows: Array.isArray(body.rows) ? body.rows : [],
        flowerOverrides: body.flowerOverrides || {},
      };
    } else {
      const { warehouseKey, warehouseKeys, awb } = req.query;
      awbLabel = awb || '';
      if (warehouseKeys) {
        keys = warehouseKeys.split(',').map(s => parseInt(s)).filter(Boolean);
      } else if (warehouseKey) {
        keys = [parseInt(warehouseKey)];
      } else if (awb) {
        const normAWB = awb.replace(/[-\s]/g, '').trim();
        const r = await query(
          `SELECT WarehouseKey FROM WarehouseMaster WHERE REPLACE(REPLACE(OrderNo,'-',''),' ','')=@awb AND isDeleted=0 ORDER BY WarehouseKey`,
          { awb: { type: sql.NVarChar, value: normAWB } }
        );
        keys = r.recordset.map(x => x.WarehouseKey);
      }
    }

    if (keys.length === 0) return res.status(400).json({ success:false, error:'warehouseKey/awb 필수' });

    const wb = XLSX.utils.book_new();
    const sheet = await buildSheet(keys, awbLabel, overrides);
    if (sheet) XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.name);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="freight_${awbLabel || keys.join('_')}_${Date.now()}.xlsx"`);
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).json({ success:false, error: err.message });
  }
});

// 서식 스타일
const BORDER_THIN = { style: 'thin', color: { rgb: '999999' } };
const BORDER_ALL = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
const BG_HEADER = { fgColor: { rgb: 'E3F2FD' }, patternType: 'solid' };   // 파란 헤더
const BG_INPUT  = { fgColor: { rgb: 'FFF9C4' }, patternType: 'solid' };   // 노란 입력
const BG_FORMULA= { fgColor: { rgb: 'F5F5F5' }, patternType: 'solid' };   // 회색 수식
const BG_SECTION= { fgColor: { rgb: 'BBDEFB' }, patternType: 'solid' };   // 진파랑 섹션제목
const FONT_BOLD = { bold: true, sz: 11 };
const FONT_TITLE = { bold: true, sz: 14, color: { rgb: 'FFFFFF' } };
const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
const ALIGN_RIGHT = { horizontal: 'right', vertical: 'center' };

function style(bg, font, align, border = BORDER_ALL) {
  return { fill: bg, font, alignment: align, border };
}

async function buildSheet(warehouseKeys, awbLabel, overrides) {
  const ov = overrides || {};
  const ovMaster = ov.master || {};
  const ovCustoms = ov.customs || {};
  const ovFlowers = ov.flowerOverrides || {};
  const ovRowsByKey = new Map();
  for (const r of (ov.rows || [])) if (r && r.prodKey != null) ovRowsByKey.set(Number(r.prodKey), r);
  const pickOv = (val, fallback) => (val === '' || val == null || Number.isNaN(Number(val))) ? fallback : Number(val);

  const keyCSV = warehouseKeys.join(',');
  const [mRes, dRes, fRes, fcRes] = await Promise.all([
    query(
      `SELECT WarehouseKey, OrderWeek, FarmName, InvoiceNo, OrderNo AS AWB,
          CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate,
          GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
         FROM WarehouseMaster WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY WarehouseKey`
    ),
    query(
      `SELECT wd.WdetailKey, wd.WarehouseKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.UPrice, wd.TPrice, wd.OrderCode,
          wm.FarmName,
          p.ProdName, p.FlowerName, p.SteamOf1Bunch, p.Cost,
          p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
         FROM WarehouseDetail wd
         INNER JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
         WHERE wd.WarehouseKey IN (${keyCSV}) ORDER BY wm.FarmName, wd.WdetailKey`
    ),
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox FROM Flower WHERE isDeleted=0`),
    query(`SELECT TOP 1 * FROM FreightCost WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY CreateDtm DESC`),
  ]);

  if (mRes.recordset.length === 0) return null;
  const mastersAll = mRes.recordset;
  const allRows = dRes.recordset;
  // FREIGHTWISE 분리
  const masters = mastersAll.filter(m => !isFreightForwarder(m.FarmName));
  // 운송료 행 분리: FarmName 이 운송사이거나 ProdName 이 '운송료' 등인 행
  const rows = allRows.filter(r => !isFreightRow(r));
  const freightRows = allRows.filter(r => isFreightRow(r));
  const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  // FREIGHTWISE 행에서 GW/Rate/DocFee 추출 (WarehouseMaster 에 없을 때 fallback)
  // BunchQty>1 이면 Rate×Weight 패턴 (GW/Rate 추출), 아니면 총액 패턴 (GW/Rate 추출 불가)
  const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
  const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
  const freightDocRows = freightRows.filter(r => (Number(r.UPrice) || 0) === 0 && Number(r.TPrice) > 0);
  const extractedGW   = isRatePattern ? (Number(freightMainRow.BunchQuantity) || 0) : 0;
  const extractedRate  = isRatePattern ? (Number(freightMainRow.UPrice) || 0) : 0;
  const extractedDoc   = freightDocRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const snap = fcRes.recordset[0] || null;
  const primary = (masters.length > 0 ? masters : mastersAll)[0];
  const sumF = (f) => masters.map(m => Number(m[f])).filter(v => !Number.isNaN(v) && v !== 0).reduce((a,b)=>a+b,0) || null;
  const firstF = (f) => { for (const m of masters) if (m[f] != null) return Number(m[f]); return null; };

  // 카테고리 결정 순서:
  //   1) 클라이언트 오버라이드 (rowsPayload[prodKey].flowerName)
  //   2) 자동 감지 (기타/미분류 → ProdName 키워드 매핑)
  //   3) DB FlowerName
  for (const r of rows) {
    const ovRow = ovRowsByKey.get(Number(r.ProdKey));
    if (ovRow && ovRow.flowerName) {
      r.FlowerName = ovRow.flowerName;
    } else {
      r.FlowerName = autoDetectFlower(r.ProdName, (r.FlowerName || '').trim());
    }
  }

  // 카테고리 집계 (BoxQty>0 우선, 없으면 BunchQty 기준으로도 노출)
  const boxByFlower = new Map();
  const bunchByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
    bunchByFlower.set(fn, (bunchByFlower.get(fn) || 0) + (Number(r.BunchQuantity) || 0));
  }
  // 박스가 0 인 카테고리도 단수>0 이면 포함 (MELODY 같은 BILL 대응)
  const categories = [...new Set([...boxByFlower.entries()].filter(([_, v]) => v > 0).map(([fn]) => fn)
    .concat([...bunchByFlower.entries()].filter(([_, v]) => v > 0).map(([fn]) => fn)))]
    .filter(Boolean);
  while (categories.length < 4) categories.push('');

  const flowerMetaMap = new Map();
  for (const f of fRes.recordset) flowerMetaMap.set(normalizeFlower(f.FlowerName), f);
  // 카테고리 오버라이드 적용 — Flower 마스터 저장 없이 사용자 입력값으로 즉시 반영
  // flowerOverrides 는 { [normalizedFlowerName]: { BoxWeight, BoxCBM, StemsPerBox } }
  for (const [normName, ovF] of Object.entries(ovFlowers)) {
    const base = flowerMetaMap.get(normName) || { FlowerName: normName };
    flowerMetaMap.set(normName, {
      ...base,
      BoxWeight:   pickOv(ovF.BoxWeight,   base.BoxWeight),
      BoxCBM:      pickOv(ovF.BoxCBM,      base.BoxCBM),
      StemsPerBox: pickOv(ovF.StemsPerBox, base.StemsPerBox),
    });
  }

  // 송이수 fallback — SteamQuantity 가 0 이면 Bunch/Box 단위에서 환산.
  // 최종 fallback: 업계 표준 단당송이(장미=10, 카네이션=20 등) 사용.
  const resolveSteam = (r) => {
    const sq = Number(r.SteamQuantity) || 0;
    if (sq > 0) return sq;
    const bq = Number(r.BunchQuantity) || 0;
    const spb = Number(r.SteamOf1Bunch) || 0;
    if (bq > 0 && spb > 0) return bq * spb;
    const boxQ = Number(r.BoxQuantity) || 0;
    const fm = flowerMetaMap.get(normalizeFlower(r.FlowerName || ''));
    const stemsPerBox = Number(fm?.StemsPerBox) || 0;
    if (boxQ > 0 && stemsPerBox > 0) return boxQ * stemsPerBox;
    // 업계 표준값 fallback
    if (bq > 0) {
      const defaultSpb = getDefaultStemsPerBunch(r.FlowerName || r.ProdName);
      if (defaultSpb > 0) return bq * defaultSpb;
    }
    return 0;
  };

  const sheetName = (awbLabel || primary.OrderWeek || `BILL_${primary.WarehouseKey}`).substring(0, 31);

  const dbInvoiceUSD = snap?.InvoiceTotalUSD ?? rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const totalSteam = rows.reduce((a, r) => a + resolveSteam(r), 0);
  // 0 은 "미설정" 으로 취급 — 클라이언트가 0 보내도 서버 추출값/DB값이 우선
  const pickNonZero = (val, fallback) => {
    if (val === '' || val == null || Number.isNaN(Number(val))) return fallback;
    const n = Number(val);
    return n > 0 ? n : fallback;
  };
  const invoiceUSD = pickOv(ovMaster.invoiceUSD, dbInvoiceUSD);
  const gw = pickNonZero(ovMaster.gw, snap?.GrossWeight ?? sumF('GrossWeight') ?? extractedGW ?? 0);
  const cw = pickNonZero(ovMaster.cw, snap?.ChargeableWeight ?? sumF('ChargeableWeight') ?? extractedGW ?? 0);
  const rate = pickNonZero(ovMaster.rateUSD, snap?.FreightRateUSD ?? firstF('FreightRateUSD') ?? extractedRate ?? 0);
  const docFee = pickNonZero(ovMaster.docFeeUSD, snap?.DocFeeUSD ?? firstF('DocFeeUSD') ?? extractedDoc ?? 0);
  const exchangeRate = pickOv(ovMaster.exchangeRate, snap?.ExchangeRate || 0);
  const actualFreightEff = pickNonZero(ovMaster.actualFreightUSD, actualFreightUSD);

  // aoa + styles (styles는 별도 map으로 관리 후 post-process)
  const aoa = Array.from({ length: 14 }, () => Array(35).fill(null));
  const styles = {};   // { "A1": styleObj }
  const merges = [];

  const set = (r, c, v, st) => {
    while (aoa.length <= r) aoa.push(Array(35).fill(null));
    aoa[r][c] = v;
    if (st) styles[XLSX.utils.encode_cell({ r, c })] = st;
  };
  const fml = (expr) => ({ f: expr });

  // 제목 B1
  set(0, 1, `${primary.FarmName || ''} · AWB ${awbLabel || primary.AWB || ''}`, style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s: { r: 0, c: 1 }, e: { r: 0, c: 6 } });

  // B5 차수 / C5
  set(4, 1, '차수', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(4, 2, awbLabel || primary.OrderWeek || '', style(BG_INPUT, FONT_BOLD, ALIGN_CENTER));

  // B6 총금액 / C6 (input) / D6=C6-C11 (formula)
  set(5, 1, '총금액 Invoice', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(5, 2, Number(invoiceUSD) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
  set(5, 3, fml('C6-C11'), style(BG_FORMULA, null, ALIGN_RIGHT));

  // B7 환율 / C7
  set(6, 1, '환율', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(6, 2, exchangeRate, style(BG_INPUT, null, ALIGN_RIGHT));

  // B8 GW / C8 / D8 CW / E8
  set(7, 1, 'GW', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(7, 2, gw, style(BG_INPUT, null, ALIGN_RIGHT));
  set(7, 3, 'CW', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(7, 4, cw, style(BG_INPUT, null, ALIGN_RIGHT));

  // B9 품목수 / C9 / D9 Rate / E9
  set(8, 1, '품목수', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(8, 2, categories.filter(c => c).length, style(BG_FORMULA, null, ALIGN_RIGHT));
  set(8, 3, 'Rate', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(8, 4, rate, style(BG_INPUT, null, ALIGN_RIGHT));

  // B10 총수량 / C10
  set(9, 1, '총수량', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(9, 2, totalSteam, style(BG_FORMULA, null, ALIGN_RIGHT));

  // B11 항공료 / C11 / D11 서류 / E11 / F11 운송비 / G11=E9*E8
  // FREIGHTWISE 실제 인보이스가 있으면 C11 에 그 값(고정값), 없으면 E11+G11 수식
  set(10, 1, '항공료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  if (actualFreightEff > 0) {
    set(10, 2, actualFreightEff, style({ fgColor:{rgb:'C8E6C9'}, patternType:'solid' }, FONT_BOLD, ALIGN_RIGHT));
  } else {
    set(10, 2, fml('E11+G11'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  }
  set(10, 3, '서류', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(10, 4, docFee, style(BG_INPUT, null, ALIGN_RIGHT));
  set(10, 5, '운송비', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(10, 6, fml('E9*E8'), style(BG_FORMULA, null, ALIGN_RIGHT));

  // J5 품목별 운임비 / O5 그외에 통관비
  set(4, 9, '품목별 운임비', style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s:{r:4,c:9}, e:{r:4,c:12} });
  set(4, 14, '그외에 통관비', style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s:{r:4,c:14}, e:{r:4,c:17} });

  // 통관 상수 (오버라이드 우선, 없으면 스냅샷, 없으면 하드코드 기본값)
  const cBakSang    = pickOv(ovCustoms.bakSangRate,       snap ? Number(snap.BakSangRate)       : 370);
  const cHandling   = pickOv(ovCustoms.handlingFee,       snap ? Number(snap.HandlingFee)       : 33000);
  const cQuarantine = pickOv(ovCustoms.quarantinePerItem, snap ? Number(snap.QuarantinePerItem) : 10000);
  const cDomestic   = pickOv(ovCustoms.domesticFreight,   snap ? Number(snap.DomesticFreight)   : 99000);
  const cDeduct     = pickOv(ovCustoms.deductFee,         snap ? Number(snap.DeductFee)         : 40000);
  const cExtra      = pickOv(ovCustoms.extraFee,          snap ? Number(snap.ExtraFee)          : 0);

  // row 6 J~U: 헤더
  ['품목','운임비','수량(송이)','송이당 운임비'].forEach((h,i) => set(5, 9+i, h, style(BG_HEADER, FONT_BOLD, ALIGN_CENTER)));
  set(5,14,'백상',  style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(5,15, fml(`C8*${cBakSang || 0}`), style(BG_FORMULA, null, ALIGN_RIGHT));
  set(5,16,'겸역차감', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(5,17, cDeduct || 0, style(BG_INPUT, null, ALIGN_RIGHT));
  ['품목','품목별 통관비','송이당 통관비'].forEach((h,i)=>set(5,18+i,h,style(BG_HEADER,FONT_BOLD,ALIGN_CENTER)));

  // P7..P9 통관 상수
  set(6, 14, '통관 수수료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(6, 15, cHandling || 0, style(BG_INPUT, null, ALIGN_RIGHT));
  set(7, 14, '검역 수수료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(7, 15, fml(`C9*${cQuarantine || 0}`), style(BG_FORMULA, null, ALIGN_RIGHT));
  set(8, 14, '국내 운송비', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(8, 15, cDomestic || 0, style(BG_INPUT, null, ALIGN_RIGHT));
  // 추가통관(extraFee) 는 R7 셀에 주입 — 기존 P10 Total 수식이 R6+R7 포함
  set(6, 17, cExtra || 0, style(BG_INPUT, null, ALIGN_RIGHT));
  set(9, 14, 'Total', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(9, 15, fml('SUM(P6:P9)+R6+R7'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));

  // 박스 수량 0 인 BILL (Yunnan Melody 처럼 단 단위) 감지 → 송이수 기반 분배 fallback
  const totalBoxAll = categories.reduce((a, c) => a + (c ? (boxByFlower.get(c) || 0) : 0), 0);
  const useStemsRatio = totalBoxAll <= 0;
  // 카테고리별 총 송이수 계산 (resolveSteam 기반, 업계표준 fallback 포함)
  const categoryStems = {};
  for (const cat of categories) {
    if (!cat) continue;
    const catRows = rows.filter(r => (r.FlowerName || '').trim() === cat);
    categoryStems[cat] = catRows.reduce((a, r) => a + resolveSteam(r), 0);
  }
  const totalStemsAll = Object.values(categoryStems).reduce((a, b) => a + b, 0);
  // 통관 합계 계산 (P10 수식과 동일)
  const customsBakSangKRW = (gw || 0) * (cBakSang || 0);
  const customsQuarantineKRW = (categories.filter(c => c).length || 0) * (cQuarantine || 0);
  const customsTotalKRW = customsBakSangKRW + (cHandling || 0) + customsQuarantineKRW + (cDomestic || 0) + (cDeduct || 0) + (cExtra || 0);

  // ────────────────────────────────────────────────────────────────────────
  // ★★ 전체 계산값을 computeFreightCost 로 서버에서 미리 계산해 static 값으로 기록 ★★
  // xlsx-js-style 의 formula-only 출력은 일부 뷰어에서 재계산이 안 되어 값이 비어 보임.
  // 해결: 모든 계산 셀에 캐시된 값을 직접 기록 (Excel 에서 열면 바로 값 표시).
  // ────────────────────────────────────────────────────────────────────────
  const compFlowerSeen = new Set();
  const compDetails = rows.map(r => {
    const fn = (r.FlowerName || '').trim();
    const first = !compFlowerSeen.has(fn);
    if (first) compFlowerSeen.add(fn);
    const ovRow = ovRowsByKey.get(Number(r.ProdKey)) || {};
    const sd = snapMap ? null : null;  // snapMap은 body loop에서만 사용
    return {
      prodKey: r.ProdKey,
      prodName: r.ProdName,
      flowerName: fn,
      farmName: r.FarmName,
      boxQty: first ? (boxByFlower.get(fn) || 0) : 0,  // 카테고리 분배용 (첫행)
      rawBoxQty: Number(r.BoxQuantity) || 0,
      bunchQty: Number(r.BunchQuantity) || 0,
      steamQty: Number(r.SteamQuantity) || 0,
      fobUSD: pickOv(ovRow.fobUSD, Number(r.UPrice) || 0),
      totalPriceUSD: Number(r.TPrice) || 0,
      stemsPerBunch: pickOv(ovRow.stemsPerBunch, Number(r.SteamOf1Bunch) || 0),
      salePriceKRW: pickOv(ovRow.salePriceKRW, Number(r.Cost) || 0),
      tariffRate: pickOv(ovRow.tariffRate, r.P_TariffRate ?? null),
    };
  });
  const compFlowerMeta = {};
  for (const [normKey, fm] of flowerMetaMap.entries()) {
    compFlowerMeta[normKey] = {
      boxWeight: Number(fm.BoxWeight) || null,
      boxCBM: Number(fm.BoxCBM) || null,
      stemsPerBox: Number(fm.StemsPerBox) || null,
      defaultTariff: Number(fm.DefaultTariff) || null,
    };
  }
  const compResult = computeFreightCost({
    master: {
      gw, cw, rateUSD: rate, docFeeUSD: docFee, exchangeRate,
      invoiceUSD, itemCount: categories.filter(c => c).length,
      actualFreightUSD: actualFreightEff || null,
    },
    basis: ov.basis || 'AUTO',
    customs: { bakSangRate: cBakSang, handlingFee: cHandling, quarantinePerItem: cQuarantine, domesticFreight: cDomestic, deductFee: cDeduct, extraFee: cExtra },
    details: compDetails,
    productMeta: {},
    flowerMeta: compFlowerMeta,
  });
  const compRowByProdKey = new Map(compResult.rows.map(r => [r.prodKey, r]));
  const compCategoryByName = new Map(compResult.categories.map(c => [c.flowerName, c]));

  // 4개 카테고리 (고정 4행) — K/L/M/T/U (static values from computeFreightCost)
  for (let i = 0; i < 4; i++) {
    const catName = categories[i] || '';
    const r = 6 + i;  // excel row 7..10
    set(r, 9, catName, style(BG_HEADER, null, ALIGN_CENTER));
    set(r, 18, catName, style(BG_HEADER, null, ALIGN_CENTER));
    const cat = catName ? compCategoryByName.get(catName) : null;
    const cellStyle = useStemsRatio
      ? style({ fgColor:{rgb:'FFF3E0'}, patternType:'solid' }, null, ALIGN_RIGHT)
      : style(BG_FORMULA, null, ALIGN_RIGHT);
    set(r, 10, cat ? Number(cat.freightUSD) || 0 : 0, cellStyle);
    set(r, 11, cat ? Number(cat.stemsCount) || 0 : 0, cellStyle);
    set(r, 12, cat ? Number(cat.freightPerStemUSD) || 0 : 0, cellStyle);
    set(r, 19, cat ? Number(cat.customsKRW) || 0 : 0, cellStyle);
    set(r, 20, cat ? Number(cat.customsPerStemKRW) || 0 : 0, cellStyle);
  }

  // AA3~AI13 분배 비율 블록
  set(2, 26, '운송비 품목별 분배 비율 계산', style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s:{r:2,c:26}, e:{r:2,c:34} });
  set(3, 26, 'GW==CW', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(3, 27, '무게로 계산 될 때', style(BG_HEADER, null, ALIGN_CENTER));
  merges.push({ s:{r:3,c:27}, e:{r:3,c:29} });
  set(3, 31, 'GW<<CW', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(3, 32, 'CBM으로 계산 될 때', style(BG_HEADER, null, ALIGN_CENTER));
  merges.push({ s:{r:3,c:32}, e:{r:3,c:34} });
  set(5, 26, '항공료 분배', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  merges.push({ s:{r:5,c:26}, e:{r:5,c:29} });
  set(5, 31, '항공료 분배', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  merges.push({ s:{r:5,c:31}, e:{r:5,c:34} });
  ['','박스당 무게','박스 수량','비율'].forEach((h,i)=>set(6,26+i,h,style(BG_HEADER,FONT_BOLD,ALIGN_CENTER)));
  set(6,31,'', style(BG_HEADER));
  ['박스당 CBM','박스 수량','비율'].forEach((h,i)=>set(6,32+i,h,style(BG_HEADER,FONT_BOLD,ALIGN_CENTER)));

  for (let i = 0; i < 4; i++) {
    const catName = categories[i] || '';
    const r = 7 + i;
    const fm = flowerMetaMap.get(normalizeFlower(catName)) || {};
    set(r,26,catName, style(BG_HEADER, null, ALIGN_CENTER));
    set(r,27, catName ? Number(fm.BoxWeight) || 0 : 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(r,28, catName ? (boxByFlower.get(catName) || 0) : 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(r,29, catName ? fml(`AB${r+1}*AC${r+1}/SUMPRODUCT($AB$8:$AB$11,$AC$8:$AC$11)`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(r,31,catName, style(BG_HEADER, null, ALIGN_CENTER));
    set(r,32, catName ? Number(fm.BoxCBM) || 0 : 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(r,33, catName ? (boxByFlower.get(catName) || 0) : 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(r,34, catName ? fml(`AG${r+1}*AH${r+1}/SUMPRODUCT($AG$8:$AG$11,$AH$8:$AH$11)`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
  }
  set(12, 29, fml('SUM(AD8:AD11)'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(12, 34, fml('SUM(AI8:AI11)'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));

  // T12/U12/V12 종 이익률/판매/이익 (static values)
  set(11, 19, '종 이익률', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(11, 20, '종 판매가', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(11, 21, '종 이익',   style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(12, 19, Number(compResult.totals.overallProfitRate) || 0, style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(12, 20, Number(compResult.totals.totalSaleKRW) || 0,     style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(12, 21, Number(compResult.totals.totalProfitKRW) || 0,   style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));

  // Row 14: body headers (C, D 는 카테고리/박스수로 채움 — 빈칸 제거)
  const headers = ['농장','품목명','카테고리','박스수','수량(송이)','FOB(단가)','운송비(송이)','CNF(송이)','총금액(CNF포함)','CNF(원화)','관세','그외통관(송이당)','도착원가(송이)','단당수량','도착원가(단)','판매(부가세별도)','판매가(부가세포함)','15% 이익 판매가(단)','단 이익','이익률','종 판매가','종 이익'];
  headers.forEach((h, i) => { if (h != null) set(13, i, h, style(BG_SECTION, FONT_TITLE, ALIGN_CENTER)); });

  // Body rows (row 15~)
  const bodyCatIdx = new Map();
  categories.forEach((c, i) => { if (c) bodyCatIdx.set(normalizeFlower(c), i); });

  const snapMap = new Map();
  if (snap) {
    const sdRes = await query(`SELECT * FROM FreightCostDetail WHERE FreightKey=@fk`, { fk: { type: sql.Int, value: snap.FreightKey } });
    for (const s of sdRes.recordset) snapMap.set(s.ProdKey, s);
  }

  let prevFarm = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowIdx = 14 + i;
    const fn = (r.FlowerName || '').trim();
    const comp = compRowByProdKey.get(r.ProdKey) || {};

    // 농장명은 바뀔 때만 표시
    const showFarm = r.FarmName && r.FarmName !== prevFarm;
    set(rowIdx, 0, showFarm ? r.FarmName : '', style(null, showFarm ? FONT_BOLD : null, { horizontal:'left' }));
    prevFarm = r.FarmName;
    set(rowIdx, 1, r.ProdName || '', style(null, null, { horizontal:'left' }));
    // C/D 컬럼: 카테고리, 박스수 (빈칸 제거)
    set(rowIdx, 2, fn, style(null, null, { horizontal:'center' }));
    set(rowIdx, 3, Number(r.BoxQuantity) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
    // E~V: 모두 static values from computeFreightCost
    set(rowIdx, 4,  Number(comp.steamQty) || 0,          style(BG_INPUT,   null, ALIGN_RIGHT));
    set(rowIdx, 5,  Number(comp.fobUSD)   || 0,          style(BG_INPUT,   null, ALIGN_RIGHT));
    set(rowIdx, 6,  Number(comp.freightPerStemUSD) || 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 7,  Number(comp.cnfUSD)   || 0,          style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 8,  Number(comp.steamQty) * Number(comp.cnfUSD) || 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 9,  Number(comp.cnfKRW)   || 0,          style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 10, Number(comp.tariffKRW) || 0,         style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 11, Number(comp.customsPerStem) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 12, Number(comp.arrivalPerStem) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 13, Number(comp.stemsPerBunch) || 0,     style(BG_INPUT,   null, ALIGN_RIGHT));
    set(rowIdx, 14, Number(comp.arrivalPerBunch) || 0,   style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 15, Number(comp.salePriceExVAT) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 16, Number(comp.salePriceKRW) || 0,      style(BG_INPUT,   null, ALIGN_RIGHT));
    set(rowIdx, 17, Number(comp.saleAt15Profit) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 18, Number(comp.profitPerBunch) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 19, Number(comp.profitRate) || 0,        style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 20, Number(comp.totalSaleKRW) || 0,      style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 21, Number(comp.totalProfitKRW) || 0,    style(BG_FORMULA, null, ALIGN_RIGHT));
  }

  // aoa → sheet
  const ws = buildWorksheet(aoa, styles, merges);
  // C(카테고리), D(박스수) — 기존엔 빈칸이었음, 이제 실제 데이터로 채워짐
  ws['!cols'] = [
    { wch: 12 },{ wch: 28 },{ wch: 10 },{ wch: 7 },{ wch: 9 },
    { wch: 8 },{ wch: 11 },{ wch: 11 },{ wch: 13 },{ wch: 13 },
    { wch: 10 },{ wch: 13 },{ wch: 13 },{ wch: 9 },{ wch: 14 },
    { wch: 14 },{ wch: 14 },{ wch: 16 },{ wch: 11 },{ wch: 9 },
    { wch: 14 },{ wch: 14 },{ wch: 4 },{ wch: 4 },{ wch: 4 },
    { wch: 4 },{ wch: 14 },{ wch: 11 },{ wch: 11 },{ wch: 10 },
    { wch: 4 },{ wch: 11 },{ wch: 11 },{ wch: 11 },{ wch: 10 },
  ];
  ws['!rows'] = Array.from({ length: 15 }, (_, i) => ({ hpx: i === 0 ? 32 : 22 }));
  return { ws, name: sheetName };
}

/**
 * 원본 엑셀의 body G/L 수식 재현 — 중첩 IF(ISNUMBER(SEARCH(...)))
 * @param {number} bodyRow Excel 행 번호 (15 이상)
 * @param {string[]} categories 카테고리 배열 (4개, 빈 문자열 포함)
 * @param {string} col 'M' (운임) or 'U' (통관)
 * @param {number} offset catCol 첫 J$7 기준 오프셋 (J7=idx0)
 * @returns {string|null} 수식 문자열 or null
 */
function buildSearchFormula(bodyRow, categories, col, _offset) {
  // 카테고리 길이가 긴 것부터 검색해야 MINICARNATION 이 CARNATION 에 오탐되지 않음
  const indexed = categories.map((c, i) => ({ cat: c, j: 7 + i, m: 7 + i }))
    .filter(x => x.cat)
    .sort((a, b) => b.cat.length - a.cat.length);
  if (indexed.length === 0) return null;
  // Build nested IF
  let expr = '0';
  for (let i = indexed.length - 1; i >= 0; i--) {
    const { j, m } = indexed[i];
    expr = `IF(ISNUMBER(SEARCH($J$${j},B${bodyRow})),$${col}$${m},${expr})`;
  }
  return expr;
}

function buildWorksheet(aoa, styles, merges) {
  const ws = {};
  let maxC = 0, maxR = 0;
  for (let R = 0; R < aoa.length; R++) {
    const row = aoa[R] || [];
    for (let C = 0; C < row.length; C++) {
      const v = row[C];
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const st = styles[addr];
      if (v == null && !st) continue;
      if (v == null) {
        ws[addr] = { t: 's', v: '', s: st };
      } else if (typeof v === 'object' && v.f) {
        ws[addr] = { f: v.f, t: 'n', s: st };
      } else if (typeof v === 'number') {
        ws[addr] = { v, t: 'n', s: st };
      } else {
        ws[addr] = { v, t: 's', s: st };
      }
      if (C > maxC) maxC = C;
      if (R > maxR) maxR = R;
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:maxR,c:maxC} });
  if (merges.length) ws['!merges'] = merges;
  return ws;
}
