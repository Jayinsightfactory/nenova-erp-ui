// ECOUNT 원본 화면 조사(버튼·검색패널·입력칸·간편검색 프리셋 날짜) — 전용 Playwright 브라우저. ⛔ 읽기 전용.
//
// 왜 전용 브라우저인가: Claude in Chrome 은 탭마다 세션ID 가 다르고 확장 재연결 때 탭 그룹이 바뀌어 재로그인이 반복됐다(2026-10-21).
// 여기서는 launchPersistentContext 한 창을 유지하고, ec_req_sid 가 붙은 base URL + 메뉴 해시로만 앱 안에서 이동한다.
//
// 2중 가드(README 의 절대 원칙 그대로):
//   1) prgId 화이트리스트 — --list 로 받은 조사 대상 화면 외로는 이동하지 않는다.
//   2) 네트워크 가드 — ECOUNT 로 가는 Save/Insert/Update/Delete/Write 류 요청과 PUT/DELETE/PATCH 는 abort.
//   + 페이지의 저장·삭제·전송·확정 버튼은 누르지 않는다. 클릭하는 것은 Search(F3) 토글·간편검색 프리셋·대화상자 '취소/닫기',
//     그리고 '검색창에 … 입력하고 검색 바랍니다' 안내창의 '확인'(1회)뿐이다. 브라우저 confirm/alert 는 dismiss.
//
// 로그인: 비밀번호는 절대 다루지 않는다. 로그인 화면이면 회사코드·사용자ID 칸이 비어 있을 때만 채우고(비밀번호 칸은 손대지 않음),
//   로그인 버튼도 누르지 않는다. 창 제목을 바꿔 사람이 찾기 쉽게 하고 <out>/_status.json 에 state=login-required 를 쓴다.
// 세션 유지: 조사가 끝난 뒤에도 KEEPALIVE_MIN(기본 5)분마다 화이트리스트 화면 해시로 이동, KEEPALIVE_HOURS(기본 1) 후 종료.
// 매일 수집 데몬(NenovaEcountDaemon, ecount-profile)과 충돌하지 않도록 프로필은 ecount-profile-survey 를 쓴다.
//
// 사용:
//   node survey-run.mjs --list <list.json> --out <dir>          # list = [[prgId, '#menuType=…&prgId=…', packet, label], …]
//   node survey-run.mjs --build <dir> --out <survey.json> [--label "P040~P059"]   # 화면별 파일 → ingest 형식 조사 JSON
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PROFILE = path.join(__dirname, 'ecount-profile-survey');
const ERP_ROOT = 'https://logincc.ecount.com/ec56/view/erp';
const COMPANY_CODE = '647026';
const USER_ID = 'NENOVA';
const WINDOW_TITLE = '★ ECOUNT 전용 조사 창 — 비밀번호만 입력 후 로그인 ★';
const KEEPALIVE_MS = Math.max(1, Number(process.env.KEEPALIVE_MIN) || 5) * 60 * 1000;
const KEEPALIVE_HOURS = Number(process.env.KEEPALIVE_HOURS ?? 1);
const WRITE_RE = /(save|insert|update|delete|remove|regist|modify|submit|\/ins\b|\/upd\b|\/del\b)/i;
const READ_RE = /(excel|export|download|print|report|view|list|search|inquiry|getdata|cache|grid|menu|resource|login)/i;
const CTX = { T: 'wrapper-toolbar', S: 'wrapper-toolbar.header-search-btn-group', B: 'wrapper-toolbar.toolbar-collapse', D: 'dialog:', O: 'other' };
const kstDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const now = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

// 개인정보·식별값 마스킹(패널 텍스트·라벨에 섞여 들어오는 경우). 업무 값은 원래 수집하지 않는다.
export function mask(value) {
  return JSON.parse(JSON.stringify(value)
    .replace(/\d{3}-\d{2}-\d{5}/g, '[사업자번호]')
    .replace(/\d{6}-[1-4]\d{6}/g, '[주민번호]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[이메일]')
    .replace(/0\d{1,2}-\d{3,4}-\d{4}/g, '[전화]'));
}

