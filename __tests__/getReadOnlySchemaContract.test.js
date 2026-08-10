import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('매출이익보고서 GET은 스키마를 조회만 하고 생성하지 않는다', () => {
  const api = read('pages/api/sales/profit-report.js');
  const lib = read('lib/profitReport.js');
  assert.match(api, /req\.method === 'GET'[\s\S]*await assertProfitReportReadSchema\(\)/);
  assert.doesNotMatch(lib, /export async function (?:stockPriceRows|periodDayRangesByMajor|loadManual)[\s\S]{0,180}await ensure(?:ProfitReport|StockPrice)Table\(\)/);
  assert.match(lib, /PROFIT_REPORT_SCHEMA_MISSING/);
  assert.match(api, /e\.statusCode \|\| 500/);
});

test('도착원가 GET 함수는 DDL ensure 대신 읽기 전용 스키마 검사를 사용한다', () => {
  const api = read('pages/api/arrival-cost/index.js');
  const historyApi = read('pages/api/arrival-cost/history.js');
  const lib = read('lib/arrivalCost.js');
  assert.doesNotMatch(lib, /export async function listArrivalCost\([\s\S]{0,350}await ensureArrivalCostTables\(\)/);
  assert.doesNotMatch(lib, /export async function searchArrivalCostFarms\([\s\S]{0,250}await ensureArrivalCostTables\(\)/);
  assert.doesNotMatch(lib, /export async function listArrivalCostHistory\([\s\S]{0,250}await ensureArrivalCostTables\(\)/);
  assert.match(lib, /ARRIVAL_COST_SCHEMA_MISSING/);
  assert.match(api, /error\.statusCode \|\| 400/);
  assert.match(historyApi, /error\.statusCode \|\| 400/);
});

test('POST 쓰기 함수는 웹 전용 스키마 초기화를 보존한다', () => {
  const profit = read('lib/profitReport.js');
  const arrival = read('lib/arrivalCost.js');
  assert.match(profit, /export async function saveManual[\s\S]{0,180}await ensureProfitReportTable\(\)/);
  assert.match(profit, /export async function saveStockPrices[\s\S]{0,180}await ensureStockPriceTable\(\)/);
  assert.match(arrival, /export async function createArrivalCostImport[\s\S]{0,180}await ensureArrivalCostTables\(\)/);
  assert.match(arrival, /export async function updateArrivalCostLine[\s\S]{0,180}await ensureArrivalCostTables\(\)/);
});

test('GET 오류가 안내하는 idempotent 배포 migration이 계약 scope에 존재한다', () => {
  const profitMigration = read('docs/migrations/2026-08-10_web_profit_report_schema.sql');
  const arrivalMigration = read('docs/migrations/2026-08-10_web_arrival_cost_schema.sql');
  const profitContract = JSON.parse(read('docs/contracts/weekly-profit-report.json'));
  const arrivalContract = JSON.parse(read('docs/contracts/arrival-cost.json'));
  assert.ok(profitContract.scope.includes('docs/migrations/2026-08-10_web_profit_report_schema.sql'));
  assert.ok(arrivalContract.scope.includes('docs/migrations/2026-08-10_web_arrival_cost_schema.sql'));
  assert.match(profitMigration, /IF NOT EXISTS[\s\S]*CREATE TABLE WebProfitReport/);
  assert.match(profitMigration, /IF NOT EXISTS[\s\S]*CREATE TABLE WebStockPrice/);
  assert.match(arrivalMigration, /IF OBJECT_ID\(N'dbo\.WebArrivalCostImport'/);
  assert.match(arrivalMigration, /IF OBJECT_ID\(N'dbo\.WebArrivalCostLine'/);
  assert.match(arrivalMigration, /COL_LENGTH\(N'dbo\.WebArrivalCostLine'/);
  assert.match(arrivalMigration, /IF OBJECT_ID\(N'dbo\.WebArrivalCostHistory'/);
});
