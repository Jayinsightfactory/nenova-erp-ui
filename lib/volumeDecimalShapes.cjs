'use strict';

const JSZip = require('jszip');

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const decodeXmlAttr = value => String(value ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'");

function resolveZipTarget(basePath, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function sheetPathMap(workbookXml, relsXml) {
  const rels = new Map();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = tag[0].match(/\bId="([^"]+)"/)?.[1];
    const target = tag[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target);
  }
  const map = new Map();
  for (const tag of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = tag[0].match(/\bname="([^"]+)"/)?.[1];
    const rid = tag[0].match(/\br:id="([^"]+)"/)?.[1];
    if (!name || !rid) continue;
    const target = rels.get(rid);
    if (target) map.set(decodeXmlAttr(name), resolveZipTarget('xl/workbook.xml', target));
  }
  return map;
}

function nextRelId(xml) {
  const ids = [...String(xml || '').matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
}

function maxShapeId(drawingXml) {
  const ids = [...String(drawingXml || '').matchAll(/<(?:\w+:)?cNvPr\b[^>]*\bid="(\d+)"/g)].map(m => Number(m[1]));
  return Math.max(1, ...ids);
}

function badgeAnchorXml(badge, id, idx) {
  const row = Number(badge.row);
  const fromCol = Number(badge.col);
  const widthCols = Number.isFinite(Number(badge.widthCols)) && Number(badge.widthCols) >= 1 ? Number(badge.widthCols) : 2;
  const toCol = fromCol + widthCols;
  const lines = String(badge.text ?? '').split(/\r?\n/).filter(Boolean);
  const paragraphs = (lines.length ? lines : ['']).map(line =>
    `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="ko-KR" sz="850" b="1"><a:solidFill><a:srgbClr val="78350F"/></a:solidFill><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/></a:rPr><a:t>${esc(line)}</a:t></a:r><a:endParaRPr lang="ko-KR" sz="850"/></a:p>`
  ).join('');

  return `<xdr:twoCellAnchor editAs="oneCell">`
    + `<xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>12700</xdr:rowOff></xdr:from>`
    + `<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:sp macro="">`
    + `<xdr:nvSpPr><xdr:cNvPr id="${id}" name="DecimalUnitBadge_${row}_${idx}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>`
    + `<xdr:spPr>`
    + `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 18000"/></a:avLst></a:prstGeom>`
    + `<a:solidFill><a:srgbClr val="FFFBEB"/></a:solidFill>`
    + `<a:ln w="12700"><a:solidFill><a:srgbClr val="B45309"/></a:solidFill></a:ln>`
    + `</xdr:spPr>`
    + `<xdr:txBody>`
    + `<a:bodyPr wrap="square" anchor="ctr" lIns="45720" rIns="45720" tIns="19050" bIns="19050"/>`
    + `<a:lstStyle/>`
    + paragraphs
    + `</xdr:txBody>`
    + `</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function injectDecimalUnitShapes(xlsxBuffer, sheetBadgesMap) {
  const entries = Object.entries(sheetBadgesMap || {}).filter(([, badges]) => Array.isArray(badges) && badges.length > 0);
  if (!entries.length) return xlsxBuffer;

  const zip = await JSZip.loadAsync(xlsxBuffer);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !workbookRels) return xlsxBuffer;

  const paths = sheetPathMap(workbookXml, workbookRels);
  let contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) return xlsxBuffer;

  let drawingNo = 1;
  while (zip.file(`xl/drawings/drawing${drawingNo}.xml`)) drawingNo += 1;

  let modified = false;
  for (const [sheetName, badges] of entries) {
    const sheetPath = paths.get(sheetName);
    if (!sheetPath) continue;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;

    let sheetXml = await sheetFile.async('string');
    const sheetBase = sheetPath.split('/').pop();
    const sheetDir = sheetPath.split('/').slice(0, -1).join('/');
    const relPath = `${sheetDir}/_rels/${sheetBase}.rels`;
    let relXml = zip.file(relPath)
      ? await zip.file(relPath).async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    const existingDrawingRid = sheetXml.match(/<drawing\b[^>]*\br:id="([^"]+)"[^>]*\/?>/)?.[1];
    let existingDrawingPath = '';
    if (existingDrawingRid) {
      const relTag = (relXml.match(/<Relationship\b[^>]*\/?>/g) || []).find(t => t.includes(`Id="${existingDrawingRid}"`));
      const target = relTag?.match(/\bTarget="([^"]+)"/)?.[1];
      if (target) existingDrawingPath = resolveZipTarget(sheetPath, target);
    }

    if (existingDrawingPath && zip.file(existingDrawingPath)) {
      let drawingXml = await zip.file(existingDrawingPath).async('string');
      let nextId = maxShapeId(drawingXml) + 1;
      const anchors = badges.map((badge, idx) => badgeAnchorXml(badge, nextId++, idx)).join('');
      drawingXml = drawingXml.replace('</xdr:wsDr>', `${anchors}</xdr:wsDr>`);
      zip.file(existingDrawingPath, drawingXml);
      modified = true;
      continue;
    }

    const drawingPath = `xl/drawings/drawing${drawingNo}.xml`;
    let nextId = 2;
    const anchors = badges.map((badge, idx) => badgeAnchorXml(badge, nextId++, idx)).join('');
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
    zip.file(drawingPath, drawingXml);

    const relId = nextRelId(relXml);
    relXml = relXml.replace('</Relationships>', `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`);
    zip.file(relPath, relXml);

    if (!/\bxmlns:r=/.test(sheetXml)) {
      sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    }
    const drawingTag = `<drawing r:id="${relId}"/>`;
    if (/<extLst\b/.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<extLst\b/, `${drawingTag}<extLst`);
    } else {
      sheetXml = sheetXml.replace('</worksheet>', `${drawingTag}</worksheet>`);
    }
    zip.file(sheetPath, sheetXml);

    if (!contentTypes.includes(`PartName="/${drawingPath}"`)) {
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    drawingNo += 1;
    modified = true;
  }

  if (!modified) return xlsxBuffer;
  zip.file('[Content_Types].xml', contentTypes);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = {
  injectDecimalUnitShapes,
};
