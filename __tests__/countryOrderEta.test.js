import './countryOrderDownloadHistory.test.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { countryOrderEtaDefault, formatCountryOrderEta, parseCountryOrderEta, withCountryOrderEta, countryOrderSourceComplete } from '../lib/countryOrderEta.js';
import { generatePedidosFromMatrix, serializePedidosWorkbook, readPedidosWorkbook } from '../lib/importPedidos.js';

test('ETA exact English weekday, strict actual date and leap year', () => {
  assert.equal(formatCountryOrderEta('2026-11-16'), 'ETA (2026-11-16 Monday)');
  assert.equal(formatCountryOrderEta('2028-02-29'), 'ETA (2028-02-29 Tuesday)');
  for (const date of ['', null, '2026-2-3', '2026-02-29', '2026-11-31', '2026-00-00', '10000-01-01', '1899-01-01']) assert.throws(() => parseCountryOrderEta(date));
});
test('country-local saved anchor advances actual ERP calendar, not ISO or minor week', () => {
  const scope = { year: 2026, week: '46-01', cycleStart: '2026-11-12' };
  assert.equal(countryOrderEtaDefault(null, scope), '2026-11-19');
  const saved = { ...scope, date: '2026-11-16' };
  assert.equal(countryOrderEtaDefault(saved, scope), '2026-11-16');
  assert.equal(countryOrderEtaDefault(saved, { ...scope, week: '46-02' }), '2026-11-16');
  assert.equal(countryOrderEtaDefault(saved, { year: 2026, week: '47-01', cycleStart: '2026-11-19' }), '2026-11-23');
  assert.equal(countryOrderEtaDefault({ year: 2026, week: '52-01', date: '2026-12-28', cycleStart: '2026-12-24' }, { year: 2027, week: '01-01', cycleStart: '2026-12-31' }), '2027-01-04');
  assert.equal(countryOrderEtaDefault(saved, { year: 2025, week: '46-01' }), '');
  assert.equal(countryOrderEtaDefault({ date: 'broken' }, scope), '2026-11-19');
  assert.equal(countryOrderEtaDefault(null, { ...scope, cycleStart: 'invalid' }), '');
});
test('hidden active orders prevent download, including legacy warning response', () => {
  assert.equal(countryOrderSourceComplete({ diagnostics: { hiddenOrderCount: 0 } }), true);
  assert.equal(countryOrderSourceComplete({}), false);
  for (const count of [1, -1, '0', NaN]) assert.equal(countryOrderSourceComplete({ diagnostics: { hiddenOrderCount: count } }), false);
  assert.equal(countryOrderSourceComplete({ warnings: ['HIDDEN_NATIVE_ORDERS: sample'] }), false);
});
test('all seven country Excel outputs keep every non-title value/formula/style and original workbook', () => {
  for (const [country, unit] of [['Netherlands','stems'],['China','bunches'],['Colombia','bunches'],['Australia','bunches'],['Thailand','bunches'],['Ecuador','stems'],['Vietnam','stems']]) {
    const matrix = { source:'erp', scope:{country,year:2026,orderWeek:'46-01'}, customers:[{key:'1',code:'CL21',name:'연습',label:'CL21'}], rows:[{key:'1',prodKey:1,name:'Tulip A',flower:'장미',unit,quantities:{1:150},total:150}],blockers:[],warnings:[] };
    for (const output of generatePedidosFromMatrix(matrix)) {
      const before = JSON.stringify(output.workbook), changed = withCountryOrderEta(output.workbook, '46-01', '2026-11-16');
      assert.equal(JSON.stringify(output.workbook), before);
      const original = readPedidosWorkbook(serializePedidosWorkbook(output.workbook)), reopened = readPedidosWorkbook(serializePedidosWorkbook(changed));
      for (const name of original.SheetNames) {
        assert.match(reopened.Sheets[name].A1.v, /Semana 46-01차 ETA \(2026-11-16 Monday\)$/);
        for (const [key, value] of Object.entries(original.Sheets[name])) if (!['A1','!rows'].includes(key)) assert.deepEqual(reopened.Sheets[name][key], value, `${country}/${key}`);
        assert.equal(changed.Sheets[name]['!rows'][0].hpt, 60);
      }
      assert.throws(() => withCountryOrderEta(output.workbook,'47-01','2026-11-16'), /차수/);
    }
  }
});
