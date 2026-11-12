// components/manuals/ImportEducation.js — 수입부 신입 교육 화면(수입부 인수인계 업무표 안의 「신입 교육」 탭).
//   쌓여 있던 기록(전산 입고 기록, 카카오톡 업무방, 엑셀 파일, 해독 안 된 화면)에서 뽑은 자료를 그림·표로 보여 준다.
//   자료: data/import-education.json (scripts/build-import-education.cjs 가 만든다). 색은 /pm 토큰만 — hex 금지.
//   주어는 업무 절차다. 카카오톡에서 뽑은 것은 개인 이름 대신 역할(수입부·영업·현장·선율·백상…)로 적혀 있다.
import { useMemo, useState } from 'react';
import { Badge, Tabs, ToggleChip } from '../pm/ui';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const VIEWS = [['cycle', '차수 한 바퀴'], ['country', '나라별 카드'], ['weekly', '나라 × 요일 일정표'], ['talk', '글 양식 · 묻고 답하기'], ['dict', '용어 · 업체 사전'], ['cases', '사고 사례'], ['files', '파일 · 엑셀 양식'], ['blind', '아직 안 잡힌 일']];
const n = (v) => Number(v || 0).toLocaleString();

function Heat({ heat }) {
  const max = Math.max(1, ...Object.values(heat || {}));
  return (
    <div className="tblwrap">
      <table className="heat" aria-label="요일과 시간대별 입고 등록 건수">
        <thead><tr><th />{HOURS.map((h) => <th key={h}>{h}시</th>)}</tr></thead>
        <tbody>
          {DAYS.map((d) => (
            <tr key={d}>
              <th>{d}</th>
              {HOURS.map((h) => { const v = heat?.[`${d}-${h}`] || 0; return <td key={h} title={`${d}요일 ${h}시 ${v}건`}><i style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 0 }} />{v > 0 && <span>{v}</span>}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cycle({ cycles }) {
  const [i, setI] = useState(0);
  if (!cycles?.length) return <p className="empty">카카오톡 기록에서 차수 한 바퀴를 아직 뽑지 못했습니다.</p>;
  const c = cycles[Math.min(i, cycles.length - 1)];
  const roles = [...new Set((c.events || []).map((e) => e.role).filter(Boolean))];
  return (
    <>
      <p className="muted">실제 차수 하나가 발주부터 결제까지 어떤 순서로 흘러갔는지, 업무방에 올라온 글의 시각 순서대로 줄 세운 것입니다. 오른쪽 칸이 그때 수입부가 할 일입니다.</p>
      <div className="chips">{cycles.map((x, k) => <ToggleChip key={k} on={k === i} onClick={() => setI(k)}>{x.label}</ToggleChip>)}</div>
      {roles.length > 0 && <p className="muted"><small>나오는 역할: {roles.join(' · ')}</small></p>}
      <ol className="flow">
        {(c.events || []).map((e, k) => (
          <li key={k}>
            <span className="when"><b>{e.dayOffset != null ? `${e.dayOffset >= 0 ? '+' : ''}${e.dayOffset}일` : ''}</b> {e.weekday} {e.time}</span>
            <span className="who"><Badge tone="plain">{e.role || '-'}</Badge> <small className="muted">{e.room}</small></span>
            <span className="what">{e.what}</span>
            <span className="act">{e.importAction ? <><b>수입부</b> {e.importAction}</> : null}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Country({ countries, talk }) {
  const [name, setName] = useState(countries?.[0]?.country);
  const c = (countries || []).find((x) => x.country === name) || countries?.[0];
  if (!c) return <p className="empty">자료 없음</p>;
  return (
    <>
      <div className="chips">{countries.map((x) => <ToggleChip key={x.country} on={x.country === c.country} onClick={() => setName(x.country)}>{x.country} {n(x.receipts)}</ToggleChip>)}</div>
      <div className="cards3">
        <div className="card"><b>언제 입고를 등록하나</b>
          {c.subs.map((s) => <p key={s.sub}>세부 차수 -{s.sub}: <b>{s.rule}</b> <small className="muted">전체 {n(s.total)}건</small></p>)}
        </div>
        <div className="card"><b>한 건의 크기</b>
          <p>입고 1건에 품목 {c.linesMedian ?? '-'}줄{c.boxMedian ? `, ${c.boxMedian}박스` : ''}(가운데 값)</p>
          <p>최근 12개월 입고 {n(c.receipts)}건, 농장 {n(c.farmCount)}곳</p>
          {c.freight?.length > 0 && <p><small className="muted">운임·무게는 품목 줄로 넣음: {c.freight.join(', ')}</small></p>}
        </div>
      </div>
      {(talk || []).filter((t) => t.country.includes(c.country)).map((t) => (
        <div key={t.country} className="card"><b>{t.country}</b> <small className="muted">{t.items}</small>
          <p><b>화물이 실제로 오는 때</b> {t.arrive}</p><p><b>발주 글이 올라오는 때</b> {t.order}</p></div>
      ))}
      <h5>요일 × 시간 — 입고 등록 건수(최근 12개월)</h5>
      <Heat heat={c.heat} />
      <h5>자주 들어오는 농장</h5>
      <div className="tblwrap"><table className="etbl"><thead><tr><th>농장 · 공급처</th><th>12개월 입고</th><th>주로 들어오는 꽃</th><th>등록 요일</th><th>최근 입고</th></tr></thead>
        <tbody>{c.farms.map((f) => <tr key={f.farm}><td><b>{f.farm}</b></td><td>{n(f.count)}</td><td>{(f.flowers || []).join(', ')}</td><td>{f.weekday}</td><td>{f.last}</td></tr>)}</tbody></table></div>
      <h5>품목 등록 규칙(꽃 종류별 가장 흔한 값)</h5>
      <div className="tblwrap"><table className="etbl"><thead><tr><th>꽃</th><th>품목 수</th><th>출고단위/견적단위/1박스 단수/1단 송이/1박스 송이</th><th>품목명 모양</th></tr></thead>
        <tbody>{c.products.map((p) => <tr key={p.flower}><td><b>{p.flower}</b></td><td>{n(p.count)}</td><td>{p.unitCombo}</td><td>{(p.examples || []).join(' · ')}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Weekly({ sheet }) {
  if (!sheet?.rows?.length) return <p className="empty">자료 없음</p>;
  return (
    <>
      <p className="muted">담당자가 엑셀에 직접 적어 둔 나라별 요일 일정표입니다({String(sheet.period?.[0] || '').slice(0, 10)}~{String(sheet.period?.[1] || '').slice(0, 10)}에 고친 내용 기준). 콜롬비아 · 에콰도르 줄은 이 표에 없어 위쪽 「주」 탭의 국가별 주간 업무표를 봅니다.</p>
      <div className="tblwrap"><table className="etbl"><thead><tr><th>나라 · 상대</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>{sheet.rows.map((r) => <tr key={r.country}><td><b>{r.country}</b></td>{DAYS.map((d) => <td key={d}>{r.cells[d] || ''}</td>)}</tr>)}</tbody></table></div>
    </>
  );
}

function Talk({ notices, qa }) {
  return (
    <>
      <h5>되풀이되는 글의 모양 <small className="muted">빈칸(○○)만 바꿔 쓰면 됩니다</small></h5>
      {notices?.length ? <div className="cards3">{notices.map((t, i) => <div key={i} className="card"><b>{t.type}</b> <small className="muted">{t.count != null ? `${n(t.count)}건` : ''}{t.when ? ` · ${t.when}` : ''}</small><pre>{t.template}</pre></div>)}</div> : <p className="empty">아직 뽑지 못했습니다.</p>}
      <h5>자주 묻고 답하는 것</h5>
      {qa?.length ? (
        <div className="tblwrap"><table className="etbl"><thead><tr><th>묻는 쪽</th><th>질문</th><th>답</th><th>어디를 보면 되나</th><th>건수</th></tr></thead>
          <tbody>{qa.map((q, i) => <tr key={i}><td>{q.asker}</td><td><b>{q.question}</b></td><td>{q.answer}</td><td>{q.where}</td><td>{q.count != null ? n(q.count) : ''}</td></tr>)}</tbody></table></div>
      ) : <p className="empty">아직 뽑지 못했습니다.</p>}
    </>
  );
}

function Dict({ glossary, partners }) {
  const [q, setQ] = useState('');
  const hit = (s) => !q || String(s || '').toLowerCase().includes(q.toLowerCase());
  const g = (glossary || []).filter((x) => hit(x.term) || hit(x.meaning));
  const p = (partners || []).filter((x) => hit(x.name) || hit(x.role));
  return (
    <>
      <label className="search">찾기 <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="낱말 · 업체 이름" aria-label="용어와 업체 찾기" /></label>
      <h5>업체 · 농장 — 누가 무슨 일을 하는 곳인가</h5>
      {p.length ? <div className="tblwrap"><table className="etbl"><thead><tr><th>이름</th><th>하는 일</th><th>주로 나오는 방</th><th>건수</th></tr></thead>
        <tbody>{p.map((x, i) => <tr key={i}><td><b>{x.name}</b></td><td>{x.role}</td><td>{Array.isArray(x.rooms) ? x.rooms.join(', ') : x.rooms}</td><td>{x.count != null ? n(x.count) : ''}</td></tr>)}</tbody></table></div> : <p className="empty">없음</p>}
      <h5>업무방에서 쓰는 말</h5>
      {g.length ? <div className="tblwrap"><table className="etbl"><thead><tr><th>말</th><th>뜻</th><th>근거</th></tr></thead>
        <tbody>{g.map((x, i) => <tr key={i}><td><b>{x.term}</b></td><td>{x.meaning}</td><td><small className="muted">{x.basis}{x.count != null ? ` · ${n(x.count)}건` : ''}</small></td></tr>)}</tbody></table></div> : <p className="empty">없음</p>}
    </>
  );
}

function Cases({ incidents }) {
  if (!incidents?.length) return <p className="empty">아직 뽑지 못했습니다.</p>;
  return (
    <div className="cards3">
      {incidents.map((x, i) => (
        <div key={i} className="card">
          <b>{x.type}</b> <small className="muted">{x.count != null ? `${n(x.count)}건` : ''}</small>
          {(x.handling || []).length > 0 && <><p className="muted"><small>처리 순서</small></p><ol>{x.handling.map((h, k) => <li key={k}>{h}</li>)}</ol></>}
          {(x.cases || []).length > 0 && <details><summary>실제 사례 {x.cases.length}건</summary><ul>{x.cases.map((c, k) => <li key={k}>{typeof c === 'string' ? c : [c.when, c.what, c.handled, c.took].filter(Boolean).join(' — ')}</li>)}</ul></details>}
        </div>
      ))}
    </div>
  );
}

function Files({ fileKinds, templates, expenseLabels }) {
  return (
    <>
      <h5>파일 이름을 보면 무슨 파일인지 알 수 있다 <small className="muted">(숫자는 #)</small></h5>
      <div className="tblwrap"><table className="etbl"><thead><tr><th>종류</th><th>건수</th><th>이름 모양과 예</th></tr></thead>
        <tbody>{(fileKinds || []).map((k) => <tr key={k.kind}><td><b>{k.kind}</b></td><td>{n(k.count)}</td><td>{k.patterns.map((p, i) => <div key={i}>{p.pattern} <small className="muted">{n(p.count)}건{p.example && p.example !== p.pattern ? ` · 예: ${p.example}` : ''}</small></div>)}</td></tr>)}</tbody></table></div>
      <h5>자주 여는 엑셀 양식의 칸</h5>
      <div className="cards3">{(templates || []).map((t) => <div key={t.file} className="card"><b>{t.file}</b> <small className="muted">시트 {t.sheetCount}개{t.sheets?.length ? ` (${t.sheets.join(', ')}…)` : ''}</small><p>{t.headers.join(' · ')}</p></div>)}</div>
      <h5>지출결의서 적요 문구</h5>
      <p>{(expenseLabels || []).map((l) => `${l.label}(${l.count})`).join(' · ')}</p>
    </>
  );
}

function Blind({ blind, missing, unverified }) {
  if (!blind) return <p className="empty">자료 없음</p>;
  return (
    <>
      {missing?.length > 0 && <><h5>카카오톡에는 되풀이되는데 매뉴얼에는 아직 없는 일</h5><ul>{missing.map((m, i) => <li key={i}><b>{m.title}</b> — {m.evidence}</li>)}</ul></>}
      {unverified?.length > 0 && <details><summary>기록으로 확인하지 못한 것 {unverified.length}가지</summary><ul>{unverified.map((u, i) => <li key={i}>{u}</li>)}</ul></details>}
      <h5>해독이 안 된 화면</h5>
      <p className="muted">화면 기록 가운데 내용 해독이 안 붙은 것이 {n(blind.undecoded)}건, 붙은 것이 {n(blind.decoded)}건입니다. 아래는 해독이 안 된 쪽에 많이 나오는 창입니다. 이 창에서 하는 일은 매뉴얼에 덜 반영돼 있을 수 있어, 담당자에게 무엇을 하는 창인지 확인이 필요합니다.</p>
      <div className="tblwrap"><table className="etbl"><thead><tr><th>창(프로그램 | 제목)</th><th>해독 안 됨</th><th>해독됨</th></tr></thead>
        <tbody>{blind.titles.map((t, i) => <tr key={i}><td>{t.title}</td><td>{n(t.undecoded)}</td><td>{t.decoded != null ? n(t.decoded) : ''}</td></tr>)}</tbody></table></div>
    </>
  );
}

export default function ImportEducation({ data }) {
  const [view, setView] = useState('cycle');
  const b = data?.basis || {};
  const src = useMemo(() => [b.receipts12m ? `전산 입고 기록 ${n(b.receipts12m)}건(최근 12개월)` : null, b.kakao?.messages ? `카카오톡 업무방 ${n(b.kakao.messages)}건` : (data?.cycles?.length ? '카카오톡 업무방 기록' : null), '엑셀 · 파일 기록', '화면 기록'].filter(Boolean).join(' · '), [b, data]);
  if (!data) return <p className="empty">교육 자료가 아직 없습니다.</p>;
  return (
    <div className="edu">
      <p className="muted">새로 온 사람이 수입부 일의 큰 그림을 먼저 익히도록, 쌓여 있던 기록에서 뽑아 정리한 업무 지원 자료입니다. 근거: {src}. 갱신 {data.updatedAt}.</p>
      <Tabs label="신입 교육 보기" items={VIEWS} value={view} onChange={setView} />
      {view === 'cycle' && <Cycle cycles={data.cycles} />}
      {view === 'country' && <Country countries={data.countries} talk={data.kakaoCountries} />}
      {view === 'weekly' && <Weekly sheet={data.weeklySheet} />}
      {view === 'talk' && <Talk notices={data.notices} qa={data.qa} />}
      {view === 'dict' && <Dict glossary={data.glossary} partners={data.partners} />}
      {view === 'cases' && <Cases incidents={data.incidents} />}
      {view === 'files' && <Files fileKinds={data.fileKinds} templates={data.templates} expenseLabels={data.expenseLabels} />}
      {view === 'blind' && <Blind blind={data.blind} missing={data.missing} unverified={data.unverified} />}
      <style jsx global>{`
        .ih .edu h5 { font-size: 13px; margin: 14px 0 6px; }
        .ih .edu .cards3 { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; margin: 8px 0; }
        .ih .edu .card { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 10px; font-size: 13px; }
        .ih .edu .card pre { white-space: pre-wrap; font: inherit; font-size: 12px; margin: 6px 0 0; padding: 8px; background: var(--pm-surface); border: 1px dashed var(--pm-line); border-radius: var(--pm-radius); }
        .ih .edu ul { margin: 4px 0; padding-left: 20px; font-size: 13px; line-height: 1.7; }
        .ih .edu .card { margin-bottom: 8px; }
        .ih .edu .card ol, .ih .edu .card ul { margin: 4px 0; padding-left: 20px; line-height: 1.6; }
        .ih .edu .etbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .ih .edu .etbl th, .ih .edu .etbl td { border-bottom: 1px solid var(--pm-line); padding: 6px; text-align: left; vertical-align: top; color: var(--pm-ink); background: transparent; }
        .ih .edu .etbl th { background: var(--pm-surface2); white-space: nowrap; }
        .ih .edu .heat { border-collapse: collapse; font-size: 11px; }
        .ih .edu .heat th { padding: 2px 6px; color: var(--pm-muted); font-weight: 500; background: transparent; }
        .ih .edu .heat td { position: relative; width: 44px; height: 26px; border: 1px solid var(--pm-line); text-align: center; padding: 0; background: transparent; }
        .ih .edu .heat td i { position: absolute; inset: 0; background: var(--pm-accent); }
        .ih .edu .heat td span { position: relative; color: var(--pm-ink); font-weight: 600; }
        .ih .edu .flow { list-style: none; padding: 0; margin: 8px 0; }
        .ih .edu .flow li { display: grid; grid-template-columns: 130px 170px 1fr 1fr; gap: 8px; padding: 7px 0; border-top: 1px solid var(--pm-line); font-size: 13px; line-height: 1.5; }
        .ih .edu .flow .act { background: var(--pm-surface2); border-radius: var(--pm-radius); padding: 2px 8px; }
        .ih .edu .search input { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); background: var(--pm-surface); color: var(--pm-ink); margin-left: 6px; }
        @media (max-width: 900px) { .ih .edu .flow li { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
