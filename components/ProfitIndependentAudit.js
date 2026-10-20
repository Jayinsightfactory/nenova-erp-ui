import { useEffect, useRef, useState } from 'react';
import { auditReportAgainstStock } from '../lib/profitIndependentAudit.mjs';
import { assertValidationResponse } from '../lib/profitValidationWindow.mjs';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from '../lib/profitReportCalc';
import { auditProfitFormulas } from '../lib/profitFormulaAudit.mjs';
import { auditReportSqlLineage } from '../lib/profitSqlLineageAudit.mjs';
import ProfitFormulaAudit from './ProfitFormulaAudit';
import s from './ProfitValidationWindow.module.css';

const labels = { MATCH: '식 일치', MISMATCH: '차이 발견', CARRIED: '앞 차수 차이 이월', INPUT_REQUIRED: '자료 확인 필요',
  UNVERIFIED: '단가·정책 추가 확인', HISTORICAL: '기준시점 다름', NOT_COMPARED: '비교값 없음' };
const number = v => v == null || !Number.isFinite(Number(v)) ? '미확인' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const compare = (report, week) => {
  const rows = report.rows.map(row => ({ ...row, calc: report.confirmed ? row.calc : computeProfitRow(row) }));
  const totals = report.confirmed ? report.confirmedTotals : computeProfitTotals(rows);
  if (!report.confirmed) for (const row of rows) Object.assign(row.calc, { D: calcRevenueRatio(row.calc, totals), U: calcPurchaseRatio(row.calc, totals) });
  return { ...auditReportAgainstStock(report, week, rows), formulaAudit: auditProfitFormulas(report, rows, totals), sqlAudit: auditReportSqlLineage(report, week?.sqlLineage), reportInput: report };
};

