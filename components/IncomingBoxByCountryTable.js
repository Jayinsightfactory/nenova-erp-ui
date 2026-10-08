// components/IncomingBoxByCountryTable.js — 차수별 국가 입고 박스 표 (데스크톱·모바일 공용)
// 국가 열은 총 박스 많은 순, 오른쪽 합계 열 + 아래 합계 행. 비고 없음.
const fmt = value => (Number(value) || 0).toLocaleString('ko-KR');

export const VIEWS = [
  { key: 'byWeek', label: '세부차수' },
  { key: 'byMajor', label: '대차수' },
  { key: 'byMonth', label: '월별' },
];

export default function IncomingBoxByCountryTable({ report, view = 'byWeek', compact = false }) {
  if (!report) return null;
  const rows = report[view] || [];
  const countries = report.countries || [];
  const grand = report.grandTotal || { byCountry: {}, total: 0 };
  const cell = { padding: compact ? '6px 6px' : '7px 10px', borderBottom: '1px solid #e4ebf3', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: compact ? 12 : 13 };
  const head = { ...cell, position: 'sticky', top: 0, background: '#1F3864', color: '#fff', fontWeight: 700, textAlign: 'center', zIndex: 1 };
  const first = { ...cell, textAlign: 'left', fontWeight: 700, background: '#D9E1F2', position: 'sticky', left: 0, zIndex: 1 };
  return (
    <div style={{ overflow: 'auto', background: '#fff', border: '1px solid #d5dfeb', borderRadius: 10, maxHeight: compact ? 'none' : 'calc(100vh - 260px)' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: compact ? 0 : 720 }}>
        <thead>
          <tr>
            <th style={{ ...head, left: 0, zIndex: 2, textAlign: 'left' }}>{view === 'byMonth' ? '월' : '차수'}</th>
            {countries.map(c => <th key={c} style={head}>{c}</th>)}
            <th style={{ ...head, background: '#163a66' }}>합계</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td style={first}>{row.label}</td>
              {countries.map(c => {
                const v = row.byCountry[c] || 0;
                return <td key={c} style={{ ...cell, color: v ? '#172b45' : '#c0c0c0' }}>{fmt(v)}</td>;
              })}
              <td style={{ ...cell, fontWeight: 700, background: '#F2F2F2' }}>{fmt(row.total)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...first, background: '#FFE699' }}>합계</td>
            {countries.map(c => <td key={c} style={{ ...cell, fontWeight: 700, background: '#FFE699' }}>{fmt(grand.byCountry[c])}</td>)}
            <td style={{ ...cell, fontWeight: 700, background: '#FFE699' }}>{fmt(grand.total)}</td>
          </tr>
        </tbody>
      </table>
      {!rows.length && <p style={{ padding: 20, textAlign: 'center', color: '#60748a' }}>표시할 입고 박스 자료가 없습니다.</p>}
    </div>
  );
}
