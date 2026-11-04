// components/pm/grow/Grow.js — /pm 키우기 미니게임 UI(책상 화분·서랍 '키우기' 탭·부서 정원). 설계: docs/pm-grow-game.md
// 데이터 = GET /api/pm/grow(서버 계산만), 에셋 = public/pm-grow/manifest.json(Higgsfield 생성 → Blender 2.5D 렌더 스프라이트).
// 첫 화면 무게 최소: 브라우저가 한가할 때 상태를 받고, 스프라이트는 보이는 화분만 로드. reduced-motion 이면 첫 프레임 정지.
import { createContext, useContext, useEffect, useState } from 'react';

const GrowCtx = createContext({ view: null, manifest: null });
export const useGrow = () => useContext(GrowCtx);

const MOOD_LABEL = { work: '일하는 중', idle: '쉬는 중', sleep: '졸고 있어요', wilt: '시무룩(물 주면 회복)' };
const FRAME = 160;

function whenIdle(fn) {
  if (typeof window === 'undefined') return () => {};
  if (window.requestIdleCallback) { const id = window.requestIdleCallback(fn, { timeout: 3000 }); return () => window.cancelIdleCallback(id); }
  const id = setTimeout(fn, 1200); return () => clearTimeout(id);
}

export function GrowProvider({ children, refreshMs = 60000 }) {
  const [view, setView] = useState(null);
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    let alive = true; let timer = null;
    const load = () => fetch('/api/pm/grow', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive && j.success) setView(j.data); }).catch(() => {});
    const cancel = whenIdle(() => {
      load(); timer = setInterval(load, refreshMs);
      fetch('/pm-grow/manifest.json').then((r) => r.json()).then((m) => { if (alive) setManifest(m); }).catch(() => {});
    });
    return () => { alive = false; cancel(); if (timer) clearInterval(timer); };
  }, [refreshMs]);
  return <GrowCtx.Provider value={{ view, manifest }}>{children}</GrowCtx.Provider>;
}

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)'); setR(q.matches);
    const on = () => setR(q.matches); q.addEventListener?.('change', on); return () => q.removeEventListener?.('change', on);
  }, []);
  return r;
}

// 스프라이트 시트 한 줄(가로 프레임) → CSS steps 애니메이션
export function GrowSprite({ line = 'flower', stage = 1, mood = 'idle', size = 48, title }) {
  const { manifest } = useGrow();
  const reduced = useReduced();
  const st = manifest?.lines?.[line]?.stages?.find((s) => s.stage === stage);
  const act = st?.actions?.[mood] || st?.actions?.idle;
  if (!act) return <span className="grow-sp ph" style={{ width: size, height: size }} aria-hidden />;
  const scale = size / FRAME;
  const dur = act.frames / (act.fps || 4);
  const anim = !reduced && act.frames > 1;
  return (
    <span className="grow-sp" role="img" aria-label={title || `${st.name} · ${MOOD_LABEL[mood] || ''}`} title={title}
      style={{ width: size, height: size, backgroundImage: `url(/pm-grow/${act.file})`, backgroundSize: `${act.frames * size}px ${size}px`,
        animation: anim ? `growSteps${act.frames} ${dur}s steps(${act.frames}) infinite` : 'none', '--grow-w': `${-act.frames * FRAME * scale}px` }}>
      <style jsx global>{`
        .grow-sp { display: inline-block; background-repeat: no-repeat; background-position: 0 0; image-rendering: auto; vertical-align: bottom; }
        .grow-sp.ph { background: none; }
        @keyframes growSteps4 { to { background-position: var(--grow-w) 0; } }
        @keyframes growSteps6 { to { background-position: var(--grow-w) 0; } }
      `}</style>
    </span>
  );
}

// 책상 위 작은 화분(직원 단계·상태). 데이터 없으면 아무것도 안 그림.
export function DeskPot({ name }) {
  const { view } = useGrow();
  const p = view?.people?.find((x) => x.name === name);
  if (!p) return null;
  return (
    <span className="desk-pot">
      <GrowSprite line={p.line} stage={p.stage} mood={p.mood} size={30} title={`${name}의 ${p.stageName} · ${MOOD_LABEL[p.mood]}`} />
      <style jsx global>{`.pm .seat { position: relative; } .desk-pot { position: absolute; right: 4px; top: 58px; pointer-events: none; z-index: 2; }`}</style>
    </span>
  );
}

