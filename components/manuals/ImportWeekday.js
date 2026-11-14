// 수입부 요일별 업무표(월~일) — "하루" 탭 맨 위.
//   요일을 고르면 ① 그 요일의 시간대별로 실제 보인 일(화면 기록 집계: 몇 주 중 몇 주, 걸린 시간, 나라)
//   ② 그 요일에 정해진 일(전산 기록 등으로 확인된 하루·주 업무표) ③ 그 요일의 나라별 일을 한 화면에 보여 준다.
//   주어는 업무 절차다. 누가 했는지는 싣지 않는다.
import { useMemo, useState } from 'react';
import { Badge, Button, ToggleChip } from '../pm/ui';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const todayIdx = () => (new Date().getDay() + 6) % 7; // 월=0
const FREQ_TONE = { '거의 매주': 'ok', 자주: 'est', 가끔: 'plain' };
const dayTypeOf = (wd) => (wd === '월' ? '월요일' : ['화', '수', '목', '금'].includes(wd) ? '화~금' : null);

export default function ImportWeekday({ weekday, schedule, calendar, manuals, onOpen }) {
  const [wd, setWd] = useState(() => DAYS[Math.min(todayIdx(), 4)]);
  const day = useMemo(() => (weekday?.weekdays || []).find((w) => w.weekday === wd), [weekday, wd]);
  const fixed = useMemo(() => {
    const daily = (schedule?.daily || []).filter((r) => r.dayType === dayTypeOf(wd));
    const weekly = (schedule?.weekly || []).filter((r) => String(r.when || '').split(/[·,\s]+/).includes(wd));
    return { daily, weekly };
  }, [schedule, wd]);
  const countryCells = useMemo(() => (calendar || []).flatMap((c) => c.cells.filter((x) => x.weekday === wd || x.weekday === '매일').map((x) => ({ ...x, country: c.country }))), [calendar, wd]);
  const title = (id) => (manuals || []).find((m) => m.id === id)?.title;
  if (!weekday?.weekdays?.length) return null;
  return (
    <div className="wk">
      <h4>요일별 업무표 <small className="muted">요일마다 하는 일이 다릅니다 — 요일을 고르세요</small></h4>
      <div className="chips" role="group" aria-label="요일">
        {DAYS.map((d) => <ToggleChip key={d} on={wd === d} onClick={() => setWd(d)}>{d}요일</ToggleChip>)}
      </div>

      <h5>① {wd}요일 시간대별로 실제 한 일 <small className="muted">화면 기록 집계(추정){day ? ` · ${wd}요일 ${day.observedDays}일치` : ''}</small></h5>
      {day?.blocks?.length ? (
        <div className="tblwrap">
          <table className="ihtbl wktbl">
            <thead><tr><th>시간대</th><th>하는 일(자주 보인 순)</th></tr></thead>
            <tbody>
              {day.blocks.map((b) => (
                <tr key={b.time}>
                  <td><b>{b.time}</b></td>
                  <td>
                    <ul className="wkitems">
                      {b.items.map((it, i) => (
                        <li key={i}>
                          <Badge tone={FREQ_TONE[it.freq] || 'plain'}>{it.freq}</Badge> <b>{it.title}</b>
                          {it.countries.length > 0 && <span> · {it.countries.join(' · ')}</span>}
                          <small className="muted"> {it.totalDays}일 중 {it.seenDays}일 · 보통 {it.minutes < 1 ? '1분 미만' : `${it.minutes}분`}</small>
                          {it.manualId && title(it.manualId) ? <Button size="sm" variant="ghost" onClick={() => onOpen(it.manualId)}>매뉴얼</Button> : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">{['토', '일'].includes(wd) ? '주말은 PC 화면 기록이 없습니다. 아래 「정해진 일」과 나라별 일을 보세요.' : '이 요일의 기록이 아직 모이지 않았습니다.'}</p>}

      <h5>② {wd}요일에 정해진 일 <small className="muted">전산 기록 · 일정표 등으로 확인한 것</small></h5>
      {fixed.weekly.length + fixed.daily.length > 0 ? (
        <ul className="wkfixed">
          {fixed.weekly.map((r) => <li key={r.id}><Badge tone={r.status === 'confirmed' ? 'ok' : 'est'}>{r.status === 'confirmed' ? '확정' : '추정'}</Badge> <b>{r.title}</b>{r.trigger ? <small className="muted"> 시작 신호: {r.trigger}</small> : null}{r.manualId && title(r.manualId) ? <Button size="sm" variant="ghost" onClick={() => onOpen(r.manualId)}>매뉴얼</Button> : null}</li>)}
          {fixed.daily.map((r) => <li key={r.id}><Badge tone={r.status === 'confirmed' ? 'ok' : 'est'}>{r.status === 'confirmed' ? '확정' : '추정'}</Badge> <b>{r.when}</b> {r.title}{r.manualId && title(r.manualId) ? <Button size="sm" variant="ghost" onClick={() => onOpen(r.manualId)}>매뉴얼</Button> : null}</li>)}
        </ul>
      ) : <p className="empty">이 요일에 따로 정해진 일은 아직 확인되지 않았습니다.</p>}

      <h5>③ {wd}요일 나라별 일</h5>
      {countryCells.length ? (
        <ul className="wkfixed">
          {countryCells.map((x, i) => <li key={i}><Badge tone={x.status === 'confirmed' ? 'ok' : 'est'}>{x.status === 'confirmed' ? '확정' : '추정'}</Badge> <b>{x.country}</b> — {x.title}{x.time ? <small className="muted"> {x.time}</small> : null}{x.manualId && title(x.manualId) ? <Button size="sm" variant="ghost" onClick={() => onOpen(x.manualId)}>매뉴얼</Button> : null}</li>)}
        </ul>
      ) : <p className="empty">이 요일에 확인된 나라별 일이 없습니다.</p>}
      {weekday.basis?.note ? <p className="muted"><small>{weekday.basis.note} ({weekday.basis.from}~{weekday.basis.to}, 업무 단위 {Number(weekday.basis.cuts).toLocaleString()}개)</small></p> : null}
      <style jsx>{`
        .wk h5 { font-size: 13px; margin: 14px 0 6px; }
        .wk :global(.wkitems), .wk :global(.wkfixed) { list-style: none; margin: 0; padding: 0; font-size: 13px; line-height: 1.9; }
        .wk :global(.wkfixed) li { padding: 3px 0; border-top: 1px solid var(--pm-line); }
        .wk :global(.wktbl) td:first-child { white-space: nowrap; width: 90px; }
      `}</style>
    </div>
  );
}
