// components/manuals/ImportHandover.js — /work/manuals 첫 화면 "수입부 인수인계 업무표".
//   하루·주·월 업무표(아침에 출근해서 하는 순서대로) → 각 줄에서 새 기준 매뉴얼(6항목 + 가이드 영상)로 바로 들어간다.
//   데이터: lib/importHandover.js(data/import-handover.json). 확정/추정과 근거 건수를 줄마다 표시한다.
//   색은 /pm 토큰(var(--pm-*))만 — hex 금지(__tests__/importHandover.test.js). 버튼은 components/pm/ui 키트만.
//   원고에 아직 없을 수 있는 자료(essentials·firstDay·troubles·countryOrderCards·folderMap·tools·order·oneLine·quickSteps)는 있을 때만 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, PmUiStyles, Tabs, ToggleChip } from '../pm/ui';
import { allThemesCss, readStoredTheme } from '../../lib/pmThemes';
import WorkflowGuide from '../WorkflowGuide';
import ImportEducation from './ImportEducation';
import ImportWeekday, { DAYS, ManualBtn, Status, evidenceText, mediaOf } from './ImportWeekday';

export { evidenceText };

const KINDS = [['daily', '하루'], ['weekly', '주'], ['monthly', '월'], ['trouble', '문제가 생겼을 때'], ['manuals', '매뉴얼 전체'], ['edu', '신입 교육'], ['todo', '남은 일 · 물어볼 것']];
const WHEN_HEAD = { daily: '시간대', weekly: '요일', monthly: '시기' };
const asArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// 긴 글을 앞 2문장 + 나머지로 나눈다(문장이 3개를 넘을 때만). 괄호 안의 마침표에서는 끊지 않는다.
export function splitLong(text) {
  const t = String(text || '');
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '「' || c === '[') depth++;
    else if (c === ')' || c === '」' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && '.?!'.includes(c) && /\s/.test(t[i + 1] || '') && !/\d/.test(t[i - 1] || '')) { out.push(t.slice(from, i + 1).trim()); from = i + 1; }
  }
  if (t.slice(from).trim()) out.push(t.slice(from).trim());
  if (out.length <= 3) return [t, ''];
  return [out.slice(0, 2).join(' '), out.slice(2).join(' ')];
}

function Long({ text }) {
  const [head, rest] = splitLong(text);
  if (!rest) return <>{head}</>;
  return <>{head}<details className="more"><summary>자세히</summary>{rest}</details></>;
}

