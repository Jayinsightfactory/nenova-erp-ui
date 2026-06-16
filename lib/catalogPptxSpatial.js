// PPTX 슬라이드 — app.py parse_slide() spatial image↔text 매칭 (JS fallback)

import JSZip from 'jszip';
import { splitEngKor } from './catalogUtils.js';

const EMU = 914400;
const INCHES = (n) => n * EMU;

function emuToCm(emu) {
  return (emu / EMU) * 2.54;
}

function readXfrm(block) {
  const xfrm = block.match(/<a:xfrm>([\s\S]*?)<\/a:xfrm>/);
  const src = xfrm ? xfrm[1] : block;
  const off = src.match(/<a:off[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/)
    || src.match(/<a:off[^>]*x="(-?\d+)"/);
  const ext = src.match(/<a:ext[^>]*cx="(-?\d+)"[^>]*cy="(-?\d+)"/);
  return {
    left: off ? parseInt(off[1], 10) : 0,
    top: off ? parseInt(off[2] || '0', 10) : 0,
    width: ext ? parseInt(ext[1], 10) : INCHES(2),
    height: ext ? parseInt(ext[2], 10) : INCHES(0.5),
  };
}

function cleanText(text) {
  return String(text || '')
    .replace(/_x000B_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParagraphs(block) {
  const paras = [];
  for (const pm of block.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const inner = pm[1];
    const text = [...inner.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map(m => m[1])
      .join('');
    const sizes = [...inner.matchAll(/\bsz="(\d+)"/g)].map(m => parseInt(m[1], 10) / 100);
    const maxSz = sizes.length ? Math.max(...sizes) : 0;
    const t = cleanText(text);
    if (t) paras.push({ text: t, maxSz });
  }
  return paras;
}

function extractShapeId(block) {
  const m = block.match(/<p:cNvPr[^>]*id="(\d+)"/);
  return m ? parseInt(m[1], 10) : null;
}

function isTxBox(block) {
  return /txBox="1"/.test(block) || /<p:txBody>/.test(block);
}

function extractTopLevelBlocks(xml, tag) {
  const openPrefix = `<${tag}`;
  const closeExact = `</${tag}>`;
  const blocks = [];
  let searchFrom = 0;

  while (searchFrom < xml.length) {
    let start = -1;
    for (let i = searchFrom; i < xml.length; i += 1) {
      if (!xml.startsWith(openPrefix, i)) continue;
      const next = xml[i + openPrefix.length];
      if (next === '>' || next === ' ' || next === '/') {
        start = i;
        break;
      }
    }
    if (start === -1) break;
    const closeStart = xml.indexOf(closeExact, start);
    if (closeStart === -1) break;
    const end = closeStart + closeExact.length;
    blocks.push(xml.slice(start, end));
    searchFrom = end;
  }
  return blocks;
}

function collectShapes(spTreeInner, acc = { titleCandidates: [], pictures: [], textboxes: [] }) {
  for (const block of extractTopLevelBlocks(spTreeInner, 'p:grpSp')) {
    const inner = block.match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
    if (inner) collectShapes(inner[1], acc);
  }

  for (const block of extractTopLevelBlocks(spTreeInner, 'p:pic')) {
    const xfrm = readXfrm(block);
    const embed = block.match(/r:embed="([^"]+)"/);
    acc.pictures.push({
      ...xfrm,
      embedId: embed ? embed[1] : null,
      shapeId: extractShapeId(block),
      block,
    });
  }

  for (const block of extractTopLevelBlocks(spTreeInner, 'p:sp')) {
    if (!isTxBox(block)) continue;
    const paras = extractParagraphs(block);
    if (!paras.length) continue;

    const xfrm = readXfrm(block);
    const shapeId = extractShapeId(block);
    let maxSz = 0;
    for (const p of paras) maxSz = Math.max(maxSz, p.maxSz);
    acc.titleCandidates.push({ maxSz, paras, shapeId });

    let engName = '';
    let korName = '';
    if (paras.length >= 2) {
      const a = splitEngKor(paras[0].text);
      const b = splitEngKor(paras[1].text);
      engName = a.eng || b.eng;
      korName = a.kor || b.kor;
    } else {
      const s = splitEngKor(paras[0].text);
      engName = s.eng;
      korName = s.kor;
    }

    acc.textboxes.push({
      left: xfrm.left,
      top: xfrm.top,
      width: xfrm.width,
      height: xfrm.height,
      engName,
      korName,
      shapeId,
    });
  }
  return acc;
}

function findTitleShapeId(titleCandidates) {
  if (!titleCandidates.length) return null;
  const sorted = [...titleCandidates].sort((a, b) => b.maxSz - a.maxSz);
  const best = sorted[0];
  if (best.maxSz < 18) return null;
  return best.shapeId;
}

function isLogoPicture(pic, blobLen, pxW, pxH) {
  const topCm = emuToCm(pic.top);
  const leftCm = emuToCm(pic.left);
  const wCm = emuToCm(pic.width);
  const hCm = emuToCm(pic.height);
  const pxRatio = pxW / Math.max(pxH, 1);
  const isLogoA = topCm < 3.0 && leftCm > 8.0 && pxRatio > 1.4 && blobLen < 40_000;
  const isLogoB = wCm <= 2.5 && hCm <= 1.5 && blobLen < 15_000;
  const isLogoC = pxRatio > 1.5 && hCm < 4.0 && blobLen < 20_000;
  return isLogoA || isLogoB || isLogoC;
}

function greedyImageTextPairs(pictures, textboxes) {
  const centerX = (left, width) => left + width / 2;

  const pairs = [];
  for (let ti = 0; ti < textboxes.length; ti += 1) {
    const tb = textboxes[ti];
    const tcx = centerX(tb.left, tb.width);
    const tcy = tb.top + tb.height / 2;

    for (let pi = 0; pi < pictures.length; pi += 1) {
      const pic = pictures[pi];
      const pcx = centerX(pic.left, pic.width);
      const pbot = pic.top + pic.height;

      const overlapL = Math.max(tb.left, pic.left);
      const overlapR = Math.min(tb.left + tb.width, pic.left + pic.width);
      const hasOverlap = overlapR > overlapL;

      let yDist;
      if (tcy >= pbot) yDist = tcy - pbot;
      else if (tcy <= pic.top) yDist = (pic.top - tcy) * 2.5;
      else yDist = 0;

      let xDist = Math.abs(tcx - pcx);
      if (!hasOverlap) xDist += INCHES(1.0);

      if (yDist > INCHES(3.5) || xDist > INCHES(3.0)) continue;
      pairs.push({ cost: yDist + xDist * 0.5, pi, ti });
    }
  }

  pairs.sort((a, b) => a.cost - b.cost);
  const piToTi = new Map();
  const usedTi = new Set();
  for (const { pi, ti } of pairs) {
    if (piToTi.has(pi) || usedTi.has(ti)) continue;
    piToTi.set(pi, ti);
    usedTi.add(ti);
  }
  return piToTi;
}

async function parseSlideXml(slideXml, mediaMap, zip) {
  const spTree = slideXml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
  if (!spTree) return [];

  const collected = collectShapes(spTree[1]);
  const titleShapeId = findTitleShapeId(collected.titleCandidates);

  const textboxes = collected.textboxes.filter(tb => tb.shapeId !== titleShapeId);
  const rawPictures = collected.pictures.filter(p => p.left >= 0 && p.top >= 0);

  const pictures = [];
  for (const pic of rawPictures) {
    if (!pic.embedId) continue;
    const rel = mediaMap[pic.embedId];
    if (!rel || !/media\//i.test(rel)) continue;
    const f = zip.file(rel);
    if (!f) continue;
    const blob = await f.async('nodebuffer');
    if (blob.length < 2000) continue;

    const pxW = pic.width;
    const pxH = pic.height;

    if (isLogoPicture(pic, blob.length, pxW, pxH)) continue;

    pictures.push({ ...pic, blob });
  }

  let filtered = pictures;
  if (pictures.length) {
    const maxDim = Math.max(...pictures.map(p => Math.max(emuToCm(p.width), emuToCm(p.height))));
    const threshold = maxDim * 0.20;
    filtered = pictures.filter(p => Math.max(emuToCm(p.width), emuToCm(p.height)) >= threshold);
  }

  filtered.sort((a, b) => (a.top - b.top) || (a.left - b.left));
  textboxes.sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const piToTi = greedyImageTextPairs(filtered, textboxes);

  return filtered.map((pic, pi) => {
    const ti = piToTi.get(pi);
    const tb = ti != null ? textboxes[ti] : null;
    return {
      eng_name: tb?.engName || '',
      name: tb?.korName || '',
      label: `${tb?.engName || ''} ${tb?.korName || ''}`.trim(),
      buffer: pic.blob,
    };
  });
}

/** app.py parse_slide spatial matching — PPTX 전체 추출 */
export async function extractProductsFromPptxSpatial(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/i)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)/i)[1], 10);
      return na - nb;
    });

  const out = [];
  for (const slidePath of slideFiles) {
    const slideNo = slidePath.match(/slide(\d+)/i)[1];
    const relPath = `ppt/slides/_rels/slide${slideNo}.xml.rels`;
    const slideXml = await zip.file(slidePath).async('string');
    const relXml = zip.file(relPath) ? await zip.file(relPath).async('string') : '';

    const mediaMap = {};
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
      mediaMap[m[1]] = m[2].replace(/^\.\.\//, 'ppt/');
    }

    const products = await parseSlideXml(slideXml, mediaMap, zip);
    out.push(...products);
  }
  return out;
}
