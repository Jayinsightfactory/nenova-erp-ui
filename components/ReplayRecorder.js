// components/ReplayRecorder.js
// nenovaweb 화면 기록기(rrweb). 기록 대상 계정(/api/work/replay?me=1 → record:true)에서만 rrweb 을 내려받아 켠다.
// 화면 구조(DOM)와 클릭·입력·이동을 이벤트로 남겨 /my-work 에서 그대로 재생 — 화면 해독(Vision) 비용 0, 값은 정확.
// 비밀번호 입력은 항상 가린다. /login·/my-work(재생 화면)는 기록하지 않는다.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

const SKIP = (p) => p === '/login' || p === '/' || p.startsWith('/my-work');
const newId = () => 's' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

// 클릭/입력 대상의 사람이 읽는 이름: aria-label → 연결된 label → placeholder → 버튼 글자 → name
function labelOf(el) {
  if (!el || !el.getAttribute) return '';
  const pick = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const aria = el.getAttribute('aria-label'); if (aria) return pick(aria);
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return pick(l.textContent); }
  const wrap = el.closest && el.closest('label'); if (wrap) return pick(wrap.textContent);
  if (el.placeholder) return pick(el.placeholder);
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') return pick(el.textContent);
  if (tag === 'td' || tag === 'th') return pick(el.textContent);
  return pick(el.name || el.title || '');
}

export default function ReplayRecorder() {
  const router = useRouter();
  useEffect(() => {
    let stop = null, timer = null, buf = [], sessionId = newId(), alive = true, rr = null;
    const flush = (beacon) => {
      if (!buf.length) return;
      const body = JSON.stringify({ sessionId, events: buf.splice(0, buf.length) });
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/work/replay', body); return; }
      fetch('/api/work/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
        .then((r) => r.json()).then((j) => { if (j && j.full) restart(); }).catch(() => {});
    };
    const custom = (tag, payload) => { try { if (rr && stop) rr.record.addCustomEvent(tag, { path: location.pathname, ...payload }); } catch {} };
    const onClick = (e) => { const el = e.target.closest ? (e.target.closest('button,a,[role=button],input,select,textarea,td,th,label') || e.target) : e.target; custom('nv-click', { label: labelOf(el), tag: (el.tagName || '').toLowerCase() }); };
    const onChange = (e) => { const el = e.target; if (!el || el.type === 'password') return; custom('nv-input', { label: labelOf(el), tag: (el.tagName || '').toLowerCase(), value: el.type === 'checkbox' ? String(el.checked) : String(el.value ?? '').slice(0, 120) }); };
    const onRoute = (url) => { custom('nv-route', { path: String(url).split('?')[0] }); if (SKIP(String(url).split('?')[0])) halt(); else if (!stop) begin(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    function begin() {
      if (!rr || stop || SKIP(location.pathname)) return;
      stop = rr.record({ emit: (ev) => { buf.push(ev); if (buf.length >= 120) flush(); }, maskInputOptions: { password: true }, sampling: { mousemove: false, scroll: 200, input: 'last' }, recordCanvas: false, collectFonts: false });
      custom('nv-route', { path: location.pathname });
    }
    function halt() { if (stop) { try { stop(); } catch {} stop = null; flush(); } }
    function restart() { halt(); sessionId = newId(); begin(); }

    // 로그인 화면에서 시작하면 아직 계정이 없다 → 화면이 바뀔 때마다 기록 대상인지 다시 묻고, 한 번 켜지면 더 묻지 않는다.
    let asking = false;
    const ensure = () => {
      if (rr || asking || !alive || location.pathname === '/login') return;
      asking = true;
      fetch('/api/work/replay?me=1').then((r) => (r.ok ? r.json() : null)).then(async (j) => {
        if (!alive || !j || !j.record) return;
        rr = await import('rrweb');
        if (!alive) return;
        begin();
        timer = setInterval(() => flush(), 5000);
        document.addEventListener('click', onClick, true);
        document.addEventListener('change', onChange, true);
        document.addEventListener('visibilitychange', onHide);
      }).catch(() => {}).finally(() => { asking = false; });
    };
    const onRouteAny = (url) => { if (rr) onRoute(url); else ensure(); };
    router.events.on('routeChangeComplete', onRouteAny);
    ensure();

    return () => {
      alive = false; if (timer) clearInterval(timer);
      document.removeEventListener('click', onClick, true); document.removeEventListener('change', onChange, true); document.removeEventListener('visibilitychange', onHide);
      router.events.off('routeChangeComplete', onRouteAny); halt();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
