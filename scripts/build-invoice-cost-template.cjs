/* Mechanical, read-only extraction of formatting. No original cell values enter the asset. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const colombia = process.argv[3] === 'CO_42_1';
const HASH = colombia ? 'd5f71f57a93d3006bb889321d00e249592ab136b855f3f20a4b2b693f78a8da3' : 'e1bb0315998c2f3550a0edab8353147612cd6c46d7247b287656eca1c3ee4233';
const sheetName = colombia ? '42-1' : '27-2 CLOUD';
const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`))?.[0] || '';
async function main() {
  const source = process.argv[2] || 'C:/Users/USER/Downloads/CHINA 중국 원가자료 (8).xlsx';
  const bytes = fs.readFileSync(source);
  if (createHash('sha256').update(bytes).digest('hex') !== HASH) throw new Error('Unverified template source');
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m=>m[0]).find(value=>value.includes(`name="${sheetName}"`));
  const id = sheet.match(/r:id="([^"]+)"/)[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).find(r => r.includes(`Id="${id}"`));
  const target = rel.match(/Target="([^"]+)"/)[1];
  const xml = await zip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`).async('string');
  const rows = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map(([, attrs, cells]) => ({
    attrs: attrs.replace(/\s(?:spans|xr:uid)="[^"]*"/g, ''),
    cells: [...cells.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(([, a]) => ({
      ref: a.match(/\br="([^"]+)"/)[1], style: a.match(/\bs="(\d+)"/)?.[1] || '0',
    })),
  }));
  const asset = { schemaVersion: 1, profileId: colombia ? 'CO_42_1_ORIGINAL_V1' : 'CN_AIR_ORIGINAL_V1', profileVersion: '1.0.0', sourceHash: HASH, sourceSheet: sheetName,
    styles: await zip.file('xl/styles.xml').async('string'), theme: await zip.file('xl/theme/theme1.xml').async('string'),
    sheetViews: tag(xml, 'sheetViews'), sheetFormatPr: tag(xml, 'sheetFormatPr'), cols: tag(xml, 'cols'), rows,
    merges: [...xml.matchAll(/<mergeCell\s+ref="([^"]+)"\/>/g)].map(m => m[1]),
    print: ['printOptions', 'pageMargins', 'pageSetup'].map(name => tag(xml, name)).join(''),
    printArea: [...workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .find(([, a, value]) => a.includes('name="_xlnm.Print_Area"') && (value.includes(`'${sheetName}'!`) || value.startsWith(`${sheetName}!`)))?.[2]?.split('!')[1] || null,
  };
  asset.assetHash = createHash('sha256').update(JSON.stringify(asset)).digest('hex');
  const output = path.join(__dirname, colombia ? '../lib/invoiceCostTemplates/colombia-42-1-v1.json' : '../lib/invoiceCostTemplates/china-air-v1.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(asset));
  console.log(`Sanitized format-only asset: ${output}`);
  console.log(`Asset SHA256: ${asset.assetHash}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
