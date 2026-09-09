import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '-';
}

export default function EstimateOverflowPreview({ preview, busy = false, error = '', onConfirm, onCancel }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || !preview || typeof document === 'undefined') return null;
  const rows = Array.isArray(preview.rows) ? preview.rows : [];

  return createPortal(
    <div role="presentation" style={styles.overlay} onClick={() => !busy && onCancel?.()}>
      <section data-estimate-overflow-dialog="1" role="dialog" aria-modal="true" aria-labelledby="estimate-overflow-title" style={styles.dialog} onClick={event => event.stopPropagation()}>
        <header style={styles.header}>
          <div>
            <h2 id="estimate-overflow-title" style={styles.title}>다음 세부차수 수량 배정 확인</h2>
            <div style={styles.subtitle}>현재 차수 가용량을 넘는 증가분만 다음 세부차수 기본 출고일에 배정합니다.</div>
          </div>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel} aria-label="닫기">✕</button>
        </header>

        <div style={styles.body}>
          <div style={styles.notice}>
            기존 현재·다음 차수 수량과 다른 출고일은 보존됩니다. 아래 신규 표시는 새 출고를 생성하고 즉시 확정하는 작업입니다.
          </div>
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['품목', '전체 요청', '현재 차수', '현재 기존 → 적용', '현재 +증가', '다음 차수', '다음 +증가', '기본 출고일', '단가', '처리'].map(label => (
                    <th key={label} style={styles.th}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.sdateKey}-${row.prodKey}-${index}`}>
                    <td style={styles.productCell}><strong>{row.prodName || `품목 ${row.prodKey}`}</strong><small style={styles.small}>{row.unit || ''}</small></td>
                    <td style={styles.numberCell}>{number(row.requestedQuantity)}</td>
                    <td style={styles.td}>{row.fromWeek}</td>
                    <td style={styles.numberCell}>{number(row.oldQuantity)} → {number(row.currentQuantity)}</td>
                    <td style={styles.numberCell}>+{number(row.currentIncrease)}</td>
                    <td style={styles.td}>{row.toWeek}</td>
                    <td style={styles.numberCell}>+{number(row.nextIncrease)}</td>
                    <td style={styles.td}>{row.shipmentDate || '-'}</td>
                    <td style={styles.numberCell}>₩{number(row.cost)}</td>
                    <td style={styles.td}>{row.newShipment ? <strong style={styles.newShipment}>신규 출고 생성·확정</strong> : '기존 출고 증가'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div role="alert" style={styles.error}>{error}</div>}
        </div>

        <footer style={styles.footer}>
          <span style={styles.footerHint}>적용을 누르기 전에는 ERP 원장이 변경되지 않습니다.</span>
          <button data-estimate-overflow-cancel="1" type="button" className="btn" disabled={busy} onClick={onCancel}>취소</button>
          <button data-estimate-overflow-confirm="1" type="button" className="btn btn-primary" disabled={busy || rows.length === 0} onClick={onConfirm}>
            {busy ? '적용 중…' : `확인 후 적용 (${rows.length}건)`}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(15, 23, 42, .58)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  dialog: {
    width: 'min(1500px, 96vw)', maxHeight: '92vh', minWidth: 0, background: '#fff', borderRadius: 10,
    boxShadow: '0 24px 64px rgba(15,23,42,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '16px 18px', borderBottom: '1px solid #e2e8f0' },
  title: { margin: 0, fontSize: 18, color: '#0f172a' },
  subtitle: { marginTop: 5, fontSize: 12, color: '#475569' },
  body: { minHeight: 0, overflowY: 'auto', padding: 18 },
  notice: { padding: '10px 12px', marginBottom: 12, border: '1px solid #f59e0b', borderRadius: 6, background: '#fffbeb', color: '#78350f', fontSize: 12 },
  tableScroll: { width: '100%', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 6 },
  table: { width: '100%', minWidth: 1080, borderCollapse: 'collapse', fontSize: 12 },
  th: { position: 'sticky', top: 0, zIndex: 1, padding: '8px 9px', borderBottom: '1px solid #94a3b8', background: '#f1f5f9', color: '#334155', textAlign: 'center', whiteSpace: 'nowrap' },
  td: { padding: '8px 9px', borderBottom: '1px solid #e2e8f0', textAlign: 'center', whiteSpace: 'nowrap' },
  productCell: { padding: '8px 9px', borderBottom: '1px solid #e2e8f0', minWidth: 190 },
  numberCell: { padding: '8px 9px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  small: { display: 'block', marginTop: 2, color: '#64748b', fontWeight: 400 },
  newShipment: { color: '#b45309', whiteSpace: 'normal' },
  error: { marginTop: 12, padding: 10, border: '1px solid #fca5a5', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', fontSize: 12 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' },
  footerHint: { flex: '1 1 320px', fontSize: 11, color: '#64748b' },
};
