// 회의정리: 원문 근거 확인 · 보드 만들기 · 파일 저장(만든 사람만 고침, 휴지통, 함께 보기) 검사. ERP 연결 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { boardFromExtraction, findQuote, layoutBoard, normalizeBoard, validateMeta, CARD_W } from '../lib/meetingBoard.js';
import { changeMeeting, getMeeting, listMeetings, saveMeeting } from '../lib/meetingBoardStore.js';
import { extractMeetingBoard } from '../lib/meetingBoardLlm.js';

const SOURCE = '가 담당: 다음 주 연습 장미 입고가 하루 늦어집니다.\n나 담당: 수요일 출고분은 목요일로 미루겠습니다.   거래처 안내는 제가 금요일까지 하겠습니다.\n다 담당: 포장 상자 규격은 아직 못 정했습니다.';
const EXTRACTION = {
  title: '연습 입고 지연 회의',
  topics: [{ key: 't1', title: '입고 지연', quote: '다음 주 연습 장미 입고가 하루 늦어집니다.', points: [{ text: '장미 입고 하루 지연', quote: '입고가 하루 늦어집니다' }, { text: '지어낸 이야기', quote: '원문에 없는 문장입니다' }] }],
  decisions: [{ text: '수요일 출고분을 목요일로 미룸', topic: 't1', quote: '수요일 출고분은 목요일로 미루겠습니다.' }],
  actions: [
    { text: '거래처 안내', owner: '나 담당', due: '금요일까지', topic: 't1', quote: '거래처 안내는 제가 금요일까지 하겠습니다.' },
    { text: '상자 규격 조사', owner: '라 담당', due: '12월 1일', topic: 't1', quote: '' },
  ],
  questions: [{ text: '포장 상자 규격', topic: 'zz', quote: '포장 상자 규격은 아직 못 정했습니다.' }],
  relations: [{ from: 't1', to: 't1', label: '자기 자신' }],
};

test('원문 근거는 공백 차이를 넘어 찾고, 없는 문장은 찾지 않는다', () => {
  const hit = findQuote(SOURCE, '미루겠습니다. 거래처 안내는');
  assert.equal(SOURCE.slice(hit.start, hit.end), hit.text);
  assert.match(hit.text, /미루겠습니다\.\s+거래처 안내는/);
  assert.equal(findQuote(SOURCE, '원문에 없는 문장'), null);
  assert.equal(findQuote(SOURCE, ''), null);
});

test('AI 결과에서 원문에 없는 근거·담당자·기한은 비운다', () => {
  const board = boardFromExtraction(EXTRACTION, SOURCE);
  const find = text => board.cards.find(card => card.text === text);
  assert.equal(board.cards.length, 7);
  assert.equal(find('지어낸 이야기').quote, '');
  assert.equal(find('거래처 안내').owner, '나 담당');
  assert.equal(find('거래처 안내').due, '금요일까지');
  assert.equal(find('상자 규격 조사').owner, '');
  assert.equal(find('상자 규격 조사').due, '');
  assert.ok(board.cards.every(card => card.origin === 'ai'));
  assert.ok(board.cards.filter(card => card.quote).every(card => SOURCE.includes(card.quote)));
  assert.equal(board.links.length, 5, '주제→이야기2 + 결정1 + 할 일2, 모르는 주제·자기 자신 연결은 버린다');
});

