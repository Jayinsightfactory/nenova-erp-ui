import { createHash } from 'node:crypto';

const archiveRoom = '수입방';
const archiveProducer = 'nenovakakao';
const koreaOffsetMs = 9 * 60 * 60 * 1000;

export function offsetImportDay(day, offset) {
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}

function parseCachedOrderObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function publicImportMessage(record, identity, idLookup) {
  const koreaTime = new Date(Date.parse(record.created_at) + koreaOffsetMs);
  const hour = koreaTime.getUTCHours();
  const dayPeriod = hour >= 12 ? '오후' : '오전';
  const minute = String(koreaTime.getUTCMinutes()).padStart(2, '0');
  const base = {
    id: 'archive:' + createHash('sha256').update(identity).digest('hex'),
    time: `${koreaTime.getUTCFullYear()}년 ${koreaTime.getUTCMonth() + 1}월 ${koreaTime.getUTCDate()}일 ${dayPeriod} ${hour % 12 || 12}:${minute}`,
    text: record.message,
    sender: record.sender || '',
    items: [],
  };
  const cached = parseCachedOrderObject(record.order_parsed);
  if (cached) {
    const normalized = { ...cached };
    if (normalized.replacesMessageId != null && String(normalized.replacesMessageId).trim() !== '') {
      const rawRef = String(normalized.replacesMessageId).trim();
      normalized.replacesMessageId = idLookup?.get(rawRef)
        || (rawRef.startsWith('archive:') ? rawRef : 'archive:' + createHash('sha256').update(rawRef).digest('hex'));
    }
    base.order_parsed = normalized;
  }
  if (record.order_parsed_at) base.order_parsed_at = String(record.order_parsed_at);
  if (Number.isInteger(record.order_parser_version)) base.order_parser_version = record.order_parser_version;
  return base;
}

export async function readImportArchive(from, through, fetcher = fetch) {
  const token = process.env.ORBIT_OWNER_TOKEN;
  if (!token) throw Error('Kakao archive credentials unavailable');
  const origin = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';
  const start = Date.parse(from + 'T00:00:00+09:00');
  const end = Date.parse(offsetImportDay(through, 1) + 'T00:00:00+09:00') - 1;
  const records = new Map();
  const pageSize = 1000;
  const deadline = AbortSignal.timeout(10000);
  let expected;
  for (let offset = 0; offset <= 5000; offset += pageSize) {
    const url = new URL('/api/kakao/messages', origin);
    url.search = new URLSearchParams({ chatroom: archiveRoom, startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(), limit: String(pageSize), offset: String(offset) });
    const response = await fetcher(url, {
      headers: { Authorization: 'Bearer ' + token }, signal: deadline, cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw Error('Kakao archive unavailable');
    const page = await response.json();
    expected ??= page.total;
    if (!page.ok || !Number.isInteger(expected) || expected < 0 || expected > 5000 || page.total !== expected ||
        !Array.isArray(page.messages) || page.messages.length !== Math.min(pageSize, expected - offset)) {
      throw Error('Kakao archive incomplete');
    }
    for (const row of page.messages) {
      const stamp = Date.parse(row.created_at);
      const identity = String(row.external_message_id || row.id || '');
      if (row.chatroom !== archiveRoom || !identity || records.has(identity) ||
          !Number.isFinite(stamp) || stamp < start || stamp > end) throw Error('Kakao archive identity mismatch');
      records.set(identity, row);
    }
    if (records.size === expected) {
      const idLookup = new Map();
      for (const [identity, row] of records.entries()) {
        const archiveId = 'archive:' + createHash('sha256').update(identity).digest('hex');
        idLookup.set(identity, archiveId);
        idLookup.set(archiveId, archiveId);
        if (row.id != null) idLookup.set(String(row.id), archiveId);
        if (row.external_message_id != null) idLookup.set(String(row.external_message_id), archiveId);
      }
      return [...records.entries()].filter(([, row]) => row.source === archiveProducer && typeof row.message === 'string')
        .sort(([a, rowA], [b, rowB]) => Date.parse(rowB.created_at) - Date.parse(rowA.created_at) || b.localeCompare(a, undefined, { numeric: true }))
        .map(([identity, row]) => publicImportMessage(row, identity, idLookup));
    }
  }
  throw Error('Kakao archive pagination incomplete');
}
