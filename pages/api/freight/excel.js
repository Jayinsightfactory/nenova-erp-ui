// pages/api/freight/excel.js — 운송기준원가 엑셀 다운로드
// 원본 16-1 콜롬비아 원가자료.xlsx 1:1 복제 (레이아웃/수식 동일)
// warehouseKey 또는 warehouseKeys(콤마구분)로 여러 BILL 한 파일로 다운로드

import XLSX from 'xlsx';
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { computeFreightCost, normalizeFlower } from '../../../lib/freightCalc';

export default withAuth(async function handler(req, res) {
  try {
    const { warehouseKey, warehouseKeys } = req.query;
    const keys = warehouseKeys ? warehouseKeys.split(',').map(s => parseInt(s)).filter(Boolean)
               : warehouseKey ? [parseInt(warehouseKey)] : [];
    if (keys.length === 0) return res.status(400).json({ success:false, error:'warehouseKey 필수' });

    const wb = XLSX.utils.book_new();

    for (const wk of keys) {
      const sheet = await buildSheet(wk);
      if (!sheet) continue;
      XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.name);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="freight_cost_${Date.now()}.xlsx"`);
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).json({ success:false, error: err.message });
  }
});

async function buildSheet(warehouseKey) {
  // DB 로드
  const [mRes, dRes, fRes, fcRes] = await Promise.all([
    query(
      `SELECT WarehouseKey, OrderWeek, FarmName, InvoiceNo, OrderNo AS AWB,
          CONVERT(NVARCHAR(10), InputDate, 120) AS InputDate,
          GrossWeight, ChargeableWeight, FreightRateUSD, DocFeeUSD
         FROM WarehouseMaster WHERE WarehouseKey=@wk AND isDeleted=0`,
      { wk: { type: sql.Int, value: warehouseKey } }
    ),
    query(
      `SELECT wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.SteamQuantity, wd.UPrice, wd.TPrice, wd.OrderCode,
          p.ProdName, p.FlowerName, p.SteamOf1Bunch, p.Cost,
          p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
         FROM WarehouseDetail wd
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
         WHERE wd.WarehouseKey=@wk ORDER BY wd.WdetailKey`,
      { wk: { type: sql.Int, value: warehouseKey } }
    ),
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox FROM Flower WHERE isDeleted=0`),
    query(
      `SELECT TOP 1 * FROM FreightCost WHERE WarehouseKey=@wk AND isDeleted=0 ORDER BY CreateDtm DESC`,
      { wk: { type: sql.Int, value: warehouseKey } }
    ),
  ]);

  if (mRes.recordset.length === 0) return null;
  const master = mRes.recordset[0];
  const rows = dRes.recordset;
  const snap = fcRes.recordset[0] || null;

  // 카테고리 집계
  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }
  const categories = [...boxByFlower.entries()].filter(([_, v]) => v > 0).map(([fn]) => fn);
  if (categories.length === 0) categories.push('OTHER');
  while (categories.length < 4) categories.push('');  // 엑셀 템플릿 호환 (4행)

  // Flower meta (normalized key)
  const flowerMetaMap = new Map();
  for (const f of fRes.recordset) flowerMetaMap.set(normalizeFlower(f.FlowerName), f);

  // 시트 구성 (a of a)
  const sheetName = master.OrderWeek || `BILL_${warehouseKey}`;

  // 행 구성 (엑셀 원본과 동일한 위치)
  const aoa = Array.from({ length: 14 }, () => Array(25).fill(null));

  // B1 = COLOMBIA (농장 국가 + 인보이스)
  aoa[0][1] = `${master.FarmName || ''} · ${master.InvoiceNo || ''}`.trim();

  // B5:C5 차수
  aoa[4][1] = '차수';
  aoa[4][2] = sheetName;

  // B6:C6 총금액 Invoice, D6=C6-C11
  const invoiceUSD = snap?.InvoiceTotalUSD ?? rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  aoa[5][1] = '총금액 Invoice';
  aoa[5][2] = Number(invoiceUSD) || 0;
  aoa[5][3] = { f: 'C6-C11' };

  // B7:C7 환율
  aoa[6][1] = '환율';
  aoa[6][2] = snap?.ExchangeRate || 0;

  // B8/C8 GW, D8/E8 CW
  aoa[7][1] = 'GW'; aoa[7][2] = snap?.GrossWeight ?? master.GrossWeight ?? 0;
  aoa[7][3] = 'CW'; aoa[7][4] = snap?.ChargeableWeight ?? master.ChargeableWeight ?? 0;

  // B9/C9 품목수, D9/E9 Rate
  aoa[8][1] = '품목수'; aoa[8][2] = categories.filter(c => c).length;
  aoa[8][3] = 'Rate';   aoa[8][4] = snap?.FreightRateUSD ?? master.FreightRateUSD ?? 0;
  aoa[8][5] = 'NO CHANGE RATE';

  // B10/C10 총수량
  const totalSteam = rows.reduce((a, r) => a + (Number(r.SteamQuantity) || 0), 0);
  aoa[9][1] = '총수량'; aoa[9][2] = totalSteam;

  // B11 항공료 / D11 서류 / F11 운송비 / C11/E11/G11
  aoa[10][1] = '항공료'; aoa[10][2] = { f: 'E11+G11' };
  aoa[10][3] = '서류';   aoa[10][4] = snap?.DocFeeUSD ?? master.DocFeeUSD ?? 0;
  aoa[10][5] = '운송비'; aoa[10][6] = { f: 'E9*E8' };

  // J5..U10: 품목별 운임비 / 통관비 블록
  aoa[4][9] = '품목별 운임비';
  aoa[4][14] = '그외에 통관비';
  aoa[5][9]  = '품목'; aoa[5][10] = '운임비'; aoa[5][11] = '수량 (송이)'; aoa[5][12] = '송이당 운임비';
  aoa[5][14] = '백상'; aoa[5][15] = { f: 'C8*370' };
  aoa[5][16] = '겸역차감'; aoa[5][17] = snap ? Number(snap.DeductFee) : 40000;
  aoa[5][18] = '품목'; aoa[5][19] = '품목별 통관비'; aoa[5][20] = '송이당 통관비';

  // P7/P8/P9 통관비 상수
  aoa[6][14] = '통관 수수료'; aoa[6][15] = snap ? Number(snap.HandlingFee) : 33000;
  aoa[7][14] = '검역 수수료'; aoa[7][15] = { f: 'C9*10000' };
  aoa[8][14] = '국내 운송비'; aoa[8][15] = snap ? Number(snap.DomesticFreight) : 99000;
  aoa[9][14] = 'Total';       aoa[9][15] = { f: 'SUM(P6:P9)+R6+R7' };

  // 카테고리 4개 (고정 4행) — ROSE/CARNATION/ALSTROMERIA/RUSCUS 순서 or DB 순서
  for (let i = 0; i < 4; i++) {
    const catName = categories[i] || '';
    const r = 6 + i;  // row 7..10 (0-index 6..9)
    aoa[r][9]  = catName;
    aoa[r][10] = catName ? { f: `IF($C$8=$E$8,$C$11*AD${r+2},$C$11*AI${r+2})` } : null;
    aoa[r][11] = catName ? { f: `AC${r+2}*${Number((flowerMetaMap.get(normalizeFlower(catName)) || {}).StemsPerBox) || 0}` } : null;
    aoa[r][12] = catName ? { f: `K${r+1}/L${r+1}` } : null;
    aoa[r][18] = catName;
    aoa[r][19] = catName ? { f: `$P$10*AD${r+2}` } : null;
    aoa[r][20] = catName ? { f: `T${r+1}/L${r+1}` } : null;
  }

  // AA3..AI13 분배비율 블록
  aoa[2][26] = '운송비 품목별 분배 비율 계산';
  aoa[3][26] = 'GW==CW'; aoa[3][27] = '무게로 계산 될 때';
  aoa[3][31] = 'GW<<CW'; aoa[3][32] = 'CBM으로 계산 될 때';
  aoa[5][26] = '항공료 분배';
  aoa[5][31] = '항공료 분배';
  aoa[6][27] = '박스당 무게'; aoa[6][28] = '박스 수량'; aoa[6][29] = '비율';
  aoa[6][32] = '박스당 CBM';  aoa[6][33] = '박스 수량'; aoa[6][34] = '비율';

  for (let i = 0; i < 4; i++) {
    const catName = categories[i] || '';
    const r = 7 + i;  // row 8..11 (0-index 7..10)
    const fm = flowerMetaMap.get(normalizeFlower(catName)) || {};
    aoa[r][26] = catName;
    aoa[r][27] = catName ? Number(fm.BoxWeight) || 0 : 0;
    aoa[r][28] = catName ? (boxByFlower.get(catName) || 0) : 0;
    aoa[r][29] = catName ? { f: `AB${r+1}*AC${r+1}/SUMPRODUCT($AB$8:$AB$11,$AC$8:$AC$11)` } : 0;
    aoa[r][31] = catName;
    aoa[r][32] = catName ? Number(fm.BoxCBM) || 0 : 0;
    aoa[r][33] = catName ? (boxByFlower.get(catName) || 0) : 0;
    aoa[r][34] = catName ? { f: `AG${r+1}*AH${r+1}/SUMPRODUCT($AG$8:$AG$11,$AH$8:$AH$11)` } : 0;
  }
  aoa[12][29] = { f: 'SUM(AD8:AD11)' };
  aoa[12][34] = { f: 'SUM(AI8:AI11)' };
  aoa[11][19] = '종 이익률'; aoa[11][20] = '종 판매가'; aoa[11][21] = '종이익';
  aoa[12][19] = { f: 'V13/U13' }; aoa[12][20] = { f: 'SUM(U15:U200)' }; aoa[12][21] = { f: 'SUM(V15:V200)' };

  // Row 14: body headers
  const headerRow = Array(22).fill(null);
  headerRow[0] = '농장';
  headerRow[1] = 'Color/Grade';
  headerRow[4] = '수량';
  headerRow[5] = 'FOB';
  headerRow[6] = '운송비 (송이)';
  headerRow[7] = 'CNF (송이)';
  headerRow[8] = '총금액 (CNF포함)';
  headerRow[9] = 'CNF (원화)';
  headerRow[10] = '관세';
  headerRow[11] = '그외통관 (송이당)';
  headerRow[12] = '도착원가(송이)';
  headerRow[13] = '단당 수량';
  headerRow[14] = '도착원가(단)';
  headerRow[15] = '판매 (부가세 별도)';
  headerRow[16] = '판매가 (부가세 포함)';
  headerRow[17] = '15% 이익 판매가 (단)';
  headerRow[18] = '단 이익';
  headerRow[19] = '이익률';
  headerRow[20] = '종 판매가';
  headerRow[21] = '종이익';
  aoa[13] = headerRow;

  // Body rows (starting at row 15, index 14)
  const snapRowsMap = new Map();
  if (snap) {
    const sdRes = await query(`SELECT * FROM FreightCostDetail WHERE FreightKey=@fk`, { fk: { type: sql.Int, value: snap.FreightKey } });
    for (const s of sdRes.recordset) snapRowsMap.set(s.ProdKey, s);
  }

  const bodyCatNameToIdx = new Map();
  categories.forEach((c, i) => { if (c) bodyCatNameToIdx.set(normalizeFlower(c), i + 7); });  // row in K/L 6..9 (0-indexed)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const excelRow = 15 + i;
    const fn = (r.FlowerName || '').trim();
    const fnKey = normalizeFlower(fn);
    // 카테고리 위치 (0-index row in J block)
    const catIdx = bodyCatNameToIdx.get(fnKey);  // 6..9 (excel row 7..10)
    const body = Array(22).fill(null);
    body[0] = r.OrderCode || '';
    body[1] = r.ProdName || '';
    body[4] = Number(r.SteamQuantity) || 0;
    body[5] = Number(r.UPrice) || 0;
    // G = M_category (송이당 운임USD) — use named-category M lookup via IF chain of SEARCH
    if (catIdx != null) {
      body[6] = { f: `M${catIdx+1}` };  // 직접 카테고리 M값 참조 (간단화; 원본 엑셀은 SEARCH 기반)
      body[11] = { f: `U${catIdx+1}` };
    } else {
      body[6] = 0; body[11] = 0;
    }
    body[7] = { f: `F${excelRow}+G${excelRow}` };
    body[8] = { f: `E${excelRow}*H${excelRow}` };
    body[9] = { f: `H${excelRow}*$C$7` };
    const tariffRate = (snapRowsMap.get(r.ProdKey) || {}).TariffRate ?? r.P_TariffRate ?? 0;
    body[10] = tariffRate > 0 ? { f: `J${excelRow}*${tariffRate}` } : 0;
    body[12] = { f: `J${excelRow}+K${excelRow}+L${excelRow}` };
    const sd = snapRowsMap.get(r.ProdKey) || {};
    body[13] = sd.StemsPerBunch ?? r.SteamOf1Bunch ?? 0;
    body[14] = { f: `M${excelRow}*N${excelRow}` };
    body[15] = { f: `Q${excelRow}/1.1` };
    body[16] = sd.SalePriceKRW ?? r.Cost ?? 0;
    body[17] = { f: `O${excelRow}/0.77` };
    body[18] = { f: `P${excelRow}-O${excelRow}` };
    body[19] = { f: `IFERROR(S${excelRow}/P${excelRow},0)` };
    body[20] = { f: `IFERROR(P${excelRow}*E${excelRow}/N${excelRow},0)` };
    body[21] = { f: `IFERROR(E${excelRow}*S${excelRow}/N${excelRow},0)` };
    aoa.push(body);
  }

  // aoa → worksheet. 수식은 {f:'...'} 형태
  const ws = aoa_to_sheet_with_formulas(aoa);
  // Column widths approximation
  ws['!cols'] = [
    { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 8 },   // A-E
    { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, // F-J
    { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, // K-O
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, // P-T
    { wch: 14 }, { wch: 14 },                                       // U-V
  ];

  return { ws, name: sheetName.substring(0, 31) };
}

function aoa_to_sheet_with_formulas(aoa) {
  const ws = {};
  let maxC = 0, maxR = 0;
  for (let R = 0; R < aoa.length; R++) {
    const row = aoa[R] || [];
    for (let C = 0; C < row.length; C++) {
      const v = row[C];
      if (v == null) continue;
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (typeof v === 'object' && v.f) {
        ws[addr] = { f: v.f, t: 'n' };
      } else if (typeof v === 'number') {
        ws[addr] = { v, t: 'n' };
      } else {
        ws[addr] = { v, t: 's' };
      }
      if (C > maxC) maxC = C;
      if (R > maxR) maxR = R;
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r:0, c:0 }, e: { r:maxR, c:maxC } });
  return ws;
}
