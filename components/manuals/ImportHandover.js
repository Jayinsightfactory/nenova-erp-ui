// components/manuals/ImportHandover.js — /work/manuals 첫 화면 "수입부 인수인계 업무표".
//   하루·주·월 업무표(아침에 출근해서 하는 순서대로) → 각 줄에서 새 기준 매뉴얼(6항목 + 가이드 영상)로 바로 들어간다.
//   데이터: lib/importHandover.js(data/import-handover.json). 확정/추정과 근거 건수를 줄마다 표시한다.
//   색은 /pm 토큰(var(--pm-*))만 — hex 금지(__tests__/importHandover.test.js). 버튼은 components/pm/ui 키트만.
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, PmUiStyles, Tabs, ToggleChip } from '../pm/ui';
import { allThemesCss, readStoredTheme } from '../../lib/pmThemes';
import WorkflowGuide from '../WorkflowGuide';

const KINDS = [['daily', '하루'], ['weekly', '주'], ['monthly', '월'], ['manuals', '매뉴얼 전체'], ['todo', '남은 일 · 물어볼 것']];
const WHEN_HEAD = { daily: '시간대', weekly: '요일', monthly: '시기' };
const STATUS = { confirmed: ['확정', 'ok'], estimated: ['추정', 'est'] };

export function evidenceText(evidence) {
  return (evidence || []).map((e) => `${e.source}${e.count != null ? ` ${Number(e.count).toLocaleString()}건` : ''}${e.note ? ` (${e.note})` : ''}`).join(' · ') || '근거 없음';
}

function Status({ it }) {
  const [label, tone] = STATUS[it.status] || STATUS.estimated;
  return <Badge tone={tone}>{label}</Badge>;
}

