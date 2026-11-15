// 회의정리 보드 — 순수 함수(브라우저·서버 공용). 전산 DB·ERP 원장과 무관하다.
//   쪽지(card) 종류: topic(주제) · point(이야기) · decision(결정) · action(할 일) · question(질문)
//   선(link): 쪽지 두 장을 잇는다. 원문 근거(quote)는 회의 원문에 실제로 있는 문장만 남긴다.

export const CARD_TYPES = ['topic', 'point', 'decision', 'action', 'question'];
export const CARD_TYPE_LABEL = { topic: '주제', point: '이야기', decision: '결정', action: '할 일', question: '질문' };
export const CARD_W = 240;
export const LIMITS = { title: 120, attendees: 300, source: 30000, cards: 300, links: 600, text: 500, owner: 40, due: 40, quote: 600, label: 30 };

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (value, max) => String(value ?? '').replace(CONTROL, '').trim().slice(0, max);
const oneLine = (value, max) => clean(value, max * 2).replace(/\s+/g, ' ').slice(0, max);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
let seq = 0;
export const newId = (prefix = 'c') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 공백을 한 칸으로 줄인 글과, 줄인 글의 각 글자가 원문 어디였는지(map)를 돌려준다.
function collapse(text) {
  let out = ''; const map = []; let space = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) { if (!space) { out += ' '; map.push(i); space = true; } continue; }
    out += ch; map.push(i); space = false;
  }
  if (out.endsWith(' ')) { out = out.slice(0, -1); map.pop(); }
  return { out, map };
}

// 원문에서 인용 문장의 자리를 찾는다. 없으면 null — 지어낸 근거를 걸러내는 문지기.
export function findQuote(source, quote) {
  const src = String(source || ''); const wanted = collapse(String(quote || '')).out;
  if (wanted.length < 2 || !src) return null;
  const { out, map } = collapse(src);
  for (const candidate of [wanted, wanted.replace(/^["'“”‘’\-·•\s]+|["'“”‘’.。…\s]+$/g, '')]) {
    if (candidate.length < 2) continue;
    const at = out.indexOf(candidate);
    if (at >= 0) { const start = map[at], end = map[at + candidate.length - 1] + 1; return { start, end, text: src.slice(start, end) }; }
  }
  return null;
}

const inSource = (source, value) => !!value && collapse(String(source || '')).out.includes(collapse(value).out);

export function validateMeta(input) {
  const title = oneLine(input?.title, LIMITS.title), attendees = oneLine(input?.attendees, LIMITS.attendees);
  const date = String(input?.date ?? '').trim();
  if (date && !/^(?:20\d{2})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(date)) throw fail('회의 날짜를 확인하세요.');
  const raw = String(input?.sourceText ?? '');
  if (raw.length > LIMITS.source) throw fail(`회의 내용은 ${LIMITS.source.toLocaleString('ko-KR')}자까지 넣을 수 있습니다. 나눠서 정리해 주세요.`);
  return { title, date, attendees, sourceText: raw.replace(/\r\n/g, '\n').replace(CONTROL, '') };
}

// 화면에서 온 보드를 저장 전에 다듬는다(모르는 항목은 버리고 길이·개수를 지킨다).
export function normalizeBoard(input) {
  if (input == null) return { cards: [], links: [] };
  if (typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.cards) || !Array.isArray(input.links ?? [])) throw fail('보드 내용을 확인하세요.');
  if (input.cards.length > LIMITS.cards) throw fail(`쪽지는 ${LIMITS.cards}장까지 저장할 수 있습니다.`);
  const ids = new Set(); const cards = [];
  for (const card of input.cards) {
    if (!card || typeof card !== 'object' || !ID.test(String(card.id)) || ids.has(card.id) || !CARD_TYPES.includes(card.type)) throw fail('쪽지 내용을 확인하세요.');
    ids.add(card.id);
    const num = v => Math.round(Math.min(20000, Math.max(0, Number.isFinite(+v) ? +v : 0)));
    cards.push({
      id: card.id, type: card.type, text: clean(card.text, LIMITS.text),
      owner: card.type === 'action' ? oneLine(card.owner, LIMITS.owner) : '',
      due: card.type === 'action' ? oneLine(card.due, LIMITS.due) : '',
      quote: clean(card.quote, LIMITS.quote), origin: card.origin === 'ai' ? 'ai' : 'user',
      x: num(card.x), y: num(card.y),
    });
  }
  const links = []; const seen = new Set();
  for (const link of (input.links || []).slice(0, LIMITS.links)) {
    if (!link || !ids.has(link.from) || !ids.has(link.to) || link.from === link.to) continue;
    const key = [link.from, link.to].sort().join('>');
    if (seen.has(key)) continue; seen.add(key);
    links.push({ id: ID.test(String(link.id)) ? link.id : newId('l'), from: link.from, to: link.to, label: oneLine(link.label, LIMITS.label) });
  }
  return { cards, links };
}

// AI가 뽑은 내용을 쪽지와 선으로 바꾼다. 원문에 없는 근거·담당자·기한은 비운다(화면이 "확인 필요"로 보여준다).
export function boardFromExtraction(extraction, sourceText) {
  const cards = []; const links = []; const topicIds = new Map();
  const list = value => (Array.isArray(value) ? value : []);
  const quoteOf = value => findQuote(sourceText, value)?.text.slice(0, LIMITS.quote) || '';
  const add = (type, item, extra = {}) => {
    const text = clean(item?.text ?? item?.title, LIMITS.text);
    if (!text || cards.length >= LIMITS.cards) return null;
    const card = { id: newId('c'), type, text, owner: '', due: '', quote: quoteOf(item?.quote), origin: 'ai', x: 0, y: 0, ...extra };
    cards.push(card); return card;
  };
  const link = (from, to, label = '') => { if (from && to && from !== to) links.push({ id: newId('l'), from, to, label: oneLine(label, LIMITS.label) }); };
  for (const topic of list(extraction?.topics).slice(0, 12)) {
    const head = add('topic', { text: topic?.title, quote: topic?.quote });
    if (!head) continue;
    if (typeof topic?.key === 'string') topicIds.set(topic.key, head.id);
    for (const point of list(topic?.points).slice(0, 8)) { const card = add('point', point); if (card) link(head.id, card.id); }
  }
  for (const item of list(extraction?.decisions).slice(0, 40)) { const card = add('decision', item); if (card) link(topicIds.get(item?.topic), card.id); }
  for (const item of list(extraction?.actions).slice(0, 40)) {
    const owner = oneLine(item?.owner, LIMITS.owner), due = oneLine(item?.due, LIMITS.due);
    const card = add('action', item, { owner: inSource(sourceText, owner) ? owner : '', due: inSource(sourceText, due) ? due : '' });
    if (card) link(topicIds.get(item?.topic), card.id);
  }
  for (const item of list(extraction?.questions).slice(0, 40)) { const card = add('question', item); if (card) link(topicIds.get(item?.topic), card.id); }
  for (const relation of list(extraction?.relations).slice(0, 20)) link(topicIds.get(relation?.from), topicIds.get(relation?.to), relation?.label);
  return layoutBoard(normalizeBoard({ cards, links }));
}

export function estimateHeight(card) {
  const lines = String(card.text || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 15)), 0);
  return 58 + lines * 21 + (card.type === 'action' ? 30 : 0) + (card.origin === 'ai' && !card.quote ? 26 : 0);
}

