#!/usr/bin/env node
// 네노바웹 운영 화면 콘솔 오류·실패 요청 점검 (읽기 전용)
// 사용: node scripts/ops-console-check.mjs [--base https://nenovaweb.com] [--paths /login,/] [--out 폴더] [--chrome 경로]
// 하는 일: 화면을 열고 → 콘솔 오류 목록 → 실패한 요청(4xx/5xx) 목록 → 화면 캡처. 클릭·입력·저장 도구는 호출하지 않는다.
// 로그인 필요 화면은 다루지 않는다(공개 화면만). 종료코드: 0=이상없음, 1=오류·실패 발견, 2=점검 자체 실패.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'https://nenovaweb.com').replace(/\/$/, '');
const paths = arg('paths', '/login').split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('/') ? s : '/' + s));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(arg('out', path.join('data', 'runtime', 'ops-console-check', stamp)));
const chrome = arg('chrome', process.env.CHROME_PATH || '');
const ALLOWED = new Set(['new_page', 'list_console_messages', 'list_network_requests', 'take_screenshot', 'close_page', 'list_pages']); // 읽기 전용 허용 도구

mkdirSync(outDir, { recursive: true });
const args = ['-y', 'chrome-devtools-mcp@1.12.0', '--headless', '--isolated', '--no-usage-statistics', '--no-performance-crux',
  '--allowedUrlPattern', base + '/*', '--workspace', outDir];
if (chrome) args.push('-e', chrome);
// 공백 경로 안전: shell 없이 실행(Windows 는 cmd.exe /c 로 npx 호출하되 인자는 개별 전달)
const child = process.platform === 'win32'
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))], { stdio: ['pipe', 'pipe', 'inherit'], windowsVerbatimArguments: true })
  : spawn('npx', args, { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', seq = 0; const waits = new Map();
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } } catch {}
  }
});
const rpc = (method, params) => new Promise((res, rej) => {
  const id = ++seq; const t = setTimeout(() => { waits.delete(id); rej(new Error('시간초과 ' + method)); }, 60000);
  waits.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = async (name, a = {}) => {
  if (!ALLOWED.has(name)) throw new Error('읽기 전용 위반: ' + name);
  const r = await rpc('tools/call', { name, arguments: a });
  const txt = (r.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  if (r.isError) throw new Error(name + ' 실패: ' + txt.slice(0, 200));
  return txt;
};

const findings = []; const pages = [];
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ops-console-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  for (const p of paths) {
    const url = base + p;
    const opened = await call('new_page', { url, timeout: 45000 }); // 운영 서버 첫 응답이 느릴 수 있어 여유(기본 10초는 부족)
    const sel = [...opened.matchAll(/^(\d+): .*\[selected\]/gm)].pop();
    const pageId = sel ? Number(sel[1]) : 2;
    const cons = await call('list_console_messages', { pageId });
    const net = await call('list_network_requests', { pageId });
    const shot = path.join(outDir, 'shot-' + (p.replace(/\W+/g, '_') || 'root') + '.png');
    try { await call('take_screenshot', { pageId, filePath: shot }); } catch (e) { findings.push({ page: p, kind: '캡처실패', detail: e.message }); }
    const errs = cons.split('\n').filter((l) => /^msgid=\d+ \[error\]/.test(l));
    const bad = net.split('\n').filter((l) => /^reqid=\d+ \S+ \S+ \[[45]\d\d\]/.test(l));
    errs.forEach((l) => findings.push({ page: p, kind: '콘솔오류', detail: l }));
    bad.forEach((l) => findings.push({ page: p, kind: '실패요청', detail: l }));
    pages.push({ path: p, consoleErrors: errs.length, failedRequests: bad.length, shot: existsSync(shot) ? shot : null });
    await call('close_page', { pageId }).catch(() => {});
  }
} catch (e) {
  console.error('점검 자체 실패:', e.message); child.kill(); process.exit(2);
}
child.kill();
const report = { checkedAt: new Date().toISOString(), base, pages, findings };
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`점검 ${pages.length}개 화면 · 콘솔오류 ${pages.reduce((a, b) => a + b.consoleErrors, 0)}건 · 실패요청 ${pages.reduce((a, b) => a + b.failedRequests, 0)}건`);
findings.forEach((f) => console.log(`- ${f.page} ${f.kind}: ${f.detail}`));
console.log('결과 폴더:', outDir);
process.exit(findings.length ? 1 : 0);
