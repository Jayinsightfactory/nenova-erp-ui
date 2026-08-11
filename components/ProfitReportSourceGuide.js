// 주차별 매출이익 보고서 — '항목별 데이터 기준 보기' 접기/펼치기.
// 조회·설명 전용 UI다. 보고서 계산·저장·다운로드 로직을 전혀 건드리지 않는다.
// 설명 문구는 lib/profitReportSourceGuide.js 한 곳에서만 관리한다(회귀테스트가 강제).
import { Fragment, useState } from 'react';
import { GUIDE_SECTIONS, ENTRY_KINDS, GUIDE_SUMMARY } from '../lib/profitReportSourceGuide';

const PANEL_ID = 'profit-report-source-guide-panel';

function KindBadge({ kind }) {
  const def = ENTRY_KINDS[kind] || ENTRY_KINDS.auto;
  return (
    <span style={{ ...st.badge, ...(badgeTone[kind] || badgeTone.auto) }} title={def.hint}>
      {def.label}
    </span>
  );
}

export default function ProfitReportSourceGuide() {
  // 새로고침하면 항상 접힌 상태로 시작한다(저장하지 않음).
  const [open, setOpen] = useState(false);
  return (
    <div style={st.wrap}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        style={st.toggle}
        title="각 금액·비율이 어느 메뉴·전산 자료에서 오고 어떻게 계산되는지 보여줍니다"
      >
        <span aria-hidden="true" style={st.caret}>{open ? '▾' : '▸'}</span>
        항목별 데이터 기준 보기
        <span style={st.toggleHint}>{open ? '접기' : '펼치기'}</span>
      </button>
      <div id={PANEL_ID} hidden={!open} style={open ? st.panel : undefined}>
        {open && (
          <>
            <p style={st.summary}>{GUIDE_SUMMARY}</p>
            <div style={st.scroller}>
              <table style={st.table}>
                <caption style={st.caption}>주차별 매출이익 보고서 항목별 데이터 기준</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...st.th, ...st.colItem }}>화면 항목</th>
                    <th scope="col" style={{ ...st.th, ...st.colSource }}>데이터가 오는 곳</th>
                    <th scope="col" style={{ ...st.th, ...st.colFormula }}>계산 방식</th>
                    <th scope="col" style={{ ...st.th, ...st.colKind }}>자동/직접입력</th>
                    <th scope="col" style={{ ...st.th, ...st.colNote }}>주의·검증</th>
                  </tr>
                </thead>
                <tbody>
                  {GUIDE_SECTIONS.map(section => (
                    <Fragment key={section.id}>
                      <tr>
                        <th scope="colgroup" colSpan={5} style={st.sectionTh}>{section.title}</th>
                      </tr>
                      {section.rows.map(row => (
                        <tr key={row.key}>
                          <th scope="row" style={{ ...st.tdItem, ...st.colItem }}>
                            {row.label}
                            <span style={st.fields} title={row.fields}>{row.fields}</span>
                          </th>
                          <td style={{ ...st.td, ...st.colSource }}>{row.source}</td>
                          <td style={{ ...st.td, ...st.colFormula }}>{row.formula}</td>
                          <td style={{ ...st.td, ...st.colKind }}><KindBadge kind={row.kind} /></td>
                          <td style={{ ...st.td, ...st.colNote }}>{row.note}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const badgeTone = {
  auto: { background: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' },
  calc: { background: '#f1f5f9', color: '#334155', borderColor: '#cbd5e1' },
  autoManual: { background: '#dcfce7', color: '#166534', borderColor: '#86efac' },
  manualSource: { background: '#ede9fe', color: '#5b21b6', borderColor: '#c4b5fd' },
  manual: { background: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' },
};

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
  scroller: { overflowX: 'auto', maxHeight: '58vh', overflowY: 'auto', maxWidth: '100%' },
  table: { borderCollapse: 'collapse', fontSize: 11.5, width: '100%', minWidth: 720, tableLayout: 'fixed' },
  caption: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  th: {
    position: 'sticky', top: 0, zIndex: 1, background: '#1e293b', color: '#fff',
    padding: '5px 7px', fontSize: 10.5, textAlign: 'left', fontWeight: 700,
  },
  sectionTh: {
    background: '#eef2ff', color: '#3730a3', textAlign: 'left', fontSize: 11,
    fontWeight: 800, padding: '4px 7px', border: '1px solid #e2e8f0',
  },
  td: { border: '1px solid #e2e8f0', padding: '4px 7px', color: '#334155', verticalAlign: 'top', lineHeight: 1.55, wordBreak: 'break-word' },
  tdItem: {
    border: '1px solid #e2e8f0', padding: '4px 7px', textAlign: 'left', verticalAlign: 'top',
    fontWeight: 700, color: '#0f172a', background: '#f8fafc', lineHeight: 1.45, wordBreak: 'break-word',
  },
  fields: { display: 'block', marginTop: 2, fontSize: 9.5, fontWeight: 500, color: '#94a3b8', lineHeight: 1.4, wordBreak: 'break-all' },
  badge: { display: 'inline-block', border: '1px solid', borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' },
  colItem: { width: '17%' },
  colSource: { width: '22%' },
  colFormula: { width: '30%' },
  colKind: { width: '10%' },
  colNote: { width: '21%' },
};