// ---- 화면별 파일 → ingest 형식 ------------------------------------------------------------------------
export function build(dir, label) {
  const results = {}; const empty = []; const dates = new Set();
  for (const f of fs.readdirSync(dir).filter(n => /^[A-Z]\d{6}\.json$/.test(n)).sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const r = rec.result; dates.add(rec.observedOn);
    // 앞 화면에서 남은 ECOUNT 안내창 확인 버튼은 화면 버튼이 아니다.
    const controls = r.c.filter(([l, , code]) => !(code === 'D' && l === '확인'));
    if (!controls.some(([l]) => l !== '사이트맵')) { empty.push(rec.program); continue; }
    results[rec.program] = { title: r.t, panelText: r.x, observedOn: rec.observedOn, controls: controls.map(([l, d, code]) => [l, '', d, CTX[code] || 'other']), fields: r.f.map(([l, t, q]) => [l, t, '', q, '', 0]), presets: r.p.map(([l, d]) => [l, d]) };
  }
  const observedOn = [...dates].sort().pop() || kstDate();
  return {
    observedOn, site: 'ECOUNT logincc.ecount.com/ec56 (dedicated Playwright profile ecount-profile-survey, read-only survey)',
    method: `in-page survey of ${Object.keys(results).length} ${label || ''} programs: hash navigate within the session URL, open search panel, enumerate visible controls [label, disabled, ctxCode], visible input fields [label, type, required], click 간편검색 presets (except 설정/검색(F8)) and read the date widget; no save/confirm/delete/transmit clicked; ECOUNT confirm dialogs cancelled with 취소/닫기; browser dialogs dismissed; network write guard active`,
    privacy: { rawBusinessValues: false, personalData: false, accountValues: false, credentials: false, sessionUrls: false },
    notes: ['ctx codes T/S/B/D/O → wrapper-toolbar / header-search-btn-group / toolbar-collapse / dialog / other; fields carry label/type/required only', 'business/registration numbers, e-mails and phone numbers masked', `not rendered (sitemap link only) and excluded: ${empty.join(',') || 'none'}`, `observed dates: ${[...dates].sort().join(',')}`],
    errors: [], results,
  };
}

