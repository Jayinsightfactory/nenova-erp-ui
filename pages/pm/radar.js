// pages/pm/radar.js — 기술 레이더(GitHub 추천) · 소프트 클레이 파스텔 재구성(Gemini 시안 radar-ui-A)
// PM 이 월·목 07:30 GitHub 인기·급상승 저장소를 모아 Claude 로 평가(우리 회사 쓸모·난이도·점수)한 결과 중 6점 이상만 보여준다.
// 데이터: GET /api/pm/radar (사장님 PC nenova-pm/github-radar/radar.js → feature-data-ingest name=tech-radar). 읽기 전용.
// 색은 lib/pmThemes.js 토큰(var(--pm-*))만 쓴다(하드코딩 hex 금지) — 테마 B(파스텔 클레이) 고정.
// 버튼은 /pm UI 키트(components/pm/ui)만 import 해 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { Button, SelectCard, ToggleChip, PmUiStyles, Tabs } from '../../components/pm/ui';
import { themeById, themeCss } from '../../lib/pmThemes';
import { verifyReqUser } from '../../lib/auth';

export async function getServerSideProps({ req, res, resolvedUrl }) {
  const user = await verifyReqUser(req, res);
  if (!user) return { redirect: { destination: '/login?next=' + encodeURIComponent(resolvedUrl || '/pm/radar'), permanent: false } };
  return { props: {} };
}

const ACTIONS = ['바로 시험', '관찰', '참고'];
const SYSTEMS = ['네노바웹', 'Orbit', 'AI 자동화', 'MOYI', '공통'];
const SCORES = [5, 6, 7, 8, 9];
const PAGE = 12; // 가운데 그리드 '더 보기' 단위 — 수집기가 20~40건으로 늘어도 레이아웃 유지
const kst = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso || ''; } };
const fmtStars = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));
const scoreTone = (s) => (s >= 9 ? 'top' : s >= 8 ? 'hi' : s >= 7 ? 'mid' : 'lo');
const BUCKETS = [['top', '최상'], ['hi', '상'], ['mid', '중'], ['lo', '하']];

// 왼쪽 "바로 시험" 추천 큰 카드 — 쉬운 설명·비유·용어풀이, [자세히 보기] 로 왜 인기·기술 세부·링크 펼침
function BigCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'bc tone' + (i % 3)}>
      <header>
        <div className="ttl">
          <a href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a>
          <span className="meta">★ {fmtStars(x.stars)}{x.starsPerDay ? ` · 하루 +${fmtStars(x.starsPerDay)}` : ''}</span>
        </div>
        <span className="pts">관심도 {x.score}점</span>
      </header>
      {x.easy && <p className="easy"><b>🤔 이게 뭐예요?</b> {x.easy}</p>}
      {x.analogy && <p className="easy"><b>💡 우리 회사에 빗대면</b> {x.analogy}</p>}
      {!x.easy && !x.analogy && <p className="easy">{x.summary}</p>}
      {(x.terms || []).length > 0 && (
        <div className="terms">{x.terms.map((t) => <span key={t.t} className="term" title={t.d}><b>{t.t}</b> {t.d}</span>)}</div>
      )}
      {open && (
        <div className="detail">
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          <p><b>기술 정보</b> {x.desc || '-'}</p>
          <p><b>우리 쓸모</b> {x.use}</p>
          {x.difficulty && <p><b>난이도</b> {x.difficulty}{x.language ? ` · ${x.language}` : ''}</p>}
          {(x.topics || []).length > 0 && <p className="tp">{x.topics.map((t) => '#' + t).join(' ')}</p>}
          <p className="tp"><a href={x.url} target="_blank" rel="noopener noreferrer">GitHub 에서 보기 →</a></p>
        </div>
      )}
      <footer>
        {(x.systems || []).slice(0, 3).map((s) => <span key={s} className="sys">#{s}</span>)}
        <span className="sp" />
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '자세히 보기'}</Button>
      </footer>
    </article>
  );
}

