import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDutchVolumeWorkHandler } from '../lib/dutchVolumeWorkApi.js';

const calls = [];
const handler = createDutchVolumeWorkHandler({ saveDutchWorkSnapshot: async value => { calls.push(value); return { id: 'saved' }; }, listDutchWorkSnapshots: async value => { calls.push(value); return { items: [], nextCursor: null, corruptCount: 0 }; }, getDutchWorkSnapshot: async value => { calls.push(value); return { id: value.id, entries: [] }; } });
async function run(patch = {}) { const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(status) { this.code = status; return this; }, json(body) { this.body = body; return this; } }; await handler({ method: 'GET', user: { userId: 'u1', userName: '담당' }, headers: { host: 'localhost:3000' }, query: {}, ...patch }, res); return res; }
assert.equal((await run()).code, 200); assert.equal(calls.at(-1).ownerId, 'u1');
assert.equal((await run({ query: { id: 'abc' } })).body.snapshot.id, 'abc');
assert.equal((await run({ user: {} })).code, 401);
assert.equal((await run({ method: 'DELETE' })).code, 405);
assert.equal((await run({ query: { id: ['a', 'b'] } })).code, 400);
const valid = { name: '작업', sourceMode: 'LIVE', fileName: '조회.xlsx', orderYear: '2026', orderWeek: '40-01', sourceIdentity: 'live2026', workbook: { SheetNames: ['a'], Sheets: { a: { '!ref': 'A1', A1: { t: 's', v: '조회' } } } }, entries: [{ id: 'a', quantity: 0 }], prices: {} };
const post = await run({ method: 'POST', body: { ...valid, ownerId: 'hacker', savedBy: 'hacker' }, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } });
assert.equal(post.code, 200); assert.equal(calls.at(-1).ownerId, 'u1'); assert.equal(calls.at(-1).savedBy, '담당'); assert.equal(post.body.snapshot.id, 'saved');
for (const headers of [{ host: 'localhost:3000', origin: 'https://evil.test' }, { host: 'localhost:3000', origin: 'null' }, { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }]) assert.equal((await run({ method: 'POST', body: {}, headers })).code, 403);
assert.equal((await run({ method: 'POST', body: {}, headers: { 'content-length': 900 * 1024 + 1 } })).code, 413);
const source = fs.readFileSync('pages/api/shipment/dutch-volume-work.js', 'utf8'); assert.match(source, /withAuth\(createDutchVolumeWorkHandler\(\)\)/); assert.match(source, /sizeLimit: '900kb'/); assert.doesNotMatch(source, /withActionLog|from.*db/);
console.log('dutchVolumeWorkApi: authentication, owner/actor enforcement, origin, limits, GET/POST contract PASS');
