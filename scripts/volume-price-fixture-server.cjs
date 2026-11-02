// Local Next UI integration fixture. Every API is intercepted; no ERP connection.
const http = require('node:http');
const next = require('next');
const XLSX = require('xlsx-js-style');
const app = next({ dev: false, hostname: '127.0.0.1', port: 3199 });
const customers = [1, 2].map(n => ({ custKey: n, custName: `검증업체${n}`, orderCode: `CL${n}`, area: '서울' }));
let loads = 0, previews = 0, applyAttempts = 0, snapshot;
app.prepare().then(() => http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname;
  if (!path.startsWith('/api/')) return app.getRequestHandler()(req, res);
  const send = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (path === '/api/auth/me') return send({ success: true, user: { userId: 'fixture', userName: '격리 검증', role: 'admin', isAdmin: true } });
  if (path === '/api/stats/pivot-weeks') return send({ success: true, weeks: ['44-02'] });
  if (path === '/api/stats/pivot-data') return send({ success: true, customers, customersByKey: customers, rows: [] });
  if (path === '/api/customers/search') return send({ success: true, customers: customers.map(c => ({ CustKey: c.custKey, CustName: c.custName, OrderCode: c.orderCode, CustArea: c.area })) });
  if (path === '/api/stats/pivot-volume-excel') {
    loads += 1;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['네덜란드'], ['', '', '', '월', '월'], ['꽃', '품목명', '칼라', '검증업체1\nCL1', '검증업체2\nCL2', '주문', '입고', '재고', '잔량'], ['수국', 'Blue', '파랑', 5 + loads, 3, 8 + loads, 20, 0, 12 - loads], ['합계', '', '', 5 + loads, 3, 8 + loads, 20, 0, 12 - loads]]);
    XLSX.utils.book_append_sheet(wb, ws, '네덜란드');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.end(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  if (path === '/api/shipment/dutch-volume-preview') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); previews += 1;
    const entryMatches = payload.entries.map(e => ({ id: e.id, custKey: e.sourceCustKey || (e.customer.includes('1') ? 1 : 2), prodKey: 10, status: 'matched', estUnit: '단' }));
    return send({ success: true, rows: entryMatches.map(m => ({ entryIds: [m.id], custKey: m.custKey, prodKey: 10, currentCost: m.custKey === 1 ? 15000 + (loads - 1) * 1000 : 0 })), entryMatches, unmatched: [], blockers: ['격리 검증: 적용 금지'], customerOptions: customers, productOptions: [] });
  }
  if (path === '/api/shipment/dutch-volume-work') {
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      snapshot = { ...JSON.parse(raw), id: 'fixture', savedAt: new Date().toISOString(), savedBy: 'fixture' };
      return send({ success: true, snapshot });
    }
    if (url.searchParams.has('id')) return send({ success: true, snapshot });
    return send({ success: true, items: snapshot ? [{ ...snapshot, entryCount: snapshot.entries.length }] : [], nextCursor: null });
  }
  if (path === '/api/fixture-state') return send({ loads, previews, applyAttempts, snapshot });
  if (path.includes('-apply')) { applyAttempts += 1; res.statusCode = 403; return send({ error: 'ERP apply disabled' }); }
  return send({ success: true, items: [], favorites: [] });
}).listen(3199, '127.0.0.1', () => console.log('Price fixture http://127.0.0.1:3199; all APIs isolated')));
