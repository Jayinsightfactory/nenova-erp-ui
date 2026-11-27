import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import {
  LAYOUT_SCHEMA_VERSION,
  WORKSHEET_CHILD_ORDER,
  colToIdx,
  idxToCol,
  isAuxiliaryNonWeekSheetName,
  rewriteFormulaDataRowBRefs,
  upgradeLegacyCostSheetXml,
  upgradeLegacyCostWorkbook,
} from '../lib/upgradeLegacyCostSheetXml.js';
import { mergeCostSheetIntoMaster } from '../lib/costWorkbookMerge.js';
import * as costMasterStore from '../lib/costMasterStore.js';
import { createCostMasterHandler } from '../lib/costMasterHttp.js';
import { preserveCostHistory } from '../lib/invoiceCostHistoryStore.js';
import { createInvoiceCostWorkbook } from '../lib/invoiceReceiptCostExport.js';
import { invoiceCostExportFixture } from './invoiceReceiptCostExport.test.js';
import { buildArrivalHistoryWorkbook } from '../lib/arrivalHistoryWorkbook.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function verifyWorksheetElementOrder(sheetXml, label = 'sheet') {
  const inner = sheetXml.replace(/^[\s\S]*?<worksheet\b[^>]*>/, '').replace(/<\/worksheet>\s*$/, '');
  const stripped = inner
    .replace(/<sheetPr\b[\s\S]*?<\/sheetPr>/g, '<sheetPr/>')
    .replace(/<sheetViews\b[\s\S]*?<\/sheetViews>/g, '<sheetViews/>')
    .replace(/<cols\b[\s\S]*?<\/cols>/g, '<cols/>')
    .replace(/<sheetData\b[\s\S]*?<\/sheetData>/g, '<sheetData/>')
    .replace(/<autoFilter\b[\s\S]*?<\/autoFilter>/g, '<autoFilter/>')
    .replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/g, '<mergeCells/>')
    .replace(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g, '<conditionalFormatting/>')
    .replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/g, '<dataValidations/>')
    .replace(/<hyperlinks\b[\s\S]*?<\/hyperlinks>/g, '<hyperlinks/>')
    .replace(/<headerFooter\b[\s\S]*?<\/headerFooter>/g, '<headerFooter/>')
    .replace(/<extLst\b[\s\S]*?<\/extLst>/g, '<extLst/>');

  const directTags = [...stripped.matchAll(/<([A-Za-z0-9:]+)\b/g)]
    .map(m => (m[1].includes(':') ? m[1].split(':')[1] : m[1]));

  let prevRank = -1;
  let prevTag = '';
  for (const tag of directTags) {
    const rank = WORKSHEET_CHILD_ORDER.indexOf(tag);
    assert.notEqual(rank, -1, `${label}: unknown worksheet direct child <${tag}>`);
    assert.ok(
      rank >= prevRank,
      `${label}: ECMA-376 worksheet child order violation (<${prevTag}> before <${tag}>, directTags=${directTags.join(' -> ')})`,
    );
    prevRank = rank;
    prevTag = tag;
  }
}

async function readWorkbookWorksheetXmlMap(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMap = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relMap.set(id, target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
  }
  const map = new Map();
  for (const m of wbXml.matchAll(/<sheet\b[^>]*?\/>/g)) {
    const name = m[0].match(/\bname="([^"]*)"/)?.[1]
      ?.replace(/&quot;/g, '"')
      ?.replace(/&apos;/g, "'")
      ?.replace(/&lt;/g, '<')
      ?.replace(/&gt;/g, '>')
      ?.replace(/&amp;/g, '&');
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    const p = relMap.get(rid);
    if (name && p && zip.file(p)) {
      map.set(name, await zip.file(p).async('string'));
    }
  }
  return map;
}

/**
 * 경량 Excel 수식 평가기 — 변환 후 시트의 실제 셀 값(B열=한글 품종, C열=품목명 등)만으로
 * G/H/I/J/K/L/M/O/R/U/V 및 SUMIF/SUMPRODUCT/SEARCH/ISNUMBER/IF/AND/OR 수식을 재계산한다.
 */
