import JSZip from 'jszip';

// 전 차수 원가시트 무손실 OOXML 업그레이더 (Zero-Shift 수식 보존 · ECMA-376 스키마 순서 엄수)
export const LAYOUT_SCHEMA_VERSION = 'v3-variety-freeze-clean';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const WORKSHEET_CHILD_ORDER = Object.freeze([
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'drawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
]);

const GROUP_ID_TO_KO = Object.freeze({
  ROSE: '장미',
  CARNATION: '카네이션',
  ALSTROMERIA: '알스트로',
  ALSTROEMERIA: '알스트로',
  RUSCUS: '루스커스',
  HYDRANGEA: '수국',
  ANTHURIUM: '안스리움',
  LOOSE_BLOOMS: '루스블룸',
  OTHERS: '기타',
});

const FLOWER_VARIETY_RULES = [
  ['수국', /hydrangea|수국/i],
  ['카네이션', /carnation|카네이션|석죽|패랭이|dianthus/i],
  ['알스트로', /alstroemeria|alstromeria|\balstro\b|알스트로/i],
  ['루스커스', /ruscus|루스커스/i],
  ['백합', /\blily\b|\blilies\b|\blilium\b|roselily|백합/i],
  ['장미', /\broses?\b|자연장미|장미|\bmondial\b|\bexplorer\b|\bfreedom\b|\bshimmer\b|playa\s*blanca|\bkahala\b|\bquicksand\b|\bvendela\b/i],
  ['안개', /gypsophila|baby.?s.?breath|million\s*star|xelence|xlence|안개/i],
  ['유칼립투스', /eucalypt|블랙잭|폴리안|구니|파블로|시네리아|니콜|베이비블루|유칼립/i],
  ['리시안', /lisianthus|eustoma|리시안/i],
  ['시네신스', /sinensis|statice|limonium|시네신스|스타티스/i],
  ['비짜루', /asparagus|비짜루|미디오/i],
  ['호접난', /phalaenopsis|호접난|호접란/i],
  ['심비디움', /cymbidium|심비디움/i],
  ['덴파레', /dendrobium|덴파레/i],
  ['난류', /\borchid\b|oncidium|\bvanda\b|모카라|온시디움|반다/i],
  ['튤립', /tulip|튤립/i],
  ['아마릴리스', /amaryllis|hippeastrum|아마릴리스/i],
  ['아스틸베', /astilbe|아스틸베/i],
  ['안스리움', /anthurium|안스리움/i],
  ['카라', /\bcalla\b|zantedeschia|카라/i],
  ['클레마티스', /clematis|클레마티스/i],
  ['캄파눌라', /campanula|캄파눌라/i],
  ['델피늄', /delphinium|델피늄/i],
  ['히야신스', /hyacinth|히야신스/i],
  ['스키미아', /skimmia|스키미아/i],
  ['아가판서스', /agapanthus|아가판서스/i],
  ['에린지움', /eryngium|에린지움/i],
  ['그레빌레아', /grevillea|그레빌레아/i],
  ['네리네', /nerine|네리네/i],
  ['작약', /peony|paeonia|작약/i],
  ['라넌큘러스', /ranunculus|라넌큘러스/i],
  ['아네모네', /anemone|아네모네/i],
  ['프리지아', /freesia|프리지아/i],
  ['국화', /chrysanthemum|소국|대국|퐁퐁|디스버드|국화/i],
  ['거베라', /gerbera|거베라/i],
  ['해바라기', /sunflower|helianthus|해바라기/i],
  ['다알리아', /dahlia|다알리아|달리아/i],
  ['수선화', /narcissus|daffodil|수선화/i],
  ['무스카리', /muscari|무스카리/i],
  ['아이리스', /\biris\b|아이리스/i],
  ['알리움', /allium|알리움/i],
  ['비부르눔', /viburnum|비부르눔|스노우볼/i],
  ['오이초', /sanguisorba|오이초/i],
  ['스위트피', /lathyrus|sweet\s*pea|스위트피/i],
  ['스카비오사', /scabiosa|스카비오사/i],
  ['베로니카', /veronica|베로니카/i],
  ['스토크', /matthiola|\bstock\b|스토크/i],
  ['금어초', /antirrhinum|snapdragon|금어초/i],
  ['왁스플라워', /wax\s*flower|chamelaucium|왁스플라워/i],
  ['프로테아', /protea|프로테아/i],
  ['류카덴드론', /leucadendron|류카덴드론/i],
  ['헬레보루스', /helleborus|헬레보루스/i],
  ['프리틸라리아', /fritillaria|프리틸라리아/i],
  ['글로리오사', /gloriosa|글로리오사/i],
  ['아스트란티아', /astrantia|아스트란티아/i],
  ['마트리카리아', /matricaria|마트리카리아/i],
  ['유포르비아', /euphorbia|유포르비아/i],
  ['코딜리네', /cordyline|코딜리네/i],
  ['캥거루포', /kang[ao]roo|캥거루포/i],
  ['하이페리쿰', /hypericum|하이페리쿰/i],
  ['낙상홍', /\bilex\b|낙상홍/i],
  ['스노우베리', /symphoricarpos|snowberry|스노우베리/i],
  ['천일홍', /gomphrena|천일홍/i],
  ['옥시', /oxypetalum|tweedia|옥시/i],
  ['불로초', /불로초|bupleurum/i],
  ['엽란', /aspidistra|엽란/i],
  ['미모사', /mimosa|acacia|미모사/i],
  ['글라디올러스', /gladiolus|글라디올러스/i],
  ['맨드라미', /celosia|맨드라미/i],
  ['오니소갈룸', /ornithogalum|오니소갈룸/i],
  ['그린·소재', /\bgreens?\b|foliage|소재/i],
];

const LEGACY_BANNER_WARNING_RE = /미승인\s*(?:파일\s*)?계산본|운영\s*DB\s*변경\s*없음|ERP\/계산\s*원가\s*변경\s*없음|원본\s*가정값|레퍼런스\s*기준가|조회\s*결과는\s*고정값입니다|입력·자동\s*수식은\s*「원본\s*양식\s*계산」|원본\s*기본값\(미승인\)/i;

function escXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unxml(value) {
  return String(value ?? '')
    .replace(/_x000[dD]_/g, '\r')
    .replace(/_x000[aA]_/g, '\n')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function colToIdx(col) {
  let n = 0;
  for (let i = 0; i < col.length; i += 1) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

export function idxToCol(idx) {
  let n = idx;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * 차수 원가시트가 아닌 부가·비교·예시·폐기 탭인지 판별한다.
 */
export function isAuxiliaryNonWeekSheetName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return true;
  if (/원본\s*수식\s*비교|원본\s*양식\s*계산|주광[·\s]*기타\s*비교|주광\s*비교/i.test(trimmed)) return true;
  if (/카테고리\s*규격표|품종\s*기준|비교작업/i.test(trimmed)) return true;
  if (/^(?:\d{1,2}\s*-\s*\d{1,2}\s+)?(?:요약|규격표|기준표)$/i.test(trimmed)) return true;
  if (/예시|견본|샘플|example|sample|template|plantilla|ejemplo|폐기/i.test(trimmed)) return true;
  if (/^sheet\s*\d+$/i.test(trimmed)) return true;
  const withoutCopySuffix = trimmed.replace(/\s*\(\d+\)\s*$/, '').trim();
  if (!/\d/.test(withoutCopySuffix)) return true;
  return false;
}

/**
 * xl/sharedStrings.xml에서 인덱스 순서를 100% 유지해 문자열 배열을 추출한다.
 */
export function parseSharedStrings(sharedStringsXml) {
  if (!sharedStringsXml) return [];
  const out = [];
  for (const m of sharedStringsXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const body = m[1] || '';
    if (!body) {
      out.push('');
      continue;
    }
    const withoutPhonetic = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
    const parts = [];
    for (const tm of withoutPhonetic.matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g)) {
      parts.push(unxml(tm[1]));
    }
    out.push(parts.join(''));
  }
  return out;
}

export function inferKoreanVariety(productText, { absorbedGroup = '', sheetTitle = '' } = {}) {
  const upperGroup = String(absorbedGroup ?? '').trim().toUpperCase();
  if (upperGroup && GROUP_ID_TO_KO[upperGroup]) return GROUP_ID_TO_KO[upperGroup];
  if (absorbedGroup && /[가-힣]/.test(absorbedGroup)) return String(absorbedGroup).trim();

  const text = String(productText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  for (const [ko, re] of FLOWER_VARIETY_RULES) {
    if (ko === '장미' && /roselily/i.test(text)) continue;
    if (re.test(text)) return ko;
  }

  if (/ecuador/i.test(sheetTitle) || /^ecuador\b/i.test(text)) return '장미';

  const slashIdx = text.indexOf('/');
  if (slashIdx > 0) {
    const prefix = text
      .slice(0, slashIdx)
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\b(?:CHINA|COLOMBIA|ECUADOR|NL|HOLLAND|VIETNAM|THAILAND|MEL|CLOUD|FRESH|PRESERVED)\b/gi, '')
      .trim();
    if (prefix && prefix.length <= 18) {
      for (const [ko, re] of FLOWER_VARIETY_RULES) {
        if (re.test(prefix)) return ko;
      }
      if (/[가-힣]/.test(prefix)) return prefix;
    }
  }
  return '기타';
}

function parseCell(rawCellXml, sharedStrings) {
  const openMatch = rawCellXml.match(/^<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)$/);
  if (!openMatch) return null;
  const attrs = openMatch[1];
  const inner = openMatch[2] ?? '';
  const refMatch = attrs.match(/\br="([A-Z]+)(\d+)"/);
  if (!refMatch) return null;
  const col = refMatch[1];
  const row = Number(refMatch[2]);
  const colIdx = colToIdx(col);
  const style = attrs.match(/\bs="(\d+)"/)?.[1] ?? null;
  const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? null;

  const fMatch = inner.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
  const hasFormula = Boolean(fMatch);
  const formulaAttrs = fMatch ? fMatch[1] : '';
  const formulaText = fMatch && fMatch[2] != null ? unxml(fMatch[2]) : null;

  const vMatch = inner.match(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/);
  const isMatch = inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);

  let text = '';
  if (type === 's' && vMatch) {
    const idx = Number(vMatch[1].trim());
    text = Number.isInteger(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
  } else if (type === 'inlineStr' && isMatch) {
    const parts = [];
    for (const tm of isMatch[1].matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g)) parts.push(unxml(tm[1]));
    text = parts.join('');
  } else if (vMatch) {
    text = unxml(vMatch[1]);
  }

  const hasContent = hasFormula || Boolean(isMatch && text !== '') || Boolean(vMatch && vMatch[1] !== '');
  return {
    raw: rawCellXml,
    attrs,
    inner,
    ref: `${col}${row}`,
    col,
    colIdx,
    row,
    style,
    type,
    hasFormula,
    formulaAttrs,
    formulaText,
    text,
    hasContent,
  };
}

