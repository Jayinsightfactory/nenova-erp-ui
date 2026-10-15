import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createCountryOrderRequestGuard } from '../lib/countryOrderPedidosAdapter.js';

const response = scopeKey => ({ success: true, readOnly: true, scope: scopeKey == null ? null : { scopeKey } });
test('late A response cannot replace B even if network ignores abort; country and cross-year scopes exact', async () => {
  const guard = createCountryOrderRequestGuard();
  const a = guard.begin('Netherlands/2026/52');
  const b = guard.begin('China/2027/01');
  assert.equal(a.signal.aborted, true);
  let applied = null;
  await Promise.resolve().then(() => { if (b.accepts(response('China/2027/01'))) applied = 'B'; });
  await Promise.resolve().then(() => { if (a.accepts(response('Netherlands/2026/52'))) applied = 'A'; });
  assert.equal(applied, 'B');
  assert.equal(b.accepts(response('China/2026/01')), false);
  assert.equal(b.accepts(response('Netherlands/2027/01')), false);
});
test('tab hide, source switch and manual invalidation abort response, including errors or partial envelopes', () => {
  const guard = createCountryOrderRequestGuard(), request = guard.begin('Netherlands/2026/42');
  assert.equal(request.accepts({ success: false, readOnly: true, scope: { scopeKey: 'Netherlands/2026/42' } }), false);
  assert.equal(request.accepts({ success: true, scope: { scopeKey: 'Netherlands/2026/42' } }), false);
  guard.invalidate(); assert.equal(request.signal.aborted, true);
  assert.equal(request.accepts(response('Netherlands/2026/42')), false);
  const calendar = guard.begin(null);
  assert.equal(calendar.accepts(response(null)), true); assert.equal(calendar.accepts(response('Netherlands/2026/42')), false);
});
test('Pedidos UI wires read-only auto source, exact year/week, hidden-tab gate and all context invalidations', () => {
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  const parent = fs.readFileSync(new URL('../pages/import/tools.js', import.meta.url), 'utf8');
  assert.match(parent, /<PedidosTool active=\{tab==='orders'\}/);
  assert.match(ui, /useState\('erp'\)/); assert.match(ui, /!active \|\| sourceMode !== 'erp'/);
  assert.match(ui, /params.set\('year', String\(selected.year\)\)/); assert.match(ui, /params.set\('majorWeek', selected.majorWeek\)/);
  assert.match(ui, /signal: request.signal, cache: 'no-store'/); assert.match(ui, /request.accepts\(body\)/);
  assert.match(ui, /matrix.blockers.length === 0/); assert.match(ui, /matrix.scope.orderWeek === orderWeek/);
  assert.match(ui, /generation !== contextGeneration.current/); assert.match(ui, /!results\?\.includes\(output\)/);
  for (const handler of ['changeSource', 'changeCountry', 'changeCycle']) assert.match(ui, new RegExp(`function ${handler}[^]*?requestGuard.current.invalidate\\(\\)`));
  assert.match(ui, /invalidate\(setOrderWeek, subweek.orderWeek\)/); assert.match(ui, /invalidate\(setFile/);
  assert.doesNotMatch(ui, /method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});
test('UI matrix is page-height, horizontally scrollable, sticky product/header, native keyboard controls and focus', () => {
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  assert.match(ui, /cycles.map\(cycle => <button type="button"/); assert.match(ui, /response\?\.subweeks.map/);
  assert.match(ui, /scope="row"/); assert.match(ui, /role="region" aria-label="전산 품목별 업체 원수량 행렬"/);
  assert.match(ui, /overflow-x: auto/); assert.match(ui, /position:sticky; left:0/); assert.match(ui, /focus-visible/);
  assert.doesNotMatch(ui, /(?:^|[;{]\s*)(?:max-)?height:\s*\d+(?:px|vh)/m);
});
