import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { mergeCostSheetIntoMaster, validSheetName } from '../lib/costWorkbookMerge.js';

// 합성 누적 통합문서: 서로 다른 스타일을 가진 과거 차수 시트 2장.
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const stylesOf = (color, fmt) => `<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="${fmt}"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="${color}"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${color}"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><dxfs count="1"><dxf><font><b/></font></dxf></dxfs></styleSheet>`;
const sheetOf = (text, selected) => `<worksheet xmlns="${NS}"><sheetViews><sheetView ${selected ? 'tabSelected="1" ' : ''}workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>${text}</t></is></c><c r="B1" s="1"><v>1.5</v></c></row></sheetData><conditionalFormatting sqref="B1"><cfRule type="expression" dxfId="0" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting></worksheet>`;
async function masterBuffer() {
  const zip = new JSZip();
  const sheetCt = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${sheetCt}"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${sheetCt}"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${R}"><bookViews><workbookView activeTab="1"/></bookViews><sheets><sheet name="44-1" sheetId="1" r:id="rId1"/><sheet name="45-1" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="${R}/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/><Relationship Type="${R}/worksheet" Target="/xl/worksheets/sheet2.xml" Id="rId2"/><Relationship Type="${R}/styles" Target="/xl/styles.xml" Id="rId3"/></Relationships>`);
  zip.file('xl/styles.xml', stylesOf('FFFF0000', '0.00'));
  zip.file('xl/worksheets/sheet1.xml', sheetOf('old44', false));
  zip.file('xl/worksheets/sheet2.xml', sheetOf('old45', true));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('새 차수 시트는 덧붙고 과거 시트는 그대로 남는다', async () => {
  const master = await masterBuffer();
  const out = await mergeCostSheetIntoMaster({ masterBuffer: master, sheetXml: sheetOf('new46', true),
    sourceStyles: stylesOf('FF00FF00', '#,##0'), sheetName: '46-1' });
  assert.equal(out.replaced, false); assert.equal(out.sheetCount, 3);
  const wb = XLSX.read(out.buffer);
  assert.deepEqual(wb.SheetNames, ['44-1', '45-1', '46-1']);
  assert.equal(wb.Sheets['44-1'].A1.v, 'old44'); assert.equal(wb.Sheets['45-1'].A1.v, 'old45'); assert.equal(wb.Sheets['46-1'].A1.v, 'new46');
  const zip = await JSZip.loadAsync(out.buffer);
  assert.equal(await zip.file('xl/worksheets/sheet1.xml').async('string'), sheetOf('old44', false));
  // 기존 시트는 탭 선택 표시(tabSelected)만 해제되고 나머지는 바이트 그대로다.
  assert.equal(await zip.file('xl/worksheets/sheet2.xml').async('string'), sheetOf('old45', true).replace('tabSelected="1"', 'tabSelected="0"'));
  // 새 시트의 s="1"은 마스터 뒤쪽 새 번호(3)로 옮겨지고, 과거 시트의 s="1"은 그대로다.
  const added = await zip.file('xl/worksheets/sheet3.xml').async('string');
  assert.match(added, /r="A1" s="3"/); assert.match(added, /dxfId="1"/);
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.match(styles, /<cellXfs count="4">/); assert.match(styles, /formatCode="#,##0"/); assert.match(styles, /FF00FF00/);
  assert.match(await zip.file('xl/workbook.xml').async('string'), /activeTab="2"/);
});

test('같은 이름의 시트는 그 자리에서 교체되고 시트 수는 늘지 않는다', async () => {
  const master = await masterBuffer();
  const out = await mergeCostSheetIntoMaster({ masterBuffer: master, sheetXml: sheetOf('redo45', true), sourceStyles: stylesOf('FF0000FF', '0.0'), sheetName: '45-1' });
  assert.equal(out.replaced, true); assert.equal(out.sheetCount, 2);
  const wb = XLSX.read(out.buffer);
  assert.deepEqual(wb.SheetNames, ['44-1', '45-1']); assert.equal(wb.Sheets['45-1'].A1.v, 'redo45'); assert.equal(wb.Sheets['44-1'].A1.v, 'old44');
});

test('공유 문자열 시트·잘못된 시트 이름은 거부한다', async () => {
  const master = await masterBuffer();
  await assert.rejects(mergeCostSheetIntoMaster({ masterBuffer: master, sheetXml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>', sourceStyles: stylesOf('FF000000', '0'), sheetName: '46-1' }));
  assert.equal(validSheetName('a/b'), false); assert.equal(validSheetName('45-1'), true);
});

const SAMPLE = 'C:/Users/USER/Downloads/45-1 콜카장 원가자료.xlsx';
test('실제 누적 파일(45-1 콜카장)에 다음 차수를 붙여도 기존 47개 시트가 그대로 유지된다', { skip: !fs.existsSync(SAMPLE) }, async () => {
  const master = fs.readFileSync(SAMPLE);
  const out = await mergeCostSheetIntoMaster({ masterBuffer: master, sheetXml: sheetOf('new46', true), sourceStyles: stylesOf('FF00FF00', '#,##0'), sheetName: '46-1' });
  const before = XLSX.read(master), after = XLSX.read(out.buffer);
  assert.equal(after.SheetNames.length, before.SheetNames.length + 1);
  assert.deepEqual(after.SheetNames.slice(0, -1), before.SheetNames); assert.equal(after.SheetNames.at(-1), '46-1');
  for (const name of before.SheetNames) assert.equal(JSON.stringify(after.Sheets[name]), JSON.stringify(before.Sheets[name]), name);
});
