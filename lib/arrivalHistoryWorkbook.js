import JSZip from 'jszip';
import { cleanArrivalFlowerChip, rowCost } from './arrivalCostView.js';
import { recalcArrivalCostWithFx } from './arrivalCostFxPreview.js';
import { formatCostSheetName } from './costMasterStore.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

function esc(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeSheetName(raw, usedNames) {
  let base = formatCostSheetName(raw, String(raw || '원가내역').trim() || '원가내역')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || '원가내역';
  let candidate = base;
  let seq = 2;
  while (usedNames.has(candidate)) {
    const suffix = ` (${seq})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    seq += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function weekSortScore(week) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(week || ''));
  if (!m) return 999999;
  return Number(m[1]) * 100 + Number(m[2]);
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="${NS}">`
    + `<numFmts count="3">`
    + `<numFmt numFmtId="164" formatCode="#,##0"/>`
    + `<numFmt numFmtId="165" formatCode="#,##0.00"/>`
    + `<numFmt numFmtId="166" formatCode="#,##0.000"/>`
    + `</numFmts>`
    + `<fonts count="4">`
    + `<font><sz val="11"/><color rgb="FF0F172A"/><name val="맑은 고딕"/></font>`
    + `<font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="맑은 고딕"/></font>`
    + `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>`
    + `<font><b/><sz val="11"/><color rgb="FF065F46"/><name val="맑은 고딕"/></font>`
    + `</fonts>`
    + `<fills count="4">`
    + `<fill><patternFill patternType="none"/></fill>`
    + `<fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF334155"/><bgColor indexed="64"/></patternFill></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>`
    + `</fills>`
    + `<borders count="2">`
    + `<border><left/><right/><top/><bottom/><diagonal/></border>`
    + `<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>`
    + `</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="8">`
    // 0: default
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    // 1: title
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>`
    // 2: summary meta cell
    + `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`
    // 3: table header (dark slate, white bold)
    + `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`
    // 4: text cell with border
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`
    // 5: integer KRW / qty (#,##0)
    + `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`
    // 6: decimal (#,##0.000)
    + `<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`
    // 7: highlighted arrival cost KRW (#,##0 emerald bold)
    + `<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`
    + `</cellXfs>`
    + `</styleSheet>`;
}

function strCell(ref, style, text) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function numCell(ref, style, num) {
  if (!Number.isFinite(Number(num))) return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}"><v>${Number(num)}</v></c>`;
}

function formulaNumCell(ref, style, formula, value) {
  const vTag = Number.isFinite(Number(value)) ? `<v>${Number(value)}</v>` : '<v>0</v>';
  return `<c r="${ref}" s="${style}"><f>${esc(formula)}</f>${vTag}</c>`;
}

function resolveEffectiveCost(row, previewFxNum) {
  if (Number(previewFxNum) > 0) {
    const preview = recalcArrivalCostWithFx(row, Number(previewFxNum));
    if (preview.ok && Number.isFinite(preview.cost)) return preview.cost;
  }
  return rowCost(row);
}

function buildWeekSheetXml({ sheetName, orderYear, rows, previewFxNum, tabSelected }) {
  const hdr = 5;
  const first = 6;
  const last = Math.max(first, hdr + rows.length);
  const colsXml = `<cols>`
    + `<col min="1" max="1" width="20" customWidth="1"/>`
    + `<col min="2" max="2" width="13" customWidth="1"/>`
    + `<col min="3" max="3" width="34" customWidth="1"/>`
    + `<col min="4" max="4" width="12" customWidth="1"/>`
    + `<col min="5" max="5" width="12" customWidth="1"/>`
    + `<col min="6" max="6" width="9" customWidth="1"/>`
    + `<col min="7" max="7" width="13" customWidth="1"/>`
    + `<col min="8" max="8" width="12" customWidth="1"/>`
    + `<col min="9" max="9" width="13" customWidth="1"/>`
    + `<col min="10" max="10" width="14" customWidth="1"/>`
    + `<col min="11" max="11" width="16" customWidth="1"/>`
    + `<col min="12" max="12" width="18" customWidth="1"/>`
    + `</cols>`;

  const totalQty = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  const totalKRW = rows.reduce((acc, r) => {
    const c = resolveEffectiveCost(r, previewFxNum);
    const q = Number(r.quantity) || 0;
    return acc + (Number.isFinite(c) ? q * c : 0);
  }, 0);

  const fxNote = Number(previewFxNum) > 0 ? ` · 미리보기 환율 ${Number(previewFxNum).toLocaleString('ko-KR')}원 적용` : '';
  const title = `${orderYear ? `${orderYear}년 ` : ''}${sheetName}차 도착원가 시트${fxNote}`;

  const xmlRows = [];
  xmlRows.push(`<row r="1" ht="28" customHeight="1">${strCell('A1', 1, title)}</row>`);
  xmlRows.push(
    `<row r="3" ht="22" customHeight="1">`
    + strCell('A3', 2, '차수')
    + strCell('B3', 2, sheetName)
    + strCell('C3', 2, `품목 행수: ${rows.length}행`)
    + strCell('D3', 2, '수량 합계')
    + formulaNumCell('E3', 5, `SUM(E${first}:E${last})`, totalQty)
    + strCell('J3', 2, '원가 합계(원)')
    + formulaNumCell('L3', 7, `SUM(L${first}:L${last})`, Math.round(totalKRW))
    + `</row>`,
  );

  const headers = [
    ['A', '농장'],
    ['B', '품종'],
    ['C', '칼라·품명'],
    ['D', '국가'],
    ['E', '수량'],
    ['F', '단위'],
    ['G', 'FOB(외화)'],
    ['H', '환율'],
    ['I', '운임(단위)'],
    ['J', '통관·기타(원)'],
    ['K', '도착원가(원)'],
    ['L', '합계원가(원)'],
  ];
  xmlRows.push(
    `<row r="${hdr}" ht="25" customHeight="1">`
    + headers.map(([c, label]) => strCell(`${c}${hdr}`, 3, label)).join('')
    + `</row>`,
  );

  rows.forEach((row, idx) => {
    const r = first + idx;
    const farm = String(row.farmName || row.autoFarmName || row.farmNameRaw || '').trim() || '-';
    const variety = cleanArrivalFlowerChip(row);
    const prod = String(row.displayName || row.prodName || row.productNameRaw || '').trim() || '-';
    const country = String(row.countryName || row.dbCountryName || '').trim() || '-';
    const qty = Number(row.quantity) || 0;
    const unit = String(row.unit || '').trim() || '-';
    const fob = row.fobUSD != null && Number.isFinite(Number(row.fobUSD)) ? Number(row.fobUSD) : null;
    const fx = Number(previewFxNum) > 0
      ? Number(previewFxNum)
      : (row.exchangeRate != null && Number.isFinite(Number(row.exchangeRate)) ? Number(row.exchangeRate) : null);
    const freight = row.freightPerUnitUSD != null && Number.isFinite(Number(row.freightPerUnitUSD)) ? Number(row.freightPerUnitUSD) : null;
    const customsOther = (Number(row.customsPerUnitKRW) || 0) + (Number(row.otherPerUnitKRW) || 0);
    const hasCustoms = row.customsPerUnitKRW != null || row.otherPerUnitKRW != null;
    const unitCost = resolveEffectiveCost(row, previewFxNum);
    const lineTotal = Number.isFinite(unitCost) ? qty * unitCost : 0;

    xmlRows.push(
      `<row r="${r}" ht="22" customHeight="1">`
      + strCell(`A${r}`, 4, farm)
      + strCell(`B${r}`, 4, variety)
      + strCell(`C${r}`, 4, prod)
      + strCell(`D${r}`, 4, country)
      + numCell(`E${r}`, 5, qty)
      + strCell(`F${r}`, 4, unit)
      + numCell(`G${r}`, 6, fob)
      + numCell(`H${r}`, 5, fx)
      + numCell(`I${r}`, 6, freight)
      + numCell(`J${r}`, 5, hasCustoms ? customsOther : null)
      + numCell(`K${r}`, 7, Number.isFinite(unitCost) ? unitCost : null)
      + (Number.isFinite(unitCost)
        ? formulaNumCell(`L${r}`, 7, `E${r}*K${r}`, lineTotal)
        : `<c r="L${r}" s="7"/>`)
      + `</row>`,
    );
  });

  if (rows.length === 0) {
    xmlRows.push(`<row r="${first}" ht="22" customHeight="1">${strCell(`A${first}`, 4, '-')}${strCell(`B${first}`, 4, '기타')}${strCell(`C${first}`, 4, '조회 내역 없음')}</row>`);
  }

  const views = `<sheetViews><sheetView${tabSelected ? ' tabSelected="1"' : ''} topLeftCell="A1" workbookViewId="0"><pane xSplit="3" ySplit="${hdr}" topLeftCell="D${first}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="D${first}" sqref="D${first}"/></sheetView></sheetViews>`;
  const autoFilter = `<autoFilter ref="A${hdr}:L${last}"/>`;
  const merges = `<mergeCells count="1"><mergeCell ref="A1:L1"/></mergeCells>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}">`
    + `<dimension ref="A1:L${last}"/>`
    + views
    + `<sheetFormatPr defaultRowHeight="22" customHeight="1"/>`
    + colsXml
    + `<sheetData>${xmlRows.join('')}</sheetData>`
    + autoFilter
    + merges
    + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
    + `<pageSetup orientation="landscape" paperSize="9"/>`
    + `</worksheet>`;
}

/**
 * `/arrival-cost` 하단 도착원가 내역(기존 차수 14-1 ~ 45-2 등)을 차수별 탭으로 분리하고
 * 전 시트에 `농장 | 품종(▼) | 칼라·품명` + 가로·세로 동시 Freeze Panes를 적용해 `.xlsx` Buffer(또는 Uint8Array)를 생성한다.
 */
export async function buildArrivalHistoryWorkbook({
  rows = [],
  orderYear = '',
  weekOrder = 'asc',
  previewFx = null,
  outputType = 'uint8array',
} = {}) {
  const byWeek = new Map();
  for (const row of rows) {
    const wk = String(row?.orderWeek || '').trim() || '미지정';
    const list = byWeek.get(wk) || [];
    list.push(row);
    byWeek.set(wk, list);
  }
  if (!byWeek.size) byWeek.set('원가내역', []);

  const entries = [...byWeek.entries()].sort(([a], [b]) => {
    const diff = weekSortScore(a) - weekSortScore(b) || String(a).localeCompare(String(b));
    return weekOrder === 'desc' ? -diff : diff;
  });

  const zip = new JSZip();
  const usedNames = new Set();
  const sheetMeta = [];
  const previewFxNum = Number(previewFx) > 0 ? Number(previewFx) : null;

  entries.forEach(([rawWeek, weekRows], idx) => {
    const sheetName = safeSheetName(rawWeek, usedNames);
    const partPath = `xl/worksheets/sheet${idx + 1}.xml`;
    const rid = `rIdSheet${idx + 1}`;
    const xml = buildWeekSheetXml({
      sheetName,
      orderYear,
      rows: weekRows,
      previewFxNum,
      tabSelected: idx === entries.length - 1,
    });
    zip.file(partPath, xml);
    sheetMeta.push({ sheetName, partPath, rid, sheetId: idx + 1 });
  });

  const activeTab = Math.max(0, sheetMeta.length - 1);
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + sheetMeta.map(s => `<Override PartName="/${s.partPath}" ContentType="${SHEET_CT}"/>`).join('')
    + `</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="${PKG_REL_NS}">`
    + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`,
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="${PKG_REL_NS}">`
    + sheetMeta.map(s => `<Relationship Id="${s.rid}" Type="${REL_NS}/worksheet" Target="${s.partPath.slice(3)}"/>`).join('')
    + `<Relationship Id="rIdStyles" Type="${REL_NS}/styles" Target="styles.xml"/>`
    + `</Relationships>`,
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="${NS}" xmlns:r="${REL_NS}">`
    + `<bookViews><workbookView activeTab="${activeTab}"/></bookViews>`
    + `<sheets>`
    + sheetMeta.map(s => `<sheet name="${esc(s.sheetName)}" sheetId="${s.sheetId}" r:id="${s.rid}"/>`).join('')
    + `</sheets>`
    + `<calcPr calcMode="auto" fullCalcOnLoad="1"/>`
    + `</workbook>`,
  );

  zip.file('xl/styles.xml', stylesXml());

  return zip.generateAsync({ type: outputType, compression: 'DEFLATE' });
}
