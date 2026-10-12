/* Mechanical, read-only extraction of formatting. No original cell values enter the asset. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const HASH = 'e1bb0315998c2f3550a0edab8353147612cd6c46d7247b287656eca1c3ee4233';
const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`))?.[0] || '';
async function main() {
  const source = process.argv[2] || 'C:/Users/USER/Downloads/CHINA 중국 원가자료 (8).xlsx';
  const bytes = fs.readFileSync(source);
  if (createHash('sha256').update(bytes).digest('hex') !== HASH) throw new Error('Unverified template source');
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const sheet = workbook.match(/<sheet\b[^>]*name="27-2 CLOUD"[^>]*\/>/)[0];
  const id = sheet.match(/r:id="([^"]+)"/)[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).find(r => r.includes(`Id="${id}"`));
  const target = rel.match(/Target="([^"]+)"/)[1];
  const xml = await zip.file(`xl/${target}`).async('string');
  const rows = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map(([, attrs, cells]) => ({
    attrs: attrs.replace(/\s(?:spans|xr:uid)="[^"]*"/g, ''),
    cells: [...cells.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(([, a]) => ({
      ref: a.match(/\br="([^"]+)"/)[1], style: a.match(/\bs="(\d+)"/)?.[1] || '0',
    })),
  }));
  const asset = { schemaVersion: 1, profileId: 'CN_AIR_ORIGINAL_V1', profileVersion: '1.0.0', sourceHash: HASH, sourceSheet: '27-2 CLOUD',
    styles: await zip.file('xl/styles.xml').async('string'), theme: await zip.file('xl/theme/theme1.xml').async('string'),
    sheetViews: tag(xml, 'sheetViews'), sheetFormatPr: tag(xml, 'sheetFormatPr'), cols: tag(xml, 'cols'), rows,
    merges: [...xml.matchAll(/<mergeCell\s+ref="([^"]+)"\/>/g)].map(m => m[1]),
    print: ['printOptions', 'pageMargins', 'pageSetup'].map(name => tag(xml, name)).join(''),
    printArea: [...workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .find(([, a, value]) => a.includes('name="_xlnm.Print_Area"') && value.includes("'27-2 CLOUD'!"))?.[2]?.split('!')[1] || null,
  };
  asset.assetHash = createHash('sha256').update(JSON.stringify(asset)).digest('hex');
  const output = path.join(__dirname, '../lib/invoiceCostTemplates/china-air-v1.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(asset));
  console.log(`Sanitized format-only asset: ${output}`);
  console.log(`Asset SHA256: ${asset.assetHash}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
