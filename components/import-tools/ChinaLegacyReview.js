import React, { useMemo, useState } from 'react';

const numberInput = { width: 88, padding: '6px 8px', boxSizing: 'border-box' };
const cell = { padding: '7px 8px', borderBottom: '1px solid #dce4ef', textAlign: 'left', verticalAlign: 'top' };

const rawUnit = product => product.raw_unit ?? product.raw_qty_unit ?? product.raw_quantity_unit
  ?? product.source_quantity_unit ?? product.quantity_unit ?? null;
const specOf = product => product.source_unit_spec ?? product.unit_spec_raw ?? product.specification ?? '';
const rowKey = (invoice, product) => `${invoice.source_sheet || ''}:${product.source_sheet || ''}:${product.source_row}`;
const unitIsBunch = value => value == null || /^(?:단|bunch|bunches)$/i.test(String(value).trim());

/** Source-preserving confirmation UI; all quantities used for promotion are explicit. */
export default function ChinaLegacyReview({ data, onConfirm, resolveLegacyChinaInvoice }) {
  const invoices = useMemo(() => Array.isArray(data?.invoices) ? data.invoices : [], [data]);
  const [draft, setDraft] = useState({ rows: {}, currency: '', currencyReason: '', currencyConfirmed: false,
    invoiceConfirmed: false, comparisonConfirmed: false, error: '' });
  const updateRow = (key, field, value) => setDraft(current => ({
    ...current, error: '', rows: { ...current.rows, [key]: { ...(current.rows[key] || {}), [field]: value } },
  }));
  const hasConflict = invoices.some(invoice => invoice.packing_comparison_status === 'CL_CONFLICT_REVIEW_REQUIRED'
    || invoice.review_states?.includes('CL_CONFLICT_REVIEW_REQUIRED'));
  const arithmeticUnverified = invoices.some(invoice => invoice.arithmetic_verified !== true);
  const unsupported = invoices.flatMap(invoice => (invoice.products || [])
    .filter(product => !unitIsBunch(rawUnit(product)))
    .map(product => `${product.source_sheet || invoice.source_sheet || 'Invoice'} row ${product.source_row}: 원문 수량 단위가 ‘단’이 아닙니다 (${rawUnit(product)}).`));

  const submit = () => {
    try {
      if (typeof resolveLegacyChinaInvoice !== 'function') throw new Error('안전한 구형 중국 인보이스 변환 도우미를 사용할 수 없습니다.');
      if (!invoices.length || invoices.some(invoice => !Array.isArray(invoice.products) || !invoice.products.length)) {
        throw new Error('확인할 원본 인보이스 또는 품목 행이 없습니다.');
      }
      if (arithmeticUnverified) throw new Error('원본 인보이스 arithmetic_verified 검증이 완료되지 않아 승격할 수 없습니다.');
      if (!/^[A-Z]{3}$/.test(String(draft.currency).trim())) throw new Error('통화 코드를 ISO 4217 대문자 3자로 입력하세요.');
      if (!draft.currencyReason.trim()) throw new Error('원문에서 통화를 확인한 근거를 입력하세요.');
      if (!draft.currencyConfirmed || !draft.invoiceConfirmed) throw new Error('통화와 인보이스 기준을 각각 확인하세요.');
      if (hasConflict && !draft.comparisonConfirmed) throw new Error('CL 비교표와 충돌합니다. Invoice를 기준으로 사용하고 CL 합계를 사용하지 않는다고 확인하세요.');
      if (unsupported.length) throw new Error(unsupported.join(' '));

      const promoted = invoices.map(invoice => {
        const rows = invoice.products.map(product => {
          const key = rowKey(invoice, product);
          const answer = draft.rows[key] || {};
          return {
            source_sheet: product.source_sheet ?? invoice.source_sheet ?? null,
            source_row: product.source_row,
            raw_qty: product.raw_qty,
            u_price: product.u_price ?? product.unitPrice,
            t_price: product.t_price ?? product.printed_amount,
            source_unit_spec: specOf(product) || null,
            raw_unit: '단',
            pcs: answer.pcs === '' || answer.pcs == null ? null : Number(answer.pcs),
            total_stems: answer.total_stems === '' || answer.total_stems == null ? null : Number(answer.total_stems),
            reason: answer.reason || '',
            confirmed: answer.confirmed === true,
          };
        });
        return resolveLegacyChinaInvoice(invoice, {
          currency: { code: String(draft.currency).trim(), reason: draft.currencyReason.trim(), confirmed: draft.currencyConfirmed },
          rows,
          invoiceConfirmed: draft.invoiceConfirmed,
          comparisonConfirmed: hasConflict ? draft.comparisonConfirmed : true,
        });
      });
      onConfirm({ invoices: promoted });
    } catch (error) {
      setDraft(current => ({ ...current, error: error?.message || '확인값을 검토하세요.' }));
    }
  };

  return <section aria-label="중국 구형 인보이스 단위·통화 검토" style={{ marginTop: 12, padding: 14,
    border: '1px solid #d9a441', borderRadius: 8, background: '#fffaf0', color: '#172b4d' }}>
    <h3 style={{ margin: '0 0 8px' }}>중국 구형 인보이스 검토 · 원문값은 수정하지 않습니다</h3>
    <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>
      원문 수량(raw_qty)이 ‘단’이라는 확인은 명시적으로 필요합니다. 박스 수(PCS)와 전체 송이(total stems)는 각 행마다 직접 입력합니다.
      규격 문자열만으로 수량을 추정하지 않으며, 단위가 다르거나 출처 행이 불완전하면 변환할 수 없습니다.
    </p>
    <p style={{ margin: '0 0 10px', fontSize: 13 }}>
      원본 통화: {invoices.map(invoice => invoice.currency || '미인쇄/미확인').join(' · ')} · 산술 검증: {arithmeticUnverified ? '미완료 — 승격 차단' : '완료'}
      {hasConflict && <> · CL 비교표 충돌 있음 (CL 합계는 사용하지 않음)</>}
    </p>
    {unsupported.length > 0 && <p role="alert" style={{ color: '#a22', fontWeight: 600 }}>{unsupported.join(' ')}</p>}
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table style={{ width: '100%', minWidth: 1050, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>{['시트/행', '원문 품명', '원문 수량 · 단 확인', '원문 규격', '단가', '인쇄 금액', '박스 PCS 입력', '전체 송이 입력', '행 확인 근거/확인'].map(label =>
          <th key={label} scope="col" style={{ ...cell, background: '#f3f6fa', position: 'sticky', top: 0 }}>{label}</th>)}</tr></thead>
        <tbody>{invoices.flatMap(invoice => (invoice.products || []).map(product => {
          const key = rowKey(invoice, product); const answer = draft.rows[key] || {};
          const sourceName = [product.name_zh, product.name_en, product.description].filter(Boolean).join(' / ');
          const blocked = !unitIsBunch(rawUnit(product));
          return <tr key={key}>
            <td style={cell}>{product.source_sheet || invoice.source_sheet || 'Invoice'} · {product.source_row}</td>
            <td style={cell}>{sourceName || '—'}</td>
            <td style={cell}><strong>{product.raw_qty ?? '—'}</strong><div><label><input type="checkbox" checked={answer.confirmed === true} disabled={blocked}
              onChange={event => updateRow(key, 'confirmed', event.target.checked)} /> 원문 수량이 단</label></div>
              <small>total_bunch: {answer.confirmed === true ? product.raw_qty : '단 확인 후 원문 수량 사용'}</small></td>
            <td style={cell}>{specOf(product) || '—'}</td>
            <td style={cell}>{product.unitPrice ?? product.u_price ?? '—'}</td>
            <td style={cell}>{product.printed_amount ?? product.t_price ?? '—'}</td>
            <td style={cell}><input aria-label={`${product.source_row}행 박스 PCS`} type="number" min="1" step="1" value={answer.pcs ?? ''}
              onChange={event => updateRow(key, 'pcs', event.target.value)} style={numberInput} disabled={blocked} /></td>
            <td style={cell}><input aria-label={`${product.source_row}행 전체 송이`} type="number" min="1" step="1" value={answer.total_stems ?? ''}
              onChange={event => updateRow(key, 'total_stems', event.target.value)} style={numberInput} disabled={blocked} /></td>
            <td style={cell}><input aria-label={`${product.source_row}행 확인 근거`} type="text" value={answer.reason ?? ''}
              onChange={event => updateRow(key, 'reason', event.target.value)} placeholder="원문·확인 근거" style={{ ...numberInput, width: 180 }} disabled={blocked} /></td>
          </tr>;
        }))}</tbody>
      </table>
    </div>
    <section aria-label="인보이스 통화와 기준 확인" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
      <label>통화 코드 (ISO 4217)<br /><input aria-label="통화 코드" value={draft.currency} maxLength={3}
        onChange={event => setDraft(current => ({ ...current, currency: event.target.value.toUpperCase(), currencyConfirmed: false, error: '' }))} /></label>
      <label style={{ flex: '1 1 260px' }}>통화 원문 근거<br /><input aria-label="통화 원문 근거" value={draft.currencyReason}
        onChange={event => setDraft(current => ({ ...current, currencyReason: event.target.value, currencyConfirmed: false, error: '' }))} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
      <label><input type="checkbox" checked={draft.currencyConfirmed} onChange={event => setDraft(current => ({ ...current, currencyConfirmed: event.target.checked, error: '' }))} /> 통화와 근거 확인</label>
    </section>
    <div style={{ marginTop: 10 }}><label><input type="checkbox" checked={draft.invoiceConfirmed}
      onChange={event => setDraft(current => ({ ...current, invoiceConfirmed: event.target.checked, error: '' }))} /> Invoice 원문을 기준으로 확인 (CL 시트 값을 품목 합계에 더하지 않음)</label></div>
    {hasConflict && <div style={{ marginTop: 8, color: '#9a3412' }}><strong>CL 비교표 충돌:</strong> CL은 비교 전용이며 Invoice 합계를 기준으로 합니다.{' '}
      <label><input type="checkbox" checked={draft.comparisonConfirmed} onChange={event => setDraft(current => ({ ...current, comparisonConfirmed: event.target.checked, error: '' }))} /> 이 기준을 명시적으로 확인</label></div>}
    {draft.error && <p role="alert" style={{ color: '#b42318', marginBottom: 0 }}>{draft.error}</p>}
    <button type="button" onClick={submit} disabled={unsupported.length > 0 || arithmeticUnverified}
      style={{ marginTop: 12, padding: '8px 14px', border: '1px solid #2457c5', borderRadius: 6, color: '#fff', background: unsupported.length || arithmeticUnverified ? '#999' : '#2457c5', cursor: unsupported.length || arithmeticUnverified ? 'not-allowed' : 'pointer' }}>
      확인한 구형 인보이스 값 적용
    </button>
  </section>;
}
