import { auditProfitFormulas } from '../lib/profitFormulaAudit.mjs';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from '../lib/profitReportCalc';
import s from './ProfitValidationWindow.module.css';

const show = (v,k) => v == null ? '없음' : ['D','K','M','U'].includes(k)
  ? `${(v*100).toFixed(6)}%` : Number(v).toLocaleString('ko-KR',{maximumFractionDigits:6});
export default function ProfitFormulaAudit({ report }) {
  if (!report) return null;
  const rows=(report.rows || []).map(r=>({...r,calc:report.confirmed?r.calc:computeProfitRow(r)}));
  const totals=report.confirmed?report.confirmedTotals:computeProfitTotals(rows);
  if (!report.confirmed) for(const r of rows) Object.assign(r.calc,{D:calcRevenueRatio(r.calc,totals),U:calcPurchaseRatio(r.calc,totals)});
  const audit=auditProfitFormulas(report,rows,totals);
  return <section className={s.section} aria-label="전체 항목 계산식 검산">
    <h2>전체 항목 계산식 검산</h2>
    <p role="status">{audit.status==='MATCH'?`계산식 일치 · ${audit.rowCount}행 · ${audit.checked}항목 대조`:audit.status==='MISMATCH'?`계산식 불일치 ${audit.issues.length}건`:'검산 자료 없음'}</p>
    <p>{report.confirmed?'확정 당시 저장된 값':'현재 보고서에 적용된 입력값'}을 기준으로 매출·환산·원가·이익·비율과 합계를 독립 계산했습니다. 원천 입력이 빠져 0으로 계산된 경우는 아래에서 따로 표시합니다.</p>
    {!!audit.issues.length && <div className={s.horizontal}><table><thead><tr><th>국가·품종</th><th>항목</th><th>표시값</th><th>검산값</th><th>원인</th></tr></thead><tbody>{audit.issues.map((i,n)=><tr key={n}><th>{i.category}</th><td>{i.column}</td><td>{show(i.actual,i.column)}</td><td>{show(i.expected,i.column)}</td><td>{i.reason} · {i.formula}</td></tr>)}</tbody></table></div>}
    {!!audit.inputWarnings.length && <details><summary>원천 입력·확정 기록 확인 필요 {audit.inputWarnings.length}행 — 계산식 일치와 별개</summary><ul>{audit.inputWarnings.map((i,n)=><li key={n}>{i.category} ({i.columns.join(', ')}) · {i.reason}</li>)}</ul></details>}
    <details><summary>적용식과 예외 보기</summary><p>매출=N+L+O+매출조정, 상품금액=외화매입×환율, 항공료원화=외화항공료×환율, 매입액=상품금액+항공료원화. 일반 매출원가=기초+매입+통관−기말, 이익=매출−원가+이익조정, 이익률=이익÷매출.</p><p>이스라엘·뉴질랜드·일본은 원가에서 기말을 빼지 않고 이익에서 더하며 이익률 분모는 매출+기말입니다. 합계 이익률도 총이익÷(총매출+총기말)입니다. 공제·국내는 매출/재고/이익 합계에만 포함되고, 기타(미분류)는 모든 합계에서 제외됩니다. 상품구매비율 합계의 분자는 베트남도 제외합니다.</p><p>기초·기말 평가 금액은 입력으로 대조하며 FIFO/매입원가 증빙 자체를 이 검산이 확정하지 않습니다. 금액·비율의 화면 반올림 전 값으로 비교합니다.</p></details>
  </section>;
}
