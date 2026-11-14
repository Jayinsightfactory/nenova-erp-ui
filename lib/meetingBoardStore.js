// 회의정리 저장소 — 네노바웹 전용 파일 저장(data/runtime/meeting-board). 전산 DB·ERP 원장을 읽거나 쓰지 않는다.
//   회의 한 건 = 파일 하나(<id>.json). 만든 사람만 고치고, "함께 보기"를 켠 회의만 다른 직원이 볼 수 있다.
//   지우기는 먼저 휴지통(deletedAt)으로 가고, 휴지통에서만 완전히 지운다. 회의 원문은 로그에 남기지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireOwnerLock, releaseOwnerLock } from './personalHomeStore.js';
import { boardCounts, normalizeBoard, validateMeta } from './meetingBoard.js';

const ROOT = path.join(process.cwd(), 'data/runtime/meeting-board');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_FILE = 2 * 1024 * 1024, MAX_MEETINGS = 3000;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function meetingActor(user) {
  if (typeof user?.userId !== 'string' || !user.userId || user.userId.length > 128 || user.accountActive === false || user.service === true) throw fail('로그인한 직원만 회의정리를 쓸 수 있습니다.', 403);
  return user.userId;
}

async function readFile(root, id) {
  if (!UUID.test(String(id))) throw fail('회의를 찾을 수 없습니다.', 404);
  const file = path.join(root, `${id}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw fail('회의 저장본을 확인하세요.', 503);
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value?.schemaVersion !== 1 || value.id !== id || typeof value.ownerId !== 'string' || !Number.isSafeInteger(value.revision)) throw fail('회의 저장본을 확인하세요.', 503);
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('회의를 찾을 수 없습니다.', 404);
    if (error.statusCode) throw error;
    throw fail('회의 저장본을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.', 503);
  }
}

async function writeFile(root, record) {
  const text = JSON.stringify(record);
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE) throw fail('회의 한 건이 너무 큽니다. 원문이나 쪽지를 줄여 주세요.', 413);
  const temporary = path.join(root, `${record.id}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, path.join(root, `${record.id}.json`));
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

const canRead = (record, userId) => record.ownerId === userId || (record.shared === true && !record.deletedAt);
const summary = (record, userId) => ({
  id: record.id, title: record.title, date: record.date, attendees: record.attendees, shared: record.shared === true,
  ownerName: record.ownerName || '', mine: record.ownerId === userId, canEdit: record.ownerId === userId,
  createdAt: record.createdAt, updatedAt: record.updatedAt, deletedAt: record.deletedAt || null,
  revision: record.revision, counts: boardCounts(record.board), sourceLength: (record.sourceText || '').length,
});
const full = (record, userId) => ({ ...summary(record, userId), sourceText: record.sourceText || '', board: record.board || { cards: [], links: [] } });

export async function listMeetings(user, { q = '', deleted = false } = {}, { root = ROOT } = {}) {
  const userId = meetingActor(user);
  let names = [];
  try { names = await fs.readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw fail('회의 목록을 읽지 못했습니다.', 503); }
  const needle = String(q || '').trim().toLowerCase().slice(0, 80);
  const rows = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) continue;
    let record;
    try { record = await readFile(root, name.slice(0, -5)); } catch { continue; }
    if (!canRead(record, userId) || !!record.deletedAt !== !!deleted) continue;
    if (needle) {
      const hay = [record.title, record.attendees, record.date, record.sourceText, ...(record.board?.cards || []).flatMap(card => [card.text, card.owner])].join('\n').toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    rows.push(summary(record, userId));
  }
  rows.sort((a, b) => (b.date || b.createdAt.slice(0, 10)).localeCompare(a.date || a.createdAt.slice(0, 10)) || b.updatedAt.localeCompare(a.updatedAt));
  return rows;
}

export async function getMeeting(user, id, { root = ROOT } = {}) {
  const userId = meetingActor(user); const record = await readFile(root, id);
  if (!canRead(record, userId)) throw fail('회의를 찾을 수 없습니다.', 404);
  return full(record, userId);
}

async function locked(root, id, work) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, `${id}.lock`); const lease = await acquireOwnerLock(lock);
  try { return await work(); } finally { await releaseOwnerLock(lock, lease); }
}

export async function saveMeeting(user, input, { root = ROOT, now = () => new Date() } = {}) {
  const userId = meetingActor(user); const meta = validateMeta(input); const board = normalizeBoard(input?.board);
  if (!meta.sourceText.trim() && !board.cards.length) throw fail('회의 내용이나 쪽지가 있어야 저장할 수 있습니다.');
  const stamp = now().toISOString(); const shared = input?.shared === true;
  const title = meta.title || `${meta.date || stamp.slice(0, 10)} 회의`;
  if (!input?.id) {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.readdir(root)).filter(name => name.endsWith('.json')).length >= MAX_MEETINGS) throw fail('회의 저장 한도에 닿았습니다. 지운 회의를 비워 주세요.', 503);
    const record = { schemaVersion: 1, id: randomUUID(), ownerId: userId, ownerName: String(user.userName || '').slice(0, 40), ...meta, title, board, shared, createdAt: stamp, updatedAt: stamp, revision: 1, deletedAt: null };
    await writeFile(root, record);
    return full(record, userId);
  }
  return locked(root, input.id, async () => {
    const record = await readFile(root, input.id);
    if (record.ownerId !== userId) throw fail(canRead(record, userId) ? '만든 사람만 고칠 수 있습니다.' : '회의를 찾을 수 없습니다.', canRead(record, userId) ? 403 : 404);
    if (record.deletedAt) throw fail('지운 회의입니다. 먼저 되살려 주세요.', 409);
    if (record.revision !== input.expectedRevision) throw fail('다른 창에서 이 회의를 먼저 고쳤습니다. 다시 열어 확인한 뒤 저장해 주세요.', 409);
    Object.assign(record, meta, { title, board, shared, updatedAt: stamp, revision: record.revision + 1 });
    await writeFile(root, record);
    return full(record, userId);
  });
}

// trash: 휴지통으로 · restore: 되살리기 · purge: 휴지통에 있는 회의를 완전히 지우기(되돌릴 수 없음)
export async function changeMeeting(user, action, id, { root = ROOT, now = () => new Date() } = {}) {
  const userId = meetingActor(user);
  if (!['trash', 'restore', 'purge'].includes(action)) throw fail('요청을 확인하세요.');
  return locked(root, String(id), async () => {
    const record = await readFile(root, id);
    if (record.ownerId !== userId) throw fail(canRead(record, userId) ? '만든 사람만 지우거나 되살릴 수 있습니다.' : '회의를 찾을 수 없습니다.', canRead(record, userId) ? 403 : 404);
    if (action === 'purge') {
      if (!record.deletedAt) throw fail('먼저 지운 회의만 완전히 지울 수 있습니다.', 409);
      await fs.unlink(path.join(root, `${record.id}.json`));
      return { id: record.id, purged: true };
    }
    record.deletedAt = action === 'trash' ? now().toISOString() : null;
    record.updatedAt = now().toISOString(); record.revision++;
    await writeFile(root, record);
    return summary(record, userId);
  });
}
