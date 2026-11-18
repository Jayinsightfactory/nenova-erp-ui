import { createHash } from 'node:crypto';

const archiveRoom = '수입방';
const archiveProducer = 'nenovakakao';
const formatTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

export function offsetImportDay(day, offset) {
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}

function publicImportMessage(record, identity) {
  const date = new Date(record.created_at);
  const fields = Object.fromEntries(formatTime.formatToParts(date).map(part => [part.type, part.value]));
  return {
    id: 'archive:' + createHash('sha256').update(identity).digest('hex'),
    time: `${fields.year}년 ${fields.month}월 ${fields.day}일 ${fields.dayPeriod} ${fields.hour}:${fields.minute}`,
    text: record.message,
    sender: record.sender || '',
    items: [],
  };
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
      return [...records.entries()].filter(([, row]) => row.source === archiveProducer && typeof row.message === 'string')
        .sort(([a, rowA], [b, rowB]) => Date.parse(rowB.created_at) - Date.parse(rowA.created_at) || b.localeCompare(a, undefined, { numeric: true }))
        .map(([identity, row]) => publicImportMessage(row, identity));
    }
  }
  throw Error('Kakao archive pagination incomplete');
}
