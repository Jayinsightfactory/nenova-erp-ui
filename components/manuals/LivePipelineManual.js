// components/manuals/LivePipelineManual.js — /work/manuals "라이브 매뉴얼".
//   작업 라벨(예 '콜롬비아 인보이스 작업')을 관찰된 대표 단계 경로로 풀어, 카드의 [재생]을 누르면 마스킹 캡처가 순서대로 넘어간다.
//   슬라이드: 클릭 위치 펄스 원 · 이전 클릭→현재 클릭 커서 이동 · 단계 캡션 · 진행 바 · 단계 소요 · 마지막에 다음 부서 넘김.
//   prefers-reduced-motion 이면 자동 재생·움직임 없이 정지 슬라이드(이전/다음만). [영상 저장]은 canvas+MediaRecorder 로 webm.
//   색은 /pm 토큰(var(--pm-*))만 — hex 금지(__tests__/workLivePipelines.test.js). 버튼은 components/pm/ui 키트만.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, PmUiStyles, Tabs, ToggleChip } from '../pm/ui';
import { allThemesCss, readStoredTheme } from '../../lib/pmThemes';

const CONF = { high: ['높음', 'ok'], medium: ['보통', 'idle'], low: ['낮음', 'off'], estimate: ['추정', 'est'] };
const SLIDE_MS = 3600;
const fmtSec = (s) => (s >= 60 ? `${Math.round(s / 60)}분` : `${Math.max(1, Math.round(s || 0))}초`);

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// 슬라이드 목록: 단계마다 캡처 1장(가장 최근). 캡처가 없으면 캡션만 있는 빈 슬라이드.
export function slidesOf(task) {
  const out = [];
  for (const s of task?.steps || []) {
    const c = (s.captures || [])[0] || null;
    out.push({ step: s, cap: c });
  }
  if (task?.handoff) out.push({ handoff: task.handoff });
  return out;
}

function Evidence({ t }) {
  const [label, tone] = CONF[t.confidence] || CONF.estimate;
  const ev = t.evidence || {};
  return (
    <span className="lv-ev">
      <Badge tone="est">추정</Badge>
      <Badge tone={tone}>신뢰도 {label}</Badge>
      <small>근거 {ev.sessions || 0}회 · 직원 {typeof t.people === 'number' ? t.people : ev.people || 0}명{ev.lastSeen ? ` · 최신 ${ev.lastSeen.slice(5)}` : ''}</small>
    </span>
  );
}

function ConfirmBar({ t, onConfirm }) {
  const st = t.confirm?.status;
  return (
    <span className="lv-cf">
      <ToggleChip on={st === 'confirmed'} onClick={() => onConfirm(t.id, st === 'confirmed' ? 'clear' : 'confirmed')}>맞아요</ToggleChip>
      <ToggleChip on={st === 'wrong'} onClick={() => onConfirm(t.id, st === 'wrong' ? 'clear' : 'wrong')}>틀려요</ToggleChip>
      {t.confirm?.by && <small className="muted">{t.confirm.by} {String(t.confirm.at || '').slice(5, 10)}</small>}
    </span>
  );
}