// 가지런히 놓기: 왼쪽에 주제 묶음(주제 아래 이야기), 오른쪽에 결정 · 할 일 · 질문 줄.
export function layoutBoard(board, heights = {}) {
  const GAP = 16, COL = CARD_W + 32, TOP = 24, LEFT = 24;
  const h = card => Math.max(60, Math.round(heights[card.id] || estimateHeight(card)));
  const byId = new Map(board.cards.map(card => [card.id, { ...card }]));
  const topics = [...byId.values()].filter(card => card.type === 'topic');
  const parent = new Map();
  for (const link of board.links) {
    const a = byId.get(link.from), b = byId.get(link.to);
    if (a?.type === 'topic' && b?.type === 'point' && !parent.has(b.id)) parent.set(b.id, a.id);
    else if (b?.type === 'topic' && a?.type === 'point' && !parent.has(a.id)) parent.set(a.id, b.id);
  }
  const loose = [...byId.values()].filter(card => card.type === 'point' && !parent.has(card.id));
  const groups = topics.map(topic => [topic, ...[...byId.values()].filter(card => parent.get(card.id) === topic.id)]);
  if (loose.length) groups.push(loose);
  const perRow = groups.length <= 4 ? Math.max(1, Math.min(2, groups.length)) : 3;
  let y = TOP, rowMax = 0;
  groups.forEach((group, index) => {
    const col = index % perRow;
    if (col === 0 && index) { y += rowMax + 40; rowMax = 0; }
    let cy = y;
    for (const card of group) { card.x = LEFT + col * COL; card.y = cy; cy += h(card) + GAP; }
    rowMax = Math.max(rowMax, cy - y - GAP);
  });
  const rightStart = LEFT + (groups.length ? Math.min(perRow, groups.length) : 0) * COL + (groups.length ? 40 : 0);
  ['decision', 'action', 'question'].filter(type => [...byId.values()].some(card => card.type === type)).forEach((type, index) => {
    let cy = TOP;
    for (const card of byId.values()) if (card.type === type) { card.x = rightStart + index * COL; card.y = cy; cy += h(card) + GAP; }
  });
  return { cards: board.cards.map(card => byId.get(card.id)), links: board.links };
}

export function boardCounts(board) {
  const counts = { topic: 0, point: 0, decision: 0, action: 0, question: 0, needCheck: 0 };
  for (const card of board?.cards || []) {
    counts[card.type]++;
    if (card.type === 'action' && (!card.owner || !card.due)) counts.needCheck++;
  }
  return counts;
}
