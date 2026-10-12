// 주차별 매출이익 보고서 — '원본 엑셀 대조' 접기/펼치기.
//
// 조회·표시 전용이다. 보고서 계산·저장·다운로드·DB를 전혀 건드리지 않는다. 화면이 이미 계산해 둔
// rowsWithCalc/totals 를 lib/profitReportExcelParity.js 순수 함수에 넘겨 판정만 렌더링한다.
//
// 왜 필요한가: 웹과 원본 엑셀이 다를 때 "몇 % 다른가"만으로는 손을 쓸 수 없다. 이 패널은 열마다
// (1) 차이가 얼마인지, (2) 그중 엑셀 쪽 알려진 원인으로 설명되는 금액이 얼마인지, (3) 남은 미설명
// 차이가 허용오차(5%) 안인지, (4) 파생열이면 어느 원천열을 고쳐야 하는지를 함께 보여준다.
import { Fragment, useMemo, useState } from 'react';
import { buildExcelParity, CAUSE_LABEL } from '../lib/profitReportExcelParity';

const PANEL_ID = 'profit-report-excel-parity-panel';

const COL_LABEL = {
  C: '매출액', D: '매출비율', E: '기초상품재고액', F: '기말상품재고액', G: '매입액(상품+포워딩)',
  H: '그외통관비', I: '매출원가', J: '매출이익', K: '이익률', L: '불량금액', M: '불량율',
  N: '순수매출액', O: '그 외 매출액', P: '상품 금액(구매)', Q: '구매금액(외화)', R: '환율',
  S: '포워딩(USD)', T: '포워딩 원화환산', U: '상품구매비율',
};