// ---- 페이지 안 조사 도우미(브라우저에서 실행) --------------------------------------------------------------
const SRV = String.raw`window.__srv={
 docs(){const docs=[document];for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument)docs.push(f.contentDocument);}catch{}}return docs;},
 vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;},
 txt(el){if(!el)return '';return (el.getAttribute('aria-label')||el.getAttribute('title')||el.value||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,40);},
 panel(){for(const d of this.docs()){const p=d.querySelector('.wrapper-header-search');if(p)return p;}return null;},
 dates(){const p=this.panel();if(!p)return '';return [...p.querySelectorAll('.selectbox-label, input.form-control:not(.hidden), span')].map(e=>(e.tagName==='INPUT'?e.value:e.textContent).trim()).filter(v=>/^(\d{1,4}|~)$/.test(v)).slice(0,9).join(' ');},
 async open(){const sleep=ms=>new Promise(r=>setTimeout(r,ms));const p=this.panel();if(p&&!this.vis(p)){for(const d of this.docs()){const b=[...d.querySelectorAll('button')].find(b=>this.vis(b)&&/Search/.test(b.textContent));if(b){b.click();await sleep(700);break;}}}return p?this.vis(p):false;},
 async closeDialogs(){const sleep=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<4;i++){const b=[...document.querySelectorAll('.ui-dialog button, .custom-alert button')].find(b=>this.vis(b)&&(b.textContent||'').trim()==='확인'&&/입력하고 검색 바랍니다/.test(((b.closest('.ui-dialog')||b.closest('.custom-alert'))||{}).innerText||''));if(!b)break;b.click();await sleep(300);}for(let i=0;i<15;i++){const btn=[...document.querySelectorAll('button, a')].find(b=>this.vis(b)&&/^(취소|닫기)$/.test((b.textContent||'').trim())&&b.closest('.ui-dialog,[class*=dialog],[class*=modal],[class*=popup],[class*=layer],[role=dialog]'));if(!btn)return i;btn.click();await sleep(350);}return 15;},
 async presets(){const sleep=ms=>new Promise(r=>setTimeout(r,ms));await this.open();const log=[['initial',this.dates()]];const labels=[];for(const d of this.docs())for(const b of d.querySelectorAll('.header-search-btn-group button'))if(this.vis(b)){const l=b.textContent.trim();if(l&&!/^(검색\(F8\)|설정)$/.test(l))labels.push(l);}for(const label of labels){await this.open();let btn=null;for(const d of this.docs()){btn=[...d.querySelectorAll('.header-search-btn-group button')].find(b=>b.textContent.trim()===label);if(btn)break;}if(!btn){log.push([label,'missing']);continue;}btn.click();await sleep(1200);await this.closeDialogs();log.push([label,this.dates()]);}await this.open();return log;},
 ctxCode(c){if(/^dialog:/.test(c))return 'D';if(/toolbar-collapse/.test(c))return 'B';if(/header-search-btn-group|header-search/.test(c))return 'S';if(/wrapper-toolbar/.test(c))return 'T';return 'O';},
 controls(){const seen=new Set();const out=[];const ctxOf=el=>{const d=el.closest('.ui-dialog,[role=dialog],.modal,[class*=popup],[class*=layer],[class*=dialog]');if(d)return 'dialog:'+(this.txt(d.querySelector('h1,h2,h3,.title,[class*=title]'))||String(d.className).slice(0,30));const t=el.closest('[class*=toolbar],[class*=btn-area],[class*=header],[class*=footer],[class*=search],form');return t?String(t.className).split(' ').slice(0,2).join('.'):'body';};for(const doc of this.docs()){for(const el of doc.querySelectorAll('button, a[role=button], a.btn, a[class*=btn], input[type=button], input[type=submit], [role=tab], [role=menuitem], span[class*=btn]')){if(!this.vis(el))continue;const label=this.txt(el);if(!label||/^(\d{1,4}|[=.]+)$/.test(label))continue;const ctx=ctxOf(el);const key=ctx+'|'+label;if(seen.has(key))continue;seen.add(key);out.push([label,el.disabled?1:0,this.ctxCode(ctx)]);}}return out;},
 fields(){const out=[];const seen=new Set();for(const d of this.docs()){for(const el of d.querySelectorAll('input, select, textarea')){if(!this.vis(el))continue;if(['hidden','button','submit','password'].includes(el.type))continue;if(el.closest('.menu-search,.wrapper-header-search'))continue;let label='';const id=el.id;if(id){try{const l=d.querySelector('label[for="'+CSS.escape(id)+'"]');if(l)label=l.textContent.trim();}catch{}}if(!label){const wrap=el.closest('tr,li,div');const th=wrap?.querySelector('th,label,.label,[class*=label],[class*=title]');if(th)label=th.textContent.replace(/\s+/g,' ').trim().slice(0,30);}label=label||el.getAttribute('aria-label')||el.placeholder||'';const req=!!(el.required||el.getAttribute('aria-required')==='true'||/required|essential|must/i.test(el.className)||el.closest('[class*=required],[class*=essential]'));const type=el.tagName==='SELECT'?'select':el.type||'text';const key=label+'|'+type;if(seen.has(key))continue;seen.add(key);out.push([label.slice(0,30),type,req?1:0]);}}return out;}
};true`;

// 한 화면 조사(브라우저 안). 렌더 대기: 제목 변경 + 컨트롤 > 3, 최대 16초.
async function surveyInPage({ hash, minWait }) {
  const s = window.__srv; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const before = document.title; location.hash = hash; await sleep(2500); let waited = 2500;
  while (waited < minWait) { const c = s.controls(); if (document.title !== before && c.length > 3) break; await sleep(1000); waited += 1000; }
  await sleep(1200); await s.closeDialogs(); await s.open();
  const p0 = s.panel(); const x = p0 ? p0.innerText.replace(/\s+/g, ' ').slice(0, 300) : '';
  const c = s.controls(); const f = s.fields(); const p = s.panel() ? await s.presets() : [];
  await s.closeDialogs();
  return { t: document.title, x, c, f, p, w: waited };
}

function writeStatus(out, data) { fs.writeFileSync(path.join(out, '_status.json'), JSON.stringify({ ...data, at: new Date().toISOString() }, null, 1)); }

