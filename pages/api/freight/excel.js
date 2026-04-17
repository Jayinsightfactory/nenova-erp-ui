// pages/api/freight/excel.js — 운송기준원가 엑셀 다운로드
// 원본 16-1 콜롬비아 원가자료.xlsx 레이아웃/서식 복제 (테두리/색/컬럼너비 포함)
// AWB 기준 합산: warehouseKeys=1,2,3 (같은 AWB의 여러 원장) 또는 awb=AWB번호로 조회

import XLSX from 'xlsx-js-style';  // SheetJS fork with style write support
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeFlower, isFreightForwarder, isFreightRow } from '../../../lib/freightCalc';

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

  // 카테고리 집계
  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }
  const categories = [...boxByFlower.entries()].filter(([_, v]) => v > 0).map(([fn]) => fn);
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

  // 4개 카테고리 (고정 4행)
  for (let i = 0; i < 4; i++) {
    const catName = categories[i] || '';
    const r = 6 + i;  // excel row 7..10
    const excelRow = r + 1;
    const stemsPerBox = Number((flowerMetaMap.get(normalizeFlower(catName)) || {}).StemsPerBox) || 0;
    set(r, 9, catName, style(BG_HEADER, null, ALIGN_CENTER));
    set(r, 10, catName ? fml(`IF($C$8=$E$8,$C$11*AD${r+2},$C$11*AI${r+2})`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(r, 11, catName ? fml(`AC${r+2}*${stemsPerBox}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(r, 12, catName ? fml(`K${excelRow}/L${excelRow}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(r, 18, catName, style(BG_HEADER, null, ALIGN_CENTER));
    set(r, 19, catName ? fml(`$P$10*AD${r+2}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(r, 20, catName ? fml(`T${excelRow}/L${excelRow}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
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

  // T12/U12/V12 종 이익률/판매/이익
  set(11, 19, '종 이익률', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(11, 20, '종 판매가', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(11, 21, '종 이익',   style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(12, 19, fml('IFERROR(V13/U13,0)'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(12, 20, fml('SUM(U15:U500)'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(12, 21, fml('SUM(V15:V500)'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));

  // Row 14: body headers
  const headers = ['농장','Color/Grade',null,null,'수량','FOB','운송비(송이)','CNF(송이)','총금액(CNF포함)','CNF(원화)','관세','그외통관(송이당)','도착원가(송이)','단당 수량','도착원가(단)','판매(부가세 별도)','판매가(부가세 포함)','15% 이익 판매가(단)','단 이익','이익률','종 판매가','종 이익'];
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
    const excelRow = rowIdx + 1;
    const fn = (r.FlowerName || '').trim();
    const catIdx = bodyCatIdx.get(normalizeFlower(fn));
    const catExcelRow = catIdx != null ? catIdx + 7 : null;

    // 농장명은 바뀔 때만 표시 (엑셀 원본과 동일)
    const showFarm = r.FarmName && r.FarmName !== prevFarm;
    set(rowIdx, 0, showFarm ? r.FarmName : '', style(null, showFarm ? FONT_BOLD : null, { horizontal:'left' }));
    prevFarm = r.FarmName;
    set(rowIdx, 1, r.ProdName || '', style(null, null, { horizontal:'left' }));
    // 오버라이드 우선순위: client POST 편집값 > 스냅샷 > DB/Product 기본값
    const ovRow = ovRowsByKey.get(Number(r.ProdKey)) || {};
    const sd = snapMap.get(r.ProdKey) || {};
    const effSteamQty = pickOv(ovRow.steamQty, resolveSteam(r));
    const effFobUSD   = pickOv(ovRow.fobUSD, Number(r.UPrice) || 0);
    set(rowIdx, 4, effSteamQty, style(BG_INPUT, null, ALIGN_RIGHT));
    set(rowIdx, 5, effFobUSD, style(BG_INPUT, null, ALIGN_RIGHT));
    // G/L 수식: 원본 엑셀의 SEARCH 방식 그대로 (카테고리별 M/U 참조)
    // =IF(ISNUMBER(SEARCH($J$8,B15)),$M$8, IF(ISNUMBER(SEARCH($J$7,B15)),$M$7, ...))
    // MINICARNATION 이 CARNATION 을 포함하므로 CARNATION(J8) 먼저 검색해야 올바름
    const searchG = buildSearchFormula(excelRow, categories, 'M', 1);
    const searchL = buildSearchFormula(excelRow, categories, 'U', 1);
    set(rowIdx, 6, searchG ? fml(searchG) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 11, searchL ? fml(searchL) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 7, fml(`F${excelRow}+G${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 8, fml(`E${excelRow}*H${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 9, fml(`H${excelRow}*$C$7`), style(BG_FORMULA, null, ALIGN_RIGHT));
    const tariffRate = pickOv(ovRow.tariffRate, sd.TariffRate ?? r.P_TariffRate ?? 0);
    set(rowIdx, 10, tariffRate > 0 ? fml(`J${excelRow}*${tariffRate}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 12, fml(`J${excelRow}+K${excelRow}+L${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    const effStemsPerBunch = pickOv(ovRow.stemsPerBunch, Number(sd.StemsPerBunch ?? r.SteamOf1Bunch) || 0);
    const effSalePriceKRW  = pickOv(ovRow.salePriceKRW,  Number(sd.SalePriceKRW ?? r.Cost) || 0);
    set(rowIdx, 13, effStemsPerBunch, style(BG_INPUT, null, ALIGN_RIGHT));
    set(rowIdx, 14, fml(`M${excelRow}*N${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 15, fml(`Q${excelRow}/1.1`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 16, effSalePriceKRW, style(BG_INPUT, null, ALIGN_RIGHT));
    set(rowIdx, 17, fml(`IFERROR(O${excelRow}/0.77,0)`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 18, fml(`P${excelRow}-O${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 19, fml(`IFERROR(S${excelRow}/P${excelRow},0)`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 20, fml(`IFERROR(P${excelRow}*E${excelRow}/N${excelRow},0)`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 21, fml(`IFERROR(E${excelRow}*S${excelRow}/N${excelRow},0)`), style(BG_FORMULA, null, ALIGN_RIGHT));
  }

  // aoa → sheet
  const ws = buildWorksheet(aoa, styles, merges);
  ws['!cols'] = [
    { wch: 12 },{ wch: 28 },{ wch: 8 },{ wch: 8 },{ wch: 8 },
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
