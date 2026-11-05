'use strict';
// AI 제어 통로(로컬 전용). 기본 꺼짐이며 --ai-bridge 플래그 또는 NENOVA_AI_BRIDGE=1 환경변수로만 켠다.
// 127.0.0.1 전용 HTTP 서버 + 시작 시 생성한 랜덤 토큰(Bearer 필수). 원격 페이지에 preload를 넣지 않고,
// 모든 조작은 main 프로세스의 기존 탭(webContents)에 한정한다. ERP 쓰기성 경로의 click/fill은 기본 차단한다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

// ERP 쓰기(주문/분배/재고/입고/견적/마스터 등 erp-contract 계열) 경로: click/fill 기본 차단.
const WRITE_BLOCKED_PREFIXES = ['/orders', '/shipment', '/stock', '/warehouse', '/incoming', '/incoming-price', '/estimate', '/master', '/admin', '/purchase', '/sales', '/ecount', '/mgmt', '/finance', '/api'];
function isWriteBlockedPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return true;
  return WRITE_BLOCKED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'));
}

// 검증용 예외(차단 경로에서도 허용): 웹 화면이 data-ai-verify="<id>" 로 명시한 요소만, 그 속성 하나로만 고른 셀렉터.
// 콤마(OR)·조합자·추가 셀렉터를 금지해 속성 없는 요소(저장/적용/등록 버튼 등)에는 절대 닿지 못한다.
// 저장·적용 버튼은 웹 쪽에서 data-ai-verify 를 달지 않는 것이 규칙이다 (docs/desktop/AI_BRIDGE.md).
const VERIFY_SELECTOR = /^\[data-ai-verify(?:="[A-Za-z0-9_.:-]{1,120}")?\]$/;
function isVerifySelector(selector) {
  return typeof selector === 'string' && VERIFY_SELECTOR.test(selector);
}

// tabs/open 허용 판정: 같은 origin(trustedUrl) + bootstrap 메뉴 allowlist(또는 /dashboard, /login) 경로만.
function allowedOpenUrl(input, menus, trustedUrl) {
  if (typeof input !== 'string' || !input) return null;
  const url = trustedUrl(input, { popup: false });
  if (!url) return null;
  const pathname = new URL(url).pathname;
  if (['/', '/dashboard', '/login'].includes(pathname)) return url;
  for (const group of Array.isArray(menus) ? menus : []) {
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      try { if (new URL(item.href, url).pathname === pathname) return url; } catch { /* skip malformed */ }
    }
  }
  return null;
}

function restrictFileToUser(file) {
  // 사용자 전용 ACL(Windows). 실패해도 치명적이지 않은 best effort.
  if (process.platform !== 'win32' || !process.env.USERNAME) return;
  execFile('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], () => {});
}

function createAiBridge({ dir, trustedUrl, getMenus, tools, now = () => new Date().toISOString() }) {
  const tokenFile = path.join(dir, 'ai-bridge-token.json');
  const auditFile = path.join(dir, 'ai-bridge-audit.jsonl');
  const token = crypto.randomBytes(32).toString('hex');
  let server = null;

  function audit(entry) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(auditFile, JSON.stringify({ ts: now(), ...entry }) + '\n');
    } catch { /* 감사 로그 실패가 조작 결과를 바꾸지 않는다. */ }
  }
  function authorized(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return false;
    const given = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  async function dispatch(method, params) {
    const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const selector = typeof p.selector === 'string' && p.selector.length <= 500 ? p.selector : '';
    switch (method) {
      case 'tabs/list': return tools.tabsList();
      case 'tabs/open': {
        const url = allowedOpenUrl(p.url, getMenus(), trustedUrl);
        audit({ method, url: typeof p.url === 'string' ? p.url.slice(0, 500) : '', allowed: Boolean(url) });
        if (!url) throw new Error('허용된 업무 메뉴 경로가 아닙니다.');
        return tools.tabsOpen(url);
      }
      case 'page/text': return tools.pageText(p.tabId);
      case 'page/query': {
        if (!selector) throw new Error('selector가 필요합니다.');
        return tools.pageQuery({ tabId: p.tabId, selector, attribute: typeof p.attribute === 'string' ? p.attribute.slice(0, 100) : '', all: p.all === true });
      }
      case 'page/click': case 'page/fill': {
        if (!selector) throw new Error('selector가 필요합니다.');
        const url = await tools.resolveTabUrl(p.tabId);
        if (!url) throw new Error('대상 탭을 찾지 못했습니다.');
        const pathname = new URL(url).pathname;
        const verify = isVerifySelector(selector);
        const blocked = isWriteBlockedPath(pathname) && !verify;
        audit({ method, url: url.slice(0, 500), selector, allowed: !blocked, verify });
        if (blocked) throw new Error(`쓰기성 조작 차단 경로입니다: ${pathname} (검증용 [data-ai-verify="…"] 셀렉터만 허용)`);
        return method === 'page/click' ? tools.pageClick({ tabId: p.tabId, selector }) : tools.pageFill({ tabId: p.tabId, selector, value: typeof p.value === 'string' ? p.value.slice(0, 4000) : '' });
      }
      case 'page/scroll': {
        // 읽기성 네비게이션(검증용): selector = 해당 요소로 scrollIntoView, y = 절대 스크롤 위치(px). 경로 차단 없음.
        const y = Number.isFinite(p.y) ? Math.max(0, Math.min(1000000, p.y)) : null;
        if (!selector && y === null) throw new Error('selector 또는 y가 필요합니다.');
        return tools.pageScroll({ tabId: p.tabId, selector, y });
      }
      case 'page/screenshot': return tools.pageScreenshot(p.tabId);
      case 'console/logs': return tools.consoleLogs({ tabId: p.tabId, limit: Number.isFinite(p.limit) ? Math.min(200, Math.max(1, p.limit)) : 50 });
      default: throw new Error('지원하지 않는 method');
    }
  }

  function handle(req, res) {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    if (!authorized(req)) { audit({ method: 'auth', allowed: false, path: req.url }); return reply(401, { ok: false, error: '인증 토큰이 올바르지 않습니다.' }); }
    if (req.method !== 'POST' || req.url !== '/rpc') return reply(404, { ok: false, error: 'POST /rpc만 지원합니다.' });
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) { req.destroy(); } else chunks.push(chunk); });
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof body.method !== 'string') return reply(400, { ok: false, error: 'method가 필요합니다.' });
        const result = await dispatch(body.method, body.params);
        reply(200, { ok: true, result });
      } catch (error) {
        reply(error?.message?.includes('차단') || error?.message?.includes('허용된') ? 403 : 400, { ok: false, error: String(error?.message || error).slice(0, 500) });
      }
    });
  }

  return {
    tokenFile, auditFile,
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handle);
        server.on('error', reject);
        // 외부 바인딩 금지: 루프백 고정.
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(tokenFile, JSON.stringify({ port, token, pid: process.pid, startedAt: now() }), { mode: 0o600 });
            restrictFileToUser(tokenFile);
          } catch (error) { server.close(); return reject(error); }
          resolve({ port, token });
        });
      });
    },
    stop() {
      try { fs.rmSync(tokenFile, { force: true }); } catch { /* best effort */ }
      if (server) { server.close(); server = null; }
    },
  };
}

module.exports = { createAiBridge, allowedOpenUrl, isWriteBlockedPath, isVerifySelector, WRITE_BLOCKED_PREFIXES };
