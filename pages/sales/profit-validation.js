import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { getPreviousProfitReportPeriod } from '../../lib/profitReportDefaultPeriod.mjs';
import { outputScope } from '../../lib/profitRangeOutput.mjs';
import { loadValidationWindow, reportBasis } from '../../lib/profitValidationWindow.mjs';
import { computeProfitRow, computeProfitTotals } from '../../lib/profitReportCalc';
import ProfitStockAdjustmentNotes from '../../components/ProfitStockAdjustmentNotes';
import s from '../../components/ProfitValidationWindow.module.css';

const columns = [['C', '매출액'], ['E', '기초재고액'], ['F', '기말재고액'], ['G', '상품·항공료'], ['H', '그외통관비'], ['J', '매출이익'], ['K', '이익률']];
const amount = (value, ratio) => value == null || !Number.isFinite(Number(value)) ? '미확인' : ratio
  ? `${(Number(value) * 100).toFixed(1)}%` : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 });

export default function ProfitValidationPage() {
  const router = useRouter();
  const [year, setYear] = useState('');
  const [major, setMajor] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const queryKey = `${JSON.stringify(router.query.year)}:${JSON.stringify(router.query.week)}`;

  async function load(nextYear = year, nextMajor = major) {
    request.current?.abort();
    setResult(null); setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const scope = outputScope(nextYear, nextMajor);
      setBusy(true);
      const data = await loadValidationWindow({ year: scope.year, major: scope.major, signal: controller.signal });
      if (!controller.signal.aborted && request.current === controller) setResult(data);
    } catch (e) {
      if (!controller.signal.aborted && request.current === controller) setError(e.message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }

  useEffect(() => {
    if (!router.isReady) return undefined;
    request.current?.abort(); setResult(null); setError(''); setBusy(false);
    const hasQuery = router.query.year !== undefined || router.query.week !== undefined;
    if (hasQuery) {
      try {
        const scope = outputScope(router.query.year, router.query.week);
        setYear(scope.year); setMajor(scope.major); load(scope.year, scope.major);
      } catch (e) { setYear(''); setMajor(''); setError(e.message); }
    } else {
      const initial = getPreviousProfitReportPeriod(getCurrentWeek());
      setYear(initial.year || ''); setMajor(initial.major || '');
    }
    return () => request.current?.abort();
  }, [router.isReady, queryKey]);

  function edit(setter, value) {
    request.current?.abort(); request.current = null;
    setBusy(false); setResult(null); setError(''); setter(value);
  }
  const report = result?.report.data;
  const checks = result?.checks.data;
  const rows = (report?.rows || []).map(row => ({ ...row, calc: report.confirmed && row.calc ? row.calc : computeProfitRow(row) }));
  const totals = report?.confirmed ? report.confirmedTotals : computeProfitTotals(rows);
  const issues = report?.audit?.issues || [];
  const reportHref = result ? `/sales/profit-report?popup=1&year=${result.year}&week=${result.major}` : '/sales/profit-report?popup=1';

  return <>
    <Head><title>수익률 검증·확인 | 네노바웹</title></Head>
    <main className={s.page}>
      <header className={s.header}><div><h1>수익률 검증·확인</h1><p>주차별 매출이익 보고서 · 읽기 전용</p></div><a href={reportHref} target="_blank" rel="noopener noreferrer">매출이익 보고서 열기 ↗</a></header>
      <form className={s.filters} onSubmit={event => { event.preventDefault(); load(); }}>
        <label>연도 <input aria-label="검증 연도" inputMode="numeric" value={year} onChange={event => edit(setYear, event.target.value)} maxLength={4} /></label>
        <label>차수 <select aria-label="검증 차수" value={major} onChange={event => edit(setMajor, event.target.value)}><option value="">선택</option>{Array.from({ length: 53 }, (_, index) => String(index + 1).padStart(2, '0')).map(week => <option key={week} value={week}>{Number(week)}차</option>)}</select></label>
        <button type="submit" disabled={busy}>{busy ? '점검 자료 조회 중…' : '점검 자료 조회'}</button>
        {busy && <button type="button" onClick={() => { request.current?.abort(); request.current = null; setBusy(false); setError('조회가 취소되었습니다. 다시 조회할 수 있습니다.'); }}>취소</button>}
      </form>
      <aside className={s.notice}>현재 제공: 기존 보고서 경고, 통관·환율·입고 원천 점검, 실제 재고조정 이력.<br />독립 수량 대사·평가액 검산·최초 원인 역추적은 아직 구현 전입니다. 경고가 없거나 이익률이 양수여도 전체 검증 완료를 뜻하지 않습니다. 원장 수정·자동 저장·AI 호출은 하지 않습니다.</aside>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {busy && <p role="status">선택 연도·차수의 자료를 읽고 있습니다. 다른 차수로 바꾸면 이전 조회는 취소됩니다.</p>}
      {result && <>
        <h2>{result.year}년 {Number(result.major)}차 확인 결과</h2>
        <p className={s.muted}>조회 {new Date(result.queriedAt).toLocaleString('ko-KR')} · 보고서와 현재 원장 점검은 별도 조회이며 동시점 대사를 보증하지 않습니다.</p>
        <section className={s.section} aria-label="보고서 금액과 경고">
          <h2>보고서 금액과 경고</h2>
          {result.report.error ? <p role="alert" className={s.error}>{result.report.error} · 보고서 판정 불가</p> : <>
            <p className={s.notice}>{reportBasis(report)}</p>
            <p>기초 기준 {report.stockWeeks?.beginOrderYear || '미확인'} / {report.stockWeeks?.begin || '미확인'} · 기말 기준 {report.stockWeeks?.endOrderYear || '미확인'} / {report.stockWeeks?.end || '미확인'}</p>
            <div className={s.horizontal}><table><caption>기존 보고서 계산값 참고 · 독립 재계산 결과 아님 · 금액 단위 원</caption><colgroup><col style={{ width: 180 }} />{columns.map(([key]) => <col key={key} style={{ width: 132 }} />)}</colgroup><thead><tr><th scope="col">국가·품종</th>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>
              {rows.map(row => <tr key={row.category}><th scope="row">{row.category}</th>{columns.map(([key]) => <td key={key} className={Number(row.calc[key]) < 0 ? s.negative : ''}>{amount(row.calc[key], key === 'K')}</td>)}</tr>)}
              {totals && <tr className={s.total}><th scope="row">보고서 전체 합계</th>{columns.map(([key]) => <td key={key}>{amount(totals[key], key === 'K')}</td>)}</tr>}
            </tbody></table></div>
            <p className={s.muted}>일반 행 이익률은 이익÷매출액, 일부 예외 행과 합계는 이익÷(매출액+기말재고액)입니다. 이익률 단순 평균과 다르며, 음수 자체는 오류 판정이 아닙니다.</p>
            {!report.audit || !Array.isArray(report.audit.issues) ? <p className={s.error}>보고서 경고 자료 없음 · 검증 상태 미확인</p> : issues.length ? <ul className={s.issues}>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.category || '전체'} · {issue.severity === 'error' ? '입력·확인 필요' : '참고·확인 필요'}</strong><p>{issue.detail?.summary || issue.message}</p>{issue.detail?.impact?.text && <p>{issue.detail.impact.text}</p>}<small>{issue.code}</small></li>)}</ul> : <p>기존 보고서 경고 없음 · 전체 검증 완료 아님</p>}
          </>}
        </section>
        <section className={s.section} aria-label="현재 원천 점검"><h2>현재 원천 점검 · 통관·환율·입고</h2>
          {result.checks.error ? <p role="alert" className={s.error}>{result.checks.error} · 원천 점검 판정 불가</p> : checks.rows.length ? <ul className={s.issues}>{checks.rows.map((check, index) => <li key={index}><strong>{check.subWeek} · {check.topic} · {check.statusLabel}</strong><p>{check.text}</p>{check.link?.href?.startsWith('/') && !check.link.href.startsWith('//') && <a href={check.link.href} target="_blank" rel="noopener noreferrer">{check.link.label} ↗</a>}</li>)}</ul> : <p>기존 원천 점검 경고 없음 · 전체 검증 완료 아님</p>}
        </section>
        <ProfitStockAdjustmentNotes key={`${result.year}:${result.major}:${result.queriedAt}`} orderYear={result.year} major={result.major} confirmed={Boolean(report?.confirmed)} />
      </>}
    </main>
  </>;
}