export default function ProfitIndependentAudit({ year, major, report }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [selected, setSelected] = useState(major), [reports, setReports] = useState({});
  const [category, setCategory] = useState(''), [visibleCount, setVisibleCount] = useState(30);
  const request = useRef(null);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setData(null); setError(''); setBusy(true); setSelected(major); setReports({});
    setProgress('1차부터 선택 차수까지 입고·확정출고·재고조정을 독립 대사하고 있습니다.');
    (async () => {
      try {
        const response = await fetch(`/api/sales/profit-independent-audit?${new URLSearchParams({ year, week: major })}`,
          { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`독립 검산 조회 실패 (HTTP ${response.status})`);
        const result = await response.json();
        if (!result.success || result.orderYear !== year || result.major !== major || !Array.isArray(result.weeks)) throw new Error('검산 응답의 연도·차수 또는 형식이 다릅니다.');
        if (controller.signal.aborted || request.current !== controller) return;
        setData(result);
        if (report) setReports({ [major]: compare(report, result.weeks.find(w => w.major === major)) });
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { if (request.current === controller) { setBusy(false); setProgress(''); } }
    })();
    return () => { request.current?.abort(); request.current = null; };
  }, [year, major, report]);

  async function loadReports(weeks) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      for (let i = 0; i < weeks.length; i++) {
        const week = weeks[i];
        controller.signal.throwIfAborted();
        setProgress(`${Number(week)}차 금액·수익률 검산 중 (${i + 1}/${weeks.length}). 원장은 변경하지 않습니다.`);
        try {
          const response = await fetch(`/api/sales/profit-report?${new URLSearchParams({ year, week, auditLive: '1' })}`,
            { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const reportData = assertValidationResponse(await response.json(), { year, major: week });
          controller.signal.throwIfAborted();
          const checked = compare(reportData, data.weeks.find(w => w.major === week));
          if (request.current === controller) setReports(old => ({ ...old, [week]: checked }));
        } catch (e) {
          controller.signal.throwIfAborted();
          if (request.current === controller) setReports(old => ({ ...old, [week]: { error: `${Number(week)}차 조회 실패: ${e.message}` } }));
        }
      }
    } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (request.current === controller) { setBusy(false); setProgress(''); } }
  }
  async function selectWeek(majorToShow) {
    if (busy) return;
    setSelected(majorToShow);
    setCategory(''); setVisibleCount(30);
    if (data?.detail === majorToShow) { if (!reports[majorToShow]) loadReports([majorToShow]); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setProgress(`${Number(majorToShow)}차 품목별 원인 상세 조회 중…`);
    try {
      const response = await fetch(`/api/sales/profit-independent-audit?${new URLSearchParams({ year, week: major, detail: majorToShow })}`,
        { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`상세 조회 실패 (HTTP ${response.status})`);
      const result = await response.json();
      if (!result.success || result.orderYear !== year || result.major !== major || result.detail !== majorToShow) throw new Error('상세 조회 범위가 다릅니다.');
      if (!controller.signal.aborted && request.current === controller) {
        setData(result);
        // Preserve completed range results only when the complete quantity/evidence fingerprint is unchanged.
        if (result.integrity.sourceHash !== data.integrity.sourceHash) setReports({});
        else setReports(old => old[majorToShow]?.reportInput
          ? { ...old, [majorToShow]: compare(old[majorToShow].reportInput, result.weeks.find(w=>w.major===majorToShow)) } : old);
      }
    } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (request.current === controller) { setBusy(false); setProgress(''); } }
  }
  const week = data?.weeks.find(w => w.major === selected), finance = reports[selected];
  const filteredEntries = (week?.entries || []).filter(item => !category || item.category === category);
  const stable = data?.integrity.status === 'STABLE_OBSERVED';
  const stop = () => { request.current?.abort(); request.current = null; setBusy(false); setProgress('취소됨 · 끝나지 않은 차수는 미검증입니다.'); };
  return <section className={s.section} aria-label="독립 검산 엔진">
    <h2>독립 검산 · 기초재고 문제인가, 기말재고 문제인가?</h2>
    <p>① 기초재고에 이미 차이가 있는지 → ② 이번 입고·출고·조정으로 새로운 차이가 생겼는지 → ③ 재고에 붙인 단가가 확인된 값인지 순서대로 봅니다.</p>
    <p className={s.notice}>기초재고가 실제보다 크면 이익이 작게, 기말재고가 실제보다 크면 이익이 크게 보입니다. 두 재고가 같은 정도로 틀리면 이익에서 서로 상쇄될 수도 있습니다. 따라서 이익률만 보고 재고가 맞다고 판단할 수 없습니다.</p>
    {progress && <p role="status">{progress}</p>}{busy && <button type="button" onClick={stop}>검산 취소</button>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {data && <>
      {!stable && <p role="alert" className={s.error}>판정 보류: {data.integrity.status === 'STALE' ? '조회 도중 원천이 변경되었습니다. 다시 조회하세요.'
        : data.integrity.status === 'POLICY_CONFLICT' ? '전산 재고 계산 절차가 검증한 버전과 다릅니다. 정책 재확인이 필요합니다.' : '비정상 재고 업무키가 발견되었습니다.'} 아래 수치는 참고이며 정상 판정으로 사용하지 마세요.</p>}
      <p className={s.muted}>수량: {year}년 1~{Number(major)}차 전체 세부차수 · 전후 원천 지문 {stable ? '일치 관측' : '판정 보류'} · {new Date(data.integrity.finishedAt).toLocaleString('ko-KR')}<br />금액 검산은 선택 차수부터 표시합니다. 전체 차수 버튼을 누르면 차례대로 읽으며, 미실행·실패 차수를 정상으로 표시하지 않습니다.</p>
      {!!data.invalidKeyCount && <p className={s.notice}>조회 구간에 비표준 재고 차수 {data.invalidKeyCount}건이 있습니다. 해당 구간은 자료 확인 필요이며, 그 구간을 넘어 최초 원인을 단정하지 않습니다.</p>}
      <button type="button" disabled={busy || !stable} onClick={() => loadReports(data.weeks.map(w => w.major))}>1~{Number(major)}차 금액·수익률도 모두 검산</button>
      <div className={s.horizontal}><table><caption>차수별 수량 원인과 금액 검산 진행 상태 · 행의 상세 버튼으로 확인</caption><colgroup>{[90,190,130,130,130,190].map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr><th>차수</th><th>수량 판정</th><th>이번 차이</th><th>앞 차수 영향</th><th>조정 품목·차수</th><th>금액·수익률</th></tr></thead>
        <tbody onKeyDown={event => { if (!['ArrowDown','ArrowUp'].includes(event.key)) return; const buttons=[...event.currentTarget.querySelectorAll('button')]; const i=buttons.indexOf(document.activeElement); if(i>=0){event.preventDefault(); buttons[Math.max(0,Math.min(buttons.length-1,i+(event.key==='ArrowDown'?1:-1)))].focus();} }}>
          {data.weeks.map(w => <tr key={w.major} className={selected===w.major?s.total:''}>
            <th><button type="button" disabled={busy} aria-pressed={selected===w.major} onClick={()=>selectWeek(w.major)}>{Number(w.major)}차 상세</button></th>
            <td>{stable ? labels[w.status] : '판정 보류'}</td><td>{w.localMismatchCount}건</td><td>{w.carriedCount}건</td><td>{w.adjustedCount}건</td>
            <td>{reports[w.major]?.error ? '조회 실패' : reports[w.major] ? <>{`${reports[w.major].rows.filter(r=>r.mathStatus==='MATCH').length}행 산술 일치 / ${reports[w.major].rows.length}행`}<br />{reports[w.major].formulaAudit.status === 'MATCH' ? `전체 항목식 ${reports[w.major].formulaAudit.checked}개 일치` : `전체 항목식 확인 필요 ${reports[w.major].formulaAudit.issues.length}건`}<br />SQL 매출·매입: {reports[w.major].sqlAudit.status === 'MATCH' ? `${reports[w.major].sqlAudit.checked}개 일치` : labels[reports[w.major].sqlAudit.status]}{reports[w.major].sqlAudit.excludedKeyCount > 0 && <><br />연도키 충돌 제외 {reports[w.major].sqlAudit.excludedKeyCount}건</>}</> : '미실행'}</td>
          </tr>)}
        </tbody></table></div>
      {week && <>
        <h3>{year}년 {Number(selected)}차 · 수량 원인 상세</h3>
        <p>기초 기준 {week.begin ? `${week.begin.year}/${week.begin.week}`:'스냅샷 없음'} → 기말 기준 {week.end ? `${week.end.year}/${week.end.week}`:'스냅샷 없음'}. {week.checkedCount}개 품목·세부차수 식 비교, 자료 확인 필요 {week.inputRequiredCount}건.</p>
        {week.openingPolicyMismatch&&<p className={s.error}>보고서 기초재고 기준과 전산 재고 계산의 직전 기준({week.firstNativePeriod})이 다릅니다. 53차 또는 비표준 차수의 이월 정책 확인이 필요하며, 어느 쪽도 자동으로 바꾸지 않았습니다.</p>}
        <label>국가·품종으로 찾기 <select value={category} onChange={e=>{setCategory(e.target.value);setVisibleCount(30);}}><option value="">전체</option>{[...new Set(week.entries.map(item=>item.category))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
        {week.detailsLoaded === false ? <p>품목별 상세 미조회 · 위 상세 버튼으로 다시 조회하세요.</p> : !week.entries.length ? <p>{week.status==='MATCH'?'현재 자료에서 수량 식의 차이가 발견되지 않았습니다. 실사·단가까지 검증 완료한 것은 아닙니다.':'비교 가능한 재고 자료가 부족합니다. 빈 결과를 정상으로 판단하지 마세요.'}</p>
          : <><p className={s.muted}>선택 분류 {filteredEntries.length}건 중 {Math.min(filteredEntries.length,visibleCount)}건 표시. 기초·입고·출고·조정은 품목의 출고단위 기준입니다.</p><ul className={s.issues}>{filteredEntries.slice(0,visibleCount).map((item,i)=><li key={`${item.period}-${item.prodKey}-${i}`}>
            <strong>{item.category} · {item.name} · {item.period} · {stable ? labels[item.status] : '판정 보류'}</strong>
            <p>기초 {number(item.opening)} + 입고 {number(item.receipt)} − 확정출고 {number(item.shipped)} + 조정 {number(item.adjusted)} = 계산 잔량 {number(item.expected)} {item.unit}<br />저장 잔량 {number(item.closing)} {item.unit} / 이번 차이 {number(item.difference)} {item.unit}</p>
            <p>{item.explanation}</p>
            {item.firstObserved&&<p>조회 범위의 최초 관측 차이: {item.firstObserved}. 기초 이월 차이 {number(item.openingError)}, 기말 누적 차이 {number(item.closingError)} {item.unit}. 실사 정답이 아닌 최초 조회 앵커 대비 추적값입니다.</p>}
            {item.closing<0&&<p className={s.error}>저장 재고가 음수입니다. 수량 식이 맞더라도 실사·입고 누락 여부를 확인해야 합니다.</p>}
            {!!item.adjustmentCount&&<p>재고조정 {item.adjustmentCount}건 포함{item.missingReasonCount ? ` · 사유 없는 이력 ${item.missingReasonCount}건 확인 필요` : ''}. 조정 합계가 0이어도 이력은 표시합니다.</p>}
            <p className={s.muted}>{item.action}</p>
          </li>)}</ul>{filteredEntries.length>visibleCount&&<button type="button" onClick={()=>setVisibleCount(n=>n+30)}>다음 30건 더 보기</button>}</>}
        <h3>{Number(selected)}차 · 금액과 수익률을 이해하는 방법</h3>
        {!finance ? <p>금액 검산 미실행. {!busy&&<button type="button" disabled={!stable} onClick={()=>loadReports([selected])}>이 차수 금액 검산</button>}</p>
          : finance.error ? <p className={s.error}>{finance.error} <button type="button" disabled={busy} onClick={()=>loadReports([selected])}>재시도</button></p>
            : <><h4>SQL DB 원행 → 웹 조회값 대사</h4>
              <p>{finance.sqlAudit.status === 'MATCH' ? `매출·차감·외화매입 ${finance.sqlAudit.checked}개 값이 SQL 독립 합계와 일치합니다.` : finance.sqlAudit.status === 'HISTORICAL' ? '확정/저장본은 저장 당시 값입니다. 현재 SQL과 시점이 달라 대사 완료로 표시하지 않습니다.' : finance.sqlAudit.status === 'MISMATCH' ? 'SQL 원행 합계와 웹 값이 다릅니다. 아래 차이를 확인하세요.' : '원천 조회·코드 분류 또는 변경 여부를 확인할 수 없어 판정을 보류했습니다.'}</p>
              <p className={s.notice}>{finance.sqlAudit.limitations}</p>
              {!!finance.sqlAudit.excludedKeyCount && <p className={s.error}>SQL 연도키 충돌로 제외된 원행 {finance.sqlAudit.excludedKeyCount}건: 매출 {number(finance.sqlAudit.excludedAmounts.N)}원 / 불량차감 {number(finance.sqlAudit.excludedAmounts.L)}원 / 기타매출 {number(finance.sqlAudit.excludedAmounts.O)}원. OrderYear와 OrderYearWeek가 서로 달라 다른 연도 데이터 혼입을 막기 위해 포함하지 않았습니다. 원장을 임의로 고치거나 합산하지 않습니다.</p>}
              {finance.sqlAudit.problems?.map(text=><p className={s.error} key={text}>{text}</p>)}
              {!!finance.sqlAudit.differences.length && <ul>{finance.sqlAudit.differences.map(d=><li key={`${d.category}-${d.col}`}>{d.category} {d.col}: SQL {number(d.sql)} / 웹 {number(d.web)}{d.col==='Q'?' (외화)':'원'}</li>)}</ul>}
              {!!finance.sqlAudit.inventoryIssues?.length && <ul className={s.issues}>{finance.sqlAudit.inventoryIssues.map((item,i)=><li key={i}><strong>{item.category} · {item.side==='begin'?'기초':'기말'} 재고 · {item.name}</strong><p>{item.reason}</p></li>)}</ul>}
              {selected !== major && <ProfitFormulaAudit report={finance.reportInput} />}<p>{finance.note}</p>{finance.historical&&<p className={s.notice}>확정본 또는 저장된 계산본입니다. 산술은 별도로 계산하지만 현재 재고와 시점이 같다고 보증하지 않습니다.</p>}
              <ul className={s.issues}>{finance.rows.map(row=><li key={row.category}>
                <strong>{row.category} · 산술 {labels[row.mathStatus]}</strong><p className={s.notice}>{row.cause}</p><p>{row.explanation}</p>
                {!!row.differences.length&&<p className={s.error}>보고서와 독립 계산이 다른 항목: {row.differences.join(', ')}</p>}
                {!!row.quantityIssues.length&&<p className={s.error}>이 분류에 수량 확인 대상 {row.quantityIssues.length}건이 있습니다. 위 수량 상세에서 기초 이월/이번 차이를 먼저 확인하세요.</p>}
                {row.valuation.map(v=><div key={v.side}><strong>{v.label}: {labels[v.status]}</strong><p>{v.explanation}<br />보고서 {number(v.adopted)}원 / 직접 단가 독립 합계 {number(v.direct)}원{v.delta!==null?` / 차이 ${number(v.delta)}원`:''}</p>
                  {!!v.items.length&&<details><summary>{v.label} 품목별 단가 근거 {v.items.length}건</summary><ul>{v.items.map(item=><li key={item.prodKey}>{item.name}: {number(item.qty)} {item.unit} × 환산 {number(item.factor)} × 단가 {number(item.price)}원 = {number(item.value)}원 · {item.reason}</li>)}</ul></details>}
                </div>)}
              </li>)}</ul>
              <p className={s.notice}>{finance.totals ? `전체 이익률은 개별 이익률의 평균이 아닙니다. 합계 이익 ${number(finance.totals.J)} ÷ (합계 매출 ${number(finance.totals.C)} + 합계 기말 ${number(finance.totals.F)}) = ${finance.totals.K===null?'분모 0으로 계산 불가':`${number(finance.totals.K*100)}%`}입니다.`:'일부 행의 필수값이 없어 전체 독립 이익률을 확정하지 않았습니다.'}</p>
            </>}
      </>}
      <details><summary>검산 범위와 아직 확인할 수 없는 부분</summary><ul>{data.limitations.map(text=><li key={text}>{text}</li>)}</ul><p>버전 {data.version} · 조회 원천 지문 {data.integrity.sourceHash}</p></details>
    </>}
  </section>;
}