function createSheetEvaluator(xlsxSheet) {
  const memo = new Map();
  const visiting = new Set();

  const expandRange = (a, b) => {
    const m1 = a.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/);
    const m2 = b.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/);
    if (!m1 || !m2) return [];
    const c1 = colToIdx(m1[1]), c2 = colToIdx(m2[1]);
    const r1 = Number(m1[2]), r2 = Number(m2[2]);
    const refs = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
        refs.push(`${idxToCol(c)}${r}`);
      }
    }
    return refs;
  };

  const toNum = v => {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v == null || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const getCellVal = ref => {
    const cleanRef = ref.replace(/\$/g, '').toUpperCase();
    if (memo.has(cleanRef)) return memo.get(cleanRef);
    const cell = xlsxSheet[cleanRef];
    if (!cell) return '';
    if (cell.f && !visiting.has(cleanRef)) {
      visiting.add(cleanRef);
      try {
        const v = evalExpr(cell.f);
        memo.set(cleanRef, v);
        return v;
      } finally {
        visiting.delete(cleanRef);
      }
    }
    return cell.v ?? '';
  };

  function splitTopLevelArgs(argStr) {
    const args = [];
    let depth = 0;
    let inStr = false;
    let cur = '';
    for (let i = 0; i < argStr.length; i += 1) {
      const ch = argStr[i];
      if (ch === '"') {
        inStr = !inStr;
        cur += ch;
        continue;
      }
      if (!inStr) {
        if (ch === '(' || ch === '{') depth += 1;
        else if (ch === ')' || ch === '}') depth -= 1;
        else if (ch === ',' && depth === 0) {
          args.push(cur.trim());
          cur = '';
          continue;
        }
      }
      cur += ch;
    }
    if (cur.trim() !== '' || argStr.endsWith(',')) args.push(cur.trim());
    return args;
  }

  function findTopLevelOp(s, ops) {
    let depth = 0;
    let inStr = false;
    for (let i = s.length - 1; i >= 0; i -= 1) {
      const ch = s[i];
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === ')' || ch === '}') depth += 1;
      else if (ch === '(' || ch === '{') depth -= 1;
      else if (depth === 0) {
        for (const op of ops) {
          if (i - op.length + 1 >= 0 && s.slice(i - op.length + 1, i + 1) === op) {
            if ((op === '+' || op === '-') && i > 0) {
              const prev = s.slice(0, i).trimEnd().at(-1);
              if (!prev || '+-*/(<>=,'.includes(prev)) continue;
            }
            if ((op === '<' || op === '>' || op === '=') && i > 0 && '<>='.includes(s[i - 1])) continue;
            if ((op === '<' || op === '>') && i + 1 < s.length && '<>='.includes(s[i + 1])) continue;
            return { idx: i - op.length + 1, op };
          }
        }
      }
    }
    return null;
  }

  function stripOuterParens(s) {
    let cur = s.trim();
    while (cur.startsWith('(') && cur.endsWith(')')) {
      let depth = 0;
      let inStr = false;
      let wrapsAll = true;
      for (let i = 0; i < cur.length; i += 1) {
        const ch = cur[i];
        if (ch === '"') inStr = !inStr;
        else if (!inStr) {
          if (ch === '(') depth += 1;
          else if (ch === ')') {
            depth -= 1;
            if (depth === 0 && i < cur.length - 1) {
              wrapsAll = false;
              break;
            }
          }
        }
      }
      if (!wrapsAll) break;
      cur = cur.slice(1, -1).trim();
    }
    return cur;
  }

  function evalCriteria(val, crit) {
    const sVal = String(val ?? '').trim().toLowerCase();
    const sCrit = String(crit ?? '').trim().toLowerCase();
    return sVal === sCrit;
  }

  function evalFunc(name, rawArgs) {
    const fn = name.toUpperCase();
    const args = splitTopLevelArgs(rawArgs);
    if (fn === 'IF') {
      const cond = evalExpr(args[0] || '0');
      if (cond && cond !== '#VALUE!') return args[1] !== undefined ? evalExpr(args[1]) : true;
      return args[2] !== undefined ? evalExpr(args[2]) : false;
    }
    if (fn === 'AND') {
      return args.every(a => Boolean(evalExpr(a)));
    }
    if (fn === 'OR') {
      return args.some(a => Boolean(evalExpr(a)));
    }
    if (fn === 'NOT') {
      return !evalExpr(args[0]);
    }
    if (fn === 'ISNUMBER') {
      const v = evalExpr(args[0]);
      return typeof v === 'number' && Number.isFinite(v);
    }
    if (fn === 'SEARCH' || fn === 'FIND') {
      const needle = String(evalExpr(args[0]) ?? '');
      const hay = String(evalExpr(args[1]) ?? '');
      if (!needle) return 1;
      const idx = fn === 'SEARCH'
        ? hay.toLowerCase().indexOf(needle.toLowerCase())
        : hay.indexOf(needle);
      return idx >= 0 ? idx + 1 : '#VALUE!';
    }
    if (fn === 'ABS') return Math.abs(toNum(evalExpr(args[0])));
    if (fn === 'ROUND') {
      const n = toNum(evalExpr(args[0]));
      const d = toNum(evalExpr(args[1] ?? '0'));
      const f = 10 ** d;
      return Math.round(n * f) / f;
    }
    if (fn === 'SUM' || fn === 'SUBTOTAL') {
      const targetArgs = fn === 'SUBTOTAL' ? args.slice(1) : args;
      let sum = 0;
      for (const a of targetArgs) {
        const rm = a.match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i);
        if (rm) {
          for (const ref of expandRange(rm[1], rm[2])) {
            const v = getCellVal(ref);
            if (typeof v === 'number' && Number.isFinite(v)) sum += v;
          }
        } else {
          const v = evalExpr(a);
          if (typeof v === 'number' && Number.isFinite(v)) sum += v;
        }
      }
      return sum;
    }
    if (fn === 'COUNT') {
      let cnt = 0;
      for (const a of args) {
        const rm = a.match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i);
        if (rm) {
          for (const ref of expandRange(rm[1], rm[2])) {
            const v = getCellVal(ref);
            if (typeof v === 'number' && Number.isFinite(v)) cnt += 1;
          }
        } else {
          const v = evalExpr(a);
          if (typeof v === 'number' && Number.isFinite(v)) cnt += 1;
        }
      }
      return cnt;
    }
    if (fn === 'SUMIF') {
      const r1m = args[0].match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i);
      const crit = evalExpr(args[1]);
      const r2m = (args[2] || args[0]).match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i);
      if (!r1m || !r2m) return 0;
      const refs1 = expandRange(r1m[1], r1m[2]);
      const refs2 = expandRange(r2m[1], r2m[2]);
      let sum = 0;
      for (let i = 0; i < refs1.length; i += 1) {
        if (evalCriteria(getCellVal(refs1[i]), crit)) {
          const v = getCellVal(refs2[i]);
          if (typeof v === 'number' && Number.isFinite(v)) sum += v;
        }
      }
      return sum;
    }
    if (fn === 'SUMPRODUCT') {
      const arrays = args.map(a => {
        const rm = a.match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i);
        if (!rm) return [toNum(evalExpr(a))];
        return expandRange(rm[1], rm[2]).map(ref => {
          const v = getCellVal(ref);
          return typeof v === 'number' && Number.isFinite(v) ? v : 0;
        });
      });
      const len = arrays[0]?.length || 0;
      let total = 0;
      for (let i = 0; i < len; i += 1) {
        let prod = 1;
        for (const arr of arrays) prod *= (arr[i] ?? 0);
        total += prod;
      }
      return total;
    }
    throw new Error(`Unsupported formula fn in test evaluator: ${fn}`);
  }

  function evalExpr(raw) {
    const s = stripOuterParens(String(raw ?? '').replace(/^=/, ''));
    if (!s) return '';
    if (/^"(?:[^"]|"")*"$/.test(s)) return s.slice(1, -1).replace(/""/g, '"');
    if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?%$/.test(s)) return Number(s.slice(0, -1)) / 100;
    if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);

    const cmp = findTopLevelOp(s, ['<>', '<=', '>=', '=', '<', '>']);
    if (cmp) {
      const lv = evalExpr(s.slice(0, cmp.idx));
      const rv = evalExpr(s.slice(cmp.idx + cmp.op.length));
      if (cmp.op === '=') return typeof lv === 'string' && typeof rv === 'string' ? lv.toLowerCase() === rv.toLowerCase() : lv === rv;
      if (cmp.op === '<>') return typeof lv === 'string' && typeof rv === 'string' ? lv.toLowerCase() !== rv.toLowerCase() : lv !== rv;
      if (cmp.op === '<') return toNum(lv) < toNum(rv);
      if (cmp.op === '<=') return toNum(lv) <= toNum(rv);
      if (cmp.op === '>') return toNum(lv) > toNum(rv);
      if (cmp.op === '>=') return toNum(lv) >= toNum(rv);
    }

    const addSub = findTopLevelOp(s, ['+', '-']);
    if (addSub) {
      const lv = toNum(evalExpr(s.slice(0, addSub.idx)));
      const rv = toNum(evalExpr(s.slice(addSub.idx + 1)));
      return addSub.op === '+' ? lv + rv : lv - rv;
    }

    const mulDiv = findTopLevelOp(s, ['*', '/']);
    if (mulDiv) {
      const lv = toNum(evalExpr(s.slice(0, mulDiv.idx)));
      const rv = toNum(evalExpr(s.slice(mulDiv.idx + 1)));
      return mulDiv.op === '*' ? lv * rv : (rv === 0 ? '#DIV/0!' : lv / rv);
    }

    if (s.startsWith('+')) return toNum(evalExpr(s.slice(1)));
    if (s.startsWith('-')) return -toNum(evalExpr(s.slice(1)));

    const fnMatch = s.match(/^([A-Za-z0-9_.]+)\(([\s\S]*)\)$/);
    if (fnMatch) return evalFunc(fnMatch[1], fnMatch[2]);

    if (/^\$?[A-Za-z]+\$?\d+$/.test(s)) return getCellVal(s);

    throw new Error(`Cannot evaluate expression: ${s}`);
  }

  return { evalCell: getCellVal, evalExpr };
}

