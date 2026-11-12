import JSZip from 'jszip';

// 누적 도착원가 통합문서(차수별 시트)에 새 차수 시트를 덧붙이는 병합 엔진.
// - 기존 시트 XML은 한 글자도 바꾸지 않는다(탭 선택 표시만 해제).
// - 새 시트의 스타일(s=)은 마스터 styles.xml 뒤에 덧붙이고 번호만 옮긴다.
// - 같은 이름의 시트가 이미 있으면 그 자리의 내용만 교체한다.
// - 새 시트는 inlineStr 문자열만 쓰는 시트여야 한다(sharedStrings 미사용).
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const xmlAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unxml = value => String(value).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const fail = message => { throw Object.assign(new Error(message), { statusCode: 422 }); };

export function validSheetName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 31 && !/[\\/?*[\]:]/.test(name);
}

// <tag count="n">...</tag> 블록의 자식 요소 목록(문자열)을 꺼낸다.
function blockOf(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`));
  return match ? { whole: match[0], attrs: match[1], inner: match[2] || '' } : null;
}
function childrenOf(inner, child) {
  return inner.match(new RegExp(`<${child}\\b[^>]*?(?:/>|>[\\s\\S]*?</${child}>)`, 'g')) || [];
}
function setBlock(xml, tag, children, beforeTags) {
  const found = blockOf(xml, tag);
  const body = `<${tag} count="${children.length}">${children.join('')}</${tag}>`;
  if (found) return xml.replace(found.whole, () => body);
  for (const next of beforeTags) {
    const at = xml.search(new RegExp(`<${next}\\b`));
    if (at >= 0) return `${xml.slice(0, at)}${body}${xml.slice(at)}`;
  }
  return xml.replace('</styleSheet>', `${body}</styleSheet>`);
}

/** source 스타일을 master 스타일 끝에 덧붙이고 { styles, map(sourceXfIndex→masterXfIndex), dxfOffset } 를 돌려준다. */
export function mergeStyles(masterStyles, sourceStyles) {
  let styles = masterStyles;
  const pick = (xml, tag, child) => { const b = blockOf(xml, tag); return b ? childrenOf(b.inner, child) : []; };
  const mFonts = pick(styles, 'fonts', 'font'), sFonts = pick(sourceStyles, 'fonts', 'font');
  const mFills = pick(styles, 'fills', 'fill'), sFills = pick(sourceStyles, 'fills', 'fill');
  const mBorders = pick(styles, 'borders', 'border'), sBorders = pick(sourceStyles, 'borders', 'border');
  const mXfs = pick(styles, 'cellXfs', 'xf'), sXfs = pick(sourceStyles, 'cellXfs', 'xf');
  const mDxfs = pick(styles, 'dxfs', 'dxf'), sDxfs = pick(sourceStyles, 'dxfs', 'dxf');
  if (!mXfs.length || !sXfs.length) fail('통합문서 스타일을 읽지 못했습니다.');

  // 사용자 지정 숫자 서식(164+)은 서식 문자열 기준으로 재사용하거나 새 번호를 준다.
  const mFmts = new Map(pick(styles, 'numFmts', 'numFmt').map(f => [unxml(f.match(/formatCode="([^"]*)"/)?.[1] ?? ''), Number(f.match(/numFmtId="(\d+)"/)[1])]));
  let nextFmt = Math.max(163, ...mFmts.values()) + 1;
  const fmtMap = new Map(), addedFmts = [];
  for (const f of pick(sourceStyles, 'numFmts', 'numFmt')) {
    const id = Number(f.match(/numFmtId="(\d+)"/)[1]), code = unxml(f.match(/formatCode="([^"]*)"/)?.[1] ?? '');
    if (mFmts.has(code)) { fmtMap.set(id, mFmts.get(code)); continue; }
    fmtMap.set(id, nextFmt); mFmts.set(code, nextFmt);
    addedFmts.push(`<numFmt numFmtId="${nextFmt}" formatCode="${xmlAttr(code)}"/>`); nextFmt += 1;
  }
  const shift = (xf, attr, offset) => xf.replace(new RegExp(`${attr}="(\\d+)"`), (_, n) => `${attr}="${Number(n) + offset}"`);
  const newXfs = sXfs.map(xf => {
    let out = shift(shift(shift(xf, 'fontId', mFonts.length), 'fillId', mFills.length), 'borderId', mBorders.length);
    out = out.replace(/numFmtId="(\d+)"/, (_, n) => `numFmtId="${fmtMap.get(Number(n)) ?? Number(n)}"`);
    out = out.replace(/xfId="\d+"/, 'xfId="0"');
    return out;
  });
  const offset = mXfs.length;
  const old = pick(styles, 'numFmts', 'numFmt');
  if (addedFmts.length) styles = setBlock(styles, 'numFmts', [...old, ...addedFmts], ['fonts']);
  styles = setBlock(styles, 'fonts', [...mFonts, ...sFonts], ['fills']);
  styles = setBlock(styles, 'fills', [...mFills, ...sFills], ['borders']);
  styles = setBlock(styles, 'borders', [...mBorders, ...sBorders], ['cellStyleXfs', 'cellXfs']);
  styles = setBlock(styles, 'cellXfs', [...mXfs, ...newXfs], ['cellStyles', 'dxfs', 'tableStyles']);
  if (sDxfs.length) styles = setBlock(styles, 'dxfs', [...mDxfs, ...sDxfs], ['tableStyles', 'colors', 'extLst']);
  const map = index => index + offset;
  return { styles, map, dxfOffset: mDxfs.length };
}

function remapSheetStyles(sheetXml, map, dxfOffset) {
  return sheetXml
    .replace(/(<c\b[^>]*?\ss=")(\d+)(")/g, (_, a, n, z) => `${a}${map(Number(n))}${z}`)
    .replace(/(<row\b[^>]*?\ss=")(\d+)(")/g, (_, a, n, z) => `${a}${map(Number(n))}${z}`)
    .replace(/(<col\b[^>]*?\sstyle=")(\d+)(")/g, (_, a, n, z) => `${a}${map(Number(n))}${z}`)
    .replace(/(<cfRule\b[^>]*?\sdxfId=")(\d+)(")/g, (_, a, n, z) => `${a}${Number(n) + dxfOffset}${z}`)
    .replace(/tabSelected="1"/g, 'tabSelected="0"');
}

/**
 * @param {Buffer|null} masterBuffer 기존 누적 통합문서(없으면 새 통합문서로 시작)
 * @param {string} sheetXml 새 차수 시트 XML (inlineStr 사용)
 * @param {string} sourceStyles 새 시트가 쓰는 styles.xml
 * @param {string} sheetName 새 시트 이름(예: "45-1")
 */
export async function mergeCostSheetIntoMaster({ masterBuffer, sheetXml, sourceStyles, sheetName }) {
  if (!validSheetName(sheetName)) fail('시트 이름이 올바르지 않습니다.');
  if (/<c\b[^>]*\bt="s"/.test(sheetXml)) fail('공유 문자열을 쓰는 시트는 병합할 수 없습니다.');
  if (!masterBuffer) fail('누적 통합문서가 필요합니다.');
  const zip = await JSZip.loadAsync(masterBuffer);
  const read = async name => { const f = zip.file(name); if (!f) fail(`통합문서 구성요소가 없습니다: ${name}`); return f.async('string'); };
  let workbook = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  let types = await read('[Content_Types].xml');
  const stylesXml = await read('xl/styles.xml');

  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m => ({
    tag: m[0], name: unxml(m[0].match(/\bname="([^"]*)"/)[1]), sheetId: Number(m[0].match(/\bsheetId="(\d+)"/)[1]),
    rid: m[0].match(/\br:id="([^"]+)"/)[1],
  }));
  if (!sheets.length) fail('통합문서에 시트가 없습니다.');
  const relTarget = rid => {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/?>`));
    if (!rel) fail('시트 연결 정보를 찾지 못했습니다.');
    return rel[0].match(/Target="([^"]+)"/)[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  };

  const merged = mergeStyles(stylesXml, sourceStyles);
  const newSheet = remapSheetStyles(sheetXml, merged.map, merged.dxfOffset)
    .replace(/<sheetView\b(?![^>]*tabSelected)/, '<sheetView tabSelected="1"');
  zip.file('xl/styles.xml', merged.styles);

  // 기존 시트는 탭 선택 표시만 해제한다.
  for (const sheet of sheets) {
    const path = relTarget(sheet.rid), body = await read(path);
    if (/tabSelected="1"/.test(body)) zip.file(path, body.replace(/tabSelected="1"/g, 'tabSelected="0"'));
  }

  const existing = sheets.find(sheet => sheet.name === sheetName);
  let index;
  if (existing) {
    zip.file(relTarget(existing.rid), newSheet); index = sheets.indexOf(existing);
  } else {
    let n = 1; while (zip.file(`xl/worksheets/sheet${n}.xml`)) n += 1;
    const path = `xl/worksheets/sheet${n}.xml`;
    let r = 1; while (new RegExp(`\\bId="rId${r}"`).test(rels)) r += 1;
    const rid = `rId${r}`, sheetId = Math.max(...sheets.map(s => s.sheetId)) + 1;
    zip.file(path, newSheet);
    rels = rels.replace('</Relationships>', `<Relationship Type="${REL_NS}/worksheet" Target="/${path}" Id="${rid}"/></Relationships>`);
    types = types.replace('</Types>', `<Override PartName="/${path}" ContentType="${SHEET_CT}"/></Types>`);
    workbook = workbook.replace('</sheets>', `<sheet name="${xmlAttr(sheetName)}" sheetId="${sheetId}" state="visible" r:id="${rid}"/></sheets>`);
    index = sheets.length;
  }
  workbook = /activeTab="\d+"/.test(workbook) ? workbook.replace(/activeTab="\d+"/, `activeTab="${index}"`)
    : workbook.replace(/<workbookView\b/, `<workbookView activeTab="${index}"`);
  if (!/fullCalcOnLoad/.test(workbook)) workbook = workbook.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  zip.file('xl/workbook.xml', workbook); zip.file('xl/_rels/workbook.xml.rels', rels); zip.file('[Content_Types].xml', types);
  // 시트 이름 목록이 바뀌었으므로 docProps/app.xml의 제목 목록은 Excel이 다시 만들도록 제거한다.
  if (zip.file('docProps/app.xml')) {
    const app = await zip.file('docProps/app.xml').async('string');
    zip.file('docProps/app.xml', app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '').replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ''));
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), replaced: Boolean(existing), sheetCount: existing ? sheets.length : sheets.length + 1 };
}

/** 생성된 통합문서(zip)에서 지정 시트의 XML과 styles.xml을 꺼낸다. */
export async function extractSheet(workbookBuffer, sheetName) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  const workbook = await zip.file('xl/workbook.xml').async('string'), rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const tag = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]).find(t => unxml(t.match(/\bname="([^"]*)"/)[1]) === sheetName);
  if (!tag) fail(`시트를 찾지 못했습니다: ${sheetName}`);
  const rid = tag.match(/\br:id="([^"]+)"/)[1];
  const target = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/?>`))[0].match(/Target="([^"]+)"/)[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  return { sheetXml: await zip.file(target).async('string'), sourceStyles: await zip.file('xl/styles.xml').async('string') };
}