// 서랍 '키우기' 탭
export function GrowTab({ name }) {
  const { view } = useGrow();
  if (!view) return <p className="muted">불러오는 중…</p>;
  const p = view.people.find((x) => x.name === name);
  if (!p) return <p className="muted">아직 성장 기록이 없어요. 업무 피드가 들어오면 자동으로 자랍니다.</p>;
  const garden = view.gardens.find((g) => g.dept === p.dept);
  return (
    <div className="grow-tab">
      <div className="hero">
        <GrowSprite line={p.line} stage={p.stage} mood={p.mood} size={128} />
        <div>
          <b className="nm">{p.stage}단계 · {p.stageName}</b>
          <div className="muted">{MOOD_LABEL[p.mood]} · 누적 {p.points}점</div>
          {p.next ? <>
            <div className="bar" aria-label={`다음 단계까지 ${Math.round(p.progress * 100)}%`}><i style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>
            <div className="muted">다음: {p.next.name}까지 {Math.max(0, p.next.at - p.points)}점</div>
          </> : <div className="muted">최고 단계에 도달했어요.</div>}
        </div>
      </div>
      <div className="stages">
        {view.stages.map((s) => (
          <span key={s.stage} className={s.stage <= p.stage ? 'got' : 'lock'}>
            <GrowSprite line={p.line} stage={s.stage} mood="idle" size={40} title={`${s.stage}단계 ${s.name} (${s.at}점)`} />
            <small>{s.name}</small>
          </span>
        ))}
      </div>
      <h3>오늘 자란 이유 ({p.today.points} / 하루 상한 {p.today.cap}점)</h3>
      {p.today.reasons.length ? <ul className="why">{p.today.reasons.map((r) => <li key={r.label}>{r.label} <span className="muted">{r.minutes}분</span></li>)}</ul>
        : <p className="muted">오늘 기록 없음</p>}
      <h3>돌봄</h3>
      <p className="muted">물뿌리개: 오래 쉬어 시무룩해진 모습만 되돌립니다(성장치는 그대로). 상점 연동 후 사용 가능.</p>
      {garden && <><h3>{garden.dept} 정원</h3><p className="muted">부서원 {garden.members}명 평균으로 {garden.stage}단계 {garden.stageName}</p></>}
      <p className="note">업무시간으로 자라며 오래 쉬어도 시들거나 단계가 내려가지 않아요. 급여·평가와 무관합니다.</p>
      <style jsx>{`
        .hero { display: flex; gap: 14px; align-items: center; background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: 8px; padding: 10px; }
        .hero > div { flex: 1; } .nm { font-size: 16px; }
        .bar { height: 8px; background: var(--pm-surface2); border-radius: 4px; overflow: hidden; margin: 6px 0 2px; } .bar i { display: block; height: 100%; background: var(--pm-ok); }
        .stages { display: flex; justify-content: space-between; margin: 10px 0; }
        .stages span { display: flex; flex-direction: column; align-items: center; } .stages .lock { opacity: .35; filter: grayscale(1); }
        .stages small { font-size: 11px; color: var(--pm-muted); }
        .why { margin: 0 0 0 18px; padding: 0; }
        .note { font-size: 11px; color: var(--pm-muted); margin-top: 14px; }
      `}</style>
    </div>
  );
}

// 부서 정원 줄(사무실 상단 등) — 다음 단계까지 진행 막대 + 남은 점수, 호버/포커스 시 규칙 설명
export const GARDEN_HELP = '부서원 평균 성장치로 자랍니다. 업무 특정 1시간=10점 · 활성만 1시간=3점 · 하루 60점 상한 · 줄지 않음 · 급여/평가와 무관.';
export function gardenNextText(g) {
  if (!g?.next) return '최고 단계';
  const avg = (g.points || 0) / Math.max(1, g.members || 1);
  return `${g.next.name}까지 ${Math.max(0, Math.ceil(g.next.at - avg))}점`;
}
export function GardenStrip() {
  const { view } = useGrow();
  if (!view?.gardens?.length) return null;
  return (
    <div className="garden" aria-label="부서 정원">
      {view.gardens.map((g) => (
        <span key={g.dept} className="g" tabIndex={0} aria-describedby="garden-help" title={GARDEN_HELP}>
          <GrowSprite stage={g.stage} mood="idle" size={36} />
          <span className="gt"><small>{g.dept} 정원 · {g.stageName}</small>
            <span className="gb" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((g.progress || 0) * 100)} aria-label={`${g.dept} 다음 단계 진행`}><i style={{ width: `${Math.round((g.progress || 0) * 100)}%` }} /></span>
            <small className="gn">{gardenNextText(g)}</small>
          </span>
        </span>
      ))}
      <span id="garden-help" className="ghelp">{GARDEN_HELP}</span>
      <style jsx>{`
        .garden { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; padding: 6px 0; }
        .g { position: relative; display: flex; align-items: center; gap: 4px; outline: none; } .g small { font-size: 12px; opacity: .85; white-space: nowrap; }
        .gt { display: grid; gap: 2px; } .gn { font-size: 11px !important; }
        .gb { display: block; width: 96px; height: 6px; border-radius: 3px; background: var(--pm-surface2); border: 1px solid var(--pm-line); overflow: hidden; } .gb i { display: block; height: 100%; background: var(--pm-ok); }
        .ghelp { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      `}</style>
    </div>
  );
}
