// pages/pm/radar.js — 전 직원 기술 레이더 (/pm/radar · 파일 전용·읽기 전용).
// 데이터: GET /api/pm/radar (work-feature-tech-radar.json). 관리자 전용 adoption-ledger 는 불러오지 않는다.
// 가드: __tests__/pmUiKit.test.js(UI 키트만) · __tests__/pmNoHexColor.test.js(#hex 금지) · __tests__/pmTechRadar.test.js · 금지어/이모지 0건.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, LinkButton, Notice, SelectCard, Skeleton, ToggleChip, PmUiStyles, Tabs } from '../../components/pm/ui';
import TechRadarWorkbench from '../../components/pm/TechRadarWorkbench';
import { themeById, themeCss } from '../../lib/pmThemes';
import { LOOK_CLEAR, lookClearCss } from '../../lib/pmLookClear';
import { verifyReqUser } from '../../lib/auth';

export async function getServerSideProps({ req, res, resolvedUrl }) {
  const user = await verifyReqUser(req, res);
  if (!user) return { redirect: { destination: '/login?next=' + encodeURIComponent(resolvedUrl || '/pm/radar'), permanent: false } };
  return { props: {} };
}

const ACTIONS = ['바로 시험', '관찰', '참고'];
const SYSTEMS = ['네노바웹', 'Orbit', 'AI 자동화', 'MOYI', '공통'];
const SCORES = [5, 6, 7, 8, 9];
const ALL = 'all';
const PAGE = 12;
const kst = (iso) => {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso || '';
  }
};
const fmtStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0));
const scoreTone = (s) => (s >= 9 ? 'top' : s >= 8 ? 'hi' : s >= 7 ? 'mid' : 'lo');
const BUCKETS = [['top', '최상'], ['hi', '상'], ['mid', '중'], ['lo', '하']];
const SYS_CODE = { '네노바웹': 'WEB', Orbit: 'ORB', 'AI 자동화': 'AI', MOYI: 'MSG', '공통': 'CORE' };
const codeOf = (x) => SYS_CODE[(x.systems || [])[0]] || 'REPO';

// 찾은 곳(sourceLabel) — ' · ' 구분 문자열 분리 (재평가 항목은 resurfaced 필드로 분리 표시)
const srcParts = (x) =>
  typeof x.sourceLabel === 'string'
    ? x.sourceLabel
        .split(' · ')
        .map((t) => t.trim())
        .filter((t) => t && !t.startsWith('재평가'))
    : [];
const srcKind = (part) => part.split('(')[0].trim();
const isWaiting = (x) => x.actionLlm === '바로 시험' && x.action !== '바로 시험' && !x.inUse;
const hasTags = (x) => !!(x.inUse || x.resurfaced || isWaiting(x) || srcParts(x).length);

function Tags({ x }) {
  if (!hasTags(x)) return null;
  return (
    <div className="xtags">
      {x.inUse && <Badge className="xt use" title="우리 회사가 이미 쓰고 있는 도구입니다. 새로 시험할 대상은 아닙니다.">이미 사용 중</Badge>}
      {x.resurfaced && <Badge className="xt re" title={`예전에 평가했던 것인데 별(인기)이 크게 늘어 다시 평가했습니다. ${x.resurfaced}`}>재평가</Badge>}
      {isWaiting(x) && <Badge className="xt wait" title="시험해 볼 만하다고 평가됐지만, 한 회차에 시험은 3개까지만 해서 순서를 기다리는 중입니다.">시험 후보(대기)</Badge>}
      {srcParts(x).map((t) => <Badge key={t} className="xt src" title="이 저장소를 찾은 곳">{t}</Badge>)}
    </div>
  );
}