function ScheduleTable({ kind, rows, onOpen }) {
  const types = useMemo(() => [...new Set(rows.map((r) => r.dayType).filter(Boolean))], [rows]);
  const [type, setType] = useState(null);
  const shown = rows.filter((r) => !type || !r.dayType || r.dayType === type);
  if (!rows.length) return <p className="empty">아직 근거가 모이지 않아 비워 두었습니다.</p>;
  return (
    <>
      {types.length > 1 && (
        <div className="chips" role="group" aria-label="날 유형">
          <ToggleChip on={!type} onClick={() => setType(null)}>전체</ToggleChip>
          {types.map((t) => <ToggleChip key={t} on={type === t} onClick={() => setType(t)}>{t}</ToggleChip>)}
        </div>
      )}
      <div className="tblwrap">
        <table className="ihtbl">
          <thead>
            <tr><th>{WHEN_HEAD[kind]}</th><th>하는 일</th><th>시작 신호(무엇이 오면 시작)</th><th>쓰는 화면·파일</th><th>다음에 넘기는 곳</th><th>근거</th><th>매뉴얼</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.when}</b>{r.dayType ? <small className="muted"> {r.dayType}</small> : null}</td>
                <td><b>{r.title}</b>{r.detail ? <p>{r.detail}</p> : null}</td>
                <td>{r.trigger || '-'}</td>
                <td>{(r.screens || []).join(', ') || '-'}</td>
                <td>{r.handoff || '-'}</td>
                <td><Status it={r} /> <small className="muted">{evidenceText(r.evidence)}</small></td>
                <td>
                  {r.manualId
                    ? <Button size="sm" variant="primary" onClick={() => onOpen(r.manualId)}>{r.hasVideo ? '영상 + 글 매뉴얼' : '글 매뉴얼'}</Button>
                    : <small className="muted">아직 없음</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 국가별 주간 업무표 — 줄 = 나라·상대, 칸 = 요일. 칸을 누르면 작업 순서·화면·걸리는 시간·넘기는 곳·근거가 펼쳐지고 매뉴얼로 들어간다.
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
function CountryCalendar({ calendar, manuals, onOpen }) {
  const [sel, setSel] = useState(null);
  if (!calendar?.length) return null;
  const picked = sel && calendar[sel[0]]?.cells[sel[1]];
  const titleOf = (id) => (manuals || []).find((m) => m.id === id);
  return (
    <>
      <h4>국가별 주간 업무표 <small className="muted">칸을 누르면 그 일의 작업 순서가 나옵니다</small></h4>
      <div className="tblwrap">
        <table className="ihtbl cal">
          <thead><tr><th>나라 · 상대</th>{DAYS.map((d) => <th key={d}>{d}</th>)}<th>매일</th></tr></thead>
          <tbody>
            {calendar.map((c, ci) => (
              <tr key={c.country}>
                <td><b>{c.country}</b><p>{c.partner}</p><p>{c.channel}</p></td>
                {[...DAYS, '매일'].map((d) => (
                  <td key={d}>
                    {c.cells.map((x, xi) => x.weekday === d && (
                      <Button key={xi} size="sm" variant={sel && sel[0] === ci && sel[1] === xi ? 'primary' : 'secondary'} className="calcell" aria-expanded={!!(sel && sel[0] === ci && sel[1] === xi)} onClick={() => setSel(sel && sel[0] === ci && sel[1] === xi ? null : [ci, xi])}>
                        {x.title}
                      </Button>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {picked && (
        <div className="caldetail" role="region" aria-label="고른 칸의 작업 순서">
          <p><b>{calendar[sel[0]].country} · {picked.weekday}</b> — {picked.title} <Status it={picked} /> <small className="muted">{evidenceText(picked.evidence)}</small></p>
          <ol>{picked.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p><b>쓰는 화면·파일</b> {picked.screens.join(', ')}</p>
          <p><b>걸리는 시간</b> {picked.time}</p>
          <p><b>다음에 넘기는 곳</b> {picked.handoff}</p>
          {picked.manualId && titleOf(picked.manualId)
            ? <Button size="sm" variant="primary" onClick={() => onOpen(picked.manualId)}>「{titleOf(picked.manualId).title}」 매뉴얼 열기</Button>
            : <small className="muted">이 일의 매뉴얼은 아직 없습니다(남은 일 목록 참고).</small>}
        </div>
      )}
      <h4>요일별 공통 일</h4>
    </>
  );
}

function ManualView({ manual, onBack }) {
  return (
    <article className="manual" aria-label={`${manual.title} 매뉴얼`}>
      <div className="mhead">
        <Button size="sm" variant="ghost" onClick={onBack}>← 업무표로</Button>
        <h3>{manual.title}</h3>
        <Status it={manual} />
        <small className="muted">{evidenceText(manual.evidence)}</small>
      </div>
      {manual.practicedBy?.length > 0 && <p className="muted"><small>이 절차를 실제로 하던 사람: {manual.practicedBy.join(', ')} · 쓰는 화면: {(manual.screens || []).join(', ')}</small></p>}

      <h4>① 이 일을 왜 · 언제 하는가</h4>
      <p><b>왜</b> {manual.why}</p>
      <p><b>언제</b> {manual.when}</p>

      <h4>② 시작 전에 준비할 자료</h4>
      <ul>{manual.prepare.map((p, i) => <li key={i}>{p}</li>)}</ul>

      <h4>③ 단계별로 따라 하기 <small className="muted">(영상 · 자막 · 목차와 같은 번호)</small></h4>
      {manual.video
        ? <WorkflowGuide workflowId={manual.video.workflowId} defaultOpen />
        : <p className="empty">이 절차는 아직 영상이 없습니다. 아래 글 단계로 따라 하세요.</p>}
      <ol className="msteps">
        {manual.steps.map((s) => (
          <li key={s.no}>
            <span className="no" aria-hidden>{s.no}</span>
            <div>
              <b>{s.no}. {s.title}</b>{s.screen ? <small className="muted"> {s.screen}</small> : null}
              <dl>
                <dt>무엇을 보고</dt><dd>{s.look}</dd>
                <dt>무엇을 넣고</dt><dd>{s.input}</dd>
                <dt>왜</dt><dd>{s.why}</dd>
              </dl>
            </div>
          </li>
        ))}
      </ol>

      <h4>④ 끝났는지 확인하는 법</h4>
      <ul>{manual.doneCheck.map((p, i) => <li key={i}>{p}</li>)}</ul>

      <h4>⑤ 자주 틀리는 곳</h4>
      <ul>{manual.pitfalls.map((p, i) => <li key={i}><b>{p.mistake}</b> → {p.fix}</li>)}</ul>

      <h4>⑥ 다음 일</h4>
      <p>{manual.next}</p>
      {manual.openQuestions?.length > 0 && (
        <>
          <h4>아직 확인이 필요한 점 <small className="muted">(담당자에게 물어볼 것)</small></h4>
          <ul>{manual.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </>
      )}
    </article>
  );
}

function Todo({ data }) {
  return (
    <>
      <h4>직원에게 물어볼 것 <small className="muted">(급한 순서 · 화면에 안 찍힌 판단 기준)</small></h4>
      {data.questions?.length ? (
        <ol className="qs">{data.questions.map((q, i) => <li key={i}><Badge tone={q.priority === '급함' ? 'err' : 'plain'}>{q.priority}</Badge> <b>{q.topic}</b> — {q.question}{q.why ? <small className="muted"> ({q.why})</small> : null}</li>)}</ol>
      ) : <p className="empty">없음</p>}
      <h4>아직 매뉴얼을 못 만든 절차</h4>
      {data.notYet?.length ? <ul>{data.notYet.map((x, i) => <li key={i}><b>{x.title}</b> — {x.reason}</li>)}</ul> : <p className="empty">없음</p>}
      <h4>근거가 부족한 절차</h4>
      {data.weakEvidence?.length ? <ul>{data.weakEvidence.map((x, i) => <li key={i}><b>{x.title}</b> — {x.reason}</li>)}</ul> : <p className="empty">없음</p>}
    </>
  );
}

export default function ImportHandover({ data, me, initialManual }) {
  const [theme, setTheme] = useState('B');
  const [kind, setKind] = useState('daily');
  const [openId, setOpenId] = useState(initialManual || null);
  useEffect(() => { setTheme(readStoredTheme(me)); }, [me]);
  useEffect(() => { if (initialManual) setOpenId(initialManual); }, [initialManual]);
  const css = useMemo(() => allThemesCss(), []);
  if (!data) return null;
  const manual = (data.manuals || []).find((m) => m.id === openId);
  const src = data.sourceSummary || [];

  return (
    <div className="pm ih" data-theme={theme}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <section aria-label="수입부 인수인계 업무표">
        <h2>수입부 인수인계 업무표 <small className="muted">하루 · 주 · 월 — 아침에 출근해서 하는 순서대로</small></h2>
        <p className="muted">
          새로 온 사람이 이 표와 매뉴얼만 보고 일을 이어받도록 만든 업무 지원 자료입니다. 줄마다 <Badge tone="ok">확정</Badge>(전산 기록 등 두 가지 이상 근거가 서로 맞음)과 <Badge tone="est">추정</Badge>(한 가지 근거뿐)을 표시했습니다. 갱신 {data.updatedAt}.
        </p>
        {src.length > 0 && <p className="muted"><small>근거 자료: {src.map((s) => `${s.label} ${s.period}${s.count != null ? ` ${Number(s.count).toLocaleString()}건` : ''}`).join(' / ')}</small></p>}
        {manual ? <ManualView manual={manual} onBack={() => setOpenId(null)} /> : (
          <>
            <Tabs label="업무표 보기" items={KINDS} value={kind} onChange={setKind} />
            {kind === 'manuals' && (
              <div className="mlist">
                {(data.manuals || []).map((m) => (
                  <div key={m.id} className="mcard">
                    <b>{m.title}</b> <Status it={m} />
                    <p>{m.why}</p>
                    <Button size="sm" variant="primary" onClick={() => setOpenId(m.id)}>{m.video ? '영상 + 글 매뉴얼 열기' : '글 매뉴얼 열기'}</Button>
                  </div>
                ))}
              </div>
            )}
            {kind === 'todo' && <Todo data={data} />}
            {kind === 'weekly' && <CountryCalendar calendar={data.countryCalendar} manuals={data.manuals} onOpen={setOpenId} />}
            {['daily', 'weekly', 'monthly'].includes(kind) && <ScheduleTable key={kind} kind={kind} rows={data.schedule?.[kind] || []} onOpen={setOpenId} />}
          </>
        )}
      </section>
      <style jsx global>{`
        .ih { background: var(--pm-bg); color: var(--pm-ink); font-family: var(--pm-font); padding: 16px 16px 0; }
        .ih section { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 14px; box-shadow: var(--pm-shadow); }
        .ih h2 { font-size: 18px; margin: 0 0 6px; }
        .ih h3 { font-size: 17px; margin: 0; }
        .ih h4 { font-size: 14px; margin: 16px 0 6px; }
        .ih p { margin: 4px 0; font-size: 13px; line-height: 1.6; }
        .ih ul, .ih ol.qs { margin: 4px 0; padding-left: 20px; font-size: 13px; line-height: 1.7; }
        .ih .muted { color: var(--pm-muted); }
        .ih .empty { color: var(--pm-muted); font-size: 12px; }
        .ih .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
        .ih .badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--pm-off-bg); color: var(--pm-off-ink); }
        .ih .badge.ok { background: var(--pm-ok-bg); color: var(--pm-ok-ink); }
        .ih .badge.est { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .ih .badge.err { background: var(--pm-err-bg); color: var(--pm-err-ink); }
        .ih .badge.plain { background: var(--pm-surface2); color: var(--pm-ink); }
        .ih .tblwrap { overflow-x: auto; margin-top: 8px; }
        .ih .ihtbl { width: 100%; border-collapse: collapse; font-size: 13px; }
        .ih .ihtbl th, .ih .ihtbl td { border-bottom: 1px solid var(--pm-line); padding: 8px 6px; text-align: left; vertical-align: top; color: var(--pm-ink); background: transparent; }
        .ih .ihtbl th { background: var(--pm-surface2); white-space: nowrap; }
        .ih .ihtbl td p { margin: 2px 0 0; color: var(--pm-muted); font-size: 12px; }
        .ih .cal td { min-width: 120px; }
        .ih .cal td:first-child { min-width: 170px; }
        .ih .calcell { display: block; width: 100%; height: auto; white-space: normal; text-align: left; line-height: 1.4; margin: 0 0 4px; padding: 6px 8px; font-weight: 500; }
        .ih .caldetail { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 10px 12px; margin: 8px 0; }
        .ih .caldetail ol { margin: 6px 0; padding-left: 22px; font-size: 13px; line-height: 1.7; }
        .ih .mlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; margin-top: 8px; }
        .ih .mcard { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 10px; }
        .ih .mhead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
        .ih .msteps { list-style: none; padding: 0; margin: 10px 0; }
        .ih .msteps li { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--pm-line); font-size: 13px; }
        .ih .msteps .no { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--pm-accent); color: var(--pm-surface); font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .ih .msteps dl { display: grid; grid-template-columns: 84px 1fr; gap: 3px 8px; margin: 6px 0 0; line-height: 1.6; }
        .ih .msteps dt { color: var(--pm-muted); }
        .ih .msteps dd { margin: 0; }
        @media (max-width: 760px) { .ih .msteps dl { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
