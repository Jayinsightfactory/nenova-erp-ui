// web.js — Railway 배포 진입점
// Railway는 web.js 를 시작 파일로 사용

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const jwt = require('jsonwebtoken');
const { attachRequestAudit } = require('./lib/userActivityHttp.cjs');
const { startRecoveryWorker } = require('./lib/pendingStockRecoveryWorker.cjs');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  if (!dev && process.env.NENOVA_PENDING_STOCK_RECOVERY === '1') {
    const recovery = startRecoveryWorker({ directory: process.env.NENOVA_STOCK_RECOVERY_DIR || require('path').join(process.cwd(), 'data', 'stock-recovery') });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { recovery.stop().finally(() => process.exit(0)); });
  }
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      if (parsedUrl.pathname.startsWith('/api/')) {
        let user = null;
        try {
          const cookie = /(?:^|;\s*)nenovaToken=([^;]+)/.exec(req.headers.cookie || '');
          const token = cookie ? decodeURIComponent(cookie[1]) : /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
          const secret = process.env.JWT_SECRET || (dev ? 'nenova-dev-only-secret-change-me' : null);
          if (token && secret) user = jwt.verify(token, secret);
        } catch { /* Unverified claims are never an audit actor. */ }
        attachRequestAudit(req, res, user);
      }
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