function ScheduleTable({ kind, rows, manuals, onOpen }) {
  const types = useMemo(() => [...new Set(rows.map((r) => r.dayType).filter(Boolean))], [rows]);
  const [type, setType] = useState(null);
  const shown = rows.filter((r) => !type || !r.dayType || r.dayType === type);
  if (!rows.length) return <p className="empty">아직 근거가 모이지 않아 비워 두었습니다.</p>;
  const allEst = kind === 'monthly' && rows.every((r) => r.status !== 'confirmed');
  return (
    <>
      {allEst && <p className="muted">아직 한 달치 기록만 있어 모두 추정입니다.</p>}
      {types.length > 1 && (
        <div className="chips" role="group" aria-label="날 유형">
          <ToggleChip on={!type} onClick={() => setType(null)}>전체</ToggleChip>
          {types.map((t) => <ToggleChip key={t} on={type === t} onClick={() => setType(t)}>{t}</ToggleChip>)}
        </div>
      )}
      <div className="tblwrap">
        <table className="ihtbl">
          <thead>
            <tr><th>{WHEN_HEAD[kind]}</th><th>하는 일</th><th>시작 신호</th><th>쓰는 화면</th><th>넘기는 곳</th><th>매뉴얼</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.when}</b>{r.dayType ? <small className="muted"> {r.dayType}</small> : null}</td>
                <td>
                  <b>{r.title}</b> {!allEst && <Status it={r} />}
                  {r.detail ? <p>{r.detail}</p> : null}
                  <details className="why"><summary>근거</summary><small className="muted">{evidenceText(r.evidence)}</small></details>
                </td>
                <td>{r.trigger || '-'}</td>
                <td>{(r.screens || []).join(', ') || '-'}</td>
                <td>{r.handoff || '-'}</td>
                <td><ManualBtn id={r.manualId} manuals={manuals} onOpen={onOpen} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 국가별 주간 업무표 — 줄 = 나라·상대, 칸 = 요일. 칸을 누르면 누른 줄 바로 아래에 작업 순서·화면·걸리는 시간·넘기는 곳이 펼쳐지고 매뉴얼로 들어간다.
function CountryCalendar({ calendar, manuals, onOpen, today }) {
  const [sel, setSel] = useState(null);
  if (!calendar?.length) return null;
  const picked = sel && calendar[sel[0]]?.cells[sel[1]];
  const cols = [...DAYS, '매일'];
  return (
    <>
      <h4>국가별 주간 업무표 <small className="muted">칸을 누르면 그 줄 바로 아래에 작업 순서가 나옵니다</small></h4>
      <div className="tblwrap">
        <table className="ihtbl cal">
          <thead><tr><th>나라 · 상대</th>{cols.map((d) => <th key={d} className={d === today ? 'today' : undefined}>{d}{d === today ? ' · 오늘' : ''}</th>)}</tr></thead>
          <tbody>
            {calendar.map((c, ci) => [
              <tr key={c.country}>
                <td><b>{c.country}</b><p>{c.partner}</p><p>{c.channel}</p></td>
                {cols.map((d) => (
                  <td key={d} className={d === today ? 'today' : undefined}>
                    {c.cells.map((x, xi) => x.weekday === d && (
                      <Button key={xi} size="sm" variant={sel && sel[0] === ci && sel[1] === xi ? 'primary' : 'secondary'} className="calcell" aria-expanded={!!(sel && sel[0] === ci && sel[1] === xi)} onClick={() => setSel(sel && sel[0] === ci && sel[1] === xi ? null : [ci, xi])}>
                        {x.title}
                      </Button>
                    ))}
                  </td>
                ))}
              </tr>,
              sel && sel[0] === ci && picked ? (
                <tr key={`${c.country}-open`} className="calrow">
                  <td colSpan={cols.length + 1}>
                    <div className="caldetail" role="region" aria-label="고른 칸의 작업 순서">
                      <p><b>{c.country} · {picked.weekday}</b> — {picked.title} <Status it={picked} /></p>
                      <ol>{picked.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                      <p><b>쓰는 화면·파일</b> {picked.screens.join(', ')}</p>
                      <p><b>걸리는 시간</b> {picked.time}</p>
                      <p><b>다음에 넘기는 곳</b> {picked.handoff}</p>
                      <details className="why"><summary>근거</summary><small className="muted">{evidenceText(picked.evidence)}</small></details>
                      <ManualBtn id={picked.manualId} manuals={manuals} onOpen={onOpen} />
                    </div>
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
      <h4>요일마다 꼭 하는 일(나라 공통)</h4>
    </>
  );
}

// 강의형 설명 영상: 기록된 화면 그림에 설명 음성을 붙인 것(실제 조작 녹화가 아님). 목차 번호는 글 단계와 같다.
function Lecture({ manual }) {
  const ref = useRef(null);
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const go = (t) => { const v = ref.current; if (!v) return; v.currentTime = t; v.play?.().catch(() => {}); };
  return (
    <div className="lec">
      <p className="muted"><small>강의형 설명 영상 — 기록된 업무 화면 그림에 설명을 붙였습니다(실제 조작을 찍은 사용 가이드 영상이 아닙니다). 길이 {mmss(manual.lecture.seconds || 0)}</small></p>
      <video ref={ref} controls preload="metadata" src={`/api/work/manual-lecture?id=${manual.id}`} aria-label={`${manual.title} 강의형 설명 영상`} />
      <div className="chips" role="group" aria-label="영상 목차">
        {manual.lecture.chapters.map((ch, i) => <Button key={i} size="sm" variant="secondary" onClick={() => go(ch.start)}>{ch.title} {mmss(ch.start)}</Button>)}
      </div>
    </div>
  );
}

// 화면 캡처 크게 보기 — 화면 위에 겹쳐 띄운다. Esc·바깥 누름으로 닫힌다.
function Zoom({ img, onClose }) {
  useEffect(() => {
    const on = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    document.querySelector('.ih .lbxbar button')?.focus?.();
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="lbx" role="dialog" aria-modal="true" aria-label="화면 캡처 크게 보기" onClick={onClose}>
      <div className="lbxbar"><Button size="sm" variant="primary" onClick={onClose}>닫기 (Esc)</Button></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.src} alt={img.alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

const TOC = [['why', '① 왜·언제'], ['prep', '② 준비'], ['steps', '③ 따라 하기'], ['check', '④ 확인'], ['pit', '⑤ 자주 틀리는 곳'], ['next', '⑥ 다음 일']];
const goTo = (id) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

function ManualView({ manual, manuals, onBack, onOpen, blurred }) {
  const [zoom, setZoom] = useState(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.scrollIntoView?.({ block: 'start' }); }, []);
  const nextLinks = (manuals || []).filter((m) => m.id !== manual.id && manual.next.includes(m.title));
  // 바로 앞 단계와 같은 그림이면 반복하지 않는다 — 몇 단계 그림과 같은지 센다.
  const sameAs = [];
  manual.steps.forEach((s, i) => {
    const prev = manual.steps[i - 1];
    sameAs[i] = s.capture && prev?.capture && prev.capture.img === s.capture.img ? (sameAs[i - 1] ?? prev.no) : null;
  });
  const nOpen = manual.openQuestions?.length || 0;
  return (
    <article className="manual" aria-label={`${manual.title} 매뉴얼`}>
      <div className="mhead">
        <Button size="sm" variant="ghost" onClick={onBack}>← 업무표로</Button>
        <h3 ref={titleRef}>{manual.title}</h3>
        <Status it={manual} />
      </div>
      {nOpen > 0 && (
        <p className="openq">이 매뉴얼에는 아직 확정되지 않은 것이 {nOpen}가지 있습니다 — <Button size="sm" variant="secondary" onClick={() => goTo('mn-open')}>보기</Button></p>
      )}
      {manual.practicedBy?.length > 0 && <p className="muted"><small>이 일을 해 본 사람(모르면 물어볼 사람): {manual.practicedBy.join(', ')} · 쓰는 화면: {(manual.screens || []).join(', ')}</small></p>}
      <nav className="toc" aria-label="매뉴얼 목차">
        {TOC.map(([k, l]) => <Button key={k} size="sm" variant="secondary" onClick={() => goTo(`mn-${k}`)}>{l}</Button>)}
      </nav>

      {manual.quickSteps?.length > 0 && (
        <>
          <h4>가장 흔한 순서</h4>
          <ol className="quick">{manual.quickSteps.map((q, i) => <li key={i}>{typeof q === 'string' ? q : <>{q.time ? <b>{q.time} </b> : null}{q.text}</>}</li>)}</ol>
        </>
      )}

      <h4 id="mn-why">① 이 일을 왜 · 언제 하는가</h4>
      <p><b>왜</b> {manual.why}</p>
      <p><b>언제</b> {manual.when}</p>

      <h4 id="mn-prep">② 시작 전에 준비할 자료</h4>
      <ul>{manual.prepare.map((p, i) => <li key={i}>{p}</li>)}</ul>

      <h4 id="mn-steps">③ 단계별로 따라 하기{(manual.video || manual.lecture) && <> <small className="muted">(영상 · 자막 · 목차와 같은 번호)</small></>}</h4>
      {manual.video
        ? <div className="vid"><WorkflowGuide workflowId={manual.video.workflowId} defaultOpen /></div>
        : manual.lecture ? <Lecture manual={manual} />
        : <p className="empty">이 절차는 아직 영상이 없습니다. 아래 글 단계와 화면 캡처로 따라 하세요.{manual.media?.videoWaiting ? <small className="muted"> 영상 대기 이유: {manual.media.videoWaiting}</small> : null}</p>}
      <ol className="msteps">
        {manual.steps.map((s, i) => (
          <li key={s.no}>
            <span className="no" aria-hidden>{s.no}</span>
            <div>
              <b>{s.no}. {s.title}</b>{s.screen ? <small className="muted"> {s.screen}</small> : null}
              <dl>
                <dt>무엇을 보고</dt><dd><Long text={s.look} /></dd>
                <dt>무엇을 넣고</dt><dd><Long text={s.input} /></dd>
                <dt>왜</dt><dd><Long text={s.why} /></dd>
              </dl>
              {s.capture ? (
                sameAs[i] ? <small className="muted capnote">위 {sameAs[i]}단계 그림과 같은 화면입니다.</small> : (
                  <figure className="cap">
                    <Button variant="ghost" className="capbtn" aria-label={`${s.no}단계 화면 캡처 크게 보기`} onClick={() => setZoom({ src: s.capture.img, alt: `${s.no}단계 화면 예시: ${s.title}` })}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.capture.img} alt={`${s.no}단계 화면 예시: ${s.title}`} loading="lazy" />
                    </Button>
                    <figcaption>누르면 크게 보입니다 · 실제 업무 화면 예시{s.capture.observedAt ? ` (${String(s.capture.observedAt).slice(0, 10)})` : ''}{blurred ? ' — 글자는 흐리게 처리했습니다. 어느 창의 어느 자리인지 보는 용도입니다.' : ''}</figcaption>
                  </figure>
                )
              ) : s.captureKind === 'messenger'
                ? <small className="muted capnote">메신저 · 메일 화면이라 캡처를 싣지 않습니다.</small>
                : !manual.video ? <small className="muted capnote">화면 캡처 준비 중</small> : null}
            </div>
          </li>
        ))}
      </ol>

      <h4 id="mn-check">④ 끝났는지 확인하는 법</h4>
      <ul>{manual.doneCheck.map((p, i) => <li key={i}>{p}</li>)}</ul>

      <h4 id="mn-pit">⑤ 자주 틀리는 곳</h4>
      <ul>{manual.pitfalls.map((p, i) => <li key={i}><b>{p.mistake}</b> → {p.fix}</li>)}</ul>

      <h4 id="mn-next">⑥ 다음 일</h4>
      <p>{manual.next}</p>
      {nextLinks.length > 0 && (
        <div className="chips">{nextLinks.map((m) => <Button key={m.id} size="sm" variant="secondary" onClick={() => onOpen(m.id)}>「{m.title}」 매뉴얼 열기</Button>)}</div>
      )}
      {nOpen > 0 && (
        <>
          <h4 id="mn-open">아직 확인이 필요한 점 <small className="muted">(담당자에게 물어볼 것)</small></h4>
          <ul>{manual.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </>
      )}
      <div className="mfoot"><Button variant="secondary" onClick={onBack}>← 업무표로</Button></div>
      {zoom && <Zoom img={zoom} onClose={closeZoom} />}
    </article>
  );
}

// 문제가 생겼을 때 — troubles 가 있으면 증상 목록, 없으면 모든 매뉴얼의 「자주 틀리는 곳」을 매뉴얼별로 모아 보여 준다.
function Trouble({ data, onOpen }) {
  const [q, setQ] = useState('');
  const hit = (...xs) => !q.trim() || xs.some((x) => String(x || '').toLowerCase().includes(q.trim().toLowerCase()));
  const manuals = data.manuals || [];
  const troubles = (data.troubles || []).filter((t) => hit(t.symptom, ...asArr(t.first), t.tell));
  return (
    <>
      <p className="muted">일하다 막혔을 때 먼저 볼 곳입니다. 비슷한 말을 아래 칸에 쳐서 찾습니다.</p>
      <label className="search">증상에서 찾기 <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 합계가 안 맞음" aria-label="증상에서 찾기" /></label>
      {data.troubles?.length ? (
        troubles.length ? (
          <ul className="trlist">
            {troubles.map((t, i) => (
              <li key={i} className="trrow">
                <p><b>{t.symptom}</b> {t.status ? <Status it={t} /> : null}</p>
                {asArr(t.first).length > 0 && <><small className="muted">먼저 할 일</small><ol>{asArr(t.first).map((f, k) => <li key={k}>{f}</li>)}</ol></>}
                {t.tell ? <p><b>알릴 곳</b> {t.tell}</p> : null}
                <ManualBtn id={t.manualId} manuals={manuals} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        ) : <p className="empty">찾는 증상이 없습니다. 다른 말로 찾아 보세요.</p>
      ) : (
        <>
          <p className="muted"><small>증상별 안내는 아직 준비 중입니다. 대신 매뉴얼마다 「자주 틀리는 곳」(실수 → 처리)을 모았습니다.</small></p>
          {manuals.map((m) => {
            const ps = (m.pitfalls || []).filter((p) => hit(p.mistake, p.fix, m.title));
            return ps.length ? (
              <div key={m.id} className="trrow">
                <p><b>{m.title}</b></p>
                <ul>{ps.map((p, i) => <li key={i}><b>{p.mistake}</b> → {p.fix}</li>)}</ul>
                <ManualBtn id={m.id} manuals={manuals} onOpen={onOpen} />
              </div>
            ) : null;
          })}
        </>
      )}
    </>
  );
}

function ManualList({ data, onOpen }) {
  const manuals = data.manuals || [];
  const list = [...manuals].sort((a, b) => (Number.isFinite(a.order) ? a.order : 1e6) - (Number.isFinite(b.order) ? b.order : 1e6));
  const firstSentence = (t) => String(t || '').split(/(?<=[.?!])\s/)[0];
  const first = data.firstDay?.items || [];
  return (
    <>
      {first.length > 0 && (
        <div className="box">
          <h4>첫날 준비물</h4>
          <ul className="firstday">{first.map((x, i) => (
            <li key={i}><b>{x.what}</b>
              {asArr(x.known).length > 0 && <p><small className="muted">아는 것</small> {asArr(x.known).join(' · ')}</p>}
              {asArr(x.missing).length > 0 && <p><small className="muted">아직 모르는 것</small> {asArr(x.missing).join(' · ')}</p>}
            </li>
          ))}</ul>
        </div>
      )}
      {data.essentials?.length > 0 && (
        <details className="fold"><summary>꼭 아는 말 ({data.essentials.length})</summary>
          <dl className="essl">{data.essentials.map((e, i) => <div key={i}><dt>{e.term} {e.status ? <Status it={e} /> : null}</dt><dd>{e.meaning}</dd></div>)}</dl>
        </details>
      )}
      {data.folderMap?.length > 0 && (
        <details className="fold"><summary>파일·폴더 지도 ({data.folderMap.length})</summary>
          <div className="tblwrap"><table className="ihtbl"><thead><tr><th>어디</th><th>경로</th><th>쓰임</th><th /></tr></thead>
            <tbody>{data.folderMap.map((f, i) => <tr key={i}><td><b>{f.place}</b></td><td>{f.path}</td><td>{f.use}</td><td>{f.status ? <Status it={f} /> : null}</td></tr>)}</tbody></table></div>
        </details>
      )}
      {data.tools?.length > 0 && (
        <details className="fold"><summary>쓰는 도구 ({data.tools.length})</summary>
          <div className="tblwrap"><table className="ihtbl"><thead><tr><th>도구</th><th>쓰임</th><th>어디서 여나</th></tr></thead>
            <tbody>{data.tools.map((t, i) => <tr key={i}><td><b>{t.name}</b></td><td>{t.use}</td><td>{t.where}</td></tr>)}</tbody></table></div>
        </details>
      )}
      {data.countryOrderCards?.length > 0 && (
        <>
          <h4>나라별 발주 카드</h4>
          <div className="mlist">{data.countryOrderCards.map((c, i) => (
            <div key={i} className="mcard">
              <p><b>{c.country}</b> {c.status ? <Status it={c} /> : null}</p>
              {c.partner ? <p><small className="muted">상대</small> {c.partner}</p> : null}
              {c.channel ? <p><small className="muted">연락 수단</small> {c.channel}</p> : null}
              {c.orderWhen ? <p><small className="muted">발주 때</small> {c.orderWhen}</p> : null}
              {asArr(c.steps).length > 0 && <ol>{asArr(c.steps).map((s, k) => <li key={k}>{s}</li>)}</ol>}
              {asArr(c.files).length > 0 && <p><small className="muted">파일</small> {asArr(c.files).join(' · ')}</p>}
              {c.registerWhen ? <p><small className="muted">입고 등록 때</small> {c.registerWhen}</p> : null}
            </div>
          ))}</div>
        </>
      )}
      <h4>매뉴얼 {manuals.length}편</h4>
      <div className="mlist">
        {list.map((m) => (
          <div key={m.id} className="mcard">
            <p><b>{Number.isFinite(m.order) ? `${m.order}. ` : ''}{m.title}</b> <Status it={m} /></p>
            <p>{m.oneLine || firstSentence(m.why)}</p>
            <ManualBtn id={m.id} manuals={manuals} onOpen={onOpen} extra={` · ${m.steps.length}단계`} />
          </div>
        ))}
      </div>
    </>
  );
}

function Todo({ data }) {
  const groups = [];
  for (const q of data.questions || []) {
    let g = groups.find((x) => x.topic === q.topic);
    if (!g) { g = { topic: q.topic, items: [] }; groups.push(g); }
    g.items.push(q);
  }
  return (
    <>
      <h4>직원에게 물어볼 것 <small className="muted">(주제별 · 화면에 안 찍힌 판단 기준)</small></h4>
      {groups.length ? groups.map((g) => (
        <details key={g.topic} className="fold" open={g.items.some((q) => q.priority === '급함')}>
          <summary>{g.topic} ({g.items.length})</summary>
          <ol className="qs">{g.items.map((q, i) => <li key={i}><Badge tone={q.priority === '급함' ? 'err' : 'plain'}>{q.priority === '급함' ? '급함' : '나중'}</Badge> {q.question}{q.why ? <small className="muted"> ({q.why})</small> : null}</li>)}</ol>
        </details>
      )) : <p className="empty">없음</p>}
      {data.answered?.length > 0 && (
        <details className="fold"><summary>기록으로 풀린 것 ({data.answered.length}) <small className="muted">직원에게 묻지 않고 쌓인 기록에서 알아낸 것</small></summary>
          <ul className="qs">{data.answered.map((x, i) => <li key={i}><Badge tone={x.status === 'confirmed' ? 'ok' : 'est'}>{x.status === 'confirmed' ? '확정' : '추정'}</Badge> <b>{x.topic}</b> — {x.answer}{x.evidence ? <small className="muted"> ({x.evidence})</small> : null}</li>)}</ul>
        </details>
      )}
      <details className="fold"><summary>영상 · 화면 캡처 현황 <small className="muted">(영상이 없는 매뉴얼은 캡처로 먼저 · 영상은 이유가 풀리면)</small></summary>
        <table className="media">
          <thead><tr><th>매뉴얼</th><th>영상</th><th>화면 캡처</th><th>영상을 아직 못 만든 이유</th></tr></thead>
          <tbody>{(data.manuals || []).map((m) => {
            const need = m.steps.filter((s) => s.captureKind === 'screen' || s.capture).length, have = m.steps.filter((s) => s.capture).length;
            return <tr key={m.id}><td>{m.title}</td><td><Badge tone={m.video ? 'ok' : m.lecture ? 'est' : 'plain'}>{m.video ? '조작 영상' : m.lecture ? '강의 영상' : '대기'}</Badge></td><td>{m.video && !have ? '영상으로 대신' : `${have} / ${need}단계`}</td><td>{m.media?.videoWaiting || '-'}</td></tr>;
          })}</tbody>
        </table>
      </details>
      <details className="fold"><summary>근거가 부족한 절차 ({data.weakEvidence?.length || 0})</summary>
        {data.weakEvidence?.length ? <ul>{data.weakEvidence.map((x, i) => <li key={i}><b>{x.title}</b> — {x.reason}</li>)}</ul> : <p className="empty">없음</p>}
      </details>
      <details className="fold"><summary>아직 매뉴얼을 못 만든 절차 ({data.notYet?.length || 0})</summary>
        {data.notYet?.length ? <ul>{data.notYet.map((x, i) => <li key={i}><b>{x.title}</b> — {x.reason}</li>)}</ul> : <p className="empty">없음</p>}
      </details>
    </>
  );
}

const withoutManual = () => { const u = new URL(window.location.href); u.searchParams.delete('manual'); return u; };

export default function ImportHandover({ data, me, initialManual }) {
  const [theme, setTheme] = useState('B');
  const [kind, setKind] = useState('daily');
  const [openId, setOpenId] = useState(initialManual || null);
  const [wd, setWd] = useState('월'); // 고른 요일 — 매뉴얼을 열었다 닫아도 유지
  const [today, setToday] = useState(null); // 서버·브라우저 요일이 달라 화면이 어긋나지 않게 useEffect 에서 계산
  const landed = useRef(!!initialManual);
  const secRef = useRef(null);
  const wasOpen = useRef(false);
  useEffect(() => { setTheme(readStoredTheme(me)); }, [me]);
  useEffect(() => {
    const i = (new Date().getDay() + 6) % 7; // 월=0
    setToday(DAYS[i]);
    setWd(i <= 4 ? DAYS[i] : '월');
  }, []);
  useEffect(() => { if (initialManual) { landed.current = true; setOpenId(initialManual); } }, [initialManual]);
  useEffect(() => {
    const on = (e) => setOpenId(e.state?.ihManual || new URLSearchParams(window.location.search).get('manual') || null);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  useEffect(() => {
    if (openId) wasOpen.current = true;
    else if (wasOpen.current) { wasOpen.current = false; secRef.current?.scrollIntoView?.({ block: 'start' }); }
  }, [openId]);
  const open = useCallback((id) => {
    const depth = (window.history.state?.depth || 0) + 1;
    const u = new URL(window.location.href); u.searchParams.set('manual', id);
    window.history.pushState({ ihManual: id, depth }, '', u);
    setOpenId(id);
  }, []);
  const back = useCallback(() => {
    const d = window.history.state?.depth || 0;
    if (d > 0 && !landed.current) { window.history.go(-d); return; }
    window.history.replaceState({}, '', withoutManual());
    landed.current = false;
    setOpenId(null);
  }, []);
  const css = useMemo(() => allThemesCss(), []);
  if (!data) return null;
  const manual = (data.manuals || []).find((m) => m.id === openId);
  const src = data.sourceSummary || [];
  const tabLabel = KINDS.find(([k]) => k === kind)?.[1];

  return (
    <div className="pm ih" data-theme={theme}>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <section aria-label="수입부 인수인계 업무표" ref={secRef}>
        <h2>수입부 인수인계 업무표 <small className="muted">하루 · 주 · 월 — 아침에 출근해서 하는 순서대로</small></h2>
        {!manual && (
          <div className="howto">
            <h3>이 화면 쓰는 법</h3>
            <ol>
              <li>오늘 요일을 누릅니다(「하루」 탭).</li>
              <li>위에서부터 차례로 합니다. 줄 끝의 [매뉴얼 열기]를 누르면 따라 하는 방법이 나옵니다.</li>
              <li>막히면 「문제가 생겼을 때」 탭을 봅니다.</li>
            </ol>
            <details className="fold">
              <summary>이 표를 어떻게 만들었나</summary>
              <p className="muted">새로 온 사람이 이 표와 매뉴얼만 보고 일을 이어받도록 만든 업무 지원 자료입니다. 줄마다 <Badge tone="ok">확정</Badge>(전산 기록 등 두 가지 이상 근거가 서로 맞음)과 <Badge tone="est">추정</Badge>(한 가지 근거뿐)을 표시했습니다. 배지에 마우스를 올리면 근거 건수가 보입니다. 갱신 {data.updatedAt}.</p>
              {src.length > 0 && <p className="muted"><small>근거 자료: {src.map((s) => `${s.label} ${s.period}${s.count != null ? ` ${Number(s.count).toLocaleString()}건` : ''}`).join(' / ')}</small></p>}
            </details>
          </div>
        )}
        {manual ? <ManualView key={manual.id} manual={manual} manuals={data.manuals} onBack={back} onOpen={open} blurred={data.captureInfo?.clarity !== 'clear'} /> : (
          <>
            <Tabs label="업무표 보기" items={KINDS} value={kind} onChange={setKind} />
            <h3 className="sr">{tabLabel}</h3>
            {kind === 'manuals' && <ManualList data={data} onOpen={open} />}
            {kind === 'trouble' && <Trouble data={data} onOpen={open} />}
            {kind === 'edu' && <ImportEducation data={data.education} />}
            {kind === 'todo' && <Todo data={data} />}
            {kind === 'weekly' && <CountryCalendar calendar={data.countryCalendar} manuals={data.manuals} onOpen={open} today={today} />}
            {kind === 'daily' && <ImportWeekday weekday={data.weekday} schedule={data.schedule} calendar={data.countryCalendar} manuals={data.manuals} onOpen={open} wd={wd} onPick={setWd} today={today} />}
            {['weekly', 'monthly'].includes(kind) && <ScheduleTable key={kind} kind={kind} rows={data.schedule?.[kind] || []} manuals={data.manuals} onOpen={open} />}
          </>
        )}
      </section>
      <style jsx global>{`
        .ih { background: var(--pm-bg); color: var(--pm-ink); font-family: var(--pm-font); padding: 16px 16px 0; }
        .ih section { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 14px; box-shadow: var(--pm-shadow); }
        .ih h2 { font-size: 18px; margin: 0 0 6px; }
        .ih h3 { font-size: 17px; margin: 0; }
        .ih h4 { font-size: 14px; margin: 16px 0 6px; }
        .ih .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
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
        .ih .howto { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 10px 14px; margin: 6px 0 10px; }
        .ih .howto h3 { font-size: 15px; }
        .ih .howto ol { margin: 4px 0; padding-left: 22px; font-size: 14px; line-height: 1.8; }
        .ih details.fold { border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 0 10px; margin: 8px 0; }
        .ih details.fold > summary { cursor: pointer; padding: 8px 0; font-size: 13px; font-weight: 600; }
        .ih details.fold[open] { padding-bottom: 8px; }
        .ih .howto details.fold { background: var(--pm-surface); }
        .ih details.more { display: inline; }
        .ih details.more > summary { cursor: pointer; display: inline; color: var(--pm-muted); font-size: 12px; margin-left: 6px; text-decoration: underline; }
        .ih details.why > summary { cursor: pointer; color: var(--pm-muted); font-size: 12px; }
        .ih .mbtn { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .ih .mnone { white-space: nowrap; }
        .ih .box { border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 4px 12px 8px; margin: 8px 0; background: var(--pm-surface2); }
        .ih .box h4 { margin-top: 8px; }
        .ih .firstday { list-style: none; padding: 0; }
        .ih .firstday li { padding: 6px 0; border-top: 1px solid var(--pm-line); }
        .ih .essl > div { padding: 6px 0; border-top: 1px solid var(--pm-line); font-size: 13px; }
        .ih .essl dt { font-weight: 600; }
        .ih .essl dd { margin: 2px 0 0; }
        .ih .search input { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); background: var(--pm-surface); color: var(--pm-ink); margin-left: 6px; min-height: 32px; }
        .ih .trlist { list-style: none; padding: 0; }
        .ih .trrow { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 8px 12px; margin: 8px 0; list-style: none; }
        .ih .trrow ol, .ih .trrow ul { margin: 2px 0 6px; }
        .ih .tblwrap { overflow-x: auto; margin-top: 8px; }
        .ih .ihtbl { width: 100%; border-collapse: collapse; font-size: 13px; }
        .ih .ihtbl th, .ih .ihtbl td { border-bottom: 1px solid var(--pm-line); padding: 8px 6px; text-align: left; vertical-align: top; color: var(--pm-ink); background: transparent; }
        .ih .ihtbl th { background: var(--pm-surface2); white-space: nowrap; }
        .ih .ihtbl th.today, .ih .ihtbl td.today { background: var(--pm-est-bg); color: var(--pm-est-ink); }
        .ih .ihtbl td p { margin: 2px 0 0; color: var(--pm-muted); font-size: 12px; }
        .ih .cal td { min-width: 120px; }
        .ih .cal td:first-child { min-width: 170px; }
        .ih .calcell { display: block; width: 100%; height: auto; white-space: normal; text-align: left; line-height: 1.4; margin: 0 0 4px; padding: 6px 8px; font-weight: 500; }
        .ih .calrow > td { background: var(--pm-surface2); padding: 4px 8px; }
        .ih .caldetail { padding: 6px 4px; }
        .ih .caldetail ol { margin: 6px 0; padding-left: 22px; font-size: 13px; line-height: 1.7; }
        .ih .mlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; margin-top: 8px; }
        .ih .mcard { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 10px; }
        .ih .mcard ol { margin: 4px 0; padding-left: 20px; font-size: 13px; }
        .ih .wk .wklist { list-style: none; margin: 0; padding: 0; font-size: 13px; }
        .ih .wk .wkrow { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--pm-line); line-height: 1.7; }
        .ih .wk .wkrow > details { flex: 1; min-width: 0; }
        .ih .wk .wkrow > .mbtn, .ih .wk .wkrow > .mnone { flex: none; margin-top: 2px; }
        .ih .wk summary { cursor: pointer; }
        .ih .wk .wkdl { display: grid; grid-template-columns: 84px 1fr; gap: 3px 8px; margin: 6px 0 4px; padding: 8px 10px; background: var(--pm-surface2); border-radius: var(--pm-radius); }
        .ih .wk .wkdl dt { color: var(--pm-muted); }
        .ih .wk .wkdl dd { margin: 0; }
        .ih .wk .wksteps { margin: 6px 0 0; padding-left: 22px; }
        .ih .wk .wksub { margin-top: 12px; }
        .ih .wk .wknote { background: var(--pm-est-bg); color: var(--pm-est-ink); border-radius: var(--pm-radius); padding: 6px 10px; }
        .ih .wk .wkref { margin-top: 18px; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 0 10px 6px; }
        .ih .wk .wkref > summary { padding: 8px 0; font-weight: 600; }
        .ih .wk .wkitems { list-style: none; margin: 0; padding: 0; line-height: 1.9; }
        .ih .wk .wktbl td:first-child { white-space: nowrap; width: 90px; }
        .ih .mhead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
        .ih .openq { background: var(--pm-est-bg); color: var(--pm-est-ink); border-radius: var(--pm-radius); padding: 6px 10px; }
        .ih .toc { position: sticky; top: 0; z-index: 5; display: flex; gap: 6px; overflow-x: auto; padding: 8px 0; margin: 8px 0; background: var(--pm-surface); border-bottom: 1px solid var(--pm-line); }
        .ih .toc .pmk-btn { flex: none; white-space: nowrap; }
        .ih .manual h4 { scroll-margin-top: 64px; }
        .ih .quick { margin: 4px 0; padding-left: 22px; font-size: 13px; line-height: 1.8; }
        .ih .mfoot { margin: 18px 0 4px; padding-top: 10px; border-top: 1px solid var(--pm-line); }
        .ih .msteps { list-style: none; padding: 0; margin: 10px 0; }
        .ih .msteps li { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--pm-line); font-size: 13px; }
        .ih .msteps .no { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--pm-accent); color: var(--pm-surface); font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .ih .msteps dl { display: grid; grid-template-columns: 84px 1fr; gap: 3px 8px; margin: 6px 0 0; line-height: 1.6; }
        .ih .msteps dt { color: var(--pm-muted); }
        .ih .msteps dd { margin: 0; }
        .ih .vid, .ih .lec { max-width: 720px; }
        .ih .lec video { display: block; width: 100%; max-width: 720px; border: 1px solid var(--pm-line); border-radius: 6px; background: var(--pm-ink); }
        .ih .lec .chips { margin-top: 8px; }
        .ih .cap { margin: 8px 0 0; max-width: 720px; }
        .ih .capbtn { display: block; width: 100%; padding: 0; height: auto; border-color: var(--pm-line); cursor: zoom-in; }
        .ih .cap img { display: block; width: 100%; height: auto; border: 1px solid var(--pm-line); border-radius: 6px; }
        .ih .cap figcaption, .ih .capnote { display: block; margin-top: 4px; font-size: 12px; color: var(--pm-muted); }
        .ih .lbx { position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; }
        .ih .lbx::before { content: ''; position: absolute; inset: 0; background: var(--pm-ink); opacity: 0.85; }
        .ih .lbx > * { position: relative; }
        .ih .lbxbar { align-self: flex-end; margin-bottom: 8px; }
        .ih .lbx img { max-width: 96vw; max-height: 86vh; object-fit: contain; background: var(--pm-surface); border-radius: 6px; }
        .ih table.media { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0 12px; }
        .ih table.media th, .ih table.media td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--pm-line); vertical-align: top; }
        .ih table.media th { color: var(--pm-muted); font-weight: 600; }
        @media (max-width: 760px) {
          .ih { padding: 8px 6px 0; }
          .ih section { padding: 10px 8px; }
          .ih .pmk-tabs { flex-wrap: nowrap; overflow-x: auto; }
          .ih .pmk-tabs .pmk-tab { flex: 0 0 auto; white-space: nowrap; }
          .ih .pmk-btn.pmk-sm, .ih .pmk-chip { min-height: 36px; }
          .ih .ihtbl { min-width: 860px; }
          .ih .msteps dl, .ih .wk .wkdl { grid-template-columns: 1fr; }
          .ih .wk .wkrow { flex-direction: column; align-items: stretch; gap: 6px; background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px 10px; margin: 6px 0; }
        }
      `}</style>
    </div>
  );
}
