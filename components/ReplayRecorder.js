// components/ReplayRecorder.js
// nenovaweb 화면 기록기(rrweb). 기록 대상 계정(직원, /api/work/replay?me=1 → record:true)에서만 rrweb 을 내려받아 켠다.
// 화면 구조(DOM)와 클릭·입력·이동을 이벤트로 남겨 /my-work 에서 그대로 재생 — 화면 해독(Vision) 비용 0, 값은 정확.
// 비밀번호 입력은 항상 가린다. /login·/my-work 는 기록하지 않는다. (화면 표시는 없음)
//
// 직원 PC 는 RAM 8~16GB(크롬·엑셀·카톡·전산 동시 사용) → 기록이 업무를 느리게 하면 안 된다. 두 단계로 돈다:
//   full : 화면 구조까지 기록(재생 가능).   lite : 단계(이동·클릭·입력값)만 기록 — DOM 을 건드리지 않아 부담이 거의 0.
// 아래 중 하나라도 해당하면 그 화면은 lite 로 내려간다(화면이 바뀔 때마다 다시 판단):
//   - 기기 메모리 8GB 미만(navigator.deviceMemory)      - 화면 요소 12,000개 초과(피벗·붙여넣기 같은 거대 표)
//   - 브라우저 JS 힙 70% 초과(performance.memory)        - 10초에 이벤트 2,500건 초과(표 전체 다시 그리기 폭주) → 60초 lite
// 버퍼는 120건 또는 약 1.5MB 마다 바로 내보내 메모리에 쌓아두지 않는다. 마우스 이동·포커스·누름/뗌은 기록하지 않는다.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

const SKIP = (p) => p === '/login' || p === '/' || p.startsWith('/my-work');
const newId = () => 's' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const MAX_NODES = 12000, HEAP_RATIO = 0.7, STORM_EVENTS = 2500, STORM_WINDOW = 10000, STORM_COOLDOWN = 60000, BUF_EVENTS = 120, BUF_BYTES = 1500000;

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

// 이 화면을 full 로 기록해도 되는가 — 안 되면 이유를 돌려준다
function liteReason() {
  try {
    if (navigator.deviceMemory && navigator.deviceMemory < 8) return 'low-memory-device';
    const m = performance && performance.memory;
    if (m && m.jsHeapSizeLimit && m.usedJSHeapSize / m.jsHeapSizeLimit > HEAP_RATIO) return 'heap-high';
    if (document.getElementsByTagName('*').length > MAX_NODES) return 'big-page';
  } catch {}
  return '';
}

