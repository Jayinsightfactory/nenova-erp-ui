// pages/pm/radar.js — 기술 레이더(GitHub 추천) · 소프트 클레이 파스텔 재구성(Gemini 시안 radar-ui-A)
// PM 이 월·목 07:30 GitHub 인기·급상승 저장소를 모아 Claude 로 평가(우리 회사 쓸모·난이도·점수)한 결과 중 6점 이상만 보여준다.
// pilotResult(PM 자동 파일럿 결과, nenova-pm/pm-radar-pilot.js) 있으면 "시험함" 배지 + 상세에 수치 요약.
// 데이터: GET /api/pm/radar (사장님 PC nenova-pm/github-radar/radar.js → feature-data-ingest name=tech-radar). 읽기 전용.
// 색은 lib/pmThemes.js 토큰(var(--pm-*))만 쓴다(하드코딩 hex 금지) — 테마 B(파스텔 클레이) 고정.
// 버튼·칩·배지는 /pm UI 키트(components/pm/ui)만 쓴다(생 button/span 배지 금지) — 사장님 피드백 2026-11-04:
//   분류 아이콘·저장소명·★별수·점수 배지는 각각 별 요소로 분리(한 덩어리 금지), 점수는 "N/10" 둥근 클레이 배지.
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, SelectCard, ToggleChip, PmUiStyles, Tabs } from '../../components/pm/ui';
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
// 분류 이모지 — 시스템(주제) 기준, 없으면 언어 머리글자 대신 📦
const SYS_ICON = { '네노바웹': '🌐', Orbit: '👁️', 'AI 자동화': '🤖', MOYI: '💬', '공통': '🧩' };
const iconOf = (x) => SYS_ICON[(x.systems || [])[0]] || '📦';

// 섹션 헤더 — 제목 + 개수 배지(UI 키트 Badge)로 통일
function SectionH({ children, count }) {
  return <h2>{children}{count !== undefined && <Badge className="cnt">{count}</Badge>}</h2>;
}

// 왼쪽 "바로 시험" 추천 큰 카드 — 쉬운 설명·비유·용어풀이, [자세히 보기] 로 왜 인기·기술 세부·링크 펼침
function BigCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'bc tone' + (i % 3)}>
      <header>
        <span className="bic" aria-hidden="true">{iconOf(x)}</span>
        <div className="ttl">
          <a href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a>
          <span className="meta">★ {fmtStars(x.stars)}{x.starsPerDay ? ` · 하루 +${fmtStars(x.starsPerDay)}` : ''}</span>
        </div>
        <Badge className="pts">관심도 {x.score}점</Badge>
        {x.pilotResult && <Badge className="pilot" title={x.pilotResult.summary}>🧪 시험함 {x.pilotResult.score}점</Badge>}
      </header>
      {x.easy && <p className="easy"><b>🤔 이게 뭐예요?</b> {x.easy}</p>}
      {x.analogy && <p className="easy"><b>💡 우리 회사에 빗대면</b> {x.analogy}</p>}
      {!x.easy && !x.analogy && <p className="easy">{x.summary}</p>}
      {(x.terms || []).length > 0 && (
        <div className="terms">{x.terms.map((t) => <Badge key={t.t} className="term" title={t.d}><b>{t.t}</b> {t.d}</Badge>)}</div>
      )}
      {open && (
        <div className="detail">
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          {x.pilotResult && <p><b>시험 결과</b> {x.pilotResult.score}점 · {x.pilotResult.summary}{x.pilotResult.testedAt ? ` (${kst(x.pilotResult.testedAt)})` : ''}</p>}
          <p><b>기술 정보</b> {x.desc || '-'}</p>
          <p><b>우리 쓸모</b> {x.use}</p>
          {x.difficulty && <p><b>난이도</b> {x.difficulty}{x.language ? ` · ${x.language}` : ''}</p>}
          {(x.topics || []).length > 0 && <p className="tp">{x.topics.map((t) => '#' + t).join(' ')}</p>}
          <p className="tp"><a href={x.url} target="_blank" rel="noopener noreferrer">GitHub 에서 보기 →</a></p>
        </div>
      )}
      <footer>
        {(x.systems || []).slice(0, 3).map((s) => <Badge key={s} className="sys">#{s}</Badge>)}
        <span className="sp" />
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '자세히 보기'}</Button>
      </footer>
    </article>
  );
}