const VERDICT = {
  match: { label: '일치', tone: { background: '#dcfce7', color: '#166534', borderColor: '#86efac' } },
  explained: { label: '원인 확인됨', tone: { background: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' } },
  investigate: { label: '조사 필요', tone: { background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' } },
};

const fmtNum = (v, kind) => {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  const n = Number(v);
  if (kind === 'ratio') return `${(n * 100).toFixed(2)}%`;
  if (kind === 'rate') return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (kind === 'foreign') return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return Math.round(n).toLocaleString('ko-KR');
};
const fmtPct = (v) => (v == null || !Number.isFinite(Number(v)) ? '-' : `${(Number(v) * 100).toFixed(2)}%`);

function VerdictBadge({ verdict }) {
  const def = VERDICT[verdict] || VERDICT.match;
  return <span style={{ ...st.badge, ...def.tone }}>{def.label}</span>;
}

/** 파생열의 "어느 원천열 때문인지" 한 줄 — exact 관계일 때만 금액을 보여준다. */
function Attribution({ attribution, kind }) {
  if (!attribution) return null;
  const { formula, exact, parts } = attribution;
  const shown = (parts || []).filter(p => p.amount == null || Math.abs(p.amount) > 0);
  return (
    <div style={st.attr}>
      <span style={st.attrFormula}>{formula}</span>
      {exact
        ? shown.map(p => (
            <span key={p.source} style={st.attrPart}>
              {COL_LABEL[p.source] || p.source} {p.amount > 0 ? '+' : '−'}{fmtNum(Math.abs(p.amount), kind)}
            </span>
          ))
        : <span style={st.attrNote}>상위 열: {(parts || []).map(p => COL_LABEL[p.source] || p.source).join(' · ')}</span>}
    </div>
  );
}

export default function ProfitReportExcelParity({ orderYear, major, rowsWithCalc, totals }) {
  const [open, setOpen] = useState(false);      // 새로고침하면 항상 접힌 상태(저장하지 않음)
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [openCategory, setOpenCategory] = useState('');

  // 패널이 접혀 있으면 계산조차 하지 않는다 — 본표 렌더링에 부담을 주지 않기 위해서다.
  const parity = useMemo(
    () => (open ? buildExcelParity({ orderYear, major, rowsWithCalc, totals }) : null),
    [open, orderYear, major, rowsWithCalc, totals],
  );

  const visibleTotals = useMemo(() => {
    if (!parity?.available) return [];
    return showAllColumns ? parity.totals : parity.totals.filter(c => c.verdict !== 'match');
  }, [parity, showAllColumns]);

  return (
    <div style={st.wrap}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        style={st.toggle}
        title="이 차수의 웹 계산값을 원본 엑셀(2026년 22~27차)과 항목별로 대조하고, 차이의 원인을 분류합니다"
      >
        <span aria-hidden="true" style={st.caret}>{open ? '▾' : '▸'}</span>
        원본 엑셀 대조
        <span style={st.toggleHint}>{open ? '접기' : '펼치기'}</span>
      </button>

      <div id={PANEL_ID} hidden={!open} style={open ? st.panel : undefined}>
        {open && !parity?.available && (
          <p style={st.summary}>{parity?.reason || '대조할 원본 엑셀이 없습니다.'}</p>
        )}

        {open && parity?.available && (
          <>
            <p style={st.summary}>
              <b>{parity.orderYear}년 {parity.major}차</b> 웹 계산값을 원본 <b>{parity.sourceFile}</b> 와 열별로 대조했습니다.
              허용오차 <b>{fmtPct(parity.tolerancePct)}</b>는 <b>미설명 차이</b>에만 적용합니다 — 원본 엑셀 자체의
              수기 예외·결함으로 설명되는 금액은 웹 결함이 아니므로 따로 분리합니다.
              <br />
              <b>매출원가·매출이익·이익률·매출비율 같은 파생열은 독립 원인이 없습니다.</b> 원천열
              (순수매출·불량·그외매출·기초/기말재고·통관비·구매·환율·포워딩)의 차이가 산술적으로 그대로 실린 결과라,
              파생열에 별도로 5% 기준을 적용할 수 없습니다. 원천열을 맞추면 파생열은 따라 맞습니다.
            </p>

            <div style={st.counts}>
              <span style={{ ...st.countChip, ...VERDICT.match.tone }}>일치 {parity.counts.match || 0}</span>
              <span style={{ ...st.countChip, ...VERDICT.explained.tone }}>원인 확인됨 {parity.counts.explained || 0}</span>
              <span style={{ ...st.countChip, ...VERDICT.investigate.tone }}>조사 필요 {parity.counts.investigate || 0}</span>
              <label style={st.checkbox}>
                <input type="checkbox" checked={showAllColumns} onChange={e => setShowAllColumns(e.target.checked)} />
                일치 항목도 보기
              </label>
            </div>

            {parity.investigate.length > 0 && (
              <div style={st.callout}>
                <b>먼저 볼 것</b> — 원천열 {parity.investigate.filter(c => !c.derived).map(c => COL_LABEL[c.col] || c.col).join(' · ') || '없음'}
                {parity.investigate.some(c => c.derived) && (
                  <span style={{ color: '#78350f' }}>
                    {' '}(파생열 {parity.investigate.filter(c => c.derived).map(c => COL_LABEL[c.col] || c.col).join(' · ')} 은 이 원천열을 고치면 따라 맞습니다)
                  </span>
                )}
              </div>
            )}

            <div style={st.scroller}>
              <table style={st.table}>
                <caption style={st.caption}>합계 기준 웹 ↔ 원본 엑셀 항목별 대조</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...st.th, ...st.colItem }}>항목</th>
                    <th scope="col" style={{ ...st.th, ...st.colNum }}>웹</th>
                    <th scope="col" style={{ ...st.th, ...st.colNum }}>원본 엑셀</th>
                    <th scope="col" style={{ ...st.th, ...st.colNum }}>차이</th>
                    <th scope="col" style={{ ...st.th, ...st.colNum }}>오차율</th>
                    <th scope="col" style={{ ...st.th, ...st.colNum }}>미설명 차이</th>
                    <th scope="col" style={{ ...st.th, ...st.colVerdict }}>판정</th>
                    <th scope="col" style={{ ...st.th, ...st.colCause }}>원인 · 분해</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTotals.map(cell => (
                    <tr key={cell.col}>
                      <th scope="row" style={{ ...st.tdItem, ...st.colItem }}>
                        {COL_LABEL[cell.col] || cell.col}
                        <span style={st.fields}>{cell.col}{cell.derived ? ' · 파생열' : ' · 원천열'}</span>
                      </th>
                      <td style={{ ...st.tdNum, ...st.colNum }}>{fmtNum(cell.web, cell.kind)}</td>
                      <td style={{ ...st.tdNum, ...st.colNum }}>{cell.excel == null ? <span style={st.blank}>빈칸</span> : fmtNum(cell.excel, cell.kind)}</td>
                      <td style={{ ...st.tdNum, ...st.colNum, color: Math.abs(cell.diff) > cell.absFloor ? '#b91c1c' : '#64748b' }}>
                        {fmtNum(cell.diff, cell.kind)}
                      </td>
                      <td style={{ ...st.tdNum, ...st.colNum }}>{fmtPct(cell.pctDiff)}</td>
                      <td style={{ ...st.tdNum, ...st.colNum, fontWeight: 800 }}>
                        {fmtNum(cell.unexplained, cell.kind)}
                        <span style={st.subPct}>{fmtPct(cell.unexplainedPct)}</span>
                      </td>
                      <td style={{ ...st.td, ...st.colVerdict }}><VerdictBadge verdict={cell.verdict} /></td>
                      <td style={{ ...st.td, ...st.colCause }}>
                        {cell.causes.map((c, i) => (
                          <div key={i} style={st.cause}>
                            <b>{CAUSE_LABEL[c.cause] || c.cause}</b>
                            {c.applied !== 0 && <span style={st.causeAmount}>{fmtNum(c.applied, cell.kind)} 설명</span>}
                            {c.applied === 0 && <span style={st.causeUnused}>이번 차이와 방향이 달라 적용 안 됨</span>}
                            <div style={st.causeNote}>{c.note}</div>
                          </div>
                        ))}
                        <Attribution attribution={cell.attribution} kind={cell.kind} />
                        {!cell.causes.length && !cell.attribution && cell.verdict === 'investigate' && (
                          <span style={st.causeNote}>알려진 원인이 없습니다. 이 열의 원천 자료를 직접 확인해야 합니다.</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!visibleTotals.length && (
                    <tr><td colSpan={8} style={st.td}>모든 항목이 허용오차 안입니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={st.catWrap}>
              <div style={st.catTitle}>품명별 대조 — 차이가 있는 항목만</div>
              {parity.categories.map(cat => {
                const bad = cat.cells.filter(c => c.verdict !== 'match');
                if (!bad.length) return null;
                const isOpen = openCategory === cat.category;
                return (
                  <Fragment key={cat.category}>
                    <button
                      type="button"
                      onClick={() => setOpenCategory(isOpen ? '' : cat.category)}
                      aria-expanded={isOpen}
                      style={st.catToggle}
                    >
                      <span aria-hidden="true" style={st.caret}>{isOpen ? '▾' : '▸'}</span>
                      {cat.category}
                      <span style={st.catCount}>{bad.length}개 항목</span>
                    </button>
                    {isOpen && (
                      <div style={st.scroller}>
                        <table style={st.table}>
                          <caption style={st.caption}>{cat.category} 항목별 대조</caption>
                          <thead>
                            <tr>
                              <th scope="col" style={{ ...st.th, ...st.colItem }}>항목</th>
                              <th scope="col" style={{ ...st.th, ...st.colNum }}>웹</th>
                              <th scope="col" style={{ ...st.th, ...st.colNum }}>원본 엑셀</th>
                              <th scope="col" style={{ ...st.th, ...st.colNum }}>차이</th>
                              <th scope="col" style={{ ...st.th, ...st.colNum }}>오차율</th>
                              <th scope="col" style={{ ...st.th, ...st.colVerdict }}>판정</th>
                              <th scope="col" style={{ ...st.th, ...st.colCause }}>원인 · 분해</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bad.map(cell => (
                              <tr key={cell.col}>
                                <th scope="row" style={{ ...st.tdItem, ...st.colItem }}>
                                  {COL_LABEL[cell.col] || cell.col}
                                  <span style={st.fields}>{cell.col}{cell.derived ? ' · 파생열' : ' · 원천열'}</span>
                                </th>
                                <td style={{ ...st.tdNum, ...st.colNum }}>{fmtNum(cell.web, cell.kind)}</td>
                                <td style={{ ...st.tdNum, ...st.colNum }}>{cell.excel == null ? <span style={st.blank}>빈칸</span> : fmtNum(cell.excel, cell.kind)}</td>
                                <td style={{ ...st.tdNum, ...st.colNum }}>{fmtNum(cell.diff, cell.kind)}</td>
                                <td style={{ ...st.tdNum, ...st.colNum }}>{fmtPct(cell.pctDiff)}</td>
                                <td style={{ ...st.td, ...st.colVerdict }}><VerdictBadge verdict={cell.verdict} /></td>
                                <td style={{ ...st.td, ...st.colCause }}>
                                  {cell.causes.map((c, i) => (
                                    <div key={i} style={st.cause}>
                                      <b>{CAUSE_LABEL[c.cause] || c.cause}</b>
                                      <div style={st.causeNote}>{c.note}</div>
                                    </div>
                                  ))}
                                  <Attribution attribution={cell.attribution} kind={cell.kind} />
                                  {cell.attributionResidual != null && Math.abs(cell.attributionResidual) > 1 && (
                                    <div style={st.residual}>
                                      공식 잔차 {fmtNum(cell.attributionResidual, cell.kind)} — 이 행은 상위 열 차이만으로 설명되지 않습니다.
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const st = {
  wrap: { marginBottom: 10 },
  toggle: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8,
    padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4,
  },
  caret: { fontSize: 10, color: '#64748b' },
  toggleHint: { fontSize: 10.5, fontWeight: 600, color: '#94a3b8' },
  panel: {
    marginTop: 6, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff',
    padding: 10, maxWidth: '100%', boxSizing: 'border-box',
  },
  summary: { margin: '0 0 8px', fontSize: 11.5, color: '#475569', lineHeight: 1.6 },
  counts: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  countChip: { display: 'inline-block', border: '1px solid', borderRadius: 5, padding: '2px 7px', fontSize: 10.5, fontWeight: 800 },
  checkbox: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', cursor: 'pointer' },
  callout: {
    border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', borderRadius: 8,
    padding: '6px 9px', fontSize: 11.5, lineHeight: 1.6, marginBottom: 8,
  },
  scroller: { overflowX: 'auto', maxHeight: '58vh', overflowY: 'auto', maxWidth: '100%' },
  table: { borderCollapse: 'collapse', fontSize: 11.5, width: '100%', minWidth: 860, tableLayout: 'fixed' },
  caption: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  th: {
    position: 'sticky', top: 0, zIndex: 1, background: '#1e293b', color: '#fff',
    padding: '5px 7px', fontSize: 10.5, textAlign: 'left', fontWeight: 700,
  },
  td: { border: '1px solid #e2e8f0', padding: '4px 7px', color: '#334155', verticalAlign: 'top', lineHeight: 1.55, wordBreak: 'break-word' },
  tdNum: { border: '1px solid #e2e8f0', padding: '4px 7px', color: '#0f172a', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  tdItem: {
    border: '1px solid #e2e8f0', padding: '4px 7px', textAlign: 'left', verticalAlign: 'top',
    fontWeight: 700, color: '#0f172a', background: '#f8fafc', lineHeight: 1.45, wordBreak: 'break-word',
  },
  fields: { display: 'block', marginTop: 2, fontSize: 9.5, fontWeight: 500, color: '#94a3b8', lineHeight: 1.4 },
  subPct: { display: 'block', fontSize: 9.5, fontWeight: 600, color: '#94a3b8' },
  blank: { color: '#b45309', fontWeight: 700 },
  badge: { display: 'inline-block', border: '1px solid', borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' },
  cause: { marginBottom: 4 },
  causeAmount: { marginLeft: 5, fontSize: 10, fontWeight: 800, color: '#1e40af' },
  causeUnused: { marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#94a3b8' },
  causeNote: { fontSize: 10.5, color: '#64748b', lineHeight: 1.5, marginTop: 1 },
  attr: { marginTop: 3, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  attrFormula: { fontSize: 10, fontWeight: 800, color: '#3730a3', background: '#eef2ff', borderRadius: 4, padding: '1px 5px' },
  attrPart: { fontSize: 10, color: '#334155', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' },
  attrNote: { fontSize: 10, color: '#64748b' },
  residual: { marginTop: 3, fontSize: 10.5, fontWeight: 700, color: '#b91c1c' },
  catWrap: { marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 8 },
  catTitle: { fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 5 },
  catToggle: {
    display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 5, marginBottom: 5,
    background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 7,
    padding: '3px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  },
  catCount: { fontSize: 10, fontWeight: 700, color: '#b91c1c' },
  colItem: { width: '15%' },
  colNum: { width: '11%' },
  colVerdict: { width: '8%' },
  colCause: { width: '25%' },
};
