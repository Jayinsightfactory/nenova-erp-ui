const JSZip = require('jszip');
const { createHash } = require('node:crypto');
const LIMITS = Object.freeze({ zip: 25 * 1024 * 1024, pdf: 12 * 1024 * 1024, expanded: 80 * 1024 * 1024, files: 80 });
async function inspectSettlementZip(buffer) {
  const reject = message => { throw Object.assign(Error(message), { statusCode: 422 }); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > LIMITS.zip) reject('ZIP은 25MiB 이하여야 합니다.');
  let zip; try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); } catch { reject('ZIP 구조를 읽지 못했습니다. 암호·손상 여부를 확인하세요.'); }
  const files = Object.values(zip.files).filter(f => !f.dir);
  if (!files.length || files.length > LIMITS.files) reject('ZIP에는 1~80개 PDF만 넣어 주세요.');
  let expanded = 0; const results = [], hashes = new Set();
  for (const file of files) {
    const name = file.unsafeOriginalName || file.name;
    if (name.includes('..') || /[\\\x00]/.test(name) || name.startsWith('/') || !/\.pdf$/i.test(name)) reject('PDF 외 파일이나 안전하지 않은 경로가 있습니다.');
    const size = file._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size <= 0 || size > LIMITS.pdf || expanded + size > LIMITS.expanded) reject('압축 해제 크기 한도를 넘었습니다.');
    expanded += size;
    const chunks = []; let inflated = 0;
    // Declared sizes are untrusted. Stop inflate before accumulating a bomb.
    await new Promise((resolve, rejectStream) => {
      const stream = file.nodeStream('nodebuffer');
      stream.on('data', chunk => { inflated += chunk.length; if (inflated > LIMITS.pdf || expanded - size + inflated > LIMITS.expanded) stream.destroy(Object.assign(Error('압축 해제 크기 한도를 넘었습니다.'), { statusCode: 422 })); else chunks.push(chunk); });
      stream.on('end', resolve); stream.on('error', rejectStream);
    });
    const bytes = Buffer.concat(chunks, inflated);
    if (bytes.length !== size || bytes.subarray(0, 5).toString() !== '%PDF-') reject('정상 PDF가 아닌 파일이 있습니다.');
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    if (hashes.has(sourceHash)) continue;
    const awbHint = name.match(/\b\d{11}\b/)?.[0] || null, partHint = name.match(/분할\s*([1-9])/)?.[1] || null;
    hashes.add(sourceHash); results.push({ sourceHash, bytes, hint: { awb: awbHint, part: partHint } });
  }
  return { sourceHash: createHash('sha256').update(buffer).digest('hex'), files: results };
}
module.exports = { LIMITS, inspectSettlementZip };