// 가운데 작은 카드 — 분류 아이콘 · 저장소명 · ★별수 · 점수 배지(N/10)를 각각 별 요소로, 클릭하면 상세 펼침
function SmallCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'sc' + (open ? ' open' : '')}>
      <SelectCard className="hit" expanded={open} onClick={() => setOpen(!open)}>
        <span className={'ic ic' + (i % 4)} aria-hidden="true">{iconOf(x)}</span>
        <span className="ttl">
          <b>{x.name.split('/').pop()}</b>
          <span className="meta">★ {fmtStars(x.stars)}</span>
        </span>
        <Badge className={'score ' + scoreTone(x.score)}>{x.score}<small>/10</small></Badge>
        {x.pilotResult && <Badge className="pilot" title={x.pilotResult.summary}>🧪 시험함</Badge>}
      </SelectCard>
      <p className="sum">{x.summary}</p>
      {open && (
        <div className="detail">
          {x.easy && <p><b>이게 뭐예요?</b> {x.easy}</p>}
          {x.analogy && <p><b>우리 회사에 빗대면</b> {x.analogy}</p>}
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          {x.pilotResult && <p><b>시험 결과</b> {x.pilotResult.score}점 · {x.pilotResult.summary}</p>}
          <p><b>{x.track === 'trend' ? '알아둘 이유' : '우리 쓸모'}</b> {x.use}</p>
          {x.desc && <p><b>기술 정보</b> {x.desc}</p>}
          <p className="tags">
            {(x.systems || []).map((s) => <Badge key={s} className="sys">#{s}</Badge>)}
            {x.action && <Badge className="sys">{x.action}</Badge>}
            {x.difficulty && <Badge className="sys">난이도 {x.difficulty}</Badge>}
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
          {round && <Badge className="round">제 {roundNo}회 · {round.id}{round.generatedAt ? ` · ${kst(round.generatedAt)} 갱신` : ''}</Badge>}
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
                  <SectionH count={featured.length}>바로 시험해 볼 것</SectionH>
                  {featured.map((x, i) => <BigCard key={x.name} x={x} i={i} />)}
                </>
              ) : <p className="muted">이번 조건에 &quot;바로 시험&quot; 추천이 없습니다.</p>}
            </section>

            <section className="mid">
              <SectionH count={rest.length}>{featured.length ? '관찰·참고' : '전체'}</SectionH>
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
                  <div key={s} className="topic"><Badge className={'tchip c' + (i % 4)}>{s}</Badge><b>{n}개</b></div>
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
        /* UI 키트 Badge(.badge)를 둥근 클레이 칩으로 — 전역 .badge 는 각진 회색이라 /pm 토큰으로 덮는다 */
        .radar :global(.badge) { border: 0; border-radius: 999px; font: inherit; font-size: 11px; line-height: 1.6; padding: 2px 9px; background: var(--pm-surface2); color: var(--pm-ink); }
        .top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
        .brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        h1 { margin: 0; font-size: 24px; letter-spacing: -0.01em; }
        .en { color: var(--pm-muted); font-size: 13px; }
        .brand :global(.round) { background: var(--pm-surface); color: var(--pm-link); font-size: 12px; padding: 4px 12px; box-shadow: var(--pm-shadow); }
        .sub { margin: 8px 0 14px; color: var(--pm-muted); max-width: 720px; line-height: 1.5; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 10px 14px; margin-bottom: 16px; background: var(--pm-surface); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); }
        .fg { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
        .fl { color: var(--pm-muted); font-size: 12px; margin-right: 4px; font-weight: bold; }
        .cols { display: grid; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) 230px; gap: 18px; align-items: start; }
        .radar :global(h2) { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; }
        .radar :global(.cnt) { color: var(--pm-muted); }
        .muted { color: var(--pm-muted); }

        /* 왼쪽 추천 큰 카드 — 파스텔 클레이(핑크/민트/크림 교대) */
        .bc { border-radius: calc(var(--pm-radius) + 4px); padding: 16px; margin-bottom: 14px; box-shadow: var(--pm-shadow); display: flex; flex-direction: column; gap: 9px; }
        .bc.tone0 { background: color-mix(in srgb, var(--pm-accent2) 26%, var(--pm-surface)); }
        .bc.tone1 { background: color-mix(in srgb, var(--pm-accent) 20%, var(--pm-surface)); }
        .bc.tone2 { background: color-mix(in srgb, var(--pm-idle-bg) 50%, var(--pm-surface)); }
        .bc header { display: flex; gap: 10px; align-items: flex-start; }
        .bic { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; font-size: 17px; background: var(--pm-surface); box-shadow: var(--pm-shadow); }
        .bc .ttl { flex: 1; min-width: 0; }
        .bc .ttl a { color: var(--pm-ink); font-weight: 800; font-size: 15px; text-decoration: none; word-break: break-all; }
        .bc .ttl a:hover { text-decoration: underline; }
        .bc .meta { display: block; color: var(--pm-muted); font-size: 12px; margin-top: 2px; }
        .bc :global(.pts) { flex: 0 0 auto; background: var(--pm-accent); color: var(--pm-accent-ink); padding: 4px 10px; font-size: 12px; font-weight: bold; white-space: nowrap; }
        .easy { margin: 0; line-height: 1.6; }
        .easy b { display: block; margin-bottom: 2px; }
        .terms { display: flex; flex-wrap: wrap; gap: 5px; }
        .bc :global(.term) { background: var(--pm-surface); box-shadow: var(--pm-shadow); padding: 3px 9px; }
        .bc :global(.term b) { color: var(--pm-link); margin-right: 3px; }
        .bc footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
        .radar :global(.sys) { background: var(--pm-surface); color: var(--pm-muted); }
        /* PM 파일럿 "시험함" 배지 — pm-radar-pilot 이 pilotResult{score,summary,reportPath,testedAt} 를 넣으면 표시 */
        .radar :global(.pilot) { background: var(--pm-ok-bg); color: var(--pm-ok-ink); font-weight: bold; white-space: nowrap; }
        .sp { flex: 1; }
        .detail { border-top: 1px dashed var(--pm-line); padding-top: 8px; line-height: 1.55; }
        .detail p { margin: 4px 0; }
        .detail b { color: var(--pm-link); margin-right: 4px; font-size: 12px; }
        /* 링크 텍스트 — 시안: 기본 파란 밑줄 대신 클레이 톤(민트) 밑줄, 호버 시 코랄 */
        .detail a { color: var(--pm-link); font-weight: bold; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--pm-accent) 60%, transparent); }
        .detail a:hover { color: var(--pm-accent2); text-decoration-color: color-mix(in srgb, var(--pm-accent2) 60%, transparent); }
        .bc .ttl a:hover, .sc .ttl b:hover { color: var(--pm-link); }
        .tp { color: var(--pm-muted); font-size: 11px; }

        /* 가운데 작은 카드 그리드 — 아이콘·이름·별·점수 배지를 각각 별 요소로 */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
        .sc { background: var(--pm-surface); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); padding: 12px; display: flex; flex-direction: column; gap: 6px; transition: transform .15s, box-shadow .15s; }
        .sc:hover { transform: translateY(-2px); }
        .sc :global(.hit) { display: flex; gap: 9px; align-items: center; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; width: 100%; box-shadow: none; }
        .ic { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; font-size: 16px; }
        .ic0 { background: var(--pm-ok-bg); } .ic1 { background: var(--pm-idle-bg); } .ic2 { background: color-mix(in srgb, var(--pm-accent2) 36%, var(--pm-surface)); } .ic3 { background: color-mix(in srgb, var(--pm-dept2) 24%, var(--pm-surface)); }
        .sc .ttl { flex: 1; min-width: 0; }
        .sc .ttl b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sc .meta { display: block; color: var(--pm-muted); font-size: 11px; }
        .sc :global(.score) { flex: 0 0 auto; font-weight: bold; font-size: 12px; padding: 3px 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .sc :global(.score small) { font-size: 10px; font-weight: normal; opacity: .75; }
        .sc :global(.score.top) { background: var(--pm-err-bg); color: var(--pm-err-ink); }
        .sc :global(.score.hi) { background: var(--pm-accent); color: var(--pm-accent-ink); }
        .sc :global(.score.mid) { background: var(--pm-idle-bg); color: var(--pm-idle-ink); }
        .sc :global(.score.lo) { background: var(--pm-surface2); color: var(--pm-muted); }
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
        .box :global(.tchip) { font-size: 12px; padding: 3px 10px; color: var(--pm-ink); }
        .box :global(.tchip.c0) { background: color-mix(in srgb, var(--pm-accent2) 38%, var(--pm-surface)); }
        .box :global(.tchip.c1) { background: var(--pm-ok-bg); }
        .box :global(.tchip.c2) { background: color-mix(in srgb, var(--pm-dept2) 24%, var(--pm-surface)); }
        .box :global(.tchip.c3) { background: var(--pm-idle-bg); }
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
