// Isolated real Next page; all APIs are intercepted, never connects to ERP.
const http = require('node:http');
const next = require('next');
const app = next({ dev: false, hostname: '127.0.0.1', port: 3197 });
app.prepare().then(() => http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/')) return app.getRequestHandler()(req, res);
  const send = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (req.method !== 'GET') { res.statusCode = 403; return send({ success: false }); }
  if (url.pathname === '/api/auth/me') return send({ success: true, user: { userId: 'fixture', userName: '격리 검증', role: 'admin', isAdmin: true } });
  if (url.pathname === '/api/stats/pivot-weeks') {
    const year = url.searchParams.get('orderYear');
    const incoming = url.searchParams.get('source') === 'incoming';
    return send({ success: true, weeks: year === '2026' ? (incoming ? ['44-01','43-02'] : ['50-01','44-01']) : year === '2025' ? (incoming ? ['41-02'] : ['50-01']) : [] });
  }
  if (url.pathname === '/api/stats/pivot-volume-excel') {
    console.log('QUERY', url.searchParams.toString());
    return send({ success: true, items: [{ key: 'fixture', species: `검증품종 ${url.searchParams.get('orderYear')} ${url.searchParams.get('weekStart')}~${url.searchParams.get('weekEnd')}` }] });
  }
  return send({ success: true, items: [], favorites: [] });
}).listen(3197, '127.0.0.1', () => console.log('Isolated volume menu http://127.0.0.1:3197')));