/**
 * CI에서도 100% 재현되도록 실제 42-1 콜롬비아(sharedStrings + shared formula SEARCH($J$8,B15)) +
 * 48-1 NL(shared formula SEARCH($J$6,$B15) + showButton="0") + 구형 비차수 부가시트를 함께 담은 통합문서 픽스처 생성
 */
async function buildRealisticLegacyMultiSheetFixture() {
  const zip = new JSZip();
  const sharedStrings = [
    'COLOMBIA                           ',
    'Color\r\nGrade',
    '수량',
    'FOB',
    '운송비(송이)',
    '그외통관(송이당)',
    '도착원가(송이)',
    '단당  수량',
    '도착원가(단)',
    '종이익',
    'ROSE',
    'CARNATION',
    'HYDRANGEA',
    'CARNATION Caroline Gold',
    'ROSE / Mondial White 60cm',
    'Hydrangea White',
    'Amaryllis / Mont Blanc 12st White',
    'Eryngium Blue Quest',
  ];

  const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<sst xmlns="${NS}" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`
    + sharedStrings.map(s => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')
    + `</sst>`;

  const coSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}">`
    + `<dimension ref="A1:V17"/>`
    + `<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15" customHeight="1"/>`
    + `<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="4" width="12" customWidth="1"/><col min="5" max="22" width="13" customWidth="1"/></cols>`
    + `<sheetData>`
    + `<row r="1"><c r="B1" s="1" t="s"><v>0</v></c></row>`
    + `<row r="5"><c r="B5" t="inlineStr"><is><t>차수</t></is></c><c r="C5" t="inlineStr"><is><t>42-1</t></is></c></row>`
    + `<row r="7"><c r="B7" t="inlineStr"><is><t>환율</t></is></c><c r="C7"><v>1400</v></c><c r="J7" t="s"><v>10</v></c><c r="M7"><v>0.21</v></c><c r="U7"><v>36.5</v></c></row>`
    + `<row r="8"><c r="J8" t="s"><v>11</v></c><c r="M8"><v>0.097</v></c><c r="U8"><v>16.74</v></c></row>`
    + `<row r="9"><c r="J9" t="s"><v>12</v></c><c r="M9"><v>0.48</v></c><c r="U9"><v>82.1</v></c></row>`
    + `<row r="14"><c r="B14" s="1" t="s"><v>1</v></c><c r="C14" s="1"/><c r="D14" s="1"/><c r="E14" s="1" t="s"><v>2</v></c><c r="F14" s="1" t="s"><v>3</v></c><c r="G14" s="1" t="s"><v>4</v></c><c r="L14" s="1" t="s"><v>5</v></c><c r="M14" s="1" t="s"><v>6</v></c><c r="N14" s="1" t="s"><v>7</v></c><c r="O14" s="1" t="s"><v>8</v></c><c r="V14" s="1" t="s"><v>9</v></c></row>`
    + `<row r="15"><c r="A15" t="inlineStr"><is><t>Cactus</t></is></c><c r="B15" s="1" t="s"><v>13</v></c><c r="C15" s="1"/><c r="D15" s="1"/><c r="E15"><v>1200</v></c><c r="F15"><v>0.21</v></c><c r="G15"><f t="shared" ref="G15:G17" si="0">IF(ISNUMBER(SEARCH($J$8,B15)),$M$8,IF(ISNUMBER(SEARCH($J$7,B15)),$M$7,IF(ISNUMBER(SEARCH($J$9,B15)),$M$9,0)))</f><v>0.097</v></c><c r="H15"><f t="shared" ref="H15:H17" si="1">F15+G15</f><v>0.307</v></c><c r="J15"><f t="shared" ref="J15:J17" si="2">H15*$C$7</f><v>429.8</v></c><c r="K15"><v>0</v></c><c r="L15"><f t="shared" ref="L15:L17" si="3">IF(ISNUMBER(SEARCH($J$8,B15)),$U$8,IF(ISNUMBER(SEARCH($J$7,B15)),$U$7,IF(ISNUMBER(SEARCH($J$9,B15)),$U$9,0)))</f><v>16.74</v></c><c r="M15"><f t="shared" ref="M15:M17" si="4">J15+K15+L15</f><v>446.54</v></c><c r="N15"><v>20</v></c><c r="O15"><f t="shared" ref="O15:O17" si="5">M15*N15</f><v>8930.8</v></c></row>`
    + `<row r="16"><c r="A16" t="inlineStr"><is><t>Esperance</t></is></c><c r="B16" s="1" t="s"><v>14</v></c><c r="C16" s="1"/><c r="D16" s="1"/><c r="E16"><v>800</v></c><c r="F16"><v>0.43</v></c><c r="G16"><f t="shared" si="0"/><v>0.21</v></c><c r="H16"><f t="shared" si="1"/><v>0.64</v></c><c r="J16"><f t="shared" si="2"/><v>896</v></c><c r="K16"><v>0</v></c><c r="L16"><f t="shared" si="3"/><v>36.5</v></c><c r="M16"><f t="shared" si="4"/><v>932.5</v></c><c r="N16"><v>10</v></c><c r="O16"><f t="shared" si="5"/><v>9325</v></c></row>`
    + `<row r="17"><c r="A17" t="inlineStr"><is><t>Balverde</t></is></c><c r="B17" s="1" t="s"><v>15</v></c><c r="C17" s="1"/><c r="D17" s="1"/><c r="E17"><v>120</v></c><c r="F17"><v>0.9</v></c><c r="G17"><f t="shared" si="0"/><v>0.48</v></c><c r="H17"><f t="shared" si="1"/><v>1.38</v></c><c r="J17"><f t="shared" si="2"/><v>1932</v></c><c r="K17"><v>0</v></c><c r="L17"><f t="shared" si="3"/><v>82.1</v></c><c r="M17"><f t="shared" si="4"/><v>2014.1</v></c><c r="N17"><v>1</v></c><c r="O17"><f t="shared" si="5"/><v>2014.1</v></c></row>`
    + `</sheetData>`
    + `<mergeCells count="5"><mergeCell ref="B1:V3"/><mergeCell ref="B14:D14"/><mergeCell ref="B15:D15"/><mergeCell ref="B16:D16"/><mergeCell ref="B17:D17"/></mergeCells>`
    + `<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>`
    + `</worksheet>`;

  const nlSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}">`
    + `<dimension ref="A1:V16"/>`
    + `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15" customHeight="1"/>`
    + `<cols><col min="1" max="4" width="12" customWidth="1"/><col min="5" max="22" width="13" customWidth="1"/></cols>`
    + `<sheetData>`
    + `<row r="1"><c r="B1" t="inlineStr"><is><t>미승인 계산본 · 운영 DB 변경 없음</t></is></c></row>`
    + `<row r="3"><c r="B3" t="inlineStr"><is><t>조회 결과는 고정값입니다. 입력·자동 수식은 「원본 양식 계산」</t></is></c></row>`
    + `<row r="5"><c r="B5" t="inlineStr"><is><t>차수</t></is></c><c r="C5" t="inlineStr"><is><t>48-1</t></is></c></row>`
    + `<row r="6"><c r="D6"><v>260.96</v></c><c r="J6" t="inlineStr"><is><t>Eryngium</t></is></c><c r="K6"><v>0.25</v></c></row>`
    + `<row r="7"><c r="C7"><v>1750</v></c></row>`
    + `<row r="10"><c r="Q10"><v>50000</v></c></row>`
    + `<row r="11"><c r="C11"><v>80</v></c></row>`
    + `<row r="14"><c r="B14" s="1" t="s"><v>1</v></c><c r="C14" s="1"/><c r="D14" s="1"/><c r="E14" s="1" t="s"><v>2</v></c><c r="F14" s="1" t="s"><v>3</v></c><c r="K14" s="1" t="inlineStr"><is><t>관세</t></is></c><c r="M14" s="1" t="s"><v>6</v></c><c r="N14" s="1" t="s"><v>7</v></c><c r="O14" s="1" t="s"><v>8</v></c></row>`
    + `<row r="15"><c r="B15" s="1" t="s"><v>16</v></c><c r="C15" s="1" t="inlineStr"><is><t>HIDDEN_STALE_TEXT</t></is></c><c r="D15" s="1"/><c r="E15"><v>24</v></c><c r="F15"><v>2.54</v></c><c r="G15"><f>(F15*E15)/$D$6</f><v>0.2336</v></c><c r="H15"><f>F15+($C$11*G15/E15)</f><v>3.3186666667</v></c><c r="J15"><f>H15*$C$7</f><v>5807.6666667</v></c><c r="K15"><f t="shared" ref="K15:K16" si="0">J15*(IF(AND($J$6&lt;&gt;"",ISNUMBER(SEARCH($J$6,$B15))),$K$6,0))</f><v>0</v></c><c r="L15"><f>$Q$10*G15/E15</f><v>486.6666667</v></c><c r="M15"><f>J15+K15+L15</f><v>6294.3333333</v></c><c r="N15"><v>1</v></c><c r="O15"><f>M15*N15</f><v>6294.3333333</v></c></row>`
    + `<row r="16"><c r="B16" s="1" t="s"><v>17</v></c><c r="C16" s="1"/><c r="D16" s="1"/><c r="E16"><v>100</v></c><c r="F16"><v>2.00</v></c><c r="G16"><f>(F16*E16)/$D$6</f><v>0.7664</v></c><c r="H16"><f>F16+($C$11*G16/E16)</f><v>2.61312</v></c><c r="J16"><f>H16*$C$7</f><v>4572.96</v></c><c r="K16"><f t="shared" si="0"/><v>1143.24</v></c><c r="L16"><f>$Q$10*G16/E16</f><v>383.2</v></c><c r="M16"><f>J16+K16+L16</f><v>6099.4</v></c><c r="N16"><v>10</v></c><c r="O16"><f>M16*N16</f><v>60994</v></c></row>`
    + `</sheetData>`
    + `<autoFilter ref="A14:V14"><filterColumn colId="1" showButton="0"/></autoFilter>`
    + `<mergeCells count="3"><mergeCell ref="B14:D14"/><mergeCell ref="B15:D15"/><mergeCell ref="B16:D16"/></mergeCells>`
    + `</worksheet>`;

  const wGroupSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}">`
    + `<dimension ref="A1:W16"/>`
    + `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`
    + `<sheetData>`
    + `<row r="1"><c r="B1" t="inlineStr"><is><t>COLOMBIA 2026/47-02 원본 양식 계산 · 미승인 계산본</t></is></c></row>`
    + `<row r="2"><c r="B2" t="inlineStr"><is><t>기본 통관비는 원본 가정값(미승인)입니다.</t></is></c></row>`
    + `<row r="3"><c r="B3" t="inlineStr"><is><t>42-1 레퍼런스 기준가 자동 적용</t></is></c></row>`
    + `<row r="5"><c r="B5" t="inlineStr"><is><t>차수</t></is></c><c r="C5" t="inlineStr"><is><t>47-2</t></is></c><c r="O5" t="inlineStr"><is><t>그외 통관비 · 원본 기본값(미승인)</t></is></c></row>`
    + `<row r="7"><c r="C7"><v>1400</v></c><c r="J7" t="inlineStr"><is><t>ROSE</t></is></c><c r="K7"><v>210</v></c><c r="L7"><f>SUMIF($W$15:$W$16,J7,$E$15:$E$16)</f><v>1000</v></c><c r="M7"><f>IF(L7=0,0,K7/L7)</f><v>0.21</v></c></row>`
    + `<row r="8"><c r="J8" t="inlineStr"><is><t>CARNATION</t></is></c><c r="K8"><v>60</v></c><c r="L8"><f>SUMIF($W$15:$W$16,J8,$E$15:$E$16)</f><v>600</v></c><c r="M8"><f>IF(L8=0,0,K8/L8)</f><v>0.1</v></c></row>`
    + `<row r="14"><c r="A14" t="inlineStr"><is><t>농장</t></is></c><c r="B14" t="inlineStr"><is><t>Color\nGrade</t></is></c><c r="C14"/><c r="D14"/><c r="E14" t="inlineStr"><is><t>수량</t></is></c><c r="F14" t="inlineStr"><is><t>FOB</t></is></c><c r="M14" t="inlineStr"><is><t>도착원가(송이)</t></is></c><c r="W14" t="inlineStr"><is><t>원가 그룹</t></is></c></row>`
    + `<row r="15"><c r="A15" t="inlineStr"><is><t>FarmA</t></is></c><c r="B15" t="inlineStr"><is><t>Freedom 60cm</t></is></c><c r="C15"/><c r="D15"/><c r="E15"><v>1000</v></c><c r="F15"><v>0.4</v></c><c r="G15"><f>IF(E15=0,0,$M$7)</f><v>0.21</v></c><c r="M15"><f>(F15+G15)*$C$7</f><v>854</v></c><c r="W15" t="inlineStr"><is><t>ROSE</t></is></c></row>`
    + `<row r="16"><c r="A16" t="inlineStr"><is><t>FarmB</t></is></c><c r="B16" t="inlineStr"><is><t>Doncel Select</t></is></c><c r="C16"/><c r="D16"/><c r="E16"><v>600</v></c><c r="F16"><v>0.2</v></c><c r="G16"><f>IF(E16=0,0,$M$8)</f><v>0.1</v></c><c r="M16"><f>(F16+G16)*$C$7</f><v>420</v></c><c r="W16" t="inlineStr"><is><t>CARNATION</t></is></c></row>`
    + `</sheetData>`
    + `<mergeCells count="3"><mergeCell ref="B14:D14"/><mergeCell ref="B15:D15"/><mergeCell ref="B16:D16"/></mergeCells>`
    + `</worksheet>`;

  const auxSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>원본수식 비교 탭</t></is></c></row></sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL_NS}/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="${REL_NS}/worksheet" Target="worksheets/sheet4.xml"/><Relationship Id="rId5" Type="${REL_NS}/worksheet" Target="worksheets/sheet5.xml"/><Relationship Id="rId6" Type="${REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId7" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="1"/></bookViews><sheets><sheet name="42-1" sheetId="1" r:id="rId1"/><sheet name="원본수식 비교" sheetId="2" r:id="rId2"/><sheet name="47-2" sheetId="3" r:id="rId3"/><sheet name="원본 양식 계산" sheetId="4" r:id="rId4"/><sheet name="48-1" sheetId="5" r:id="rId5"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="4" hidden="1">'48-1'!$B$14:$V$14</definedName></definedNames><calcPr calcId="191029"/></workbook>`);
  zip.file('xl/styles.xml', styles);
  zip.file('xl/sharedStrings.xml', ssXml);
  zip.file('xl/worksheets/sheet1.xml', coSheetXml);
  zip.file('xl/worksheets/sheet2.xml', auxSheetXml);
  zip.file('xl/worksheets/sheet3.xml', wGroupSheetXml);
  zip.file('xl/worksheets/sheet4.xml', auxSheetXml);
  zip.file('xl/worksheets/sheet5.xml', nlSheetXml);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('비차수 부가·비교·예시·폐기 탭 판별기가 정확히 동작한다', () => {
  for (const aux of ['원본수식 비교', '46-02 원본수식 비교', '원본 양식 계산', '주광·기타 비교', '요약', '카테고리 규격표', '품종 기준', '08-1(예시)', 'Ejemplo 안개', '비교작업', '19-1 MEL 폐기', '해상', '해상 (2)', '해산 CLOUD']) {
    assert.equal(isAuxiliaryNonWeekSheetName(aux), true, `should remove auxiliary tab: ${aux}`);
  }
  for (const week of ['14-1A', '15-2', '42-1', '45-1', '48-2', '2026 47-02', '44-01 44-1', '47', '01-2', '21-2 (H)', '17-1 MEL', '42A-2 CLOUD', '21,22차', '48-1 해상 HUB']) {
    assert.equal(isAuxiliaryNonWeekSheetName(week), false, `should keep week tab: ${week}`);
  }
});

test('수식 치환기는 문자열 리터럴·상단 고정셀·타 시트 참조를 보호하고 데이터행 B/$B 참조만 C/$C로 바꾼다', () => {
  assert.equal(
    rewriteFormulaDataRowBRefs('IF(ISNUMBER(SEARCH($J$8,B15)),$M$8,IF($B$5=1,AB15,"B15 literal"))', 15, 100),
    'IF(ISNUMBER(SEARCH($J$8,C15)),$M$8,IF($B$5=1,AB15,"B15 literal"))',
  );
  assert.equal(
    rewriteFormulaDataRowBRefs('J15*(IF(AND($J$6<>"",ISNUMBER(SEARCH($J$6,$B15))),$K$6,0))', 15, 25),
    'J15*(IF(AND($J$6<>"",ISNUMBER(SEARCH($J$6,$C15))),$K$6,0))',
  );
  assert.equal(
    rewriteFormulaDataRowBRefs("'타시트'!B15+B15", 15, 25),
    "'타시트'!B15+C15",
  );
});

test('합성 다중 시트(CO sharedStrings + NL $B15 + W열 원가그룹 + 부가시트 2종) 일괄 업그레이드 & 수식 재평가 오차 0.000000원 & 멱등성 검증', async () => {
  const originalBuf = await buildRealisticLegacyMultiSheetFixture();
  const beforeWb = XLSX.read(originalBuf, { cellFormula: true });

  const upgraded = await upgradeLegacyCostWorkbook(originalBuf);
  assert.equal(upgraded.changed, true);
  assert.deepEqual(upgraded.removedSheets, ['원본수식 비교', '원본 양식 계산']);
  assert.deepEqual(upgraded.sheetNames, ['42-1', '47-2', '48-1']);

  const afterWb = XLSX.read(upgraded.buffer, { cellFormula: true });
  assert.deepEqual(afterWb.SheetNames, ['42-1', '47-2', '48-1']);

  const xmlMap = await readWorkbookWorksheetXmlMap(upgraded.buffer);
  for (const [name, xml] of xmlMap.entries()) {
    verifyWorksheetElementOrder(xml, `fixture:${name}`);
    assert.match(xml, /<pane\b(?=[^>]*\bxSplit="[1-9]\d*")(?=[^>]*\bySplit="[1-9]\d*")(?=[^>]*\bstate="frozen")/, `${name} frozen pane`);
    assert.match(xml, /<autoFilter\b[^>]*ref="[AB]\d+:[A-Z]+\d+"\/>/, `${name} autoFilter`);
    assert.doesNotMatch(xml, /showButton="0"/, `${name} must not hide filter dropdown`);
    assert.doesNotMatch(xml, /미승인 계산본|운영 DB 변경 없음|원본 가정값|레퍼런스 기준가|원본 양식 계산/, `${name} warnings stripped`);
  }

  // 1) 42-1 시트: 품종 분류 + SEARCH($J$8, C15) 수식 직접 재평가 === 원본 값 (오차 0.000000)
  const s42 = afterWb.Sheets['42-1'];
  assert.equal(s42.A14?.v, '농장');
  assert.equal(s42.B14?.v, '품종');
  assert.equal(s42.B15?.v, '카네이션');
  assert.equal(s42.C15?.v, 'CARNATION Caroline Gold');
  assert.equal(s42.B16?.v, '장미');
  assert.equal(s42.C16?.v, 'ROSE / Mondial White 60cm');
  assert.equal(s42.B17?.v, '수국');
  assert.equal(s42.C17?.v, 'Hydrangea White');
  assert.match(s42.G15?.f || '', /SEARCH\(\$J\$8,C15\)/);
  assert.match(s42.G16?.f || '', /SEARCH\(\$J\$8,C16\)/);
  assert.match(s42.L17?.f || '', /SEARCH\(\$J\$8,C17\)/);

  const eval42Before = createSheetEvaluator(beforeWb.Sheets['42-1']);
  const eval42After = createSheetEvaluator(s42);
  for (const ref of ['G15', 'G16', 'G17', 'L15', 'L16', 'L17', 'M15', 'M16', 'M17', 'O15', 'O16', 'O17']) {
    const bVal = eval42Before.evalCell(ref);
    const aVal = eval42After.evalCell(ref);
    assert.ok(typeof aVal === 'number' && Number.isFinite(aVal), `42-1 ${ref} must evaluate to finite number, got ${aVal}`);
    assert.ok(Math.abs(aVal - bVal) <= 1e-9, `42-1 ${ref} formula drift: before=${bVal} after=${aVal}`);
  }

  // 2) 47-2 시트: W열 원가 그룹 -> B열 한글 품종 흡수 + SUMIF($B$15:$B$16,"장미",...) 재평가 오차 0.000000
  const s47 = afterWb.Sheets['47-2'];
  assert.equal(s47.B14?.v, '품종');
  assert.equal(s47.W14, undefined);
  assert.equal(s47.B15?.v, '장미');
  assert.equal(s47.B16?.v, '카네이션');
  const eval47Before = createSheetEvaluator(beforeWb.Sheets['47-2']);
  const eval47After = createSheetEvaluator(s47);
  for (const ref of ['L7', 'L8', 'M7', 'M8', 'G15', 'G16', 'M15', 'M16']) {
    const bVal = eval47Before.evalCell(ref);
    const aVal = eval47After.evalCell(ref);
    assert.ok(Math.abs(aVal - bVal) <= 1e-9, `47-2 ${ref} formula drift: before=${bVal} after=${aVal}`);
  }

  // 3) 48-1 NL 시트: 숨은 C15 잔여값 제거 + $B15 -> $C15 치환 + 관세 수식 재평가 오차 0.000000
  const s48 = afterWb.Sheets['48-1'];
  assert.equal(s48.B14?.v, '품종');
  assert.equal(s48.B15?.v, '아마릴리스');
  assert.equal(s48.C15?.v, 'Amaryllis / Mont Blanc 12st White');
  assert.equal(s48.B16?.v, '에린지움');
  assert.equal(s48.C16?.v, 'Eryngium Blue Quest');
  assert.match(s48.K15?.f || '', /SEARCH\(\$J\$6,\$C15\)/);
  assert.match(s48.K16?.f || '', /SEARCH\(\$J\$6,\$C16\)/);
  const eval48Before = createSheetEvaluator(beforeWb.Sheets['48-1']);
  const eval48After = createSheetEvaluator(s48);
  for (const ref of ['K15', 'K16', 'M15', 'M16', 'O15', 'O16']) {
    const bVal = eval48Before.evalCell(ref);
    const aVal = eval48After.evalCell(ref);
    assert.ok(Math.abs(aVal - bVal) <= 1e-9, `48-1 ${ref} formula drift: before=${bVal} after=${aVal}`);
  }

  // 4) definedNames localSheetId 재매핑 확인 ('48-1'은 index 4 -> index 2로 이동)
  const outZip = await JSZip.loadAsync(upgraded.buffer);
  const outWbXml = await outZip.file('xl/workbook.xml').async('string');
  assert.match(outWbXml, /localSheetId="2"[^>]*>(?:&apos;|')48-1(?:&apos;|')!\$B\$14:\$V\$16<\/definedName>/);

  // 5) 2회 실행 시 완벽한 멱등성(changed === false, 바이트 동일) 증명
  const second = await upgradeLegacyCostWorkbook(upgraded.buffer);
  assert.equal(second.changed, false);
  assert.equal(Buffer.compare(second.buffer, upgraded.buffer), 0);
});

const CO_42_1_FILE = 'C:/Users/USER/Downloads/42-1 원가자료.xlsx';
test('실제 과거 콜롬비아 42-1 원가자료.xlsx(44개 전 차수 시트) 업그레이드 · 수식 재평가 오차 0.000000원 실증', { skip: !fs.existsSync(CO_42_1_FILE) }, async () => {
  const raw = fs.readFileSync(CO_42_1_FILE);
  const beforeWb = XLSX.read(raw, { cellFormula: true });
  const upgraded = await upgradeLegacyCostWorkbook(raw);

  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.removedSheets.length, 0);
  assert.equal(upgraded.sheetNames.length, 44);
  assert.equal(upgraded.upgradedSheets.length, 44);

  const afterWb = XLSX.read(upgraded.buffer, { cellFormula: true });
  const xmlMap = await readWorkbookWorksheetXmlMap(upgraded.buffer);

  let checkedFormulaCells = 0;
  for (const name of afterWb.SheetNames) {
    assert.equal(isAuxiliaryNonWeekSheetName(name), false);
    const xml = xmlMap.get(name);
    verifyWorksheetElementOrder(xml, `42-1:${name}`);
    assert.match(xml, /<pane\b[^>]*\bxSplit="4"[^>]*\bySplit="14"[^>]*\bstate="frozen"\/>/, `${name} freeze pane`);
    assert.match(xml, /<autoFilter\b[^>]*ref="A14:[A-Z]+\d+"\/>/, `${name} autoFilter`);

    const bs = beforeWb.Sheets[name];
    const as = afterWb.Sheets[name];
    assert.equal(as.B14?.v, '품종', `${name} B14=품종`);

    // 모든 데이터행(15..last) G/L/M/O 캐시값 일치 + 대표 시트(14-1A, 15-2, 27-2, 42-1)는 전 행 수식 직접 재평가!
    const doFullEval = ['14-1A', '15-2', '27-2', '38-1', '42-1'].includes(name);
    const beforeEval = doFullEval ? createSheetEvaluator(bs) : null;
    const afterEval = doFullEval ? createSheetEvaluator(as) : null;

    for (let r = 15; r <= 310; r += 1) {
      if (bs[`E${r}`]?.v === undefined && bs[`M${r}`]?.v === undefined) continue;
      for (const col of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']) {
        const ref = `${col}${r}`;
        if (typeof bs[ref]?.v === 'number') {
          assert.equal(as[ref]?.v, bs[ref].v, `${name} ${ref} cached value`);
        }
        if (doFullEval && as[ref]?.f && ['G', 'L', 'M', 'O'].includes(col)) {
          const evBefore = beforeEval.evalCell(ref);
          const evAfter = afterEval.evalCell(ref);
          assert.ok(typeof evAfter === 'number' && Number.isFinite(evAfter), `${name} ${ref} evaluated non-number: ${evAfter}`);
          assert.ok(Math.abs(evAfter - evBefore) <= 1e-9, `${name} ${ref} live formula mismatch: ${evBefore} vs ${evAfter}`);
          checkedFormulaCells += 1;
        }
      }
    }
  }
  assert.ok(checkedFormulaCells > 1500, `expected >1500 live-evaluated formula cells, got ${checkedFormulaCells}`);

  const secondPass = await upgradeLegacyCostWorkbook(upgraded.buffer);
  assert.equal(secondPass.changed, false);
});

const NL_48_1_FILE = 'C:/Users/USER/Documents/카카오톡 받은 파일/48-1 NL 원가자료.xlsx';
test('실제 네덜란드 48-1 NL 원가자료.xlsx(75시트 -> 예시 제거 74시트) 업그레이드 · 수식 재평가 오차 0.000000원 실증', { skip: !fs.existsSync(NL_48_1_FILE) }, async () => {
  const raw = fs.readFileSync(NL_48_1_FILE);
  const beforeWb = XLSX.read(raw, { cellFormula: true });
  const upgraded = await upgradeLegacyCostWorkbook(raw);

  assert.equal(upgraded.changed, true);
  assert.ok(upgraded.removedSheets.includes('08-1(예시)'), '예시 시트 제거');
  assert.equal(upgraded.sheetNames.every(n => !isAuxiliaryNonWeekSheetName(n)), true);

  const afterWb = XLSX.read(upgraded.buffer, { cellFormula: true });
  const xmlMap = await readWorkbookWorksheetXmlMap(upgraded.buffer);

  for (const name of afterWb.SheetNames) {
    const xml = xmlMap.get(name);
    verifyWorksheetElementOrder(xml, `NL:${name}`);
    assert.match(xml, /<pane\b(?=[^>]*\bxSplit="[1-9]\d*")(?=[^>]*\bySplit="[1-9]\d*")(?=[^>]*\bstate="frozen")/, `NL ${name} frozen`);
    assert.match(xml, /<autoFilter\b[^>]*ref="[AB]\d+:[A-Z]+\d+"\/>/, `NL ${name} autoFilter`);
    assert.doesNotMatch(xml, /showButton="0"/, `NL ${name} filter button enabled`);
  }

  // 최신 48-1 시트($B15 참조 공유수식 포함) 실시간 수식 재평가 오차 0.000000원 증명
  const evalBefore = createSheetEvaluator(beforeWb.Sheets['48-1']);
  const evalAfter = createSheetEvaluator(afterWb.Sheets['48-1']);
  assert.equal(afterWb.Sheets['48-1'].B14?.v, '품종');
  for (let r = 15; r <= 21; r += 1) {
    for (const col of ['G', 'K', 'L', 'M', 'O']) {
      const ref = `${col}${r}`;
      const bVal = evalBefore.evalCell(ref);
      const aVal = evalAfter.evalCell(ref);
      assert.ok(Math.abs(aVal - bVal) <= 1e-9, `NL 48-1 ${ref} formula drift: ${bVal} vs ${aVal}`);
    }
  }
});

const CN_48_1_FILE = 'C:/Users/USER/Documents/카카오톡 받은 파일/48-1 중국 원가자료.xlsx';
test('실제 중국 48-1 중국 원가자료.xlsx(85시트 -> 폐기·비차수 제거 + 비정형 방어가드 + SEARCH 수식 보존) 실증', { skip: !fs.existsSync(CN_48_1_FILE) }, async () => {
  const raw = fs.readFileSync(CN_48_1_FILE);
  const beforeWb = XLSX.read(raw, { cellFormula: true });
  const upgraded = await upgradeLegacyCostWorkbook(raw);

  assert.equal(upgraded.changed, true);
  for (const bad of ['19-1 MEL 폐기', '해상', '해상 (2)', '해산 CLOUD']) {
    assert.ok(upgraded.removedSheets.includes(bad), `expected removed: ${bad}`);
  }
  assert.equal(upgraded.sheetNames.every(n => !isAuxiliaryNonWeekSheetName(n)), true);

  const afterWb = XLSX.read(upgraded.buffer, { cellFormula: true });
  const xmlMap = await readWorkbookWorksheetXmlMap(upgraded.buffer);

  for (const name of afterWb.SheetNames) {
    const xml = xmlMap.get(name);
    verifyWorksheetElementOrder(xml, `CN:${name}`);
    assert.match(xml, /<pane\b(?=[^>]*\bxSplit="[1-9]\d*")(?=[^>]*\bySplit="[1-9]\d*")(?=[^>]*\bstate="frozen")/, `CN ${name} frozen`);
    assert.match(xml, /<autoFilter\b[^>]*ref="[AB]\d+:[A-Z]+\d+"\/>/, `CN ${name} autoFilter`);
  }

  // 비정형 '21,22차'(C4=수량)는 방어 가드로 C열 수량을 덮어쓰지 않고 보존해야 함
  assert.equal(afterWb.Sheets['21,22차'].C4?.v, '수량');

  // 정형 시트('17-1 MEL', '27-2 CLOUD', '34-2B CLOUD') SEARCH 수식 재평가 오차 0.000000원 증명
  for (const [sampleSheet, hdrRow] of [['17-1 MEL', 23], ['27-2 CLOUD', 23], ['34-2B CLOUD', 24]]) {
    assert.equal(afterWb.Sheets[sampleSheet][`B${hdrRow}`]?.v, '품종');
    const evB = createSheetEvaluator(beforeWb.Sheets[sampleSheet]);
    const evA = createSheetEvaluator(afterWb.Sheets[sampleSheet]);
    for (let r = hdrRow + 1; r <= hdrRow + 8; r += 1) {
      if (!beforeWb.Sheets[sampleSheet][`E${r}`]) continue;
      for (const col of ['G', 'K', 'L', 'M', 'O']) {
        const ref = `${col}${r}`;
        if (!afterWb.Sheets[sampleSheet][ref]?.f) continue;
        const bv = evB.evalCell(ref);
        const av = evA.evalCell(ref);
        assert.ok(Math.abs(av - bv) <= 1e-9, `CN ${sampleSheet} ${ref} drift: ${bv} vs ${av}`);
      }
    }
  }
});

test('cost-master GET/다운로드 및 단발 upgrade API가 구형 오염 마스터를 즉시 정화하고 히스토리 캐시 버전이 분리된다', async () => {
  const prevDir = process.env.COST_MASTER_DIR;
  const masterDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'legacy-master-clean-'));
  const historyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'legacy-history-clean-'));
  process.env.COST_MASTER_DIR = masterDir;
  try {
    // 서버 data/cost-master/colombia.xlsx에 과거 구형 5시트(부가시트 포함) 파일이 이미 놓여 있던 상황 재현
    const pollutedBuf = await buildRealisticLegacyMultiSheetFixture();
    await fsp.writeFile(path.join(masterDir, 'colombia.xlsx'), pollutedBuf);

    const handler = createCostMasterHandler({ authorize: () => true });
    const makeRes = () => ({
      code: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(d) { this.data = d; },
      send(b) { this.body = b; },
      end() {},
    });

    // 1) GET 상태 조회 시 자동 정화되어 부가시트가 사라진 차수 시트만 반환
    const resInfo = makeRes();
    await handler({ method: 'GET', query: { country: 'CO' } }, resInfo);
    assert.equal(resInfo.code, 200);
    assert.deepEqual(resInfo.data.sheetNames, ['42-1', '47-2', '48-1']);

    // 2) GET ?download=1 다운로드 시 정화된 통합문서 반환
    const resDl = makeRes();
    await handler({ method: 'GET', query: { country: 'CO', download: '1' } }, resDl);
    assert.equal(resDl.code, 200);
    const dlWb = XLSX.read(resDl.body);
    assert.deepEqual(dlWb.SheetNames, ['42-1', '47-2', '48-1']);
    assert.equal(dlWb.Sheets['42-1'].B14?.v, '품종');

    // 3) POST action='upgrade' 단발 변환 시 서버 마스터 변경 없이 업로드 파일 전 시트 신형 변환
    const resUp = makeRes();
    await handler({
      method: 'POST',
      body: { action: 'upgrade', fileName: '42-1 원가자료.xlsx', fileBase64: pollutedBuf.toString('base64') },
    }, resUp);
    assert.equal(resUp.code, 200);
    assert.equal(resUp.headers['X-Removed-Auxiliary-Sheets'], '2');
    assert.deepEqual(XLSX.read(resUp.body).SheetNames, ['42-1', '47-2', '48-1']);

    // 4) preserveCostHistory: 구형 해시 키(버전 미포함)의 오염된 캐시를 절대 재사용하지 않고 LAYOUT_SCHEMA_VERSION 키를 사용
    assert.equal(LAYOUT_SCHEMA_VERSION, 'v3-variety-freeze-clean');
    const ctx = invoiceCostExportFixture(3, 'NL_AMOUNT_V1');
    const newBytes = await createInvoiceCostWorkbook(ctx);
    const user = { userId: 'legacy-cache-user' };
    const oldKey = createHash('sha256')
      .update(JSON.stringify(['legacy-cache-user', '2026', 'NL', 'AIR', 'EUR', 'NL_ORIGINAL_V1']))
      .digest('hex');
    const oldCacheDir = path.join(historyDir, oldKey);
    await fsp.mkdir(oldCacheDir, { recursive: true });
    const fakeUuidFile = '11111111-1111-4111-8111-111111111111.xlsx';
    await fsp.writeFile(path.join(oldCacheDir, fakeUuidFile), pollutedBuf);
    await fsp.writeFile(path.join(oldCacheDir, 'latest.json'), JSON.stringify({
      file: fakeUuidFile,
      seedId: null,
      scope: { year: '2026', country: 'NL', mode: 'AIR', currency: 'EUR' },
      digests: [],
      activeTabs: {},
    }));

    const outHistory = await preserveCostHistory({ bytes: newBytes, context: ctx, user, root: historyDir });
    const dirs = await fsp.readdir(historyDir);
    assert.equal(dirs.length, 2, '새 레이아웃 스키마 버전 디렉터리가 별도 생성되어야 함');
    const histWb = XLSX.read(outHistory);
    assert.equal(histWb.SheetNames.some(n => isAuxiliaryNonWeekSheetName(n)), false);
  } finally {
    if (prevDir === undefined) delete process.env.COST_MASTER_DIR;
    else process.env.COST_MASTER_DIR = prevDir;
    await fsp.rm(masterDir, { recursive: true, force: true });
    await fsp.rm(historyDir, { recursive: true, force: true });
  }
});

test('/arrival-cost 기존 차수(14-1 ~ 45-2) 내역 차수별 .xlsx 내보내기(buildArrivalHistoryWorkbook) 규격 검증', async () => {
  const sampleRows = [
    {
      orderWeek: '14-01',
      countryName: '콜롬비아',
      dbFlowerName: '카네이션',
      farmName: 'Cactus',
      displayName: '카네이션 문라이트',
      quantity: 30,
      unit: '단',
      fobUSD: 0.21,
      exchangeRate: 1450,
      freightPerUnitUSD: 0.09,
      customsPerUnitKRW: 320,
      selectedArrivalCostKRW: 9020,
    },
    {
      orderWeek: '45-02',
      countryName: '콜롬비아',
      dbFlowerName: '수국',
      farmName: 'Balverde',
      displayName: '수국 화이트',
      quantity: 120,
      unit: '송이',
      fobUSD: 0.9,
      exchangeRate: 1380,
      freightPerUnitUSD: 0.48,
      customsPerUnitKRW: 85,
      selectedArrivalCostKRW: 1989,
    },
  ];

  const buf = await buildArrivalHistoryWorkbook({
    rows: sampleRows,
    orderYear: '2026',
    weekOrder: 'asc',
    outputType: 'nodebuffer',
  });

  const wb = XLSX.read(buf, { cellFormula: true });
  assert.deepEqual(wb.SheetNames, ['14-1', '45-2']);

  const xmlMap = await readWorkbookWorksheetXmlMap(buf);
  for (const name of wb.SheetNames) {
    const xml = xmlMap.get(name);
    verifyWorksheetElementOrder(xml, `historyExport:${name}`);
    assert.match(xml, /<pane xSplit="3" ySplit="5" topLeftCell="D6" activePane="bottomRight" state="frozen"\/>/);
    assert.match(xml, /<autoFilter ref="A5:L6"\/>/);
    const s = wb.Sheets[name];
    assert.equal(s.A5?.v, '농장');
    assert.equal(s.B5?.v, '품종');
    assert.equal(s.C5?.v, '칼라·품명');
  }
  assert.equal(wb.Sheets['14-1'].A6?.v, 'Cactus');
  assert.equal(wb.Sheets['14-1'].B6?.v, '카네이션');
  assert.equal(wb.Sheets['45-2'].A6?.v, 'Balverde');
  assert.equal(wb.Sheets['45-2'].B6?.v, '수국');
});
