'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestOptions, homeWorkspaceRequest } = require('../home-workspace.cjs');
const snapshot = owner => ({ success: true, schemaVersion: 1, ownerId: owner, revision: 0, tasks: [], guidance: [], feedback: [] });
test('main bridge fixes origin, binds owner and strips arbitrary renderer fields', () => {
  const r = requestOptions({ method: 'POST', url: 'https://evil.test', command: { action: 'create', expectedRevision: 0, requestId: 'fixture-1234', date: '2026-10-09', title: '업무', weekdays: [5], ownerId: 'other', expectedOwnerId: 'other', url: '/api/shipment' } }, 'verified');
  assert.equal(r.url, 'https://nenovaweb.com/api/desktop/home-workspace');
  assert.equal(r.options.redirect, 'error');
  assert.deepEqual(JSON.parse(r.options.body), { action: 'create', expectedRevision: 0, requestId: 'fixture-1234', expectedOwnerId: 'verified', date: '2026-10-09', title: '업무', weekdays: [5] });
  const monthly = requestOptions({method:'POST',command:{action:'create',expectedRevision:0,requestId:'fixture-monthly',date:'2026-01-31',title:'월말',frequency:'monthly',weekdays:[]}},'verified');
  assert.equal(JSON.parse(monthly.options.body).frequency,'monthly');
  assert.throws(()=>requestOptions({method:'POST',command:{action:'create',expectedRevision:0,requestId:'fixture-invalid',date:'2026-01-31',title:'오류',frequency:'yearly'}},'verified'));
  for (const date of ['2025-10-09', '2026-10-09']) assert.equal(new URL(requestOptions({ method: 'GET', date, offset: 200 }, 'verified').url).searchParams.get('date'), date);
  assert.throws(() => requestOptions({ method: 'GET', date: '2026-02-30' }, 'verified'));
  assert.throws(() => requestOptions({ method: 'DELETE' }, 'verified'));
  assert.throws(() => requestOptions({ method: 'POST', command: { action: 'sql' } }, 'verified'));
});
test('bridge discards delayed data across account transitions and fails closed on wrong owner', async () => {
  let current = true, release;
  const request = homeWorkspaceRequest({ payload: { method: 'GET' }, owner: 'a', fetch: () => new Promise(r => { release = r; }), isCurrent: () => current, onUnauthorized() {} });
  current = false; release(Response.json(snapshot('a')));
  await assert.rejects(request, /계정/);
  await assert.rejects(homeWorkspaceRequest({ payload: { method: 'GET' }, owner: 'a', fetch: async () => Response.json(snapshot('b')), isCurrent: () => true, onUnauthorized() {} }), /계정/);
});
test('bridge returns conflict details, locks on unauthorized and bounds responses', async () => {
  let locked = false;
  const args = { payload: { method: 'GET' }, owner: 'a', isCurrent: () => true, onUnauthorized: () => { locked = true; } };
  assert.equal((await homeWorkspaceRequest({ ...args, fetch: async () => Response.json({ success: false, code: 'REVISION_CONFLICT', error: '다른 창 수정' }, { status: 409 }) })).code, 'REVISION_CONFLICT');
  await assert.rejects(homeWorkspaceRequest({ ...args, fetch: async () => new Response('', { status: 401 }) })); assert.ok(locked);
  locked = false;
  const forbidden = await homeWorkspaceRequest({ ...args, fetch: async () => Response.json({ success: false, error: '원문이 변경되었습니다.' }, { status: 403 }) });
  assert.equal(forbidden.status, 403); assert.equal(locked, false, 'source permission failure preserves the current actor and drafts');
  await assert.rejects(homeWorkspaceRequest({ ...args, fetch: async () => Response.json({ success: false, code: 'ACCOUNT_CHANGED' }, { status: 403 }) })); assert.ok(locked);
  await assert.rejects(homeWorkspaceRequest({ ...args, fetch: async () => Response.json(snapshot('a'), { headers: { 'content-length': String(3 * 1024 * 1024) } }) }));
  assert.deepEqual(await homeWorkspaceRequest({ ...args, fetch: async () => Response.json(snapshot('a')) }), snapshot('a'));
});

test('calendar month/week are validated read-only queries with fixed owner and origin',()=>{
 const request=requestOptions({method:'GET',calendarMonth:'2026-12',calendarWeek:'2027-01-01',url:'https://evil.test'},'verified');const u=new URL(request.url);assert.equal(u.origin,'https://nenovaweb.com');assert.equal(u.searchParams.get('expectedOwnerId'),'verified');assert.equal(u.searchParams.get('calendarWeek'),'2027-01-01');assert.equal(u.searchParams.get('calendarMonth'),'2026-12');assert.equal(request.options.method,'GET');
 for(const value of ['2026-02-30','1999-12-31',[],null])assert.throws(()=>requestOptions({method:'GET',calendarWeek:value},'verified'));
 for(const value of ['2026-13','2026-1',[],null])assert.throws(()=>requestOptions({method:'GET',calendarMonth:value},'verified'));
});

test('transport timeout is a clean retryable result and never hides an account change',async()=>{
 let unauthorized=0;const base={payload:{method:'GET'},owner:'a',isCurrent:()=>true,onUnauthorized:()=>unauthorized++};
 for(const name of ['TimeoutError','AbortError','TypeError']){
  const value=await homeWorkspaceRequest({...base,fetch:async()=>{throw Object.assign(new Error('internal transport details'),{name});}});assert.equal(value.success,false);assert.equal(value.status,name==='TypeError'?503:504);assert(!/remote method|TimeoutError|internal transport/.test(value.error));
 }
 const bodyTimeout=await homeWorkspaceRequest({...base,fetch:async()=>({status:200,headers:new Headers(),text:async()=>{throw Object.assign(Error('hidden'),{name:'AbortError'});}})});assert.equal(bodyTimeout.status,504);assert.equal(unauthorized,0);
 await assert.rejects(homeWorkspaceRequest({...base,isCurrent:()=>false,fetch:async()=>{throw Object.assign(Error('hidden'),{name:'TimeoutError'});}}),/계정이 변경/);
});
