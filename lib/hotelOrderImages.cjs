const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ROOT = path.join(process.cwd(), 'data/runtime/hotel-order-images');
const MAX_BYTES = 15 * 1024 * 1024;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(id);
function ownerDir(owner, root) {
  if (typeof owner !== 'string' || !owner || owner.length > 200) throw fail('로그인이 필요합니다.', 401);
  return path.join(root, createHash('sha256').update(owner).digest('hex'));
}
function imageType(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(buffer.subarray(0,6).toString())) return 'gif';
  if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return 'webp';
  throw fail('PNG, JPG, GIF, WEBP 이미지만 보관할 수 있습니다.');
}
async function save(owner, buffer, { root = ROOT } = {}) {
  const dir = ownerDir(owner, root);
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw fail('이미지는 최대 15MB까지 업로드할 수 있습니다.', 413);
  const type = imageType(buffer), id = `${createHash('sha256').update(buffer).digest('hex')}.${type}`;
  await fs.mkdir(dir, { recursive:true, mode:0o700 });
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
    try { await fs.link(temp, path.join(dir,id)); } catch(e) { if(e.code !== 'EEXIST') throw e; }
  } finally { await fs.unlink(temp).catch(()=>{}); }
  return { id };
}
async function read(owner, id, { root = ROOT } = {}) {
  const dir = ownerDir(owner, root);
  if (!validId(id)) throw fail('이미지 번호를 확인하세요.');
  try { return { buffer: await fs.readFile(path.join(dir,id)), mime: `image/${id.endsWith('.jpg') ? 'jpeg' : id.split('.').pop()}` }; }
  catch(e) { if(e.code==='ENOENT') throw fail('보관된 이미지가 없습니다.',404); throw e; }
}
module.exports = { save, read, MAX_BYTES };