test('가지런히 놓기는 쪽지를 겹치지 않게 놓는다', () => {
  const board = layoutBoard(boardFromExtraction(EXTRACTION, SOURCE), {});
  const boxes = board.cards.map(card => ({ x: card.x, y: card.y, h: 60 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `쪽지 ${i}·${j} 겹침`);
  }
});

test('보드·회의 정보 검사: 잘못된 값은 거절하고 끊긴 선은 버린다', () => {
  assert.throws(() => normalizeBoard({ cards: [{ id: 'a', type: 'nope', text: 'x' }], links: [] }), /쪽지/);
  const board = normalizeBoard({ cards: [{ id: 'a', type: 'action', text: ' 할 일 ', owner: '가', due: '', x: -5, y: 'z' }, { id: 'b', type: 'point', text: 'p', owner: '무시' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'none' }] });
  assert.deepEqual([board.cards[0].text, board.cards[0].x, board.cards[0].y, board.cards[1].owner], ['할 일', 0, 0, '']);
  assert.equal(board.links.length, 1);
  assert.throws(() => validateMeta({ date: '2026-13-01' }), /날짜/);
  assert.throws(() => validateMeta({ sourceText: 'x'.repeat(30001) }), /30,000자/);
});

test('저장: 만든 사람만 고치고, 함께 보기만 남이 읽고, 휴지통을 거쳐야 완전히 지운다', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-board-'));
  const a = { userId: 'user-a', userName: '연습 가', accountActive: true }, b = { userId: 'user-b', userName: '연습 나', accountActive: true };
  try {
    await assert.rejects(saveMeeting({ userId: 'svc', service: true }, { sourceText: 'x' }, { root }), { statusCode: 403 });
    await assert.rejects(saveMeeting(a, { sourceText: '  ' }, { root }), /회의 내용이나 쪽지/);
    const board = boardFromExtraction(EXTRACTION, SOURCE);
    const created = await saveMeeting(a, { title: '', date: '2026-11-16', attendees: '가, 나', sourceText: SOURCE, board }, { root });
    assert.equal(created.title, '2026-11-16 회의'); assert.equal(created.revision, 1); assert.equal(created.board.cards.length, 7);
    assert.deepEqual((await listMeetings(b, {}, { root })).length, 0, '함께 보기를 켜지 않은 회의는 남에게 안 보인다');
    await assert.rejects(getMeeting(b, created.id, { root }), { statusCode: 404 });
    await assert.rejects(saveMeeting(a, { ...created, expectedRevision: 0 }, { root }), { statusCode: 409 });
    const moved = { ...created.board, cards: created.board.cards.map((card, i) => (i ? card : { ...card, x: 400, y: 300, text: '고친 주제' })) };
    const updated = await saveMeeting(a, { id: created.id, expectedRevision: 1, title: '연습 회의', date: '2026-11-16', attendees: '가, 나', sourceText: SOURCE, board: moved, shared: true }, { root });
    assert.equal(updated.revision, 2);
    const reopened = await getMeeting(b, created.id, { root });
    assert.deepEqual([reopened.board.cards[0].x, reopened.board.cards[0].y, reopened.board.cards[0].text, reopened.canEdit], [400, 300, '고친 주제', false]);
    await assert.rejects(saveMeeting(b, { id: created.id, expectedRevision: 2, sourceText: SOURCE }, { root }), { statusCode: 403 });
    await assert.rejects(changeMeeting(b, 'trash', created.id, { root }), { statusCode: 403 });
    assert.equal((await listMeetings(a, { q: '고친 주제' }, { root })).length, 1);
    assert.equal((await listMeetings(a, { q: '없는말' }, { root })).length, 0);
    await assert.rejects(changeMeeting(a, 'purge', created.id, { root }), { statusCode: 409 });
    await changeMeeting(a, 'trash', created.id, { root });
    assert.equal((await listMeetings(a, {}, { root })).length, 0);
    assert.equal((await listMeetings(a, { deleted: true }, { root })).length, 1);
    assert.equal((await listMeetings(b, { deleted: true }, { root })).length, 0);
    await changeMeeting(a, 'restore', created.id, { root });
    assert.equal((await listMeetings(a, {}, { root })).length, 1);
    await changeMeeting(a, 'trash', created.id, { root });
    assert.deepEqual(await changeMeeting(a, 'purge', created.id, { root }), { id: created.id, purged: true });
    assert.deepEqual((await fs.readdir(root)).filter(name => name.endsWith('.json')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AI 호출: 실패는 종류 코드로만 돌려주고 예외를 던지지 않는다', async () => {
  const ok = await extractMeetingBoard({ sourceText: SOURCE }, { createClient: () => ({ messages: { create: async request => {
    assert.equal(request.tool_choice.name, 'record_meeting_board'); assert.match(request.messages[0].content, /<회의원문>/);
    return { usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', name: 'record_meeting_board', input: EXTRACTION }] };
  } } }) });
  assert.equal(ok.extraction.title, '연습 입고 지연 회의');
  const quiet = console.error; console.error = () => {};
  try {
    const failing = status => extractMeetingBoard({ sourceText: SOURCE }, { createClient: () => ({ messages: { create: async () => { throw Object.assign(new Error('x'), { status }); } } }) });
    assert.equal((await failing(429)).errorCode, 'RATE_LIMIT');
    assert.equal((await failing(401)).errorCode, 'API_AUTH');
    assert.equal((await failing(529)).errorCode, 'MODEL_UNAVAILABLE');
    assert.equal((await extractMeetingBoard({ sourceText: SOURCE }, { createClient: () => ({ messages: { create: async () => ({ content: [{ type: 'text', text: 'no tool' }] }) } }) })).errorCode, 'BAD_ANSWER');
  } finally { console.error = quiet; }
});
