// pages/pm/radar.js — 기술 레이더(GitHub 추천)
// PM 이 월·목 07:30 GitHub 인기·급상승 저장소를 모아 Claude 로 평가(우리 회사 쓸모·난이도·점수)한 결과 중 6점 이상만 보여준다.
// 데이터: GET /api/pm/radar (사장님 PC nenova-pm/github-radar/radar.js → feature-data-ingest name=tech-radar). 읽기 전용.
// 버튼은 /pm UI 키트(components/pm/ui)만 import 해 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { Button, ToggleChip, PmUiStyles, Tabs } from '../../components/pm/ui';
import { verifyReqUser } from '../../lib/auth';

export async function getServerSideProps({ req, res, resolvedUrl }) {
  const user = await verifyReqUser(req, res);
  if (!user) return { redirect: { destination: '/login?next=' + encodeURIComponent(resolvedUrl || '/pm/radar'), permanent: false } };
  return { props: {} };
}

const ACTIONS = ['바로 시험', '관찰', '참고'];
const SYSTEMS = ['네노바웹', 'Orbit', 'AI 자동화', 'MOYI', '공통'];
const SCORES = [5, 6, 7, 8, 9];
const kst = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso || ''; } };
const fmtStars = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));
const scoreTone = (s) => (s >= 8 ? 'hi' : s >= 7 ? 'mid' : 'lo');