// 녹화: 슬라이드를 canvas 에 그려 MediaRecorder 로 webm 저장(브라우저 내, 서버 전송 없음)
async function exportWebm(task, slides, root) {
  const cs = getComputedStyle(root);
  const tok = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  const W = 960, H = 600, IMG_H = 540;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!cv.captureStream || typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 영상 저장을 지원하지 않습니다.');
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const load = (src) => new Promise((ok) => { if (!src) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
  const imgs = await Promise.all(slides.map((s) => load(s.cap?.img)));
  rec.start();
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i], im = imgs[i], t0 = performance.now();
    while (performance.now() - t0 < SLIDE_MS) {
      const p = (performance.now() - t0) / SLIDE_MS;
      g.fillStyle = tok('--pm-bg', 'white'); g.fillRect(0, 0, W, H);
      if (im) { const z = 1 + 0.04 * p; g.drawImage(im, (W - W * z) / 2, (IMG_H - IMG_H * z) / 2, W * z, IMG_H * z); }
      const ck = s.cap?.click;
      if (ck) { g.strokeStyle = tok('--pm-accent', 'orange'); g.lineWidth = 3; g.beginPath(); g.arc(ck.x * W, ck.y * IMG_H, 10 + 18 * (p % 0.5) * 2, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = tok('--pm-surface', 'white'); g.fillRect(0, IMG_H, W, H - IMG_H);
      g.fillStyle = tok('--pm-ink', 'black'); g.font = '600 18px sans-serif';
      g.fillText(s.handoff ? `다음 부서로 넘김 → ${s.handoff.to}: ${s.handoff.what}` : `${s.step.i + 1}. ${s.step.title}  (${fmtSec(s.step.avgSec)})`, 16, IMG_H + 26);
      g.fillStyle = tok('--pm-accent', 'orange'); g.fillRect(0, H - 6, W * ((i + p) / slides.length), 6);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  rec.stop();
  await new Promise((r) => { rec.onstop = r; });
  const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  const a = document.createElement('a'); a.href = url; a.download = `${task.label}.webm`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Player({ task, onClose, onConfirm }) {
  const slides = useMemo(() => slidesOf(task), [task]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [saving, setSaving] = useState('');
  const root = useRef(null);
  useEffect(() => { const r = prefersReducedMotion(); setReduced(r); setPlaying(!r); }, []);
  useEffect(() => {
    if (!playing || reduced) return undefined;
    const h = setTimeout(() => { if (i + 1 < slides.length) setI(i + 1); else setPlaying(false); }, SLIDE_MS);
    return () => clearTimeout(h);
  }, [i, playing, reduced, slides.length]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((x) => Math.min(slides.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose, slides.length]);
  const cur = slides[i] || {};
  const prevClick = (slides[i - 1] && slides[i - 1].cap && slides[i - 1].cap.click) || { x: 0.5, y: 0.5 };
  const click = cur.cap?.click;
  const save = useCallback(async () => {
    setSaving('영상 만드는 중…');
    try { await exportWebm(task, slides, root.current); setSaving(''); } catch (e) { setSaving(e.message); }
  }, [task, slides]);

  return (
    <div className="lv-player" role="dialog" aria-label={`${task.label} 라이브 매뉴얼 재생`} ref={root}>
      <div className="lv-top">
        <b>{task.label}</b> <Evidence t={task} />
        <span className="lv-sp" />
        <Button size="sm" variant="ghost" onClick={onClose}>닫기</Button>
      </div>
      <div className="lv-bar" aria-hidden="true">
        {slides.map((s, k) => (
          <span key={k} className={`seg${k < i ? ' done' : ''}${k === i ? ' now' : ''}`}>
            <i style={k === i && playing && !reduced ? { animationDuration: `${SLIDE_MS}ms` } : undefined} />
          </span>
        ))}
      </div>
      <div className={`lv-stage${reduced ? ' still' : ''}`} key={i}>
        {cur.handoff ? (
          <div className="lv-hand">
            <span className="muted">이 작업이 끝나면</span>
            <strong>→ {cur.handoff.to}</strong>
            <span>{cur.handoff.what}</span>
          </div>
        ) : cur.cap ? (
          <div className="lv-shot">
            <img src={cur.cap.img} alt={`${cur.step.i + 1}단계 화면(개인정보 블러 처리)`} />
            {click && (
              <>
                <span className="lv-cursor" style={{ '--fx': `${prevClick.x * 100}%`, '--fy': `${prevClick.y * 100}%`, '--tx': `${click.x * 100}%`, '--ty': `${click.y * 100}%` }} />
                <span className="lv-pulse" style={{ left: `${click.x * 100}%`, top: `${click.y * 100}%` }} />
              </>
            )}
            <small className="lv-obs">관측 {cur.cap.observedAt?.slice(5)}{click ? ' · 클릭 위치 추정' : ''}</small>
          </div>
        ) : <div className="lv-hand"><span className="muted">이 단계는 쓸 수 있는 캡처가 아직 없습니다(마스킹 검증 통과분만 표시).</span></div>}
        {cur.step && (
          <div className="lv-cap">
            <span className="n">{cur.step.i + 1}/{task.steps.length}</span>
            <span className="t">{cur.step.title}</span>
            <span className="d muted">{cur.step.screen ? `「${cur.step.screen}」 · ` : ''}보통 {fmtSec(cur.step.avgSec)}{cur.step.support ? ` · 세션 ${cur.step.support}%에서 나옴` : ''}</span>
            {cur.step.mail && <span className="d muted">메일: 발신 {cur.step.mail.sender}{cur.step.mail.subjectKeywords?.length ? ` · 제목 ${cur.step.mail.subjectKeywords.join('/')}` : ''}{cur.step.mail.attachments?.length ? ` · 첨부 ${cur.step.mail.attachments.join('/')}` : ''}</span>}
            {cur.step.branch && <span className="d muted">갈림: {cur.step.branch.share}%는 → {cur.step.branch.title}</span>}
          </div>
        )}
      </div>
      <div className="lv-ctl">
        <Button size="sm" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>이전</Button>
        {!reduced && <Button size="sm" variant="primary" onClick={() => { if (i + 1 >= slides.length) setI(0); setPlaying(!playing); }}>{playing ? '일시정지' : '재생'}</Button>}
        <Button size="sm" onClick={() => setI(Math.min(slides.length - 1, i + 1))} disabled={i + 1 >= slides.length}>다음</Button>
        <span className="lv-sp" />
        <Button size="sm" variant="ghost" onClick={save} loading={saving === '영상 만드는 중…'}>영상 저장(webm)</Button>
        {saving && saving !== '영상 만드는 중…' && <small className="err">{saving}</small>}
        <ConfirmBar t={task} onConfirm={onConfirm} />
      </div>
    </div>
  );
}

export default function LivePipelineManual({ me, onBack }) {
  const [theme, setTheme] = useState('B');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [dept, setDept] = useState('all');
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState('');
  useEffect(() => { setTheme(readStoredTheme(me)); }, [me]);
  useEffect(() => {
    fetch('/api/work/live-pipelines').then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error || '불러오기 실패'); setData(j.data); }).catch((e) => setErr(e.message));
  }, []);
  const css = useMemo(() => allThemesCss(), []);
  const tasks = (data?.tasks || []).filter((t) => dept === 'all' || t.dept === dept);
  const depts = [...new Set((data?.tasks || []).map((t) => t.dept).filter(Boolean))];

  const play = async (t) => {
    setLoading(t.id);
    try {
      const j = await (await fetch(`/api/work/live-pipelines?id=${encodeURIComponent(t.id)}`)).json();
      if (!j.success) throw new Error(j.error || '불러오기 실패');
      setOpen(j.task);
    } catch (e) { setErr(e.message); } finally { setLoading(''); }
  };
  const confirm = async (id, status) => {
    try {
      const j = await (await fetch('/api/work/live-pipelines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', id, status }) })).json();
      if (!j.success) throw new Error(j.error || '저장 실패');
      setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, confirm: j.confirm } : t)) }));
      setOpen((o) => (o && o.id === id ? { ...o, confirm: j.confirm } : o));
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="pm wmr lv" data-theme={theme}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header className="hd">
        <h1 data-desktop-chrome>라이브 매뉴얼 — 작업이 실제로 흘러가는 순서</h1>
        <p className="muted">
          직원 화면 관찰(최근 {data?.period?.weeks || 8}주)에서 같은 작업이 이어진 구간을 모아, 가장 흔한 단계 순서를 캡처로 보여 줍니다. 캡처는 읽힌 업무 단어만 남기고 나머지(이름·메일주소·금액 등)는 흐리게 처리했고, 검증 못 한 캡처는 쓰지 않습니다. 모두 &apos;추정&apos;이며 맞는지 직원이 확인해 주세요.
          {data?.generatedAt ? ` 갱신 ${String(data.generatedAt).slice(0, 10)}.` : ''}
        </p>
        {onBack && <Button size="sm" variant="ghost" onClick={onBack}>신입 루틴으로</Button>}
      </header>
      {err && <p className="err">{err}</p>}
      {!data ? <p className="empty">{err ? '' : '불러오는 중…'}</p> : !data.tasks?.length ? <p className="empty">라이브 매뉴얼 데이터가 아직 없습니다(주 1회 생성).</p> : (
        <>
          <Tabs label="부서" items={[['all', '전체'], ...depts.map((d) => [d, d])]} value={dept} onChange={setDept} />
          <div className="lv-cards">
            {tasks.map((t) => (
              <section key={t.id} className="lv-card">
                <div className="lv-h"><b>{t.label}</b><small className="muted">{t.dept}</small></div>
                <Evidence t={t} />
                <ol className="lv-chain">
                  {t.steps.map((s) => <li key={s.i}><span>{s.title}</span><small className="muted">{fmtSec(s.avgSec)}</small></li>)}
                  {t.handoff && <li className="ho"><span>→ {t.handoff.to}: {t.handoff.what}</span></li>}
                </ol>
                <div className="lv-foot">
                  <Button size="sm" variant="primary" onClick={() => play(t)} loading={loading === t.id} disabled={!t.captures}>{t.captures ? `재생 (${t.steps.length}단계 · 약 ${fmtSec(t.totalSec)})` : '캡처 없음'}</Button>
                  <ConfirmBar t={t} onConfirm={confirm} />
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {open && <Player task={open} onClose={() => setOpen(null)} onConfirm={confirm} />}
      <style jsx global>{`
        .wmr.lv { background: var(--pm-bg); color: var(--pm-ink); font-family: var(--pm-font); padding: 16px; min-height: 100%; }
        .lv h1 { font-size: 20px; margin: 0 0 4px; }
        .lv .hd { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
        .lv .hd p { flex: 1 1 100%; margin: 0; font-size: 13px; }
        .lv .muted { color: var(--pm-muted); }
        .lv .empty { color: var(--pm-muted); font-size: 13px; }
        .lv .err { color: var(--pm-err); }
        .lv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-top: 10px; }
        .lv-card { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px; box-shadow: var(--pm-shadow); display: flex; flex-direction: column; gap: 6px; }
        .lv-h { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
        .lv-ev, .lv-cf { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; }
        .lv-chain { margin: 4px 0; padding-left: 20px; font-size: 13px; display: grid; gap: 2px; }
        .lv-chain li { display: flex; justify-content: space-between; gap: 6px; }
        .lv-chain li.ho { list-style: none; margin-left: -20px; color: var(--pm-link); font-weight: 600; }
        .lv-foot { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: auto; }
        .lv-player { position: fixed; inset: 0; z-index: 60; background: var(--pm-bg); display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; overflow: auto; }
        .lv-top, .lv-ctl { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .lv-sp { flex: 1; }
        .lv-bar { display: flex; gap: 4px; }
        .lv-bar .seg { flex: 1; height: 6px; border-radius: 3px; background: var(--pm-line); overflow: hidden; }
        .lv-bar .seg i { display: block; height: 100%; width: 0; background: var(--pm-accent); }
        .lv-bar .seg.done i { width: 100%; }
        .lv-bar .seg.now i { width: 100%; animation: lv-fill linear both; }
        .lv-stage { position: relative; flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; animation: lv-in 420ms cubic-bezier(.2,.8,.2,1) both; }
        .lv-shot { position: relative; border-radius: var(--pm-radius); overflow: hidden; border: 1px solid var(--pm-line); background: var(--pm-surface2); aspect-ratio: 16 / 9; max-height: 68vh; margin: 0 auto; width: 100%; max-width: calc(68vh * 16 / 9); }
        .lv-shot img { width: 100%; height: 100%; object-fit: contain; display: block; animation: lv-kb ${SLIDE_MS}ms ease-out both; transform-origin: var(--kx, 50%) var(--ky, 50%); }
        .lv-obs { position: absolute; right: 8px; bottom: 6px; background: var(--pm-surface); color: var(--pm-muted); padding: 2px 6px; border-radius: 6px; font-size: 11px; }
        .lv-cursor { position: absolute; width: 18px; height: 18px; margin: -4px 0 0 -4px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: var(--pm-ink); border: 2px solid var(--pm-surface); left: var(--tx); top: var(--ty); animation: lv-move 900ms cubic-bezier(.3,.7,.2,1) both; pointer-events: none; }
        .lv-pulse { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 3px solid var(--pm-accent); pointer-events: none; animation: lv-pulse 1200ms 800ms ease-out infinite both; }
        .lv-cap { display: flex; flex-direction: column; gap: 2px; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 10px 12px; animation: lv-up 500ms 150ms cubic-bezier(.2,.8,.2,1) both; }
        .lv-cap .n { font-size: 12px; color: var(--pm-link); font-weight: 700; }
        .lv-cap .t { font-size: 17px; font-weight: 700; }
        .lv-cap .d { font-size: 12px; }
        .lv-hand { flex: 1; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: var(--pm-surface); border-radius: var(--pm-radius); border: 1px solid var(--pm-line); }
        .lv-hand strong { font-size: 26px; color: var(--pm-link); animation: lv-slide 700ms cubic-bezier(.2,.8,.2,1) both; }
        @keyframes lv-fill { from { transform: translateX(-100%); } to { transform: none; } }
        @keyframes lv-in { from { opacity: 0; transform: translateY(6px) scale(.99); } to { opacity: 1; transform: none; } }
        @keyframes lv-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes lv-kb { from { transform: scale(1); } to { transform: scale(1.04); } }
        @keyframes lv-move { from { left: var(--fx); top: var(--fy); opacity: .3; } to { left: var(--tx); top: var(--ty); opacity: 1; } }
        @keyframes lv-pulse { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes lv-slide { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
        .lv-stage.still, .lv-stage.still *, .lv-stage.still img { animation: none !important; }
        @media (prefers-reduced-motion: reduce) { .lv *, .lv-player * { animation: none !important; transition: none !important; } }
        @media (max-width: 640px) { .lv-cards { grid-template-columns: 1fr; } .lv-cap .t { font-size: 15px; } }
      `}</style>
    </div>
  );
}