function ExtraDetail({ x }) {
  const pr = x.pilotResult;
  const src = srcParts(x);
  return (
    <>
      {pr && (
        <p>
          <b>시험 결과</b>{' '}
          {[pr.verdict, pr.score !== undefined && pr.score !== null ? `${pr.score}점` : '', pr.summary].filter(Boolean).join(' · ')}
          {pr.testedAt ? ` (${kst(pr.testedAt)} 시험)` : ''}
          {pr.reportPath && <span className="rp"> · 시험 보고서: {pr.reportPath}</span>}
        </p>
      )}
      {x.resurfaced && <p><b>다시 평가한 이유</b> 별(인기)이 크게 늘었습니다 — {x.resurfaced}</p>}
      {isWaiting(x) && <p><b>시험 대기</b> 시험해 볼 만하다고 평가됐지만, 한 회차에 시험은 3개까지만 해서 순서를 기다리는 중입니다.</p>}
      {x.inUse && <p><b>이미 사용 중</b> 우리 회사가 이미 쓰고 있는 도구라 새로 시험하지 않고 참고용으로만 보여줍니다.</p>}
      {src.length > 0 && <p><b>찾은 곳</b> {src.join(' · ')}</p>}
    </>
  );
}

function SectionH({ children, count }) {
  return <h2>{children}{count !== undefined && <Badge className="cnt">{count}</Badge>}</h2>;
}

function BigCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'bc tone' + (i % 3)}>
      <header>
        <span className="bic" aria-hidden="true">{codeOf(x)}</span>
        <div className="ttl">
          <a href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a>
          <span className="meta">★ {fmtStars(x.stars)}{x.starsPerDay ? ` · 하루 +${fmtStars(x.starsPerDay)}` : ''}{x._round ? ` · ${x._round.slice(5)} 추천` : ''}</span>
        </div>
        <Badge className="pts">관심도 {x.score}점</Badge>
        {x._new && <Badge className="newb">신규</Badge>}
        {x.pilotResult && <Badge className="pilot" title={x.pilotResult.summary}>시험함 {x.pilotResult.score}점</Badge>}
      </header>
      <Tags x={x} />
      <p className="easy">{x.easy || x.summary}</p>
      {open && (
        <div className="detail">
          {x.analogy && <p><b>우리 회사에 빗대면</b> {x.analogy}</p>}
          {(x.terms || []).length > 0 && (
            <div className="terms">{x.terms.map((t) => <Badge key={t.t} className="term" title={t.d}><b>{t.t}</b> {t.d}</Badge>)}</div>
          )}
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          <ExtraDetail x={x} />
          <p><b>기술 정보</b> {x.desc || '-'}</p>
          <p><b>우리 쓸모</b> {x.use}</p>
          {x.difficulty && <p><b>난이도</b> {x.difficulty}{x.language ? ` · ${x.language}` : ''}</p>}
          {(x.topics || []).length > 0 && <p className="tp">{x.topics.map((t) => '#' + t).join(' ')}</p>}
          <p className="tp"><a href={x.url} target="_blank" rel="noopener noreferrer">GitHub 에서 보기 →</a></p>
        </div>
      )}
      <footer>
        {(x.systems || []).slice(0, 3).map((s) => <Badge key={s} className="sys">{s}</Badge>)}
        <span className="sp" />
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '자세히 보기'}</Button>
      </footer>
    </article>
  );
}

