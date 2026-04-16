// pages/api/freight/excel.js — 운송기준원가 엑셀 다운로드
// 원본 16-1 콜롬비아 원가자료.xlsx 레이아웃/서식 복제 (테두리/색/컬럼너비 포함)
// AWB 기준 합산: warehouseKeys=1,2,3 (같은 AWB의 여러 원장) 또는 awb=AWB번호로 조회

import XLSX from 'xlsx-js-style';  // SheetJS fork with style write support
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeFlower } from '../../../lib/freightCalc';

export default withAuth(async function handler(req, res) {
  try {
    const { warehouseKey, warehouseKeys, awb } = req.query;
    let keys = [];
    let awbLabel = awb || '';

    if (warehouseKeys) {
      keys = warehouseKeys.split(',').map(s => parseInt(s)).filter(Boolean);
    } else if (warehouseKey) {
      keys = [parseInt(warehouseKey)];
    } else if (awb) {
      const r = await query(
        `SELECT WarehouseKey FROM WarehouseMaster WHERE OrderNo=@awb AND isDeleted=0 ORDER BY WarehouseKey`,
        { awb: { type: sql.NVarChar, value: awb } }
      );
      keys = r.recordset.map(x => x.WarehouseKey);
    }
    if (keys.length === 0) return res.status(400).json({ success:false, error:'warehouseKey/awb 필수' });

    const wb = XLSX.utils.book_new();
    const sheet = await buildSheet(keys, awbLabel);
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

async function buildSheet(warehouseKeys, awbLabel) {
  const keyCSV = warehouseKeys.join(',');
  const [mRes, dRes, fRes, fcRes] = await Promise.all([
    query(
      `SELECT WarehouseKey, OrderWeek, FarmName, InvoiceNo, OrderNo AS AWB,
          CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate,
          GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
         FROM WarehouseMaster WHERE WarehouseKey IN (${keyCSV}) AND isDeleted=0 ORDER BY WarehouseKey`
    ),
    query(
      `SELECT wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.SteamQuantity, wd.UPrice, wd.TPrice, wd.OrderCode,
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
  const masters = mRes.recordset;
  const rows = dRes.recordset;
  const snap = fcRes.recordset[0] || null;
  const primary = masters[0];
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

  const sheetName = (awbLabel || primary.OrderWeek || `BILL_${primary.WarehouseKey}`).substring(0, 31);

  const invoiceUSD = snap?.InvoiceTotalUSD ?? rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const totalSteam = rows.reduce((a, r) => a + (Number(r.SteamQuantity) || 0), 0);
  const gw = snap?.GrossWeight ?? sumF('GrossWeight') ?? 0;
  const cw = snap?.ChargeableWeight ?? sumF('ChargeableWeight') ?? 0;
  const rate = snap?.FreightRateUSD ?? firstF('FreightRateUSD') ?? 0;
  const docFee = snap?.DocFeeUSD ?? firstF('DocFeeUSD') ?? 0;

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
  set(6, 2, snap?.ExchangeRate || 0, style(BG_INPUT, null, ALIGN_RIGHT));

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

  // B11 항공료 / C11=E11+G11 / D11 서류 / E11 / F11 운송비 / G11=E9*E8
  set(10, 1, '항공료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(10, 2, fml('E11+G11'), style(BG_FORMULA, FONT_BOLD, ALIGN_RIGHT));
  set(10, 3, '서류', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(10, 4, docFee, style(BG_INPUT, null, ALIGN_RIGHT));
  set(10, 5, '운송비', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(10, 6, fml('E9*E8'), style(BG_FORMULA, null, ALIGN_RIGHT));

  // J5 품목별 운임비 / O5 그외에 통관비
  set(4, 9, '품목별 운임비', style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s:{r:4,c:9}, e:{r:4,c:12} });
  set(4, 14, '그외에 통관비', style(BG_SECTION, FONT_TITLE, ALIGN_CENTER));
  merges.push({ s:{r:4,c:14}, e:{r:4,c:17} });

  // row 6 J~U: 헤더
  ['품목','운임비','수량(송이)','송이당 운임비'].forEach((h,i) => set(5, 9+i, h, style(BG_HEADER, FONT_BOLD, ALIGN_CENTER)));
  set(5,14,'백상',  style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(5,15, fml('C8*370'), style(BG_FORMULA, null, ALIGN_RIGHT));
  set(5,16,'겸역차감', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(5,17, snap ? Number(snap.DeductFee) : 40000, style(BG_INPUT, null, ALIGN_RIGHT));
  ['품목','품목별 통관비','송이당 통관비'].forEach((h,i)=>set(5,18+i,h,style(BG_HEADER,FONT_BOLD,ALIGN_CENTER)));

  // P7..P9 통관 상수
  set(6, 14, '통관 수수료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(6, 15, snap ? Number(snap.HandlingFee) : 33000, style(BG_INPUT, null, ALIGN_RIGHT));
  set(7, 14, '검역 수수료', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(7, 15, fml('C9*10000'), style(BG_FORMULA, null, ALIGN_RIGHT));
  set(8, 14, '국내 운송비', style(BG_HEADER, FONT_BOLD, ALIGN_CENTER));
  set(8, 15, snap ? Number(snap.DomesticFreight) : 99000, style(BG_INPUT, null, ALIGN_RIGHT));
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
    set(rowIdx, 4, Number(r.SteamQuantity) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(rowIdx, 5, Number(r.UPrice) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
    if (catExcelRow) {
      set(rowIdx, 6, fml(`M${catExcelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
      set(rowIdx, 11, fml(`U${catExcelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    } else {
      set(rowIdx, 6, 0, style(BG_FORMULA, null, ALIGN_RIGHT));
      set(rowIdx, 11, 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    }
    set(rowIdx, 7, fml(`F${excelRow}+G${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 8, fml(`E${excelRow}*H${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 9, fml(`H${excelRow}*$C$7`), style(BG_FORMULA, null, ALIGN_RIGHT));
    const tariffRate = (snapMap.get(r.ProdKey) || {}).TariffRate ?? r.P_TariffRate ?? 0;
    set(rowIdx, 10, tariffRate > 0 ? fml(`J${excelRow}*${tariffRate}`) : 0, style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 12, fml(`J${excelRow}+K${excelRow}+L${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    const sd = snapMap.get(r.ProdKey) || {};
    set(rowIdx, 13, Number(sd.StemsPerBunch ?? r.SteamOf1Bunch) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
    set(rowIdx, 14, fml(`M${excelRow}*N${excelRow}`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 15, fml(`Q${excelRow}/1.1`), style(BG_FORMULA, null, ALIGN_RIGHT));
    set(rowIdx, 16, Number(sd.SalePriceKRW ?? r.Cost) || 0, style(BG_INPUT, null, ALIGN_RIGHT));
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