// 가운데 작은 카드 — 이름·별·점수 배지·한줄요약, 클릭하면 상세 펼침
function SmallCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'sc' + (open ? ' open' : '')}>
      <SelectCard className="hit" expanded={open} onClick={() => setOpen(!open)}>
        <span className={'ic ic' + (i % 4)} aria-hidden="true">{(x.language || x.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="ttl">
          <b>{x.name.split('/').pop()}</b>
          <span className="meta">★ {fmtStars(x.stars)}</span>
        </span>
        <span className={'score ' + scoreTone(x.score)}>{x.score}</span>
      </SelectCard>
      <p className="sum">{x.summary}</p>
      {open && (
        <div className="detail">
          {x.easy && <p><b>이게 뭐예요?</b> {x.easy}</p>}
          {x.analogy && <p><b>우리 회사에 빗대면</b> {x.analogy}</p>}
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          <p><b>{x.track === 'trend' ? '알아둘 이유' : '우리 쓸모'}</b> {x.use}</p>
          {x.desc && <p><b>기술 정보</b> {x.desc}</p>}
          <p className="tags">
            {(x.systems || []).map((s) => <span key={s} className="sys">#{s}</span>)}
            {x.action && <span className="sys">{x.action}</span>}
            {x.difficulty && <span className="sys">난이도 {x.difficulty}</span>}
          </p>
          <p className="tp"><a href={x.url} target="_blank" rel="noopener noreferrer">GitHub 에서 보기 →</a></p>
        </div>
      )}
    </article>
  );
}

export default function TechRadar() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [roundId, setRoundId] = useState('');
  const [act, setAct] = useState('');
  const [sys, setSys] = useState('');
  const [minScore, setMinScore] = useState(5);
  const [track, setTrack] = useState('interest');
  const [shown, setShown] = useState(PAGE);
  const clayCss = useMemo(() => themeCss(themeById('B')), []);

  useEffect(() => {
    fetch('/api/pm/radar', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error || '불러오기 실패'); setData(j.data); setRoundId(j.data?.rounds?.[0]?.id || ''); })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { setShown(PAGE); }, [roundId, act, sys, minScore, track]);

  const rounds = data?.rounds || [];
  const round = rounds.find((r) => r.id === roundId) || rounds[0];
  const roundNo = round ? rounds.length - rounds.indexOf(round) : 0;
  const items = useMemo(() => (round?.items || []).filter((x) => ((x.track || 'interest') === track) && (!act || x.action === act) && (!sys || (x.systems || []).includes(sys)) && x.score >= minScore), [round, act, sys, minScore, track]);
  const featured = useMemo(() => items.filter((x) => x.action === '바로 시험').slice(0, 3), [items]);
  const rest = useMemo(() => items.filter((x) => !featured.includes(x)), [items, featured]);
  // 오른쪽 사이드바 집계 — 클라이언트에서만(새 API 없음)
  const dist = useMemo(() => { const d = { top: 0, hi: 0, mid: 0, lo: 0 }; items.forEach((x) => { d[scoreTone(x.score)]++; }); return d; }, [items]);
  const distMax = Math.max(1, ...BUCKETS.map(([k]) => dist[k]));
  const sysCount = useMemo(() => { const m = new Map(); items.forEach((x) => (x.systems || []).forEach((s) => m.set(s, (m.get(s) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [items]);

  return (
    <div className="pm radar" data-theme="B">
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: clayCss }} />
      <header className="top">
        <div className="brand">
          <h1>기술 레이더</h1>
          <span className="en">(Tech Radar)</span>
          {round && <span className="round">제 {roundNo}회 · {round.id}{round.generatedAt ? ` · ${kst(round.generatedAt)} 갱신` : ''}</span>}
        </div>
        {round && (
          <Tabs label="구분" value={track} onChange={setTrack} items={[
            ['interest', `우리 관심 (${(round.items || []).filter((x) => (x.track || 'interest') === 'interest').length})`],
            ['trend', `전체 트렌드 (${(round.items || []).filter((x) => x.track === 'trend').length})`],
          ]} />
        )}
      </header>
      <p className="sub">PM 이 월·목 아침 GitHub 인기·급상승 저장소를 살펴 우리 회사(네노바웹·Orbit·AI 자동화·MOYI)에 쓸모 있는 것만 골랐습니다.</p>

      {err && <p className="muted">불러오지 못했습니다: {err}</p>}
      {!err && !data && <p className="muted">불러오는 중…</p>}
      {data && !rounds.length && <p className="muted">아직 올라온 회차가 없습니다.</p>}

      {round && (
        <>
          <div className="filters">
            <div className="fg"><span className="fl">주제 필터</span>
              <ToggleChip on={!sys} aria-pressed={!sys} onClick={() => setSys('')}>전체</ToggleChip>
              {SYSTEMS.map((s) => <ToggleChip key={s} on={sys === s} aria-pressed={sys === s} onClick={() => setSys(sys === s ? '' : s)}>#{s}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">추천</span>
              <ToggleChip on={!act} aria-pressed={!act} onClick={() => setAct('')}>전체</ToggleChip>
              {ACTIONS.map((a) => <ToggleChip key={a} on={act === a} aria-pressed={act === a} onClick={() => setAct(act === a ? '' : a)}>{a}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">점수 필터</span>
              {SCORES.map((n) => <ToggleChip key={n} on={minScore === n} aria-pressed={minScore === n} onClick={() => setMinScore(n)}>★{n} 이상</ToggleChip>)}
            </div>
          </div>

          <div className="cols">
            <section className="left">
              {featured.length > 0 ? (
                <>
                  <h2>바로 시험해 볼 것</h2>
                  {featured.map((x, i) => <BigCard key={x.name} x={x} i={i} />)}
                </>
              ) : <p className="muted">이번 조건에 &quot;바로 시험&quot; 추천이 없습니다.</p>}
            </section>

            <section className="mid">
              <h2>{featured.length ? '관찰·참고' : '전체'} <span className="cnt">{rest.length}</span></h2>
              {rest.length === 0 && <p className="muted">조건에 맞는 항목이 없습니다.</p>}
              <div className="grid">{rest.slice(0, shown).map((x, i) => <SmallCard key={x.name} x={x} i={i} />)}</div>
              {rest.length > shown && (
                <div className="more"><Button variant="secondary" onClick={() => setShown(shown + PAGE)}>더 보기 ({rest.length - shown}건 남음)</Button></div>
              )}
            </section>

            <aside className="side">
              <div className="box">
                <h3>점수 분포</h3>
                <div className="bars" role="img" aria-label={BUCKETS.map(([k, l]) => `${l} ${dist[k]}건`).join(', ')}>
                  {BUCKETS.map(([k, l]) => (
                    <div key={k} className="bar">
                      <span className="bv">{dist[k]}</span>
                      <span className={'bf ' + k} style={{ height: Math.max(6, Math.round((dist[k] / distMax) * 72)) + 'px' }} />
                      <span className="bl">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="box">
                <h3>인기 주제별 개수</h3>
                {sysCount.length === 0 && <p className="muted">-</p>}
                {sysCount.map(([s, n], i) => (
                  <div key={s} className="topic"><span className={'tchip c' + (i % 4)}>{s}</span><b>{n}개</b></div>
                ))}
              </div>
              {rounds.length > 1 && (
                <div className="box">
                  <h3>지난 회차 목록</h3>
                  {rounds.map((r, i) => (
                    <Button key={r.id} size="sm" variant={r.id === round.id ? 'primary' : 'ghost'} className="rbtn" onClick={() => setRoundId(r.id)}>
                      제 {rounds.length - i}회 ({r.id}) · {r.posted}건
                    </Button>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <style jsx>{`
        .radar { min-height: 100%; padding: 20px 24px 40px; background: var(--pm-bg); color: var(--pm-ink); font-size: 13px; font-family: var(--pm-font); }
        .top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
        .brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        h1 { margin: 0; font-size: 24px; letter-spacing: -0.01em; }
        .en { color: var(--pm-muted); font-size: 13px; }
        .round { background: var(--pm-surface); border: 1px solid var(--pm-line); color: var(--pm-link); border-radius: 999px; padding: 4px 12px; font-size: 12px; box-shadow: var(--pm-shadow); }
        .sub { margin: 8px 0 14px; color: var(--pm-muted); max-width: 720px; line-height: 1.5; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 10px 14px; margin-bottom: 16px; background: var(--pm-surface); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); }
        .fg { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
        .fl { color: var(--pm-muted); font-size: 12px; margin-right: 4px; font-weight: bold; }
        .cols { display: grid; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) 230px; gap: 18px; align-items: start; }
        h2 { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; }
        .cnt { font-size: 11px; background: var(--pm-surface2); border-radius: 10px; padding: 1px 8px; color: var(--pm-muted); }
        .muted { color: var(--pm-muted); }

        /* 왼쪽 추천 큰 카드 — 파스텔 클레이(핑크/민트/크림 교대) */
        .bc { border-radius: calc(var(--pm-radius) + 4px); padding: 16px; margin-bottom: 14px; box-shadow: var(--pm-shadow); display: flex; flex-direction: column; gap: 9px; }
        .bc.tone0 { background: color-mix(in srgb, var(--pm-accent2) 26%, var(--pm-surface)); }
        .bc.tone1 { background: color-mix(in srgb, var(--pm-accent) 20%, var(--pm-surface)); }
        .bc.tone2 { background: color-mix(in srgb, var(--pm-idle-bg) 50%, var(--pm-surface)); }
        .bc header { display: flex; gap: 10px; align-items: flex-start; }
        .bc .ttl { flex: 1; min-width: 0; }
        .bc .ttl a { color: var(--pm-ink); font-weight: 800; font-size: 15px; text-decoration: none; word-break: break-all; }
        .bc .ttl a:hover { text-decoration: underline; }
        .bc .meta { display: block; color: var(--pm-muted); font-size: 12px; margin-top: 2px; }
        .pts { flex: 0 0 auto; background: var(--pm-accent); color: var(--pm-accent-ink); border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: bold; white-space: nowrap; }
        .easy { margin: 0; line-height: 1.6; }
        .easy b { display: block; margin-bottom: 2px; }
        .terms { display: flex; flex-wrap: wrap; gap: 5px; }
        .term { font-size: 11px; background: var(--pm-surface); color: var(--pm-ink); border-radius: 999px; padding: 3px 9px; box-shadow: var(--pm-shadow); }
        .term b { color: var(--pm-link); margin-right: 3px; }
        .bc footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
        .sys { font-size: 11px; background: var(--pm-surface); color: var(--pm-muted); border-radius: 999px; padding: 2px 8px; }
        .sp { flex: 1; }
        .detail { border-top: 1px dashed var(--pm-line); padding-top: 8px; line-height: 1.55; }
        .detail p { margin: 4px 0; }
        .detail b { color: var(--pm-link); margin-right: 4px; font-size: 12px; }
        .detail a { color: var(--pm-link); font-weight: bold; }
        .tp { color: var(--pm-muted); font-size: 11px; }

        /* 가운데 작은 카드 그리드 */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
        .sc { background: var(--pm-surface); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); padding: 12px; display: flex; flex-direction: column; gap: 6px; transition: transform .15s, box-shadow .15s; }
        .sc:hover { transform: translateY(-2px); }
        .sc :global(.hit) { display: flex; gap: 9px; align-items: center; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; width: 100%; box-shadow: none; }
        .sc :global(.hit) .ic, .sc :global(.hit) .ttl, .sc :global(.hit) .score { pointer-events: none; }
        .ic { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; font-weight: 800; font-size: 14px; color: var(--pm-ink); }
        .ic0 { background: var(--pm-ok-bg); } .ic1 { background: var(--pm-idle-bg); } .ic2 { background: color-mix(in srgb, var(--pm-accent2) 36%, var(--pm-surface)); } .ic3 { background: color-mix(in srgb, var(--pm-dept2) 24%, var(--pm-surface)); }
        .sc .ttl { flex: 1; min-width: 0; }
        .sc .ttl b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sc .meta { color: var(--pm-muted); font-size: 11px; }
        .score { flex: 0 0 auto; min-width: 34px; height: 24px; border-radius: 999px; display: grid; place-items: center; font-weight: bold; font-size: 12px; padding: 0 7px; font-variant-numeric: tabular-nums; }
        .score.top { background: var(--pm-err-bg); color: var(--pm-err-ink); }
        .score.hi { background: var(--pm-accent); color: var(--pm-accent-ink); }
        .score.mid { background: var(--pm-idle-bg); color: var(--pm-idle-ink); }
        .score.lo { background: var(--pm-surface2); color: var(--pm-muted); }
        .sum { margin: 0; color: var(--pm-muted); line-height: 1.5; }
        .tags { display: flex; flex-wrap: wrap; gap: 4px; }
        .more { margin-top: 14px; text-align: center; }

        /* 오른쪽 사이드바 */
        .side { display: flex; flex-direction: column; gap: 14px; }
        .box { background: var(--pm-surface); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); padding: 14px; }
        h3 { margin: 0 0 10px; font-size: 13px; }
        .bars { display: flex; gap: 10px; align-items: flex-end; justify-content: space-around; min-height: 104px; }
        .bar { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .bv { font-size: 11px; color: var(--pm-muted); font-variant-numeric: tabular-nums; }
        .bf { width: 18px; border-radius: 999px; }
        .bf.top { background: color-mix(in srgb, var(--pm-err) 45%, var(--pm-err-bg)); }
        .bf.hi { background: var(--pm-accent); }
        .bf.mid { background: var(--pm-idle-bg); }
        .bf.lo { background: color-mix(in srgb, var(--pm-dept2) 40%, var(--pm-surface2)); }
        .bl { font-size: 11px; color: var(--pm-muted); }
        .topic { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 7px 0; }
        .tchip { font-size: 12px; border-radius: 999px; padding: 3px 10px; color: var(--pm-ink); }
        .tchip.c0 { background: color-mix(in srgb, var(--pm-accent2) 38%, var(--pm-surface)); }
        .tchip.c1 { background: var(--pm-ok-bg); }
        .tchip.c2 { background: color-mix(in srgb, var(--pm-dept2) 24%, var(--pm-surface)); }
        .tchip.c3 { background: var(--pm-idle-bg); }
        .topic b { font-variant-numeric: tabular-nums; }
        .box :global(.rbtn) { display: block; width: 100%; margin: 4px 0; text-align: left; }

        @media (max-width: 1100px) {
          .cols { grid-template-columns: minmax(280px, 1fr) 1.4fr; }
          .side { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }
          .side .box { flex: 1 1 220px; }
        }
        @media (max-width: 640px) {
          .radar { padding: 14px 16px 32px; }
          .cols { grid-template-columns: 1fr; }
          .side { flex-direction: column; }
          .grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
