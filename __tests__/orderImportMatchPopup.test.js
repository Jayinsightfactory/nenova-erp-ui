import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  IMPORT_MATCH_MESSAGE as M,
  buildImportMatchInit,
  buildImportMatchPopupUrl,
  createImportMatchToken,
  isTrustedInitMessage,
  mergeMatchCandidates,
  pickProductPayload,
  readSelectedProduct,
  readTrustedPopupMessage,
} from '../lib/orderImportMatchPopup.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const ORIGIN = 'https://erp.example';

// 토큰·URL
const t1 = createImportMatchToken({ randomUUID: () => 'abc' });
assert.equal(t1, 'import-abc');
assert.notEqual(createImportMatchToken({}), createImportMatchToken({}));
assert.match(buildImportMatchPopupUrl('tok'), /^\/orders\/product-match\?popup=1&token=tok$/);

// opener 수신 검증
const popup = {};
const pending = { token: 'tok', popup };
const ok = { origin: ORIGIN, source: popup, data: { type: M.selected, token: 'tok', prod: { ProdKey: 7, ProdName: 'A' } } };
assert.ok(readTrustedPopupMessage(ok, pending, ORIGIN));
assert.equal(readTrustedPopupMessage({ ...ok, origin: 'https://evil.example' }, pending, ORIGIN), null, '다른 출처 거부');
assert.equal(readTrustedPopupMessage({ ...ok, source: {} }, pending, ORIGIN), null, '다른 창 거부');
assert.equal(readTrustedPopupMessage({ ...ok, data: { ...ok.data, token: 'old' } }, pending, ORIGIN), null, '이전 토큰 거부');
assert.equal(readTrustedPopupMessage({ ...ok, data: { type: M.init, token: 'tok' } }, pending, ORIGIN), null, 'init 은 opener 가 받지 않음');
assert.equal(readTrustedPopupMessage(ok, null, ORIGIN), null, '대기 중 요청 없으면 거부');
for (const type of [M.ready, M.cleared, M.cancel]) assert.ok(readTrustedPopupMessage({ ...ok, data: { type, token: 'tok' } }, pending, ORIGIN), type);

// 팝업 init 검증
const opener = {};
const init = { origin: ORIGIN, source: opener, data: { type: M.init, token: 'tok' } };
assert.ok(isTrustedInitMessage(init, opener, ORIGIN, 'tok'));
assert.equal(isTrustedInitMessage({ ...init, source: {} }, opener, ORIGIN, 'tok'), false);
assert.equal(isTrustedInitMessage(init, opener, ORIGIN, 'other'), false);

// 선택 payload
assert.deepEqual(readSelectedProduct(ok.data), { ProdKey: 7, ProdName: 'A', DisplayName: 'A', FlowerName: '', CounName: '', OutUnit: '' });
assert.equal(pickProductPayload({ ProdKey: 0 }), null);
assert.equal(pickProductPayload({ ProdKey: 'x' }), null);
assert.equal(readSelectedProduct({ type: M.cancel, prod: { ProdKey: 1 } }), null);

// init 본문
const row = { inputName: '프라우드', prodKey: 11, displayName: 'D', suggestedProducts: [{ prodKey: 1 }], secret: 'x' };
const body = buildImportMatchInit(row, '업체', 'tok');
assert.equal(body.currentProdKey, 11);
assert.equal(body.matchName, '프라우드');
assert.equal(body.secret, undefined);

// 후보 병합: 서버 후보 먼저(점수순), 중복 제거, 최대 50
const all = Array.from({ length: 80 }, (_, i) => ({ ProdKey: i + 1, ProdName: `ROSE ${i}`, DisplayName: `장미 ${i}`, CounName: 'CHINA', FlowerName: '장미' }));
const sug = [{ prodKey: 5, prodName: 'ROSE 4', score: 50, customerUsageCount: 3 }, { prodKey: 9, prodName: 'ROSE 8', score: 90 }];
const empty = mergeMatchCandidates({ suggestions: sug, allProducts: all, query: '' });
assert.deepEqual(empty.map((x) => x.ProdKey), [9, 5], '검색어 없으면 서버 후보만, 점수 높은 순');
assert.equal(empty[1].usageCount, 3);
const merged = mergeMatchCandidates({ suggestions: sug, allProducts: all, query: '장미' });
assert.equal(merged.length, 50);
assert.deepEqual(merged.slice(0, 2).map((x) => x.ProdKey), [9, 5]);
assert.equal(new Set(merged.map((x) => x.ProdKey)).size, merged.length);

// 연결 계약: import.js 는 팝업 + 안전 검사 + 기존 확정 함수 재사용, 자동 선택 없음
const imp = read('../pages/orders/import.js');
assert.match(imp, /window\.open\(buildImportMatchPopupUrl\(token\), IMPORT_MATCH_POPUP_NAME, IMPORT_MATCH_POPUP_FEATURES\)/);
assert.match(imp, /readTrustedPopupMessage\(event, matchPopupPendingRef\.current, window\.location\.origin\)/);
assert.match(imp, /await handlePersistMapping\(pending\.row, prod\);\s*pickProduct\(pending\.idx, prod, pending\.row\)/);
assert.match(imp, /aria-haspopup="dialog" onClick=\{openChange\}/);
const lib = read('../lib/orderImportMatchPopup.js');
assert.match(lib, /width=980,height=760/);
const page = read('../pages/orders/product-match.js');
assert.match(page, /Escape/); assert.match(page, /ArrowDown/); assert.match(page, /onDoubleClick/);
assert.match(page, /IMPORT_MATCH_MESSAGE\.cleared/);
console.log('orderImportMatchPopup: ok');
