// Deployment-only READ check. No source payloads, credentials, screenshots or raw amounts are logged.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const origin = 'https://nenovaweb.com';
async function main() {
  const token = process.env.NENOVAWEB_SERVICE_TOKEN;
  assert(token, 'Service credential unavailable');
  const probes = new Map();
  for (const week of ['35', '37', '40', '41', '43', '44']) {
    const response = await fetch(`${origin}/api/sales/customs-clearance?year=2026&week=${week}`, {
      method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90000),
    });
    assert.equal(response.status, 200, `Customs ${week} GET status`);
    const data = await response.json();
    assert.equal(data.success, true); assert.equal(String(data.orderYear), '2026'); assert.equal(String(data.major), week);
    assert(Array.isArray(data.phase03?.rows));
    assert(data.phase03.rows.every(r => r.year === '2026' && r.orderWeek === `${week}-03`));
    if (['40', '41', '43'].includes(week)) assert(data.phase03.rows.some(r => r.category === '중국' && r.legacyPhase === '01'), `Legacy ${week} duplicate guard`);
    if (week === '44') assert(data.phase03.rows.some(r => r.category === '중국' && r.awb === '99997130176' && !r.legacyPhase), '44-03 exact candidate');
    const vietnam = data.countries.find(r => r.category === '베트남');
    const evidence = vietnam?.effectiveRow?.VietnamFeeEvidence || [];
    for (const e of evidence) { assert.equal(e.applied, e.net + e.vat); assert.equal(e.applied, e.gross); assert.equal(e.policy, 'workbook_gross'); }
    if (week === '35' && Number(vietnam?.saved?.SunYul1) === 63000) assert(evidence.some(e => e.phase === 1 && e.applied === 69300), 'Verified 35 net-to-gross projection');
    probes.set(week, data);
    console.log(JSON.stringify({ week, status: 'PASS', phase03Rows: data.phase03.rows.length, vietnamEvidenceRows: evidence.length, actualBusinessWrites: 0 }));
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
    let blockedWrites = 0; const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) { blockedWrites++; return req.abort('blockedbyclient'); }
      if (url.origin !== origin) return req.abort('blockedbyclient');
      if (url.pathname.startsWith('/api/')) return req.continue({ headers: { ...req.headers(), authorization: `Bearer ${token}` } });
      return req.continue();
    });
    await page.goto(`${origin}/sales/customs-clearance?year=2026&week=44`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('[aria-label="03차 AWB별 통관 비용"]', { timeout: 90000 });
    const panel = await page.$eval('[aria-label="03차 AWB별 통관 비용"]', e => e.textContent);
    assert(panel.includes('44-03') && panel.includes('99997130176'));
    assert.equal(errors.length, 0, 'No client runtime errors');
    console.log(JSON.stringify({ productionUi: 'PASS', year: '2026', week: '44', blockedBackgroundWrites: blockedWrites, actualBusinessWrites: 0 }));
  } finally { await browser.close(); }
}
main().catch(() => { console.error('CUSTOMS_PHASE03_READ_SMOKE_FAILED (no source data logged)'); process.exitCode = 1; });
