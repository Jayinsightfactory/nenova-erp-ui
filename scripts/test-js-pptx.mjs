import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const refDir = '_catalog-ref-browser';
const pptx = fs.readdirSync(refDir).find(f => f.endsWith('.pptx'));
const buf = fs.readFileSync(path.join(refDir, pptx));

const zip = await JSZip.loadAsync(buf);
const slideFiles = Object.keys(zip.files)
  .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
  .sort((a, b) => parseInt(a.match(/slide(\d+)/i)[1], 10) - parseInt(b.match(/slide(\d+)/i)[1], 10));

let total = 0;
for (const slidePath of slideFiles) {
  const slideNo = slidePath.match(/slide(\d+)/i)[1];
  const relPath = `ppt/slides/_rels/slide${slideNo}.xml.rels`;
  const slideXml = await zip.file(slidePath).async('string');
  const relXml = zip.file(relPath) ? await zip.file(relPath).async('string') : '';
  const mediaMap = {};
  for (const m of relXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
    mediaMap[m[1]] = m[2].replace(/^\.\.\//, 'ppt/');
  }
  const texts = [];
  for (const m of slideXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
    const t = m[1].trim();
    if (t && t.length > 1 && !/^NENOVA$/i.test(t)) texts.push(t);
  }
  let imgs = 0;
  for (const m of slideXml.matchAll(/r:embed="([^"]+)"/g)) {
    const rel = mediaMap[m[1]];
    if (rel && /media\//i.test(rel)) {
      const f = zip.file(rel);
      if (f) {
        const b = await f.async('nodebuffer');
        if (b.length > 2000) imgs++;
      }
    }
  }
  total += Math.min(texts.length, imgs);
}
console.log('JS extract estimate:', total, 'slides:', slideFiles.length, 'file:', pptx);