function SmallCard({ x, i }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={'sc' + (open ? ' open' : '')}>
      <SelectCard className="hit" expanded={open} onClick={() => setOpen(!open)}>
        <span className={'ic ic' + (i % 4)} aria-hidden="true">{codeOf(x)}</span>
        <span className="ttl">
          <b>{x.name.split('/').pop()}</b>
          <span className="meta">★ {fmtStars(x.stars)}{x._round ? ` · ${x._round.slice(5)} 추천` : ''}</span>
        </span>
        {x._new && <Badge className="newb">신규</Badge>}
        <Badge className={'score ' + scoreTone(x.score)}>{x.score}<small>/10</small></Badge>
        {x.pilotResult && <Badge className="pilot" title={x.pilotResult.summary}>시험함</Badge>}
      </SelectCard>
      <Tags x={x} />
      <p className="sum">{x.summary}</p>
      {open && (
        <div className="detail">
          {x.easy && <p><b>이게 뭐예요?</b> {x.easy}</p>}
          {x.analogy && <p><b>우리 회사에 빗대면</b> {x.analogy}</p>}
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          <ExtraDetail x={x} />
          <p><b>{x.track === 'trend' ? '알아둘 이유' : '우리 쓸모'}</b> {x.use}</p>
          {x.desc && <p><b>기술 정보</b> {x.desc}</p>}
          <p className="tags">
            {(x.systems || []).map((s) => <Badge key={s} className="sys">{s}</Badge>)}
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
  const [pageView, setPageView] = useState('workbench'); // 'workbench' | 'cards'
  const [roundId, setRoundId] = useState('');
  const [act, setAct] = useState('');
  const [sys, setSys] = useState('');
  const [minScore, setMinScore] = useState(5);
  const [track, setTrack] = useState('interest');
  const [src, setSrc] = useState('');
  const [hideInUse, setHideInUse] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const clayCss = useMemo(() => themeCss(themeById('B')), []);

  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setErr(''); setBusy(true);
    fetch('/api/pm/radar', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.error || '불러오기 실패');
        setData(j.data || { rounds: [] });
        setRoundId(ALL);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const clearFilters = () => { setSys(''); setAct(''); setMinScore(5); setSrc(''); setHideInUse(false); };
  useEffect(() => { setShown(PAGE); }, [roundId, act, sys, minScore, track, src, hideInUse]);

  const rounds = useMemo(() => data?.rounds || [], [data]);
  const merged = useMemo(() => {
    const seen = new Set();
    const list = [];
    rounds.forEach((r, i) =>
      (r.items || []).forEach((x) => {
        if (seen.has(x.name)) return;
        seen.add(x.name);
        list.push({ ...x, _round: r.id, _new: i === 0 && rounds.length > 1 });
      })
    );
    return list;
  }, [rounds]);

  const isAll = roundId === ALL || !rounds.some((r) => r.id === roundId);
  const picked = rounds.find((r) => r.id === roundId) || rounds[0];
  const round = !rounds.length ? null : isAll ? { id: ALL, items: merged, generatedAt: rounds[0].generatedAt } : picked;
  const roundNo = picked ? rounds.length - rounds.indexOf(picked) : 0;

  const srcKinds = useMemo(() => {
    const m = new Map();
    (round?.items || []).forEach((x) => new Set(srcParts(x).map(srcKind)).forEach((k) => m.set(k, (m.get(k) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [round]);
  const inUseCount = useMemo(() => (round?.items || []).filter((x) => x.inUse).length, [round]);
  const srcOn = srcKinds.includes(src) ? src : '';
  const hideOn = hideInUse && inUseCount > 0;

  const items = useMemo(
    () =>
      (round?.items || []).filter(
        (x) =>
          (x.track || 'interest') === track &&
          (!act || x.action === act) &&
          (!sys || (x.systems || []).includes(sys)) &&
          x.score >= minScore &&
          (!srcOn || srcParts(x).some((t) => srcKind(t) === srcOn)) &&
          (!hideOn || !x.inUse)
      ),
    [round, act, sys, minScore, track, srcOn, hideOn]
  );
  const nFilters = (sys ? 1 : 0) + (act ? 1 : 0) + (minScore !== 5 ? 1 : 0) + (srcOn ? 1 : 0) + (hideOn ? 1 : 0);
  const featured = useMemo(() => items.filter((x) => x.action === '바로 시험').slice(0, 3), [items]);
  const rest = useMemo(() => items.filter((x) => !featured.includes(x)), [items, featured]);
  const dist = useMemo(() => {
    const d = { top: 0, hi: 0, mid: 0, lo: 0 };
    items.forEach((x) => { d[scoreTone(x.score)]++; });
    return d;
  }, [items]);
  const distMax = Math.max(1, ...BUCKETS.map(([k]) => dist[k]));
  const sysCount = useMemo(() => {
    const m = new Map();
    items.forEach((x) => (x.systems || []).forEach((s) => m.set(s, (m.get(s) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <div className="pm radar" data-theme="B" data-look={LOOK_CLEAR}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: clayCss + lookClearCss }} />

      <header className="top">
        <div className="brand">
          <h1>기술 레이더</h1>
          <span className="en">(Tech Radar)</span>
          {round && (
            <Badge className="round">
              {isAll ? `전체 누적 · ${rounds.length}회차 · ${merged.length}건` : `제 ${roundNo}회 · ${round.id}`}
              {round.generatedAt ? ` · ${kst(round.generatedAt)} 갱신` : ''}
            </Badge>
          )}
        </div>

        <div className="top-controls">
          <Tabs
            label="화면 모드"
            value={pageView}
            onChange={setPageView}
            items={[
              ['workbench', '극좌표 · 매트릭스 · 도입 시뮬레이터'],
              ['cards', '회차별 쉬운 해설 목록'],
            ]}
          />
          {round && pageView === 'cards' && (
            <Tabs
              label="구분"
              value={track}
              onChange={setTrack}
              items={[
                ['interest', `우리 관심 (${(round.items || []).filter((x) => (x.track || 'interest') === 'interest').length})`],
                ['trend', `전체 트렌드 (${(round.items || []).filter((x) => x.track === 'trend').length})`],
              ]}
            />
          )}
        </div>
      </header>
      <p className="sub">월·목 아침마다 선별한 외부 도구를 4분면 레이더와 실설계 파이프라인 도입 시뮬레이터로 검증합니다.</p>

      {err && (
        <Notice tone="error" title="추천 목록을 불러오지 못했습니다" action={<Button size="sm" variant="secondary" loading={busy} onClick={load}>다시 불러오기</Button>}>
          잠시 뒤 다시 눌러 주세요. 계속 안 되면 PM 사무실에 알려 주세요.
          <details className="errraw"><summary>자세히</summary>{err}</details>
        </Notice>
      )}
      {!err && !data && (
        <div className="loading" aria-busy="true">
          <Skeleton card rows={4} /><Skeleton card rows={3} /><Skeleton card rows={3} />
        </div>
      )}
      {data && !rounds.length && (
        <EmptyState title="아직 올라온 추천이 없습니다">월요일과 목요일 아침에 새 추천이 올라옵니다. 그때 다시 열어 보세요.</EmptyState>
      )}

      {round && pageView === 'workbench' && (
        <TechRadarWorkbench
          techRadar={data}
          isAdmin={false}
          mode="clear"
          standaloneUiStyles={false}
          title="전 직원 기술 레이더 · 실설계 도입 시뮬레이터"
          subtitle="4분면 극좌표 레이더 · 2×2 임팩트×준비도 매트릭스 · 원장 표에서 기술을 선택해 업무 파이프라인 도입 전/후 변화를 확인합니다."
        />
      )}

      {round && pageView === 'cards' && (
        <>
          <div className="filters">
            <div className="fg"><span className="fl">주제 필터</span>
              <ToggleChip on={!sys} aria-pressed={!sys} onClick={() => setSys('')}>전체</ToggleChip>
              {SYSTEMS.map((s) => <ToggleChip key={s} on={sys === s} aria-pressed={sys === s} onClick={() => setSys(sys === s ? '' : s)}>{s}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">추천</span>
              <ToggleChip on={!act} aria-pressed={!act} onClick={() => setAct('')}>전체</ToggleChip>
              {ACTIONS.map((a) => <ToggleChip key={a} on={act === a} aria-pressed={act === a} onClick={() => setAct(act === a ? '' : a)}>{a}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">점수 필터</span>
              {SCORES.map((n) => <ToggleChip key={n} on={minScore === n} aria-pressed={minScore === n} onClick={() => setMinScore(n)}>{n}점 이상</ToggleChip>)}
            </div>
            {srcKinds.length > 0 && (
              <div className="fg"><span className="fl">찾은 곳</span>
                <ToggleChip on={!srcOn} aria-pressed={!srcOn} onClick={() => setSrc('')}>전체</ToggleChip>
                {srcKinds.map((k) => <ToggleChip key={k} on={srcOn === k} aria-pressed={srcOn === k} onClick={() => setSrc(srcOn === k ? '' : k)}>{k}</ToggleChip>)}
              </div>
            )}
            {inUseCount > 0 && (
              <div className="fg"><span className="fl">이미 쓰는 도구</span>
                <ToggleChip on={hideOn} aria-pressed={hideOn} onClick={() => setHideInUse(!hideOn)}>빼고 보기 ({inUseCount}개)</ToggleChip>
              </div>
            )}
            {nFilters > 0 && (
              <div className="fg fclear"><span className="fl">조건 {nFilters}개로 {items.length}건 보는 중</span>
                <LinkButton onClick={clearFilters}>조건 지우기</LinkButton>
              </div>
            )}
          </div>

          <div className="cols">
            <section className="left">
              {featured.length > 0 ? (
                <>
                  <SectionH count={featured.length}>바로 시험해 볼 것</SectionH>
                  {featured.map((x, i) => <BigCard key={x.name} x={x} i={i} />)}
                </>
              ) : (
                <EmptyState title="바로 시험해 볼 것이 없습니다">
                  {nFilters > 0 ? '지금 고른 조건에는 없습니다. 조건을 지우면 다시 보입니다.' : '이번에는 관찰·참고만 있습니다.'}
                </EmptyState>
              )}
            </section>

            <section className="mid">
              <SectionH count={rest.length}>{featured.length ? '관찰·참고' : '전체'}</SectionH>
              {rest.length === 0 && (
                <EmptyState title="조건에 맞는 것이 없습니다" action={nFilters > 0 ? <Button size="sm" variant="secondary" onClick={clearFilters}>조건 지우기</Button> : null}>
                  {nFilters > 0 ? '조건을 줄이면 더 많이 보입니다.' : '이 구분에는 아직 추천이 없습니다.'}
                </EmptyState>
              )}
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
                <h3>주제별 개수</h3>
                {sysCount.length === 0 && <p className="muted">-</p>}
                {sysCount.map(([s, n], i) => (
                  <div key={s} className="topic"><Badge className={'tchip c' + (i % 4)}>{s}</Badge><b>{n}개</b></div>
                ))}
              </div>
              {rounds.length > 0 && (
                <div className="box">
                  <h3>회차별로 보기</h3>
                  <Button size="sm" variant={isAll ? 'primary' : 'ghost'} className="rbtn" onClick={() => setRoundId(ALL)}>
                    전체 누적 · {merged.length}건
                  </Button>
                  {rounds.map((r, i) => (
                    <Button key={r.id} size="sm" variant={!isAll && r.id === round.id ? 'primary' : 'ghost'} className="rbtn" onClick={() => setRoundId(r.id)}>
                      제 {rounds.length - i}회 ({r.id}) · {r.posted}건
                    </Button>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <style jsx global>{`
        .radar .loading { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 16px; }
        .radar .errraw { margin-top: 4px; font-size: 12px; opacity: .8; }
        .radar .errraw summary { cursor: pointer; }
        .radar .pmk-notice { margin-top: 12px; }
        .radar .fclear .fl { font-weight: bold; }
        .pm.radar[data-look="clear"] .bc,
        .pm.radar[data-look="clear"] .sc,
        .pm.radar[data-look="clear"] .box,
        .pm.radar[data-look="clear"] .filters { background: var(--pm-surface); border: 1px solid var(--pm-line); box-shadow: none; }
        .pm.radar[data-look="clear"] .bic,
        .pm.radar[data-look="clear"] .ic { background: var(--pm-surface2); border: 1px solid var(--pm-line); box-shadow: none; font-size: 10px; font-weight: 700; color: var(--pm-muted); }
        .pm.radar[data-look="clear"] .bc .pts { background: var(--pm-surface2); color: var(--pm-ink); border: 1px solid var(--pm-line); }
        .pm.radar[data-look="clear"] .newb { background: color-mix(in srgb, var(--pm-accent) 10%, var(--pm-surface)); color: var(--pm-accent); }
        .pm.radar[data-look="clear"] .sc .score.top { background: var(--pm-accent); color: var(--pm-accent-ink); }
        .pm.radar[data-look="clear"] .sc .score.hi { background: color-mix(in srgb, var(--pm-accent) 14%, var(--pm-surface)); color: var(--pm-accent); }
        .pm.radar[data-look="clear"] .sc .score.mid,
        .pm.radar[data-look="clear"] .sc .score.lo { background: var(--pm-surface2); color: var(--pm-muted); }
        .pm.radar[data-look="clear"] .bf.top { background: var(--pm-accent); }
        .pm.radar[data-look="clear"] .bf.hi { background: color-mix(in srgb, var(--pm-accent) 62%, var(--pm-surface)); }
        .pm.radar[data-look="clear"] .bf.mid { background: color-mix(in srgb, var(--pm-accent) 36%, var(--pm-surface)); }
        .pm.radar[data-look="clear"] .bf.lo { background: color-mix(in srgb, var(--pm-accent) 18%, var(--pm-surface)); }
        .pm.radar[data-look="clear"] .box .tchip { background: var(--pm-surface2); }
        .pm.radar[data-look="clear"] .brand .round,
        .pm.radar[data-look="clear"] .bc .term { box-shadow: none; border: 1px solid var(--pm-line); }
        .pm.radar[data-look="clear"] .pmk-chip.on { color: var(--pm-accent); }
        .radar .sc .hit { flex-wrap: wrap; }
        .radar .sc .hit .ttl { flex: 1 1 110px; min-width: 110px; }
        .pm.radar[data-look="clear"] .pmk-btn.pmk-primary { color: var(--pm-accent-ink); }
        .radar .bc { border-radius: var(--pm-radius); padding: 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
        .radar .bc header { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
        .radar .bic { flex: 0 0 auto; min-width: 38px; height: 28px; padding: 0 6px; border-radius: 6px; display: grid; place-items: center; }
        .radar .bc .ttl { flex: 1 1 150px; min-width: 150px; }
        .radar .bc .ttl a { color: var(--pm-ink); font-weight: 700; font-size: 14.5px; text-decoration: none; overflow-wrap: anywhere; }
        .radar .bc .ttl a:hover { text-decoration: underline; }
        .radar .bc .meta { display: block; color: var(--pm-muted); font-size: 11.5px; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .radar .bc .pts { flex: 0 0 auto; padding: 3px 9px; font-size: 11.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .radar .easy { margin: 0; line-height: 1.55; }
        .radar .terms { display: flex; flex-wrap: wrap; gap: 5px; }
        .radar .bc .term { background: var(--pm-surface2); padding: 2px 8px; }
        .radar .bc .term b { color: var(--pm-link); margin-right: 3px; }
        .radar .bc footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
        .radar .sp { flex: 1; }
        .radar .detail { border-top: 1px solid var(--pm-line); padding-top: 8px; line-height: 1.55; }
        .radar .detail p { margin: 4px 0; }
        .radar .detail b { color: var(--pm-link); margin-right: 4px; font-size: 12px; }
        .radar .detail a { color: var(--pm-link); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
        .radar .tp { color: var(--pm-muted); font-size: 11px; }
        .radar .sc { border-radius: var(--pm-radius); padding: 12px; display: flex; flex-direction: column; gap: 6px; }
        .radar .sc .hit { display: flex; gap: 8px; align-items: center; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; width: 100%; box-shadow: none; }
        .radar .ic { flex: 0 0 auto; min-width: 36px; height: 26px; padding: 0 5px; border-radius: 5px; display: grid; place-items: center; }
        .radar .sc .ttl { flex: 1; min-width: 0; }
        .radar .sc .ttl b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .radar .sc .meta { display: block; color: var(--pm-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
        .radar .sc .score { flex: 0 0 auto; font-weight: 700; font-size: 12px; padding: 3px 8px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .radar .sc .score small { font-size: 10px; font-weight: normal; opacity: .75; }
        .radar .sum { margin: 0; color: var(--pm-muted); line-height: 1.5; }
        .radar .tags, .radar .xtags { display: flex; flex-wrap: wrap; gap: 4px; }
        .radar .xtags .xt { white-space: normal; word-break: keep-all; }
        .radar .xtags .xt.use { background: var(--pm-ok-bg); color: var(--pm-ok-ink); font-weight: 700; }
        .radar .xtags .xt.re { background: var(--pm-err-bg); color: var(--pm-err-ink); font-weight: 700; }
        .radar .xtags .xt.wait { background: var(--pm-idle-bg); color: var(--pm-idle-ink); font-weight: 700; }
        .radar .xtags .xt.src { background: var(--pm-surface2); color: var(--pm-muted); }
        .radar .detail .rp { color: var(--pm-muted); font-size: 11px; word-break: break-all; }
      `}</style>
      <style jsx>{`
        .radar { min-height: 100%; padding: 18px 22px 40px; background: var(--pm-bg); color: var(--pm-ink); font-size: 13px; font-family: var(--pm-font); }
        .radar :global(.badge) { border: 1px solid var(--pm-line); border-radius: 4px; font: inherit; font-size: 11px; line-height: 1.5; padding: 1px 7px; background: var(--pm-surface2); color: var(--pm-ink); }
        .top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center; }
        .top-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
        .en { color: var(--pm-muted); font-size: 13px; }
        .brand :global(.round) { background: var(--pm-surface); color: var(--pm-link); font-size: 11.5px; padding: 3px 10px; font-variant-numeric: tabular-nums; }
        .sub { margin: 6px 0 14px; color: var(--pm-muted); max-width: 780px; line-height: 1.5; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 10px 14px; margin-bottom: 14px; border-radius: var(--pm-radius); }
        .fg { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
        .fl { color: var(--pm-muted); font-size: 12px; margin-right: 4px; font-weight: 700; }
        .cols { display: grid; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) 230px; gap: 16px; align-items: start; }
        .radar :global(h2) { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; }
        .radar :global(.cnt) { color: var(--pm-muted); font-variant-numeric: tabular-nums; }
        .muted { color: var(--pm-muted); }
        .radar :global(.sys) { background: var(--pm-surface2); color: var(--pm-muted); }
        .radar :global(.newb) { background: var(--pm-err-bg); color: var(--pm-err-ink); font-weight: 700; white-space: nowrap; }
        .radar :global(.pilot) { background: var(--pm-ok-bg); color: var(--pm-ok-ink); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
        .more { margin-top: 14px; text-align: center; }
        .side { display: flex; flex-direction: column; gap: 12px; }
        .box { border-radius: var(--pm-radius); padding: 12px 14px; }
        h3 { margin: 0 0 10px; font-size: 13px; }
        .bars { display: flex; gap: 10px; align-items: flex-end; justify-content: space-around; min-height: 104px; }
        .bar { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .bv { font-size: 11px; color: var(--pm-muted); font-variant-numeric: tabular-nums; }
        .bf { width: 18px; border-radius: 4px; }
        .bl { font-size: 11px; color: var(--pm-muted); }
        .topic { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0; }
        .box :global(.tchip) { font-size: 12px; padding: 2px 9px; color: var(--pm-ink); }
        .topic b { font-variant-numeric: tabular-nums; }
        .box :global(.rbtn) { display: block; width: 100%; margin: 4px 0; text-align: left; }
        @media (max-width: 1100px) {
          .cols { grid-template-columns: minmax(280px, 1fr) 1.4fr; }
          .side { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }
          .side .box { flex: 1 1 220px; }
        }
        @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
        @media (max-width: 640px) {
          .radar { padding: 14px 16px 32px; }
          .side { flex-direction: column; }
          .grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