function makeInlineStrCell(ref, style, text) {
  const sAttr = style != null ? ` s="${style}"` : '';
  const val = String(text ?? '');
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`;
}

function makeEmptyStyledCell(ref, style) {
  const sAttr = style != null ? ` s="${style}"` : '';
  return `<c r="${ref}"${sAttr}/>`;
}

function moveCellToCol(cell, newCol, rowNum, styleOverride = null) {
  const newRef = `${newCol}${rowNum}`;
  const style = styleOverride ?? cell.style;
  let attrs = cell.attrs.replace(/\br="[A-Z]+\d+"/, `r="${newRef}"`);
  if (style != null) {
    attrs = /\bs="\d+"/.test(attrs) ? attrs.replace(/\bs="\d+"/, `s="${style}"`) : `${attrs} s="${style}"`;
  }
  return cell.inner ? `<c${attrs}>${cell.inner}</c>` : `<c${attrs}/>`;
}

/**
 * 데이터행 품목명이 B{r} -> C{r}로 이동할 때 수식 내 동일 시트 B{minRow..maxRow} 참조만 C{minRow..maxRow}로 치환한다.
 * 문자열 리터럴("...")과 타 시트 참조('시트'!B15, Sheet!B15)는 절대 건드리지 않는다.
 */
export function rewriteFormulaDataRowBRefs(formula, minRow, maxRow, { absorbWGroup = false, jGroupLabels = null } = {}) {
  if (!formula || typeof formula !== 'string') return formula;

  // 1) 먼저 기존 데이터행 품목명 셀 B{minRow..maxRow} 참조만 C{minRow..maxRow}로 치환한다.
  // 문자열 리터럴("...")과 타 시트 참조('시트'!Ref, Sheet!Ref)는 절대 건드리지 않는다.
  const tokenRe = /"(?:[^"]|"")*"|'(?:[^']|'')*'!\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?|[A-Za-z0-9_.]+\!\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?/g;
  let result = '';
  let lastIndex = 0;

  const replaceSegment = (seg) => seg.replace(
    /(?<![A-Za-z0-9_!'])(\$?)B(\$?)(\d+)(?![A-Za-z0-9_])/g,
    (match, colDollar, rowDollar, digits) => {
      const r = Number(digits);
      if (r >= minRow && r <= maxRow) return `${colDollar}C${rowDollar}${digits}`;
      return match;
    },
  );

  for (const m of formula.matchAll(tokenRe)) {
    result += replaceSegment(formula.slice(lastIndex, m.index));
    result += m[0];
    lastIndex = m.index + m[0].length;
  }
  result += replaceSegment(formula.slice(lastIndex));

  // 2) 그 다음 우측 W열 원가 그룹 흡수 대상이 있으면 SUMIF($W$.. -> $B$.., "한글품종")로 치환한다
  // (순서상 B->C 치환 이후에 수행해야 새 $B$ 참조가 $C$로 재치환되지 않음!).
  if (absorbWGroup) {
    result = result.replace(
      /SUMIF\(\s*\$?W\$?(\d+)\s*:\s*\$?W\$?(\d+)\s*,\s*(?:\$?J\$?(\d+)|"([A-Z_]+)")\s*,/gi,
      (whole, r1, r2, jRow, literalGroup) => {
        let ko = null;
        if (jRow && jGroupLabels?.has(Number(jRow))) {
          const rawJ = jGroupLabels.get(Number(jRow));
          ko = GROUP_ID_TO_KO[String(rawJ).trim().toUpperCase()] || rawJ;
        } else if (literalGroup) {
          ko = GROUP_ID_TO_KO[literalGroup.toUpperCase()] || null;
        }
        return ko ? `SUMIF($B$${r1}:$B$${r2},"${ko}",` : whole;
      },
    );
  }

  return result;
}

function updateCellFormulaXml(rawCellXml, rewriter) {
  return rawCellXml.replace(/<f(\b[^>]*?)>([\s\S]*?)<\/f>/g, (whole, attrs, body) => {
    const decoded = unxml(body);
    const updated = rewriter(decoded);
    if (updated === decoded) return whole;
    return `<f${attrs}>${escXml(updated)}</f>`;
  });
}

function cleanLegacyBannerTitle(rawTitle, weekText, sheetName) {
  const src = String(rawTitle ?? '').trim();
  const week = String(weekText || sheetName || '').trim();
  let country = '';
  if (/colombia|콜롬비아/i.test(src)) country = 'COLOMBIA';
  else if (/ecuador|에콰도르/i.test(src)) country = 'ECUADOR';
  else if (/\bnl\b|netherlands|holex|네덜란드/i.test(src)) country = 'NL';
  else if (/중국\s*해상/i.test(src)) country = '중국 해상';
  else if (/china|중국|cloud|melody|hubfresh/i.test(src)) country = 'CHINA';
  else if (/australia|호주|\bau\b/i.test(src)) country = 'AUSTRALIA';
  else if (/vietnam|베트남|\bvn\b/i.test(src)) country = 'VIETNAM';
  else if (/thailand|태국|\bth\b/i.test(src)) country = 'THAILAND';
  const testTag = /TEST_ONLY/i.test(src) ? ' (TEST_ONLY)' : '';
  if (country && week) return `${country} ${week} 도착원가${testTag}`;
  if (country) return `${country} 도착원가${testTag}`;
  if (week) return `${week} 도착원가${testTag}`;
  return `도착원가${testTag}`;
}

function ensureColWidths(colsXml, desiredMinWidths) {
  if (!colsXml) {
    const cols = Object.entries(desiredMinWidths)
      .map(([k, w]) => `<col min="${k}" max="${k}" width="${w}" customWidth="1"/>`)
      .join('');
    return `<cols>${cols}</cols>`;
  }
  let segments = [...colsXml.matchAll(/<col\b([^>]*?)\/>/g)].map(m => ({
    min: Number(m[1].match(/\bmin="(\d+)"/)?.[1] || 0),
    max: Number(m[1].match(/\bmax="(\d+)"/)?.[1] || 0),
    attrs: m[1],
  })).filter(s => s.min > 0 && s.max >= s.min);

  if (!segments.length) return colsXml;

  for (const [kStr, minWidth] of Object.entries(desiredMinWidths)) {
    const colIdx = Number(kStr);
    const next = [];
    let matched = false;
    for (const seg of segments) {
      if (colIdx < seg.min || colIdx > seg.max) {
        next.push(seg);
        continue;
      }
      matched = true;
      const curW = Number(seg.attrs.match(/\bwidth="([^"]+)"/)?.[1] || 0);
      const targetW = Math.max(curW, minWidth);
      const cloneAttrs = (a, b, w) => {
        let s = seg.attrs.replace(/\bmin="\d+"/, `min="${a}"`).replace(/\bmax="\d+"/, `max="${b}"`);
        if (w !== null) {
          s = /\bwidth="[^"]*"/.test(s) ? s.replace(/\bwidth="[^"]*"/, `width="${w}"`) : `${s} width="${w}"`;
          s = /\bcustomWidth="[^"]*"/.test(s) ? s.replace(/\bcustomWidth="[^"]*"/, 'customWidth="1"') : `${s} customWidth="1"`;
        }
        return s;
      };
      if (seg.min < colIdx) next.push({ min: seg.min, max: colIdx - 1, attrs: cloneAttrs(seg.min, colIdx - 1, null) });
      next.push({ min: colIdx, max: colIdx, attrs: cloneAttrs(colIdx, colIdx, targetW) });
      if (seg.max > colIdx) next.push({ min: colIdx + 1, max: seg.max, attrs: cloneAttrs(colIdx + 1, seg.max, null) });
    }
    if (!matched) {
      next.push({ min: colIdx, max: colIdx, attrs: ` min="${colIdx}" max="${colIdx}" width="${minWidth}" customWidth="1"` });
    }
    next.sort((a, b) => a.min - b.min);
    segments = next;
  }
  return `<cols>${segments.map(s => `<col${s.attrs}/>`).join('')}</cols>`;
}

function buildFrozenSheetViews(existingSheetViewsXml, { xSplit, ySplit, topLeftCell, sheetTopLeft = 'A1' }) {
  let tabSelectedAttr = '';
  let showGridLinesAttr = '';
  let zoomAttrs = '';
  if (existingSheetViewsXml) {
    const svOpen = existingSheetViewsXml.match(/<sheetView\b([^>]*?)(?:\/>|>)/)?.[1] || '';
    const ts = svOpen.match(/\btabSelected="[01]"/);
    if (ts) tabSelectedAttr = ` ${ts[0]}`;
    const sg = svOpen.match(/\bshowGridLines="[01]"/);
    if (sg) showGridLinesAttr = ` ${sg[0]}`;
    const zs = svOpen.match(/\bzoomScale="\d+"/);
    const zsn = svOpen.match(/\bzoomScaleNormal="\d+"/);
    if (zs) zoomAttrs += ` ${zs[0]}`;
    if (zsn) zoomAttrs += ` ${zsn[0]}`;
  }
  return `<sheetViews><sheetView${tabSelectedAttr}${showGridLinesAttr}${zoomAttrs} topLeftCell="${sheetTopLeft}" workbookViewId="0"><pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/></sheetView></sheetViews>`;
}

function extractDirectWorksheetChildren(worksheetInnerXml) {
  const buckets = new Map();
  const push = (tag, xml) => {
    const arr = buckets.get(tag) || [];
    arr.push(xml);
    buckets.set(tag, arr);
  };

  let pos = 0;
  const len = worksheetInnerXml.length;
  while (pos < len) {
    const lt = worksheetInnerXml.indexOf('<', pos);
    if (lt < 0) break;
    if (worksheetInnerXml.startsWith('<!--', lt)) {
      const endComment = worksheetInnerXml.indexOf('-->', lt + 4);
      pos = endComment < 0 ? len : endComment + 3;
      continue;
    }
    const tagMatch = worksheetInnerXml.slice(lt).match(/^<([A-Za-z0-9:]+)\b([^>]*?)(\/?)>/);
    if (!tagMatch) {
      pos = lt + 1;
      continue;
    }
    const fullOpen = tagMatch[0];
    const tagName = tagMatch[1];
    const localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
    const selfClosing = tagMatch[3] === '/';
    if (selfClosing) {
      push(localName, fullOpen);
      pos = lt + fullOpen.length;
      continue;
    }
    const closeNeedle = `</${tagName}>`;
    const closeAt = worksheetInnerXml.indexOf(closeNeedle, lt + fullOpen.length);
    if (closeAt < 0) {
      push(localName, worksheetInnerXml.slice(lt));
      break;
    }
    const endPos = closeAt + closeNeedle.length;
    push(localName, worksheetInnerXml.slice(lt, endPos));
    pos = endPos;
  }
  return buckets;
}

function assembleWorksheetXml(xmlProlog, worksheetOpenTag, buckets) {
  const ordered = [];
  const emitted = new Set();
  for (const tag of WORKSHEET_CHILD_ORDER) {
    const items = buckets.get(tag);
    if (items?.length) {
      ordered.push(...items);
      emitted.add(tag);
    }
  }
  for (const [tag, items] of buckets.entries()) {
    if (!emitted.has(tag) && items?.length) ordered.push(...items);
  }
  return `${xmlProlog}${worksheetOpenTag}${ordered.join('')}</worksheet>`;
}

/**
 * 단일 시트 XML을 무손실 업그레이드한다.
 * @returns {{ xml: string, changed: boolean, upgraded: boolean, autoFilterRef: string | null, mode: string }}
 */
export function upgradeLegacyCostSheetXml(sheetXml, { sharedStrings = [], sheetName = '' } = {}) {
  if (!sheetXml || typeof sheetXml !== 'string') {
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: null, mode: 'empty' };
  }

  const wsOpenMatch = sheetXml.match(/^([\s\S]*?)(<worksheet\b[^>]*>)([\s\S]*?)<\/worksheet>\s*$/);
  if (!wsOpenMatch) {
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: null, mode: 'unrecognized' };
  }
  const xmlProlog = wsOpenMatch[1];
  const wsOpenTag = wsOpenMatch[2];
  const wsInner = wsOpenMatch[3];

  const buckets = extractDirectWorksheetChildren(wsInner);
  const sheetDataXml = buckets.get('sheetData')?.[0] || '';
  if (!sheetDataXml || /^<sheetData\b[^>]*\/>\s*$/.test(sheetDataXml)) {
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: null, mode: 'empty-sheetdata' };
  }

  // 행 파싱
  const rowEntries = [];
  const rowMap = new Map();
  const sheetDataInner = sheetDataXml.replace(/^<sheetData\b[^>]*>/, '').replace(/<\/sheetData>\s*$/, '');
  for (const rm of sheetDataInner.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttrs = rm[1];
    const rInner = rm[2] ?? '';
    const rNum = Number(rAttrs.match(/\br="(\d+)"/)?.[1] || 0);
    if (!rNum) continue;
    const cells = [];
    const byCol = new Map();
    for (const cm of rInner.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const parsed = parseCell(cm[0], sharedStrings);
      if (parsed) {
        cells.push(parsed);
        byCol.set(parsed.col, parsed);
      }
    }
    const entry = { rowNum: rNum, attrs: rAttrs, raw: rm[0], cells, byCol };
    rowEntries.push(entry);
    rowMap.set(rNum, entry);
  }

  if (!rowEntries.length) {
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: null, mode: 'no-rows' };
  }

  // 기존 병합 셀 목록
  const existingMergesXml = buckets.get('mergeCells')?.[0] || '';
  const merges = [...existingMergesXml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(m => m[1]);

  // 원가 테이블 헤더 행(hdr) 탐색
  const normHeader = s => String(s ?? '').replace(/[\r\n\s]+/g, ' ').trim();
  const QTY_RE = /^(?:수량|송이수|실제량|입고수량|qty)(?:\s*\([^)]*\))?$/i;
  const COST_HDR_RE = /fob|상품|단가|운임|운송비|금액포시죤|금액비율|금액\s*배분비|배분비|cnf|관세|통관|도착원가|원가\s*\(|원가\/|단당|송이\/단위|환산수량|종이익|총이익|종\s*판매가|총판매가/i;

  let hdr = null;
  let alreadyHasVariety = false;
  let varietyColOnHeader = null;

  for (const row of rowEntries) {
    if (row.rowNum > 55) break;
    let costHits = 0;
    let hasQty = false;
    let vCol = null;
    for (const cell of row.cells) {
      if (cell.colIdx > 25) continue;
      const t = normHeader(cell.text);
      if (!t) continue;
      if (cell.colIdx <= 4 && t === '품종') vCol = cell.col;
      if (cell.colIdx >= 3 && cell.colIdx <= 7 && QTY_RE.test(t)) hasQty = true;
      if (cell.colIdx >= 4 && cell.colIdx <= 23 && COST_HDR_RE.test(t)) costHits += 1;
    }
    if (vCol && (hasQty || costHits >= 2)) {
      hdr = row.rowNum;
      alreadyHasVariety = true;
      varietyColOnHeader = vCol;
      break;
    }
    if (hasQty && costHits >= 2) {
      hdr = row.rowNum;
      break;
    }
  }

  // 원가 테이블이 아닌 일반/합성 시트는 건드리지 않는다.
  if (!hdr) {
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: null, mode: 'non-cost-sheet' };
  }

  // 상단 1~5행 구형 경고문구 존재 여부 점검
  let hasLegacyWarning = false;
  for (const rNum of [1, 2, 3, 5]) {
    const row = rowMap.get(rNum);
    if (!row) continue;
    for (const cell of row.cells) {
      if (cell.text && LEGACY_BANNER_WARNING_RE.test(cell.text)) {
        hasLegacyWarning = true;
        break;
      }
    }
  }

  const hdrRow = rowMap.get(hdr);
  const wHeaderText = normHeader(hdrRow?.byCol.get('W')?.text);
  const hasLegacyWCostGroup = wHeaderText === '원가 그룹';

  const existingViewsXml = buckets.get('sheetViews')?.[0] || '';
  const hasFrozenBothPanes = /<pane\b(?=[^>]*\bxSplit="[1-9]\d*")(?=[^>]*\bySplit="[1-9]\d*")(?=[^>]*\bstate="frozen")[^>]*\/>/.test(existingViewsXml);
  const existingAutoFilterXml = buckets.get('autoFilter')?.[0] || '';
  const hasCleanAutoFilter = Boolean(existingAutoFilterXml) && !/showButton="0"/.test(existingAutoFilterXml);

  // 이미 신형(품종 열 + 가로·세로 동시 Freeze Panes + 정상 AutoFilter + 경고문구/W열 그룹 없음)이면 100% 멱등 반환!
  if (alreadyHasVariety && hasFrozenBothPanes && hasCleanAutoFilter && !hasLegacyWarning && !hasLegacyWCostGroup) {
    const existingRef = existingAutoFilterXml.match(/\bref="([^"]+)"/)?.[1] || null;
    return { xml: sheetXml, changed: false, upgraded: false, autoFilterRef: existingRef, mode: 'already-v3' };
  }

  // 시트 메타(제목·차수) 파악
  const sheetTitle = rowMap.get(1)?.byCol.get('B')?.text || rowMap.get(1)?.byCol.get('A')?.text || '';
  const weekText = rowMap.get(5)?.byCol.get('C')?.text || rowMap.get(4)?.byCol.get('C')?.text || sheetName;

  // J7..J14 품종 그룹 기준값 파악 (W열 원가 그룹 흡수 시 SUMIF 보존용)
  const jGroupLabels = new Map();
  for (let r = 6; r <= Math.min(16, hdr - 1); r += 1) {
    const jc = rowMap.get(r)?.byCol.get('J');
    const aac = rowMap.get(r + 1)?.byCol.get('AA');
    if (jc?.text) jGroupLabels.set(r, jc.text.trim());
    else if (aac?.text) jGroupLabels.set(r, aac.text.trim());
  }

  // 데이터 마지막 행(lastActiveRow / lastTableRow) 산정
  const FOOTER_STOP_RE = /^(?:비용\s*증빙\s*종류|검토\s*구분|원본\s*입고)$/;
  let stopAtRow = Infinity;
  let lastActiveRow = hdr;
  let lastFormulaRow = hdr;

  for (const row of rowEntries) {
    if (row.rowNum <= hdr) continue;
    const aText = normHeader(row.byCol.get('A')?.text);
    if (aText && FOOTER_STOP_RE.test(aText)) {
      stopAtRow = row.rowNum;
      break;
    }
    const bText = normHeader(row.byCol.get('B')?.text);
    if (/^(?:합계|소계|total)$/i.test(bText) || /^(?:합계|소계|total)$/i.test(aText)) {
      continue;
    }
    const hasPrimaryData = ['A', 'B', 'C', 'D', 'E', 'F'].some(c => {
      const cell = row.byCol.get(c);
      return cell && cell.hasContent && String(cell.text ?? '').trim() !== '';
    });
    const hasMainFormulaOrVal = row.cells.some(c => c.colIdx >= 2 && c.colIdx <= 22 && c.hasContent);
    if (hasPrimaryData) lastActiveRow = Math.max(lastActiveRow, row.rowNum);
    if (hasMainFormulaOrVal) lastFormulaRow = Math.max(lastFormulaRow, row.rowNum);
  }

  let maxMergeDataRow = hdr;
  for (const m of merges) {
    const mm = m.match(/^B(\d+):D(\d+)$/);
    if (mm && Number(mm[1]) > hdr && Number(mm[2]) < stopAtRow) {
      maxMergeDataRow = Math.max(maxMergeDataRow, Number(mm[2]));
    }
  }

  // 공유 수식 ref="G15:G78"의 끝 행도 포함
  let maxSharedFormulaRow = hdr;
  for (const row of rowEntries) {
    if (row.rowNum <= hdr || row.rowNum >= stopAtRow) continue;
    for (const cell of row.cells) {
      if (!cell.formulaAttrs) continue;
      const refM = cell.formulaAttrs.match(/\bref="[A-Z]+\d+:[A-Z]+(\d+)"/);
      if (refM && Number(refM[1]) < stopAtRow) {
        maxSharedFormulaRow = Math.max(maxSharedFormulaRow, Number(refM[1]));
      }
    }
  }

  const lastTableRow = Math.max(lastActiveRow, lastFormulaRow, maxMergeDataRow, maxSharedFormulaRow);
  const lastFilterRow = Math.max(lastActiveRow, lastFormulaRow);

  // 안전한 B:D -> B(품종) + C:D(품목명) 분할 가능 여부 판정
  let canSplitBD = false;
  if (!alreadyHasVariety && hdrRow) {
    const cHdrText = normHeader(hdrRow.byCol.get('C')?.text);
    const dHdrText = normHeader(hdrRow.byCol.get('D')?.text);
    const eHdrText = normHeader(hdrRow.byCol.get('E')?.text);
    const hasHdrBDMerge = merges.includes(`B${hdr}:D${hdr}`);
    const hasDataBDMerges = merges.some(m => {
      const mm = m.match(/^B(\d+):D(\d+)$/);
      return mm && Number(mm[1]) > hdr && Number(mm[1]) === Number(mm[2]);
    });
    const bHdrBlankWithDataInB = !normHeader(hdrRow.byCol.get('B')?.text)
      && rowEntries.some(r => r.rowNum > hdr && r.rowNum <= lastTableRow && normHeader(r.byCol.get('B')?.text));

    // 데이터행(hdr+1..lastTableRow)의 C열/D열을 수식이 직접 참조하는 비정형 시트가 아닌지 검증
    let hasDataRowCDFormulaRef = false;
    const cdCheckRe = /(?<![A-Za-z0-9_!'])\$?[CD]\$?(\d+)(?![A-Za-z0-9_])/g;
    for (const row of rowEntries) {
      for (const cell of row.cells) {
        if (!cell.formulaText) continue;
        const stripped = cell.formulaText.replace(/"(?:[^"]|"")*"/g, '');
        for (const m of stripped.matchAll(cdCheckRe)) {
          const rRef = Number(m[1]);
          if (rRef >= hdr && rRef <= lastTableRow) {
            hasDataRowCDFormulaRef = true;
            break;
          }
        }
        if (hasDataRowCDFormulaRef) break;
      }
      if (hasDataRowCDFormulaRef) break;
    }

    if (!cHdrText && !dHdrText && eHdrText && !hasDataRowCDFormulaRef && (hasHdrBDMerge || hasDataBDMerges || bHdrBlankWithDataInB)) {
      canSplitBD = true;
    }
  }

  // 1) 상단 1~5행 경고문구 정화
  if (hasLegacyWarning) {
    for (const rNum of [1, 2, 3, 5]) {
      const row = rowMap.get(rNum);
      if (!row) continue;
      let rowChanged = false;
      const nextCells = [];
      for (const cell of row.cells) {
        if (!cell.text || !LEGACY_BANNER_WARNING_RE.test(cell.text)) {
          nextCells.push(cell);
          continue;
        }
        rowChanged = true;
        if (rNum === 1 && (cell.col === 'B' || cell.col === 'A')) {
          const cleaned = cleanLegacyBannerTitle(cell.text, weekText, sheetName);
          nextCells.push(parseCell(makeInlineStrCell(cell.ref, cell.style, cleaned), sharedStrings));
        } else if (rNum === 5 && cell.col === 'O') {
          nextCells.push(parseCell(makeInlineStrCell(cell.ref, cell.style, '그외에 통관비'), sharedStrings));
        } else {
          nextCells.push(parseCell(makeEmptyStyledCell(cell.ref, cell.style), sharedStrings));
        }
      }
      if (rowChanged) {
        row.cells = nextCells;
        row.byCol = new Map(nextCells.map(c => [c.col, c]));
        row.dirty = true;
      }
    }
  }

  // 2) 콜롬비아·복원형 B{hdr}:D{hdr} 분할 + 데이터행 B->C 이동 + B열 한글 품종 채움 + W열 원가 그룹 흡수
  const hasAnyFarmInColA = rowEntries.some(
    r => r.rowNum > hdr && r.rowNum <= lastActiveRow && normHeader(r.byCol.get('A')?.text),
  );

  let updatedMerges = [...merges];

  if (canSplitBD) {
    // 헤더 행(hdr) 재구성
    const origACell = hdrRow.byCol.get('A');
    const origBCell = hdrRow.byCol.get('B');
    const origCCell = hdrRow.byCol.get('C');
    const origDCell = hdrRow.byCol.get('D');
    const origECell = hdrRow.byCol.get('E');

    const hdrStyle = origBCell?.style ?? origECell?.style ?? '0';
    const dHdrStyle = origDCell?.style ?? origCCell?.style ?? hdrStyle;
    const origProdHeader = normHeader(origBCell?.text) ? origBCell.text : 'Color\nGrade';

    const hdrMap = new Map(hdrRow.cells.map(c => [c.col, c]));
    if (!normHeader(origACell?.text) && (hasAnyFarmInColA || /colombia|ecuador/i.test(sheetTitle))) {
      hdrMap.set('A', parseCell(makeInlineStrCell(`A${hdr}`, origACell?.style ?? hdrStyle, '농장'), sharedStrings));
    }
    hdrMap.set('B', parseCell(makeInlineStrCell(`B${hdr}`, hdrStyle, '품종'), sharedStrings));
    hdrMap.set('C', parseCell(makeInlineStrCell(`C${hdr}`, hdrStyle, origProdHeader), sharedStrings));
    hdrMap.set('D', parseCell(makeEmptyStyledCell(`D${hdr}`, dHdrStyle), sharedStrings));
    if (hasLegacyWCostGroup) hdrMap.delete('W');

    hdrRow.cells = [...hdrMap.values()].sort((a, b) => a.colIdx - b.colIdx);
    hdrRow.byCol = hdrMap;
    hdrRow.dirty = true;

    // 데이터 행(hdr+1 .. lastTableRow) B->C 이동 & B열 한글 품종 주입
    for (const row of rowEntries) {
      if (row.rowNum <= hdr || row.rowNum > lastTableRow) continue;
      const r = row.rowNum;
      const bCell = row.byCol.get('B');
      const cCell = row.byCol.get('C');
      const dCell = row.byCol.get('D');
      const wCell = hasLegacyWCostGroup ? row.byCol.get('W') : null;
      const absorbedGroup = wCell?.text ? wCell.text.trim() : '';

      const cellMap = new Map(row.cells.map(c => [c.col, c]));
      if (hasLegacyWCostGroup) cellMap.delete('W');

      const prodText = bCell?.text ?? '';
      const bHasProd = Boolean(bCell && (bCell.hasContent || prodText.trim() !== ''));
      const bStyle = bCell?.style ?? cCell?.style ?? null;
      const dStyle = dCell?.style ?? cCell?.style ?? bStyle;

      if (bHasProd || absorbedGroup) {
        const varietyKo = inferKoreanVariety(prodText, { absorbedGroup, sheetTitle });
        cellMap.set('B', parseCell(makeInlineStrCell(`B${r}`, bStyle, varietyKo), sharedStrings));
        if (bCell) {
          cellMap.set('C', parseCell(moveCellToCol(bCell, 'C', r, bStyle), sharedStrings));
        } else {
          cellMap.set('C', parseCell(makeEmptyStyledCell(`C${r}`, bStyle), sharedStrings));
        }
        cellMap.set('D', parseCell(makeEmptyStyledCell(`D${r}`, dStyle), sharedStrings));
      } else if (bCell || cCell || dCell) {
        // 빈 서식 행: C:D 병합 테두리 유지 + 숨은 잔여값 제거
        if (bCell) cellMap.set('B', parseCell(makeEmptyStyledCell(`B${r}`, bStyle), sharedStrings));
        if (cCell || bCell) cellMap.set('C', parseCell(makeEmptyStyledCell(`C${r}`, bStyle), sharedStrings));
        if (dCell) cellMap.set('D', parseCell(makeEmptyStyledCell(`D${r}`, dStyle), sharedStrings));
      }

      row.cells = [...cellMap.values()].sort((a, b) => a.colIdx - b.colIdx);
      row.byCol = cellMap;
      row.dirty = true;
    }

    // 전 행 수식 내 데이터행 B{hdr+1..lastTableRow} 참조 -> C{hdr+1..lastTableRow} 정밀 치환
    const minDataRow = hdr + 1;
    const rewriter = f => rewriteFormulaDataRowBRefs(f, minDataRow, lastTableRow, {
      absorbWGroup: hasLegacyWCostGroup,
      jGroupLabels,
    });

    for (const row of rowEntries) {
      let rowFormulaUpdated = false;
      const nextCells = row.cells.map(cell => {
        if (!cell.hasFormula || !cell.formulaText) return cell;
        const newRaw = updateCellFormulaXml(cell.raw, rewriter);
        if (newRaw === cell.raw) return cell;
        rowFormulaUpdated = true;
        return parseCell(newRaw, sharedStrings);
      });
      if (rowFormulaUpdated) {
        row.cells = nextCells;
        row.byCol = new Map(nextCells.map(c => [c.col, c]));
        row.dirty = true;
      }
    }

    // 병합 범위 B{r}:D{r} -> C{r}:D{r} 갱신
    const nextMerges = [];
    const mergeSet = new Set();
    const addMerge = ref => {
      if (!mergeSet.has(ref)) {
        mergeSet.add(ref);
        nextMerges.push(ref);
      }
    };

    for (const m of updatedMerges) {
      const bdMatch = m.match(/^B(\d+):[CD](\d+)$/);
      if (bdMatch) {
        const r1 = Number(bdMatch[1]);
        const r2 = Number(bdMatch[2]);
        if (r1 === hdr && r2 === hdr) {
          addMerge(`C${hdr}:D${hdr}`);
          continue;
        }
        if (r1 > hdr && r2 <= lastTableRow && r1 === r2) {
          addMerge(`C${r1}:D${r2}`);
          continue;
        }
      }
      addMerge(m);
    }
    addMerge(`C${hdr}:D${hdr}`);
    for (let r = hdr + 1; r <= lastTableRow; r += 1) {
      const rEntry = rowMap.get(r);
      if (rEntry && (rEntry.byCol.get('C') || r <= lastActiveRow)) {
        addMerge(`C${r}:D${r}`);
      }
    }
    updatedMerges = nextMerges;

    // B열(품종) 및 C열(품목명) 가독 폭 보강 (E열 이후 폭 절대 무수정)
    const updatedCols = ensureColWidths(buckets.get('cols')?.[0] || '', { 2: 12.5, 3: 22 });
    buckets.set('cols', [updatedCols]);
  }

  // 직렬화된 <sheetData> 갱신
  const serializedRows = rowEntries.map(row => {
    if (!row.dirty) return row.raw;
    const inner = row.cells.map(c => c.raw).join('');
    return `<row${row.attrs}>${inner}</row>`;
  }).join('');
  buckets.set('sheetData', [`<sheetData>${serializedRows}</sheetData>`]);

  // <mergeCells> 갱신
  if (updatedMerges.length > 0) {
    buckets.set('mergeCells', [`<mergeCells count="${updatedMerges.length}">${updatedMerges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`]);
  } else {
    buckets.delete('mergeCells');
  }

  // <autoFilter> 범위 산정 (품종 열이 반드시 포함되도록 A{hdr} 또는 B{hdr}부터 시작)
  const finalHdrRow = rowMap.get(hdr);
  const hasAHeader = Boolean(normHeader(finalHdrRow?.byCol.get('A')?.text));
  const filterStartCol = hasAHeader || varietyColOnHeader === 'A' ? 'A' : 'B';

  let maxFilterColIdx = 22; // 기본 V열
  if (finalHdrRow) {
    for (const c of finalHdrRow.cells) {
      if (c.colIdx >= 5 && c.colIdx <= 26 && normHeader(c.text)) {
        maxFilterColIdx = Math.max(maxFilterColIdx, c.colIdx);
      }
    }
  }
  for (const nearRowNum of [hdr - 2, hdr - 1]) {
    const nearRow = rowMap.get(nearRowNum);
    if (!nearRow) continue;
    for (const c of nearRow.cells) {
      if (c.colIdx >= 20 && c.colIdx <= 24 && /종이익|총이익|판매가/.test(normHeader(c.text))) {
        maxFilterColIdx = Math.max(maxFilterColIdx, c.colIdx);
      }
    }
  }
  const filterEndCol = idxToCol(maxFilterColIdx);
  const autoFilterEndRow = Math.max(hdr, lastFilterRow);
  const autoFilterRef = `${filterStartCol}${hdr}:${filterEndCol}${autoFilterEndRow}`;
  buckets.set('autoFilter', [`<autoFilter ref="${autoFilterRef}"/>`]);

  // 가로·세로 동시 Freeze Panes (<sheetViews>) 주입
  let xSplit = 4;
  if (!canSplitBD) {
    if (alreadyHasVariety) {
      const existingPane = existingViewsXml.match(/<pane\b[^>]*\bxSplit="(\d+)"/);
      if (existingPane && Number(existingPane[1]) > 0) {
        xSplit = Number(existingPane[1]);
      } else {
        const qtyCell = finalHdrRow?.cells.find(c => c.colIdx >= 3 && c.colIdx <= 7 && QTY_RE.test(normHeader(c.text)));
        xSplit = qtyCell ? Math.max(2, qtyCell.colIdx - 1) : 4;
      }
    } else {
      const qtyCell = finalHdrRow?.cells.find(c => c.colIdx >= 3 && c.colIdx <= 7 && QTY_RE.test(normHeader(c.text)));
      xSplit = qtyCell ? Math.max(2, qtyCell.colIdx - 1) : 4;
    }
  }
  const freezeCol = idxToCol(xSplit + 1);
  const ySplit = hdr;
  const topLeftCell = `${freezeCol}${hdr + 1}`;
  const sheetTopLeft = hdr > 18 ? `A${Math.max(1, hdr - 10)}` : 'A1';
  buckets.set('sheetViews', [buildFrozenSheetViews(existingViewsXml, { xSplit, ySplit, topLeftCell, sheetTopLeft })]);

  // <dimension> 최소 범위 보정
  const dimXml = buckets.get('dimension')?.[0];
  if (dimXml) {
    const dm = dimXml.match(/\bref="([A-Z]+\d+):([A-Z]+)(\d+)"/);
    if (dm) {
      const maxC = colToIdx(dm[2]) >= maxFilterColIdx ? dm[2] : filterEndCol;
      const maxR = Math.max(Number(dm[3]), lastTableRow);
      buckets.set('dimension', [`<dimension ref="${dm[1]}:${maxC}${maxR}"/>`]);
    }
  } else {
    buckets.set('dimension', [`<dimension ref="A1:${filterEndCol}${Math.max(hdr + 1, lastTableRow)}"/>`]);
  }

  const nextXml = assembleWorksheetXml(xmlProlog, wsOpenTag, buckets);
  return {
    xml: nextXml,
    changed: nextXml !== sheetXml,
    upgraded: true,
    autoFilterRef,
    mode: canSplitBD ? 'split-bd-variety-freeze' : 'freeze-autofilter-only',
  };
}

function quoteSheetForFormula(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function absRangeFromAutoFilterRef(autoFilterRef) {
  const m = String(autoFilterRef || '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  return `$${m[1]}$${m[2]}:$${m[3]}$${m[4]}`;
}

/**
 * 누적 원가 통합문서(.xlsx Buffer) 전체를 순회하며:
 * 1) 비차수 부가 시트(원본수식 비교, 원본 양식 계산, 주광·기타 비교, 예시 등)를 자동 제거하고
 * 2) 모든 기존 차수 시트에 품종(B열) + 품종▼ AutoFilter + 가로·세로 Freeze Panes를 무손실 적용한다.
 */
export async function upgradeLegacyCostWorkbook(workbookBuffer) {
  if (!workbookBuffer || !workbookBuffer.length) {
    return { buffer: workbookBuffer, changed: false, removedSheets: [], upgradedSheets: [], sheetNames: [] };
  }
  const zip = await JSZip.loadAsync(workbookBuffer);
  const wbFile = zip.file('xl/workbook.xml');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const typesFile = zip.file('[Content_Types].xml');
  if (!wbFile || !relsFile || !typesFile) {
    return { buffer: workbookBuffer, changed: false, removedSheets: [], upgradedSheets: [], sheetNames: [] };
  }

  let wbXml = await wbFile.async('string');
  let relsXml = await relsFile.async('string');
  let typesXml = await typesFile.async('string');
  const ssXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '';
  const sharedStrings = ssXml ? parseSharedStrings(ssXml) : [];

  const relMap = new Map();
  for (const rm of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const tag = rm[0];
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) {
      const normPath = target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
      relMap.set(id, { tag, target, normPath });
    }
  }

  const sheetMatches = [...wbXml.matchAll(/<sheet\b[^>]*?\/>/g)].map((m, origIdx) => {
    const tag = m[0];
    const name = unxml(tag.match(/\bname="([^"]*)"/)?.[1] || '');
    const rid = tag.match(/\br:id="([^"]+)"/)?.[1] || '';
    const sheetId = Number(tag.match(/\bsheetId="(\d+)"/)?.[1] || origIdx + 1);
    return { origIdx, tag, name, rid, sheetId, rel: relMap.get(rid) };
  });

  if (!sheetMatches.length) {
    return { buffer: workbookBuffer, changed: false, removedSheets: [], upgradedSheets: [], sheetNames: [] };
  }

  const candidateKept = sheetMatches.filter(s => !isAuxiliaryNonWeekSheetName(s.name));
  const keptSheets = candidateKept.length > 0 ? candidateKept : sheetMatches;
  const keptSet = new Set(keptSheets.map(s => s.origIdx));
  const removedSheets = sheetMatches.filter(s => !keptSet.has(s.origIdx));

  const oldIdxToNewIdx = new Map();
  keptSheets.forEach((s, newIdx) => oldIdxToNewIdx.set(s.origIdx, newIdx));

  let anySheetChanged = removedSheets.length > 0;
  const upgradedSheets = [];
  const autoFilterByNewIdx = new Map();

  // 제거 대상 비차수 시트 파일 및 관계 정리
  for (const rem of removedSheets) {
    if (rem.rel) {
      const partPath = rem.rel.normPath;
      zip.remove(partPath);
      const sheetRelsPath = partPath.replace(/^xl\/worksheets\/([^/]+)$/, 'xl/worksheets/_rels/$1.rels');
      if (sheetRelsPath !== partPath) zip.remove(sheetRelsPath);
      relsXml = relsXml.replace(rem.rel.tag, '');
      const escapedPart = `/${partPath}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      typesXml = typesXml.replace(new RegExp(`<Override\\b[^>]*PartName="${escapedPart}"[^>]*\\/>`, 'g'), '');
    }
  }

  // 유지되는 모든 차수 시트에 무손실 OOXML 업그레이드 실행
  for (let newIdx = 0; newIdx < keptSheets.length; newIdx += 1) {
    const s = keptSheets[newIdx];
    if (!s.rel || !zip.file(s.rel.normPath)) continue;
    const origSheetXml = await zip.file(s.rel.normPath).async('string');
    const up = upgradeLegacyCostSheetXml(origSheetXml, { sharedStrings, sheetName: s.name });
    if (up.autoFilterRef) autoFilterByNewIdx.set(newIdx, up.autoFilterRef);
    if (up.changed) {
      zip.file(s.rel.normPath, up.xml);
      anySheetChanged = true;
      upgradedSheets.push(s.name);
    }
  }

  if (!anySheetChanged) {
    return {
      buffer: workbookBuffer,
      changed: false,
      removedSheets: [],
      upgradedSheets: [],
      sheetNames: keptSheets.map(s => s.name),
    };
  }

  // workbook.xml <sheets> 재구성
  wbXml = wbXml.replace(/<sheets>[\s\S]*?<\/sheets>/, () => `<sheets>${keptSheets.map(s => s.tag).join('')}</sheets>`);

  // workbook.xml <definedNames> localSheetId 재매핑 + _FilterDatabase 최신화 + 제거 시트 참조 삭제
  const removedNamesSet = new Set(removedSheets.map(s => s.name));
  if (/<definedNames>[\s\S]*?<\/definedNames>/.test(wbXml)) {
    wbXml = wbXml.replace(/<definedNames>([\s\S]*?)<\/definedNames>/, (_, inner) => {
      const nextDefined = [];
      for (const dm of inner.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
        let dAttrs = dm[1];
        let dBody = dm[2];
        const decodedBody = unxml(dBody);
        const refsRemovedSheet = [...removedNamesSet].some(rn => decodedBody.includes(`${quoteSheetForFormula(rn)}!`) || decodedBody.startsWith(`${rn}!`));
        if (refsRemovedSheet) continue;

        const localMatch = dAttrs.match(/\blocalSheetId="(\d+)"/);
        if (localMatch) {
          const oldLocal = Number(localMatch[1]);
          if (!oldIdxToNewIdx.has(oldLocal)) continue;
          const newLocal = oldIdxToNewIdx.get(oldLocal);
          dAttrs = dAttrs.replace(/\blocalSheetId="\d+"/, `localSheetId="${newLocal}"`);
          const dName = dAttrs.match(/\bname="([^"]+)"/)?.[1] || '';
          if (dName === '_xlnm._FilterDatabase' && autoFilterByNewIdx.has(newLocal)) {
            const absRange = absRangeFromAutoFilterRef(autoFilterByNewIdx.get(newLocal));
            if (absRange) {
              dBody = escXml(`${quoteSheetForFormula(keptSheets[newLocal].name)}!${absRange}`);
            }
          }
        }
        nextDefined.push(`<definedName${dAttrs}>${dBody}</definedName>`);
      }
      return nextDefined.length ? `<definedNames>${nextDefined.join('')}</definedNames>` : '';
    });
  }

  // activeTab 범위 보정
  const curActive = Number(wbXml.match(/\bactiveTab="(\d+)"/)?.[1] || 0);
  const mappedActive = oldIdxToNewIdx.has(curActive)
    ? oldIdxToNewIdx.get(curActive)
    : Math.min(curActive, Math.max(0, keptSheets.length - 1));
  if (/\bactiveTab="\d+"/.test(wbXml)) {
    wbXml = wbXml.replace(/\bactiveTab="\d+"/, `activeTab="${mappedActive}"`);
  }

  // 수식 캐시 체인(calcChain.xml) 정리 및 fullCalcOnLoad 보장
  zip.remove('xl/calcChain.xml');
  relsXml = relsXml.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/?>/g, '');
  typesXml = typesXml.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, '');
  if (/<calcPr\b/.test(wbXml)) {
    if (!/\bfullCalcOnLoad="1"/.test(wbXml)) {
      wbXml = /\bfullCalcOnLoad="[^"]*"/.test(wbXml)
        ? wbXml.replace(/\bfullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"')
        : wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
    }
  } else {
    wbXml = wbXml.replace('</workbook>', `<calcPr fullCalcOnLoad="1"/></workbook>`);
  }

  zip.file('xl/workbook.xml', wbXml);
  zip.file('xl/_rels/workbook.xml.rels', relsXml);
  zip.file('[Content_Types].xml', typesXml);

  if (zip.file('docProps/app.xml')) {
    const appXml = await zip.file('docProps/app.xml').async('string');
    zip.file(
      'docProps/app.xml',
      appXml
        .replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '')
        .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ''),
    );
  }

  const canNodeBuffer = typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function';
  const outBuffer = await zip.generateAsync({ type: canNodeBuffer ? 'nodebuffer' : 'uint8array', compression: 'DEFLATE' });
  return {
    buffer: outBuffer,
    changed: true,
    removedSheets: removedSheets.map(s => s.name),
    upgradedSheets,
    sheetNames: keptSheets.map(s => s.name),
  };
}
