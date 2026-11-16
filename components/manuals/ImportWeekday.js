// 수입부 「하루」 탭 전체 — 요일을 고르면 그 요일의 할 일을 시간 순서대로 보여 준다.
//   ① 본체: 「{요일} 할 일 — 시간 순서」(전산 기록 등으로 정해진 하루·주 업무표). 줄을 누르면 시작 신호·쓰는 화면·넘기는 곳·설명이 펼쳐진다.
//   ② 나라별 일(주 탭 달력의 그 요일 칸)
//   ③ 참고: 지난 몇 주 동안 이 요일에 실제로 한 일(화면 기록 집계) — 접어 둔다.
//   주어는 업무 절차다. 누가 했는지는 싣지 않는다. 고른 요일(wd)은 ImportHandover 가 들고 있어 매뉴얼을 열었다 닫아도 유지된다.
import { Badge, Button, ToggleChip } from '../pm/ui';

export const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const dayTypeOf = (wd) => (wd === '월' ? '월요일' : ['화', '수', '목', '금'].includes(wd) ? '화~금' : null);
const STATUS = { confirmed: ['확정', 'ok'], estimated: ['추정', 'est'] };

export function evidenceText(evidence) {
  if (typeof evidence === 'string') return evidence; // 나라별 카드처럼 근거가 한 줄 글인 자료
  if (!Array.isArray(evidence)) return '';
  return (evidence || []).map((e) => `${e.source}${e.count != null ? ` ${Number(e.count).toLocaleString()}건` : ''}${e.note ? ` (${e.note})` : ''}`).join(' · ') || '근거 없음';
}

// 확정/추정 배지 — 건수 글은 마우스를 올리면(title) 보인다.
export function Status({ it }) {
  const [label, tone] = STATUS[it.status] || STATUS.estimated;
  return <Badge tone={tone} title={evidenceText(it.evidence)}>{label}</Badge>;
}

export const mediaOf = (m) => (m.video ? '조작 영상' : m.lecture ? '강의 영상' : '글·그림');

// 모든 곳에서 같은 모양: 테두리 있는 「매뉴얼 열기」 + 옆에 작은 글자(영상 종류). 매뉴얼이 없으면 「매뉴얼 준비 중」.
export function ManualBtn({ id, manuals, onOpen, extra }) {
  const m = id ? (manuals || []).find((x) => x.id === id) : null;
  if (!m) return <small className="muted mnone">매뉴얼 준비 중</small>;
  return (
    <span className="mbtn">
      <Button size="sm" variant="secondary" className="mopen" aria-label={`${m.title} 매뉴얼 열기`} onClick={() => onOpen(m.id)}>매뉴얼 열기</Button>
      <small className="muted">{mediaOf(m)}{extra || ''}</small>
    </span>
  );
}

function DetailPanel({ r }) {
  const screens = (r.screens || []).join(', ');
  return (
    <dl className="wkdl">
      {r.trigger ? <><dt>시작 신호</dt><dd>{r.trigger}</dd></> : null}
      {screens ? <><dt>쓰는 화면</dt><dd>{screens}</dd></> : null}
      {r.handoff ? <><dt>넘기는 곳</dt><dd>{r.handoff}</dd></> : null}
      {r.detail ? <><dt>설명</dt><dd>{r.detail}</dd></> : null}
    </dl>
  );
}

