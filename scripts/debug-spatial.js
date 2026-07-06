const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function main() {
  const dir = path.join(process.cwd(), '_catalog-ref-browser');
  const pptx = fs.readdirSync(dir).find(f => f.endsWith('.pptx'));
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, pptx)));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const spTree = xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
  const inner = spTree[1];
  console.log('inner len', inner.length);
  console.log('pic count', (inner.match(/<p:pic/g) || []).length);
  console.log('sp count', (inner.match(/<p:sp/g) || []).length);

  function findMatchingClose(xmlStr, tag, startIdx) {
    const openTag = `<${tag}`;
    const closeTag = `</${tag}>`;
    let depth = 0;
    let i = startIdx;
    while (i < xmlStr.length) {
      const nextOpen = xmlStr.indexOf(openTag, i + (depth === 0 && i === startIdx ? 0 : 1));
      const nextClose = xmlStr.indexOf(closeTag, i);
      if (nextClose === -1) return -1;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + openTag.length;
      } else {
        if (depth === 0) return nextClose + closeTag.length;
        depth -= 1;
        i = nextClose + closeTag.length;
      }
    }
    return -1;
  }

  const tags = ['p:sp', 'p:pic', 'p:grpSp'];
  let idx = 0;
  let n = 0;
  while (idx < inner.length && n < 5) {
    let nearest = null;
    for (const tag of tags) {
      const p = inner.indexOf(`<${tag}`, idx);
      if (p !== -1 && (nearest == null || p < nearest.pos)) nearest = { tag, pos: p };
    }
    if (!nearest) break;
    const end = findMatchingClose(inner, nearest.tag, nearest.pos);
    console.log('block', n, nearest.tag, 'pos', nearest.pos, 'end', end, 'len', end - nearest.pos);
    idx = end;
    n += 1;
  }
}

main();
