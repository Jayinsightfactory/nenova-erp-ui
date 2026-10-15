import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createCountryOrderRequestGuard } from '../lib/countryOrderPedidosAdapter.js';
import { buildCountryOrderMatrix, formatCountryOrderUnitBasis, formatCountryOrderStoredQuantities } from '../lib/countryOrderSource.js';
import { formatPedidosQuantity } from '../lib/importPedidos.js';

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
  assert.ok(ui.includes('.pedidos-tool button[aria-pressed="true"]'), 'selected state must outrank grouped default button styles');
  assert.doesNotMatch(ui, /(?:^|[;{]\s*)(?:max-)?height:\s*\d+(?:px|vh)/m);
});

test('UI distinguishes current product basis, output unit and saved quantities without converting them', () => {
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  assert.match(ui, /<th scope="col">품목<\/th><th scope="col">품목관리 기준<\/th><th scope="col">발주서 단위<\/th><th scope="col">저장 주문수량<\/th>/);
  assert.match(ui, /formatCountryOrderUnitBasis\(row.unitBasis\)/);
  assert.match(ui, /formatCountryOrderStoredQuantities\(row.storedQuantities\)/);
  assert.match(ui, /formatCountryOrderStoredQuantities\(row.storedQuantitiesByCustomer\?\.\[customer.key\]\)/);
  assert.match(ui, /Object.hasOwn\(row.storedQuantitiesByCustomer \?\? \{\}, customer.key\)/);
  assert.match(ui, /: '주문 없음'/);
  assert.match(ui, /품목관리 기준은 현재 품목 설정이며 참고용/);
  assert.match(ui, /발주서 수량을 다시 환산하지 않습니다/);
  assert.match(ui, /표시된 0을 단 수량이나 품목관리 기준으로 자동 보정하지 않습니다/);
  assert.match(ui, /matrix.blockers.length === 0/);
  assert.match(ui, /row.quantities\[customer.key\] \?\? 0/);
  assert.doesNotMatch(ui, /(?:row\.(?:total|quantities)|unitBasis|storedQuantities)\s*\*|SteamOf1Bunch\s*\*/);
});

test('UI display helpers show product bunch/stem basis separately from saved 120 bunches / zero stems; export blocker remains', () => {
  const raw = { OrderYear: 2026, OrderWeek: '42-01', CustKey: 1, CustName: '업체', CustOrderCode: 'CL21', ProdKey: 2990, ProdName: 'Product basis sample', FlowerName: '기타', CounName: '네덜란드', OutUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0, SteamOf1Box: 0, OutQuantity: 0, BoxQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SourceRowCount: 1 };
  const input = { success: true, readOnly: true, scope: { country: 'Netherlands', counName: '네덜란드', year: 2026, majorWeek: '42', scopeKey: 'Netherlands/2026/42' }, subweeks: [{ orderWeek: '42-01' }], rows: [raw], warnings: [] };
  const matrix = buildCountryOrderMatrix(input, '42-01'), row = matrix.rows[0];
  assert.equal(formatCountryOrderUnitBasis(row.unitBasis), '1송이 기준');
  assert.match(formatCountryOrderStoredQuantities(row.storedQuantities), /저장 단 120 · 송이 0/);
  assert.equal(row.quantities['1'], 0); assert.equal(row.total, 0); assert.equal(row.unit, 'stems');
  assert.match(matrix.blockers.join(' '), /STEM_QUANTITY_UNAVAILABLE/);
  assert.equal(formatCountryOrderUnitBasis({ ...row.unitBasis, unit: 'bunches', steamOf1Bunch: 10 }), '1단 = 10송이');
  assert.match(formatCountryOrderStoredQuantities({ ...row.storedQuantities, steamQuantity: null }), /송이 미등록/);
});

test('saved quantity details are keyboard accessible and expand in page flow, not tooltip-only or a small vertical box', () => {
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  assert.match(ui, /<details><summary>업체별 저장수량<\/summary><ul>/);
  assert.match(ui, /summary:focus-visible/);
  assert.match(ui, /\.pedidos-matrix \.pedidos-unit-basis, \.pedidos-matrix \.pedidos-stored-quantities[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(ui, /\.pedidos-stored-quantities[^}]*overflow-y/);
  assert.doesNotMatch(ui, /(?:^|[;{]\s*)(?:max-)?height:\s*\d+(?:px|vh)/m);
});

test('quantity-zero cells and totals display blank while diagnostic zero and product labels remain visible', () => {
  assert.equal(formatPedidosQuantity(0), ''); assert.equal(formatPedidosQuantity(-0), '');
  assert.equal(formatPedidosQuantity(null), ''); assert.equal(formatPedidosQuantity(1.23456789), '1.23456789');
  assert.equal(formatPedidosQuantity(-2), '-2');
  assert.match(formatCountryOrderStoredQuantities({ bunchQuantity: 120, steamQuantity: 0, boxQuantity: 0, outQuantity: 0 }), /송이 0/);
  const ui = fs.readFileSync(new URL('../components/import-tools/PedidosTool.js', import.meta.url), 'utf8');
  assert.match(ui, /formatPedidosQuantity\(row.quantities\[customer.key\] \?\? 0\)/);
  assert.match(ui, /formatPedidosQuantity\(row.total\)/);
  assert.match(ui, /formatPedidosQuantity\(output.totalQuantity\)/);
  assert.match(ui, /c === 0 \? \(cell == null \? '' : String\(cell\)\) : formatPedidosQuantity\(cell\)/);
  assert.match(ui, /formatCountryOrderStoredQuantities\(row.storedQuantities\)/);
});