export default function ImportWeekday({ weekday, schedule, calendar, manuals, onOpen, wd, onPick, today }) {
  const day = (weekday?.weekdays || []).find((w) => w.weekday === wd);
  const daily = (schedule?.daily || []).filter((r) => r.dayType === dayTypeOf(wd)).sort((a, b) => String(a.when).localeCompare(String(b.when)));
  const weekly = (schedule?.weekly || []).filter((r) => String(r.when || '').split(/[·,\s]+/).includes(wd));
  const countryCells = (calendar || []).flatMap((c) => c.cells.filter((x) => x.weekday === wd || x.weekday === '매일').map((x) => ({ ...x, country: c.country })));
  const weekend = today === '토' || today === '일';
  if (!weekday?.weekdays?.length) return null;
  const rowOf = (r, head) => (
    <li key={r.id} className="wkrow">
      <details>
        <summary><b>{head}</b> <b>{r.title}</b> <Status it={r} /></summary>
        <DetailPanel r={r} />
      </details>
      <ManualBtn id={r.manualId} manuals={manuals} onOpen={onOpen} />
    </li>
  );
  const blocks = (day?.blocks || []).map((b) => ({ ...b, items: b.items.filter((it) => it.minutes >= 5) })).filter((b) => b.items.length);
  return (
    <div className="wk">
      <div className="chips" role="group" aria-label="요일">
        {DAYS.map((d) => <ToggleChip key={d} on={wd === d} onClick={() => onPick(d)}>{d}요일{d === today ? ' · 오늘' : ''}</ToggleChip>)}
      </div>
      {weekend && wd === '월' && <p className="muted wknote">오늘은 {today}요일입니다 — 다음 출근일(월요일) 일을 보여 줍니다. 다른 요일은 위 단추로 바꿉니다.</p>}

      <h4>{wd}요일 할 일 — 시간 순서 <small className="muted">줄을 누르면 시작 신호와 쓰는 화면이 펼쳐집니다</small></h4>
      {daily.length + weekly.length > 0 ? (
        <>
          {daily.length > 0 && <ul className="wklist">{daily.map((r) => rowOf(r, r.when))}</ul>}
          {weekly.length > 0 && (
            <>
              <p className="muted wksub">{wd}요일에 하는 주간 일 <small>(시각은 정해져 있지 않습니다)</small></p>
              <ul className="wklist">{weekly.map((r) => rowOf(r, `${wd}요일`))}</ul>
            </>
          )}
        </>
      ) : <p className="empty">이 요일에 따로 정해진 일은 아직 확인되지 않았습니다. 아래 나라별 일을 보세요.</p>}

      <h4>{wd}요일 나라별 일</h4>
      {countryCells.length ? (
        <ul className="wklist">
          {countryCells.map((x, i) => (
            <li key={i} className="wkrow">
              <details>
                <summary><b>{x.country}</b> — {x.title} <Status it={x} />{x.time ? <small className="muted"> {x.time}</small> : null}</summary>
                {x.steps?.length > 0 && <ol className="wksteps">{x.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
                <DetailPanel r={{ screens: x.screens, handoff: x.handoff }} />
              </details>
              <ManualBtn id={x.manualId} manuals={manuals} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : <p className="empty">이 요일에 확인된 나라별 일이 없습니다.</p>}

      <details className="wkref">
        <summary>참고: 지난 몇 주 동안 이 요일에 실제로 한 일(화면 기록 집계)</summary>
        {blocks.length ? (
          <>
            <p className="muted"><small>화면 기록을 세어 만든 추정입니다{day ? ` · ${wd}요일 ${day.observedDays}일치` : ''}. 5분 미만 일은 뺐습니다.</small></p>
            <div className="tblwrap">
              <table className="ihtbl wktbl">
                <thead><tr><th>시간대</th><th>하는 일(자주 보인 순)</th></tr></thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.time}>
                      <td><b>{b.time}</b></td>
                      <td>
                        <ul className="wkitems">
                          {b.items.map((it, i) => (
                            <li key={i}>
                              <b>{it.title}</b>
                              {it.countries.length > 0 && <span> · {it.countries.join(' · ')}</span>}
                              <small className="muted"> {it.freq} · {wd}요일 {it.totalDays}번 중 {it.seenDays}번 · 한 번에 {it.minutes}분쯤</small>{' '}
                              <ManualBtn id={it.manualId} manuals={manuals} onOpen={onOpen} />
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {weekday.basis?.note ? <p className="muted"><small>{weekday.basis.note} ({weekday.basis.from}~{weekday.basis.to}, 업무 단위 {Number(weekday.basis.cuts).toLocaleString()}개)</small></p> : null}
          </>
        ) : <p className="empty">{['토', '일'].includes(wd) ? '주말은 PC 화면 기록이 없습니다.' : '이 요일의 기록이 아직 모이지 않았습니다.'}</p>}
      </details>
    </div>
  );
}
