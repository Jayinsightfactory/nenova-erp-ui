import { raumPnlCollisionLocationRows } from '../../lib/raumPnlCollisionLocation';

// Presentational only: details are supplied by the failed preview/save path.
export default function RaumPnlCollisionLocations({ details }) {
  const rows = raumPnlCollisionLocationRows(details);
  if (!rows.length) return null;
  // A structured price is optional.  `0` is still a real price and must keep
  // the column visible, so this intentionally avoids a truthiness check.
  const hasSalePrice = rows.some(row => row.salePrice !== null && row.salePrice !== undefined);
  const showSalePrice = value => value === null || value === undefined
    ? '—'
    : (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : String(value));
  const cell = { padding: '5px 7px', borderBottom: '1px solid #fed7aa', verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' };
  return <div data-testid="raum-pnl-collision-locations" role="alert" style={{ marginTop: 8, padding: 8, border: '1px solid #fdba74', borderRadius: 5, background: '#fff7ed', color: '#7c2d12', maxWidth: '100%' }}>
    <b>저장하지 않았습니다. 업로드 행과 기존 저장본의 보존 충돌을 확인하세요.</b>
    <div style={{ overflowX: 'auto', marginTop: 6 }}>
      <table style={{ width: '100%', minWidth: hasSalePrice ? 820 : 730, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 }}>
        <thead><tr>{['호텔', '연도', '차수', '품목', '업로드 원본 위치', ...(hasSalePrice ? ['판매단가'] : []), '확인 내용'].map(label => <th key={label} style={{ ...cell, textAlign: 'left', background: '#ffedd5' }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <td style={{ ...cell, maxWidth: 160 }}>{row.hotel}</td><td style={{ ...cell, width: 62 }}>{row.orderYear}</td><td style={{ ...cell, width: 58 }}>{row.major}</td>
          <td style={{ ...cell, maxWidth: 220 }}>{row.itemName}</td><td style={{ ...cell, maxWidth: 180 }}>{row.originalSource}</td>
          {hasSalePrice ? <td style={{ ...cell, width: 92, textAlign: 'right' }}>{showSalePrice(row.salePrice)}</td> : null}
          <td style={{ ...cell, maxWidth: 300 }}>{row.confirmation}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
