import { inventoryBasisReason } from '../lib/profitReportInventoryBasis.mjs';

const number = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });
const cell = { padding: '9px 12px', borderBottom: '1px solid #dbe3ee', verticalAlign: 'top', textAlign: 'left' };
const quantityIssue = code => code === 'ambiguous_conversion' ? '입고·품목의 환산 비율이 서로 다름'
  : code === 'missing_purchase_quantity' ? '매입수량 근거 없음'
    : code === 'missing_stock_quantity' ? '재고수량 누락' : '단위 환산 근거 없음';

function BasisCell({ basis, value, confirmed, stale }) {
  if (!basis) return <><strong>{number(value)}원</strong><div>{confirmed
    ? '확정 당시 상세 평가 근거 미보관 — 현재 값으로 역산하지 않습니다.'
    : '상세 평가 근거 미제공 — 최신 조회 결과에서 확인하세요.'}</div></>;
  const unit = basis.unit || '단위 미확인';
  return <>
    <div><strong>{basis.label}</strong>{basis.estimated && <span style={{ color: '#92400e' }}> · 승인 추정 포함</span>}</div>
    <div style={{ color: '#475569' }}>{basis.year && basis.major ? `${basis.year}년 ${basis.major}차` : '확정 저장값'}{basis.week ? ` · 재고 ${basis.week}` : ''} · <strong>{number(basis.value)}원</strong></div>
    {basis.average && <>
      <div>총 도착원가 {number(basis.average.totalCost)}원 ÷ 매입 {number(basis.average.purchaseQty, 3)} {unit}</div>
      <div><b>평균 {number(basis.average.unitCost, 4)}원{basis.unit ? `/${basis.unit}` : ' (단위 미확인)'}</b> × 환산재고 {number(basis.quantity, 3)} {unit}</div>
      <div style={{ color: '#64748b' }}>총원가 = (상품 {number(basis.average.purchaseForeign)} + 포워딩 {number(basis.average.forwardingForeign)}) × 환율 {number(basis.average.taxableRate, 4)} + 통관비 {number(basis.average.customsCost)}원</div>
    </>}
    {!basis.average && basis.quantity != null && <div>{!basis.unit && basis.method === 'product_cost'
      ? '환산재고: 단위별 확인 필요'
      : `환산재고 ${number(basis.quantity, 3)}${basis.unit ? ` ${basis.unit}` : ' (단위 혼합 또는 미확인)'}`}</div>}
    {inventoryBasisReason(basis) && <div style={{ color: '#64748b' }}>{inventoryBasisReason(basis)}</div>}
    {basis.normalization && <div style={{ color: '#64748b' }}>{basis.normalization.note}
      {!basis.normalization.eligible && <span> 평균 적용 보류: {basis.normalization.reason === 'no_purchase' ? '해당 차수 매입 없음' : '수량·환산 근거 확인 필요'}.</span>}
      {basis.normalization.issues?.length > 0 && <div>확인 대상 {basis.normalization.issues.length}건:
        {basis.normalization.issues.slice(0, 3).map((issue, i) => <div key={`${issue.prodKey}-${issue.phase}-${i}`}>
          {issue.prodName || `품목 #${issue.prodKey}`} · {quantityIssue(issue.code)}
        </div>)}
      </div>}
    </div>}
    {!basis.unit && basis.average && <div style={{ color: '#92400e' }}>단위 명칭 미확인 — 박스·단·송이로 임의 표기하지 않습니다.</div>}
    {stale && <div style={{ color: '#92400e' }}>입력 편집 중: 위 재고 근거는 마지막 서버 조회 기준입니다.</div>}
  </>;
}

export default function ProfitInventoryBasis({ data, edits = {} }) {
  if (!data?.rows?.length) return null;
  return <details open id="profit-inventory-basis" data-testid="profit-inventory-basis" style={{ margin: '10px 0', scrollMarginTop: 80, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', fontSize: 13 }}>
    <summary style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 700 }}>국가·품종별 재고 평가 기준 — 평균 도착원가와 적용 예외</summary>
    <p style={{ margin: '0 12px 10px', color: '#475569', lineHeight: 1.6 }}>
      업체별 판매단가가 아닙니다. 평균식이 적용된 행은 매입·포워딩·통관비와 매입수량을 표시합니다.
      국가별 원본 방식과 단위가 달라 품목별 원가를 적용한 행은 그 사유를 구분합니다. 기초는 전차수 기준이며 수량은 SQL 재고입니다.
      {data.confirmed && ' 확정본은 저장된 금액을 유지하며 현재 계산으로 교체하지 않습니다.'}
    </p>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
        <thead><tr style={{ background: '#eff6ff' }}><th scope="col" style={cell}>국가·품종</th><th scope="col" style={cell}>기초상품재고액(E) 평가 근거</th><th scope="col" style={cell}>기말상품재고액(F) 평가 근거</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.category}>
          <th scope="row" style={{ ...cell, width: 150 }}>{row.category}</th>
          <td style={cell}><BasisCell basis={row.inventoryValuation?.begin} value={row.calc?.E ?? row.auto?.E} confirmed={data.confirmed} /></td>
          <td style={cell}><BasisCell basis={row.inventoryValuation?.end} value={row.calc?.F ?? row.auto?.F} confirmed={data.confirmed}
            stale={['H', 'R', 'S'].some(key => edits[row.category]?.[key] !== undefined)} /></td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}