function Card({ x }) {
  const [open, setOpen] = useState(false);
  const trend = x.track === 'trend';
  return (
    <article className={'rc' + (x.action === '바로 시험' ? ' try' : '')}>
      <header>
        <span className={'score ' + scoreTone(x.score)} title={trend ? '알아둘 가치(0~10)' : '우리 회사 쓸모 점수(0~10)'}>{x.score}</span>
        <div className="ttl">
          <a href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a>
          <div className="meta">★ {fmtStars(x.stars)}{x.starsPerDay ? ` · 하루 +${fmtStars(x.starsPerDay)}` : ''}{x.language ? ` · ${x.language}` : ''}</div>
        </div>
        <span className={'act a' + ACTIONS.indexOf(x.action)}>{x.action}</span>
      </header>
      <p className="sum">{x.summary}</p>
      {x.easy && <div className="easy"><b>이게 뭐예요?</b> {x.easy}</div>}
      {x.analogy && <div className="easy ana"><b>우리 회사에 빗대면</b> {x.analogy}</div>}
      {(x.terms || []).length > 0 && (
        <div className="terms">{x.terms.map((t) => <span key={t.t} className="term" title={t.d}><b>{t.t}</b> {t.d}</span>)}</div>
      )}
      <div className="use"><b>{trend ? '알아둘 이유' : '우리 쓸모'}</b> {x.use}</div>
      {open && (
        <div className="detail">
          {x.why && <p><b>왜 인기인가요?</b> {x.why}</p>}
          <p><b>기술 정보</b> {x.desc || '-'}</p>
          {(x.topics || []).length > 0 && <p className="tp">{x.topics.map((t) => '#' + t).join(' ')}</p>}
          <p className="tp">만든 날 {String(x.created || '').slice(0, 10)} · 최근 수정 {String(x.pushed || '').slice(0, 10)}</p>
        </div>
      )}
      <footer>
        {(x.systems || []).map((s) => <span key={s} className="sys">{s}</span>)}
        <span className={'diff d' + ['쉬움', '보통', '어려움'].indexOf(x.difficulty)}>난이도 {x.difficulty}</span>
        <span className="sp" />
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '왜 인기·기술 세부'}</Button>
      </footer>
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

  useEffect(() => {
    fetch('/api/pm/radar', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error || '불러오기 실패'); setData(j.data); setRoundId(j.data?.rounds?.[0]?.id || ''); })
      .catch((e) => setErr(e.message));
  }, []);

  const rounds = data?.rounds || [];
  const round = rounds.find((r) => r.id === roundId) || rounds[0];
  const items = useMemo(() => (round?.items || []).filter((x) => ((x.track || 'interest') === track) && (!act || x.action === act) && (!sys || (x.systems || []).includes(sys)) && x.score >= minScore), [round, act, sys, minScore, track]);
  const tryNow = items.filter((x) => x.action === '바로 시험');
  const rest = items.filter((x) => x.action !== '바로 시험');

  return (
    <div className="pm radar">
      <PmUiStyles />
      <div className="top">
        <div>
          <h1>기술 레이더</h1>
          <p className="sub">PM 이 월·목 아침 GitHub 인기·급상승 저장소를 살펴 우리 회사(네노바웹·Orbit·AI 자동화·MOYI)에 쓸모 있는 것만 골랐습니다. 관심 분야는 6점 이상, 전체 트렌드는 알아둘 가치 상위만 게시.</p>
        </div>
        {round && (
          <div className="stat">
            <div><b>{round.posted}</b><span>게시</span></div>
            <div><b>{round.evaluated}</b><span>평가</span></div>
            <div><b>{round.poolSize}</b><span>훑어본 수</span></div>
            <div className="when">{round.id} 회차<br />{kst(round.generatedAt)} 갱신</div>
          </div>
        )}
      </div>

      {err && <p className="muted">불러오지 못했습니다: {err}</p>}
      {!err && !data && <p className="muted">불러오는 중…</p>}
      {data === null && !err && rounds.length === 0 && null}
      {data && !rounds.length && <p className="muted">아직 올라온 회차가 없습니다.</p>}

      {round && (
        <>
          <Tabs label="구분" value={track} onChange={setTrack} items={[
            ['interest', `우리 관심 (${(round.items || []).filter((x) => (x.track || 'interest') === 'interest').length})`],
            ['trend', `전체 트렌드 (${(round.items || []).filter((x) => x.track === 'trend').length})`],
          ]} />
          <p className="tabnote">{track === 'trend' ? '주제와 상관없이 지금 GitHub 에서 뜨는 것 — "알아둘 가치" 기준 상위만.' : '우리 업무(ERP·업무관찰·AI 자동화·메신저) 관련 주제 — "우리 쓸모" 6점 이상.'}</p>
          <div className="filters">
            <div className="fg"><span className="fl">추천</span>
              <ToggleChip on={!act} aria-pressed={!act} onClick={() => setAct('')}>전체</ToggleChip>
              {ACTIONS.map((a) => <ToggleChip key={a} on={act === a} aria-pressed={act === a} onClick={() => setAct(act === a ? '' : a)}>{a}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">시스템</span>
              <ToggleChip on={!sys} aria-pressed={!sys} onClick={() => setSys('')}>전체</ToggleChip>
              {SYSTEMS.map((s) => <ToggleChip key={s} on={sys === s} aria-pressed={sys === s} onClick={() => setSys(sys === s ? '' : s)}>{s}</ToggleChip>)}
            </div>
            <div className="fg"><span className="fl">점수</span>
              {SCORES.map((n) => <ToggleChip key={n} on={minScore === n} aria-pressed={minScore === n} onClick={() => setMinScore(n)}>{n}+</ToggleChip>)}
            </div>
          </div>

          {tryNow.length > 0 && (
            <section>
              <h2>바로 시험해 볼 것 <span>{tryNow.length}</span></h2>
              <div className="grid">{tryNow.map((x) => <Card key={x.name} x={x} />)}</div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h2>관찰·참고 <span>{rest.length}</span></h2>
              <div className="grid">{rest.map((x) => <Card key={x.name} x={x} />)}</div>
            </section>
          )}
          {!items.length && <p className="muted">조건에 맞는 항목이 없습니다.</p>}

          {rounds.length > 1 && (
            <section className="arch">
              <h2>지난 회차</h2>
              <div className="rounds">
                {rounds.map((r) => (
                  <Button key={r.id} size="sm" variant={r.id === round.id ? 'primary' : 'secondary'} onClick={() => setRoundId(r.id)}>
                    {r.id} · {r.posted}건
                  </Button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <style jsx>{`
        .radar { min-height: 100%; padding: 20px 24px 40px; background: #1d2130; color: #e8ebf3; font-size: 13px; }
        .top { display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px; }
        h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
        .sub { margin: 0; color: #a9b0c4; max-width: 640px; line-height: 1.5; }
        .stat { display: flex; gap: 18px; align-items: center; background: #272c3e; border: 1px solid #353b52; border-radius: 10px; padding: 10px 16px; }
        .stat div { display: flex; flex-direction: column; align-items: center; }
        .stat b { font-size: 20px; color: #ffd76a; font-variant-numeric: tabular-nums; }
        .stat span { font-size: 11px; color: #a9b0c4; }
        .stat .when { font-size: 11px; color: #c7cde0; text-align: right; align-items: flex-end; line-height: 1.5; }
        .filters { display: flex; flex-wrap: wrap; gap: 6px 20px; padding: 10px 12px; margin-bottom: 18px; background: #252a3b; border-radius: 10px; }
        .fg { display: flex; align-items: center; flex-wrap: wrap; }
        .fl { color: #8d95ad; font-size: 12px; margin-right: 6px; }
        h2 { font-size: 15px; margin: 18px 0 10px; display: flex; gap: 8px; align-items: center; }
        h2 span { font-size: 11px; background: #3a4158; border-radius: 10px; padding: 1px 8px; color: #c7cde0; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
        .rc { background: #272c3e; border: 1px solid #353b52; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; transition: border-color .15s, transform .15s; }
        .rc:hover { border-color: #5a6385; transform: translateY(-1px); }
        .rc.try { border-color: #6b5a24; box-shadow: inset 3px 0 0 #ffd76a; }
        .rc header { display: flex; gap: 10px; align-items: flex-start; }
        .score { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; font-weight: bold; font-size: 16px; font-variant-numeric: tabular-nums; }
        .score.hi { background: #ffd76a; color: #2b2214; }
        .score.mid { background: #5b8def; color: #fff; }
        .score.lo { background: #3a4158; color: #e8ebf3; }
        .ttl { flex: 1; min-width: 0; }
        .ttl a { color: #8fb8ff; font-weight: bold; word-break: break-all; text-decoration: none; }
        .ttl a:hover { text-decoration: underline; }
        .meta { color: #8d95ad; font-size: 11px; margin-top: 2px; }
        .act { flex: 0 0 auto; font-size: 11px; border-radius: 6px; padding: 3px 7px; white-space: nowrap; }
        .act.a0 { background: #ffd76a; color: #2b2214; font-weight: bold; }
        .act.a1 { background: #2f4a6b; color: #cfe2ff; }
        .act.a2 { background: #3a4158; color: #c7cde0; }
        .sum { margin: 0; line-height: 1.5; }
        .use { background: #1f2333; border-radius: 8px; padding: 8px 10px; line-height: 1.5; color: #d6dbe8; }
        .use b { color: #ffd76a; margin-right: 4px; font-size: 12px; }
        .rc footer { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; align-items: center; }
        .sys, .diff { font-size: 11px; border-radius: 6px; padding: 2px 7px; background: #323850; color: #c7cde0; }
        .diff.d0 { color: #8be3a5; } .diff.d1 { color: #ffd76a; } .diff.d2 { color: #ff9a8a; }
        .easy { line-height: 1.55; color: #e8ebf3; }
        .easy b { display: block; color: #8be3a5; font-size: 12px; margin-bottom: 2px; }
        .easy.ana b { color: #ffb38a; }
        .terms { display: flex; flex-wrap: wrap; gap: 4px; }
        .term { font-size: 11px; background: #1f2a3a; border: 1px solid #344a66; color: #cfe2ff; border-radius: 12px; padding: 2px 8px; }
        .term b { color: #8fb8ff; }
        .detail { border-top: 1px dashed #3a4158; padding-top: 6px; color: #c7cde0; line-height: 1.5; }
        .detail p { margin: 4px 0; } .detail b { color: #ffd76a; margin-right: 4px; font-size: 12px; }
        .tp { color: #8d95ad; font-size: 11px; }
        .sp { flex: 1; }
        .tabnote { color: #a9b0c4; margin: 8px 0 10px; font-size: 12px; }
        .rounds { display: flex; flex-wrap: wrap; gap: 6px; }
        .muted { color: #a9b0c4; }
        @media (max-width: 640px) {
          .radar { padding: 14px 16px 32px; }
          .grid { grid-template-columns: 1fr; }
          .stat { width: 100%; justify-content: space-between; }
        }
      `}</style>
    </div>
  );
}
