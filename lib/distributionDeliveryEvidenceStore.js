const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { deliveryIdentity, exactDeliveryTime, fullDeliveryText, matchDeliveryStatus } = require('./distributionDeliveryStatus');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'runtime', 'distribution-delivery-evidence');
function evidenceKey(source, year) {
  if (!/^\d{4}$/.test(String(year)) || deliveryIdentity(source) !== source?.identity || !source?.identity || source.chatroom !== '영업방' || !fullDeliveryText(source.message) || exactDeliveryTime(source, year) === null) return null;
  return crypto.createHash('sha256').update(JSON.stringify([String(year), source.identity, source.message, source.created_at, source.timestamp_approximate === true, source.truncated === true, source.is_truncated === true])).digest('hex');
}
function createDistributionDeliveryEvidenceStore({ directory = DEFAULT_DIRECTORY, now = () => new Date() } = {}) {
  const root = path.resolve(directory);
  async function read({ source, year }) {
    const key = evidenceKey(source, year);
    if (!key) return null;
    const file = path.join(root, `${key}.json`);
    let record;
    try {
      const stat = await fs.promises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid evidence file');
      record = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const at = exactDeliveryTime({ created_at: record.deliveredAt }, year);
    if (record.schemaVersion !== 1 || record.key !== key || record.year !== String(year) || record.identity !== source.identity || record.status !== 'DELIVERED' || !/^nenovakakao\|[^|]+\|[^|]+$/.test(record.deliveryIdentity || '') || record.deliveryIdentity === source.identity || at === null || at < exactDeliveryTime(source, year) || !Number.isFinite(Date.parse(record.verifiedAt))) throw new Error('invalid stored delivery evidence');
    return { identity: record.identity, status: 'DELIVERED', deliveryIdentity: record.deliveryIdentity, deliveredAt: record.deliveredAt, verifiedAt: record.verifiedAt, persisted: true };
  }
  async function confirm({ source, target, year }) {
    const key = evidenceKey(source, year);
    const match = matchDeliveryStatus({ sources: [source], targets: [target], year })[0];
    if (!key || match.status !== 'DELIVERED') throw new Error('unverified delivery evidence');
    const record = { schemaVersion: 1, key, year: String(year), ...match, verifiedAt: now().toISOString() };
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, `${key}.json`), temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fs.promises.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      // Link publishes a complete record and cannot replace a concurrent winner.
      try { await fs.promises.link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { await fs.promises.unlink(temporary).catch(() => {}); }
    return read({ source, year });
  }
  return { read, confirm };
}
module.exports = { createDistributionDeliveryEvidenceStore, evidenceKey };