export default function ReplayRecorder() {
  const router = useRouter();
  useEffect(() => {
    let stop = null, timer = null, buf = [], bufBytes = 0, sessionId = newId(), alive = true, rr = null, active = false;
    let stormAt = 0, stormN = 0, coolUntil = 0;
    const flush = (beacon) => {
      if (!buf.length) return;
      const body = JSON.stringify({ sessionId, events: buf.splice(0, buf.length) }); bufBytes = 0;
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/work/replay', body); return; }
      fetch('/api/work/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
        .then((r) => r.json()).then((j) => { if (j && j.full) { sessionId = newId(); if (stop) { haltDom(); evaluate(); } } }).catch(() => {});
    };
    const push = (ev, approxBytes) => { buf.push(ev); bufBytes += approxBytes; if (buf.length >= BUF_EVENTS || bufBytes >= BUF_BYTES) flush(); };
    // 단계 이벤트는 rrweb 을 거치지 않고 직접 넣는다 → lite 에서도 똑같이 남는다(rrweb 커스텀 이벤트와 같은 모양: type 5)
    const custom = (tag, payload) => { if (active) push({ type: 5, timestamp: Date.now(), data: { tag, payload: { path: location.pathname, ...payload } } }, 200); };
    const onClick = (e) => { const el = e.target.closest ? (e.target.closest('button,a,[role=button],input,select,textarea,td,th,label') || e.target) : e.target; custom('nv-click', { label: labelOf(el), tag: (el.tagName || '').toLowerCase() }); };
    const onChange = (e) => { const el = e.target; if (!el || el.type === 'password') return; custom('nv-input', { label: labelOf(el), tag: (el.tagName || '').toLowerCase(), value: el.type === 'checkbox' ? String(el.checked) : String(el.value ?? '').slice(0, 120) }); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };

    function haltDom() { if (stop) { try { stop(); } catch {} stop = null; } }
    function startDom() {
      if (stop || !rr) return;
      stop = rr.record({
        emit: (ev) => {
          const now = Date.now();
          if (now - stormAt > STORM_WINDOW) { stormAt = now; stormN = 0; }
          if (++stormN > STORM_EVENTS) { coolUntil = now + STORM_COOLDOWN; haltDom(); custom('nv-mode', { label: 'lite', value: 'event-storm' }); return; }
          push(ev, ev.type === 2 ? 400000 : 600); // 전체 스냅샷은 크다 → 곧바로 내보내지도록 크게 잡는다
        },
        maskInputOptions: { password: true }, slimDOMOptions: 'all',
        sampling: { mousemove: false, scroll: 250, input: 'last', mouseInteraction: { MouseUp: false, MouseDown: false, Focus: false, Blur: false, TouchStart: false, TouchEnd: false, ContextMenu: false } },
        recordCanvas: false, collectFonts: false, inlineImages: false,
      });
    }
    // 화면이 바뀔 때마다: 기록 제외 화면이면 끄고, 아니면 full/lite 를 다시 고른다
    function evaluate() {
      if (!rr || !alive) return;
      if (SKIP(location.pathname)) { haltDom(); if (active) { flush(); active = false; } return; }
      if (!active) { active = true; }
      custom('nv-route', { path: location.pathname });
      const why = Date.now() < coolUntil ? 'event-storm' : liteReason();
      if (why) { if (stop) haltDom(); custom('nv-mode', { label: 'lite', value: why }); }
      else if (!stop) { startDom(); }
    }

    // 로그인 화면에서 시작하면 아직 계정이 없다 → 화면이 바뀔 때마다 기록 대상인지 다시 묻고, 한 번 켜지면 더 묻지 않는다.
    let asking = false;
    const ensure = () => {
      if (rr || asking || !alive || location.pathname === '/login') return;
      asking = true;
      fetch('/api/work/replay?me=1').then((r) => (r.ok ? r.json() : null)).then(async (j) => {
        if (!alive || !j || !j.record) return;
        rr = await import('rrweb');
        if (!alive) return;
        timer = setInterval(() => flush(), 5000);
        document.addEventListener('click', onClick, true);
        document.addEventListener('change', onChange, true);
        document.addEventListener('visibilitychange', onHide);
        evaluate();
      }).catch(() => {}).finally(() => { asking = false; });
    };
    // 화면 전환 직후엔 표가 아직 그려지는 중 → 조금 뒤에 요소 수를 센다
    const onRouteAny = () => { if (rr) setTimeout(evaluate, 800); else ensure(); };
    // 화면 전환이 시작되면 구조 기록을 잠깐 멈춘다 — 다음 화면의 거대 표가 그려지는 과정(수 MB 변경)을 기록하지 않고,
    // 다 그려진 뒤(evaluate) 요소 수를 보고 full/lite 를 새로 고른다.
    const onRouteStart = () => haltDom();
    router.events.on('routeChangeStart', onRouteStart);
    router.events.on('routeChangeComplete', onRouteAny);
    ensure();

    return () => {
      alive = false; if (timer) clearInterval(timer);
      document.removeEventListener('click', onClick, true); document.removeEventListener('change', onChange, true); document.removeEventListener('visibilitychange', onHide);
      router.events.off('routeChangeStart', onRouteStart); router.events.off('routeChangeComplete', onRouteAny); haltDom(); flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