async function main() {
  if (opt('--build')) {
    const survey = mask(build(opt('--build'), opt('--label', '')));
    fs.writeFileSync(opt('--out'), JSON.stringify(survey, null, 1));
    console.log(JSON.stringify({ out: opt('--out'), programs: Object.keys(survey.results).length, notes: survey.notes }));
    return;
  }
  const { chromium } = await import('playwright');
  const list = JSON.parse(fs.readFileSync(opt('--list'), 'utf8'));
  const OUT = opt('--out'); fs.mkdirSync(OUT, { recursive: true });
  const ALLOWED = new Set(list.map(([prg]) => prg));            // 가드 1: prgId 화이트리스트
  for (const [prg, hash] of list) if (!new RegExp(`[#&]prgId=${prg}(&|$)`).test(hash)) throw new Error(`hash/prgId 불일치: ${prg}`);

  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1600, height: 900 }, args: ['--start-maximized'] });
  await ctx.route('**/*', route => {                            // 가드 2: 쓰기 요청 차단
    const u = route.request().url(); const m = route.request().method();
    let host = '', pathq = ''; try { const url = new URL(u); host = url.hostname; pathq = url.pathname + url.search; } catch {}
    const isEcount = /(^|\.)ecount\.com$/i.test(host);
    // 2026-10-22: 정적 모듈 GET(예 /static/…/temporary_save/temporary_save.js)은 파일 이름에 save 가 들어 있어도 쓰기가 아니다.
    //   막으면 입력 화면이 렌더되지 않는다. GET + /static/ + 정적 확장자만 예외, API 호출·POST 쓰기는 계속 차단.
    const staticAsset = m === 'GET' && /\/static\//i.test(pathq) && /\.(js|css|png|gif|jpe?g|svg|woff2?|ttf|map)(\?|$)/i.test(pathq);
    const isWrite = (WRITE_RE.test(pathq) && !READ_RE.test(pathq) && !staticAsset) || ['PUT', 'DELETE', 'PATCH'].includes(m);
    if (isEcount && isWrite) { console.error(`🛑 [READ-ONLY GUARD] ECOUNT 쓰기 차단: ${m} ${u.slice(0, 100)}`); return route.abort(); }
    return route.continue();
  });
  await ctx.addInitScript(title => { if (location.hostname === 'login.ecount.com') { const set = () => { if (document.title !== title) document.title = title; }; set(); setInterval(set, 1000); } }, WINDOW_TITLE);
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  // 창이 닫히면 원인을 남긴다: 직전 URL·제목·진행 화면·콘솔 로그 30줄, 닫힘 종류(page close / crash / context close).
  const consoleTail = []; let lastTitle = ''; let current = null;
  page.on('console', msg => { consoleTail.push(`${new Date().toISOString()} ${msg.type()} ${msg.text().slice(0, 200)}`); if (consoleTail.length > 30) consoleTail.shift(); });
  const recordClose = kind => { try { fs.writeFileSync(path.join(OUT, `_close-cause-${Date.now()}.json`), JSON.stringify(mask({ kind, at: new Date().toISOString(), lastUrl: String(page.url()).replace(/ec_req_sid=[^&#]+/, 'ec_req_sid=REDACTED'), lastTitle, current, consoleTail }), null, 1)); console.error(`🔴 [${now()}] 창 닫힘 감지(${kind}) — 직전 화면 ${current ? current.join(' ') : '(로그인 대기 중)'}`); } catch {} };
  page.on('close', () => recordClose('page-close'));
  page.on('crash', () => recordClose('page-crash'));
  ctx.on('close', () => recordClose('context-close'));
  setInterval(() => { page.title().then(t => { lastTitle = t; }).catch(() => {}); }, 5000).unref();

  const onLogin = () => /login\.ecount\.com/i.test(page.url());
  const onErp = () => /logincc\.ecount\.com\/.*\/view\/erp/i.test(page.url());
  async function prefill() {   // 회사코드·ID 만, 비어 있을 때만. 비밀번호 칸·로그인 버튼은 건드리지 않는다.
    return page.evaluate(({ c, u }) => { const set = (id, v) => { const e = document.getElementById(id); if (e && !e.value) { e.focus(); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 'filled'; } return e ? 'kept' : 'absent'; }; return { com_code: set('com_code', c), id: set('id', u) }; }, { c: COMPANY_CODE, u: USER_ID }).catch(() => null);
  }
  async function waitLogin(reason) {
    if (!onLogin()) await page.goto('https://login.ecount.com/').catch(() => {});
    console.log(`⚠ [${now()}] 로그인 필요(${reason}) — 창 제목 '${WINDOW_TITLE}'. 비밀번호만 입력해 주세요.`);
    let filled = null;
    for (;;) {
      if (onErp()) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500); if (onErp()) break; }
      if (onLogin()) { const r = await prefill(); if (JSON.stringify(r) !== JSON.stringify(filled)) { filled = r; console.log(`   prefill ${JSON.stringify(r)}`); } }
      writeStatus(OUT, { state: 'login-required', reason, windowTitle: WINDOW_TITLE, prefill: filled, done: doneCount(), total: list.length });
      await page.waitForTimeout(3000);
    }
    console.log(`✅ [${now()}] 로그인 확인.`);
  }
  const doneCount = () => list.filter(([prg]) => fs.existsSync(path.join(OUT, `${prg}.json`))).length;

  // 세션 부팅: 처음 한 번만 루트로 이동(프로필 쿠키로 세션 복원 시도). 이후에는 세션ID 없는 주소로 절대 이동하지 않는다.
  await page.goto(ERP_ROOT, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(2500);
  if (!onErp()) await waitLogin('start');
  let base = page.url().split('#')[0];
  const go = async hash => { const prg = (hash.match(/prgId=([A-Z]\d{6})/) || [])[1]; if (!ALLOWED.has(prg)) throw new Error(`화이트리스트 밖 화면: ${prg}`); return hash; };
  const ensureSrv = async () => { if (!(await page.evaluate(() => !!window.__srv).catch(() => false))) await page.evaluate(SRV); };
  const rebootIfNeeded = async () => { if (!onErp()) { await waitLogin('session-lost'); base = page.url().split('#')[0]; } };

  const SKIP = new Set(String(process.env.SKIP_PRG || '').split(',').filter(Boolean));   // 조사 제외(예: 열 때 창이 닫힌 화면)
  for (const [prg, hash, packet, label] of list) {
    const file = path.join(OUT, `${prg}.json`);
    if (fs.existsSync(file)) continue;                          // 재개: 이미 저장된 화면은 건너뜀
    if (SKIP.has(prg)) { console.log(`  [${prg}] ${packet} ${label}: 제외(SKIP_PRG)`); continue; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      await rebootIfNeeded(); await ensureSrv();
      current = [prg, packet, label, `attempt ${attempt}`];
      writeStatus(OUT, { state: 'running', program: prg, packet, label, attempt, done: doneCount(), total: list.length });
      let result = null;
      try {
        result = await Promise.race([page.evaluate(surveyInPage, { hash: await go(hash), minWait: attempt === 1 ? 16000 : 30000 }), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 180000))]);
      } catch (e) { console.error(`  [${prg}] ${e.message.slice(0, 120)}`); }
      if (!onErp()) continue;                                    // 조사 중 세션이 끊기면 재로그인 후 같은 화면 다시
      const rendered = result && result.c.some(([l]) => l !== '사이트맵');
      if (result && (rendered || attempt === 3)) {
        fs.writeFileSync(file, JSON.stringify(mask({ program: prg, packet, menuLabel: label, observedOn: kstDate(), result }), null, 1));
        console.log(`  [${prg}] ${packet} ${label}: 컨트롤 ${result.c.length} · 입력칸 ${result.f.length} · 프리셋 ${result.p.length}${rendered ? '' : ' (미렌더)'}`);
        break;
      }
    }
  }
  writeStatus(OUT, { state: 'done', done: doneCount(), total: list.length });
  console.log(`🏁 [${now()}] 조사 완료 ${doneCount()}/${list.length}. 세션 유지 ${KEEPALIVE_HOURS}시간(${KEEPALIVE_MS / 60000}분 간격).`);

  const until = Date.now() + KEEPALIVE_HOURS * 3600 * 1000;    // 세션 유지: 조회 화면 해시 이동만
  while (Date.now() < until) {
    await page.waitForTimeout(KEEPALIVE_MS);
    if (!onErp()) { writeStatus(OUT, { state: 'session-lost-after-done', done: doneCount(), total: list.length }); break; }
    await page.evaluate(h => { location.hash = h; }, await go(list[0][1])).catch(() => {});
    writeStatus(OUT, { state: 'keepalive', done: doneCount(), total: list.length });
  }
  await ctx.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e);
  if (opt('--out') && !opt('--build') && /closed/i.test(String(e && e.message))) { try { writeStatus(opt('--out'), { state: 'browser-closed', error: String(e.message).slice(0, 200) }); } catch {} }
  process.exit(1);
});
