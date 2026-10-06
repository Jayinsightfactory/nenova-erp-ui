import JSZip from 'jszip';
import { dutchEntryPrice } from './dutchVolumePrice.js';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sheetPathMap(workbookXml, relsXml) {
  const rels = new Map([...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)].map(match => [match[1], match[2]]));
  const map = new Map();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target = rels.get(match[2]);
    if (target) map.set(match[1].replace(/&amp;/g, '&'), `xl/${target.replace(/^\/?xl\//, '')}`);
  }
  return map;
}

function nextRelId(xml) {
  const ids = [...String(xml || '').matchAll(/Id="rId(\d+)"/g)].map(match => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
}

function shapeXml(shape, index) {
  const price = Number(shape.price).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const emuPerPx = 9525;
  const left = Math.round(Math.max(0, shape.leftPx || 0) * emuPerPx);
  const right = Math.round(Math.max(1, (shape.leftPx || 0) + (shape.widthPx || 1)) * emuPerPx);
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${shape.col}</xdr:col><xdr:colOff>${left}</xdr:colOff><xdr:row>${shape.row}</xdr:row><xdr:rowOff>190500</xdr:rowOff></xdr:from><xdr:to><xdr:col>${shape.col}</xdr:col><xdr:colOff>${right}</xdr:colOff><xdr:row>${shape.row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="${index + 2}" name="Price ${index + 1}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFDF8"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="C0504D"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr wrap="none" anchor="ctr" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" sz="800" b="1"/><a:t>${esc(price)}</a:t></a:r><a:endParaRPr lang="ko-KR" sz="800"/></a:p><a:endParaRPr lang="ko-KR" sz="800"/></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

export async function addDutchPriceShapesToXlsx(XLSX, buffer, workbook, entries, prices, bulkConfig) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const paths = sheetPathMap(workbookXml, workbookRels);
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  let drawingNo = 1;
  while (zip.file(`xl/drawings/drawing${drawingNo}.xml`)) drawingNo += 1;

  for (const [sheetName, sheetPath] of paths) {
    const sheet = workbook?.Sheets?.[sheetName];
    if (!sheet) continue;
    const shapes = (entries || []).filter(entry => entry.sheetName === sheetName && dutchEntryPrice(entry, prices, bulkConfig) > 0).map(entry => {
      const { r: row, c: col } = XLSX.utils.decode_cell(entry.cellAddress);
      const price = dutchEntryPrice(entry, prices, bulkConfig);
      const wch = Number(sheet['!cols']?.[col]?.wch || 0);
      const cellWidthPx = wch > 0 ? Math.max(24, Math.round(wch * 7 + 5)) : 68;
      const labelWidthPx = Math.min(cellWidthPx - 2, Math.max(30, Math.ceil(String(price).length * 5.8 + 10)));
      return { row, col, price, widthPx: labelWidthPx, leftPx: Math.max(0, (cellWidthPx - labelWidthPx) / 2) };
    });
    if (!shapes.length) continue;

    const drawingPath = `xl/drawings/drawing${drawingNo}.xml`;
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${shapes.map(shapeXml).join('')}</xdr:wsDr>`;
    zip.file(drawingPath, drawingXml);

    const sheetFile = zip.file(sheetPath);
    let sheetXml = await sheetFile.async('string');
    const sheetBase = sheetPath.split('/').pop();
    const relPath = `xl/worksheets/_rels/${sheetBase}.rels`;
    let relXml = zip.file(relPath) ? await zip.file(relPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const relId = nextRelId(relXml);
    relXml = relXml.replace('</Relationships>', `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`);
    zip.file(relPath, relXml);
    sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${relId}"/></worksheet>`);
    zip.file(sheetPath, sheetXml);
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    drawingNo += 1;
  }
  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
