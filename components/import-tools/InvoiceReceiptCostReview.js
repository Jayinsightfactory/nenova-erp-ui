import { useEffect, useMemo, useState } from 'react';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from '../../lib/invoiceReceiptCost';
import styles from '../../styles/InvoiceReceiptCost.module.css';

const EMPTY_FORM = Object.freeze({
  formulaId: '',
  formulaVersion: '',
  formulaSourceHash: '',
  formulaSourceSheet: '',
  formulaSourceCells: '',
  formulaApplicabilityConfirmed: false,
  formulaEffectiveDate: '',
  nativeCurrency: '',
  exchangeRateKRW: '',
  exchangeRateType: '',
  exchangeRateDate: '',
  freightAmount: '',
  freightCurrency: '',
  customsTotalKRW: '',
  costSourceId: '',
  allocationScope: '',
  allocationShareNumerator: '',
  allocationShareDenominator: '',
  expected95Quantity: '',
  lineInputs: [],
});

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function committedReceiptLines(document) {
  if (Array.isArray(document?.receiptLines)) return document.receiptLines;
  const operation = (document?.operations || [])
    .filter(item => item.status === 'COMMITTED' && Number(item.documentRevision) === Number(document?.revision))
    .sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || '')))[0];
  const byLine = new Map((operation?.result?.lineMappings || []).map(mapping => [String(mapping.lineId).toLowerCase(), mapping]));
  return (document?.lines || []).map(line => {
    const mapping = byLine.get(String(line.lineId).toLowerCase());
    const mapped = (key, fallback) => mapping && Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : fallback;
    return { ...line,
      outQuantity: mapped('outQuantity', null), outUnit: mapped('unit', null), wdetailKey: mapped('wdetailKey', null),
      boxQuantity: mapped('boxQuantity', line.boxQuantity), bunchQuantity: mapped('bunchQuantity', line.bunchQuantity),
      stemQuantity: mapped('stemQuantity', line.stemQuantity), unitPrice: mapped('unitPrice', line.unitPrice),
      lineAmount: mapped('lineAmount', line.lineAmount) };
  });
}

function initialForm(document, receiptLines) {
  const saved = document?.reviewedMetadata?.invoiceCostInput || document?.reviewedMetadata?.costInput || {};
  const freight = document?.reviewedMetadata?.costInputs?.freight;
  const recognizedFreight = freight?.source === 'invoice'
    && /^[A-Z]{3}$/.test(String(freight.currency || '').trim().toUpperCase())
    && freight.amount !== null && freight.amount !== undefined && freight.amount !== ''
    && Number.isFinite(Number(freight.amount)) && Number(freight.amount) >= 0;
  const lineCurrencies = new Set(receiptLines.map(line => String(line.currency || '').trim().toUpperCase()));
  const uniformNativeCurrency = lineCurrencies.size === 1 && /^[A-Z]{3}$/.test([...lineCurrencies][0])
    ? [...lineCurrencies][0] : '';
  const verifiedFormula = INVOICE_COST_FORMULAS[saved.formulaId];
  const savedLines = new Map((saved.lineInputs || []).map(line => [String(line.lineId).toLowerCase(), line]));
  return {
    ...EMPTY_FORM,
    nativeCurrency: uniformNativeCurrency,
    ...(recognizedFreight ? {
      freightAmount: Number(freight.amount),
      freightCurrency: String(freight.currency).trim().toUpperCase(),
    } : {}),
    ...saved,
    ...(verifiedFormula ? {
      formulaVersion: verifiedFormula.formulaVersion,
      formulaSourceHash: verifiedFormula.formulaSourceHash,
      formulaSourceSheet: verifiedFormula.formulaSourceSheet,
      formulaSourceCells: verifiedFormula.formulaSourceCells,
    } : {}),
    lineInputs: receiptLines.map(line => ({
      lineId: line.lineId,
      tariffRate: savedLines.get(String(line.lineId).toLowerCase())?.tariffRate ?? '',
      otherCostPerUnitKRW: savedLines.get(String(line.lineId).toLowerCase())?.otherCostPerUnitKRW ?? '',
      stemsPerBunch: savedLines.get(String(line.lineId).toLowerCase())?.stemsPerBunch ?? '',
    })),
  };
}

function receiptStatusLabel(status) {
  return ({ DRAFT: '초안', REVIEW_REQUIRED: '검토 필요', PARTIAL: '일부 등록', COMMITTED: '입고 확정' })[status] || status || '—';
}

function documentCountry(document) {
  const value = String(document?.reviewedMetadata?.country || '').trim().toUpperCase();
  if (['CN', 'CHINA', '중국'].includes(value)) return 'CN';
  if (['NL', 'NETHERLANDS', 'HOLLAND', '네덜란드'].includes(value)) return 'NL';
  return value;
}

function payloadOf(form) {
  return {
    ...form,
    exchangeRateKRW: numberOrNull(form.exchangeRateKRW),
    freightAmount: numberOrNull(form.freightAmount),
    customsTotalKRW: numberOrNull(form.customsTotalKRW),
    allocationShareNumerator: numberOrNull(form.allocationShareNumerator),
    allocationShareDenominator: numberOrNull(form.allocationShareDenominator),
    expected95Quantity: numberOrNull(form.expected95Quantity),
    lineInputs: form.lineInputs.map(line => ({
      lineId: line.lineId,
      tariffRate: numberOrNull(line.tariffRate),
      otherCostPerUnitKRW: numberOrNull(line.otherCostPerUnitKRW),
      stemsPerBunch: numberOrNull(line.stemsPerBunch),
    })),
  };
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? styles.wideField : styles.field}><span>{label}</span>{children}</label>;
}

function money(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}원` : '—';
}

function unitLabel(value) {
  return ({ BUNCH: '단', STEM: '송이', BOX: '박스' })[value] || value || '';
}

export default function InvoiceReceiptCostReview({ document, onSaved }) {
  const receiptLines = useMemo(() => committedReceiptLines(document), [document]);
  const [form, setForm] = useState(() => initialForm(document, receiptLines));
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setForm(initialForm(document, committedReceiptLines(document)));
    setPreview(null);
    setReason('');
    setNotice(null);
  }, [document?.documentId, document?.revision]);

  if (!document) return null;

  function update(name, value) {
    setForm(current => ({ ...current, [name]: value }));
    setPreview(null);
  }

  function chooseFormula(formulaId) {
    const formula = INVOICE_COST_FORMULAS[formulaId];
    setForm(current => ({
      ...current,
      formulaId,
      formulaVersion: formula?.formulaVersion || '',
      formulaSourceHash: formula?.formulaSourceHash || '',
      formulaSourceSheet: formula?.formulaSourceSheet || '',
      formulaSourceCells: formula?.formulaSourceCells || '',
    }));
    setPreview(null);
  }

  function updateLine(lineId, name, value) {
    setForm(current => ({
      ...current,
      lineInputs: current.lineInputs.map(line => line.lineId === lineId ? { ...line, [name]: value } : line),
    }));
    setPreview(null);
  }

  function runPreview() {
    const result = previewInvoiceCost({ ...document, costInput: payloadOf(form) }, receiptLines);
    setPreview(result);
    setNotice(result.status === 'APPROVED'
      ? { type: 'success', text: '실제 입고량 기준 원가가 계산되었습니다. 저장 전 합계와 행별 근거를 확인하세요.' }
      : { type: 'error', text: '입력 검토가 필요합니다. 누락값을 0으로 대신하지 않았습니다.' });
  }

  async function save() {
    if (preview?.status !== 'APPROVED' || !reason.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/import/receipts/${encodeURIComponent(document.documentId)}/cost-revisions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: document.revision, input: payloadOf(form), reason: reason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const detail = Array.isArray(data.issues) ? ` (${data.issues.map(item => item.message).join(', ')})` : '';
        throw new Error(`${data.error || '원가 변경본을 저장하지 못했습니다.'}${detail}`);
      }
      setNotice({ type: 'success', text: data.cost?.idempotent ? '같은 승인 요청으로 저장된 원가를 확인했습니다.' : '실제 입고량 원가를 승인 저장했습니다.' });
      onSaved?.(data.cost);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  const lineResult = new Map((preview?.lines || []).map(line => [line.lineId, line]));
  const country = documentCountry(document);
  const allowedFormulaIds = country === 'CN' ? ['CN_SEA_ACTUAL_V1'] : country === 'NL' ? ['NL_AMOUNT_V1'] : [];
  const allowedFormulas = allowedFormulaIds.map(id => INVOICE_COST_FORMULAS[id]);
  const selectedFormula = INVOICE_COST_FORMULAS[form.formulaId];
  const reviewOnly = allowedFormulaIds.length === 0 || (form.formulaId && !selectedFormula);

  return <section className={styles.root} aria-label="인보이스 도착원가 검토">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>검증된 원가 계산</span><h3>실제 입고량 도착원가</h3>
        <p>승인된 두 공식만 계산합니다. 적용 확인은 이 문서에 대한 수동 검토이며 공식의 보편적 유효성을 뜻하지 않습니다. 95% 적재 예상값은 비교 전용입니다.</p></div>
      <div className={styles.status}><span>문서 버전</span><strong>{document.revision ?? '—'}</strong><span>입고 상태</span><strong>{receiptStatusLabel(document.receiptStatus)}</strong></div>
    </header>

    {notice && <p className={notice.type === 'error' ? styles.error : styles.success} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {reviewOnly && <p className={styles.reviewOnly} role="status">이 국가 또는 저장된 공식은 아직 승인 계산을 지원하지 않습니다. 원문과 입력값은 검토할 수 있지만 원가는 승인 저장되지 않습니다.</p>}

    <div className={styles.formGrid}>
      <Field label="검증 공식"><select value={form.formulaId} onChange={event => chooseFormula(event.target.value)} disabled={allowedFormulas.length === 0}>
        <option value="">공식을 선택하세요</option>
        {form.formulaId && !selectedFormula && <option value={form.formulaId}>미지원 공식 · 검토 전용</option>}
        {allowedFormulas.map(formula => <option key={formula.formulaId} value={formula.formulaId}>{formula.label}</option>)}
      </select></Field>
      <Field label="매입 통화"><input maxLength={3} value={form.nativeCurrency} onChange={event => update('nativeCurrency', event.target.value.toUpperCase())} placeholder="CNY / EUR 등" /></Field>
      <Field label="운임 통화"><input maxLength={3} value={form.freightCurrency} onChange={event => update('freightCurrency', event.target.value.toUpperCase())} placeholder="명시 입력" /></Field>
      <Field label="환율 (원/통화)"><input type="number" step="0.000001" value={form.exchangeRateKRW} onChange={event => update('exchangeRateKRW', event.target.value)} /></Field>
      <Field label="환율 종류"><input value={form.exchangeRateType} onChange={event => update('exchangeRateType', event.target.value)} placeholder="매입/신고 등" /></Field>
      <Field label="환율 기준일"><input type="date" value={form.exchangeRateDate} onChange={event => update('exchangeRateDate', event.target.value)} /></Field>
      <Field label="운임 원금"><input type="number" step="0.000001" min="0" value={form.freightAmount} onChange={event => update('freightAmount', event.target.value)} /></Field>
      <Field label="통관비 합계 (KRW)"><input type="number" step="0.000001" min="0" value={form.customsTotalKRW} onChange={event => update('customsTotalKRW', event.target.value)} placeholder="NL 공식 필수" /></Field>
      <Field label="비용 원천 식별값" wide><input value={form.costSourceId} onChange={event => update('costSourceId', event.target.value)} placeholder="공급자 + 전표번호 + 비용항목 + 통화" /></Field>
      <Field label="비용 배분 범위"><select value={form.allocationScope} onChange={event => update('allocationScope', event.target.value)}><option value="">범위를 선택하세요</option><option value="SINGLE_INVOICE">이 인보이스에만 배분</option><option value="SHARED">여러 인보이스 공동 비용 · 저장 불가</option></select></Field>
      <Field label="이 문서 배분 몫"><span className={styles.share}><input aria-label="배분 분자" type="number" step="0.000001" min="0" value={form.allocationShareNumerator} onChange={event => update('allocationShareNumerator', event.target.value)} /><b>/</b><input aria-label="배분 분모" type="number" step="0.000001" min="0.000001" value={form.allocationShareDenominator} onChange={event => update('allocationShareDenominator', event.target.value)} /></span></Field>
      {form.formulaId === 'CN_SEA_ACTUAL_V1' && <Field label="95% 예상수량 (비교 전용)"><input type="number" step="0.000001" min="0" value={form.expected95Quantity} onChange={event => update('expected95Quantity', event.target.value)} /></Field>}
      <Field label={`공식 적용일 (입고일 ${document.reviewedMetadata?.inputDate || '미확인'})`}><input type="date" value={form.formulaEffectiveDate} onChange={event => update('formulaEffectiveDate', event.target.value)} /></Field>
    </div>

    <label className={styles.confirmation}><input type="checkbox" checked={form.formulaApplicabilityConfirmed === true}
      onChange={event => update('formulaApplicabilityConfirmed', event.target.checked)} />
      <span>이 입고일·운송·품목에 해당 원본 계산식 적용을 확인했습니다</span></label>

    <details className={styles.evidence}>
      <summary>검증된 계산 근거 보기</summary>
      <dl><div><dt>공식 버전</dt><dd>{form.formulaVersion || '공식 선택 필요'}</dd></div>
        <div><dt>원본 시트</dt><dd>{form.formulaSourceSheet || '공식 선택 필요'}</dd></div>
        <div><dt>검증 셀</dt><dd>{form.formulaSourceCells || '공식 선택 필요'}</dd></div>
        <div><dt>원본 SHA-256</dt><dd><code>{form.formulaSourceHash || '공식 선택 필요'}</code></dd></div></dl>
    </details>

    <div className={styles.tableRegion} role="region" aria-label="행별 원가 입력과 결과" tabIndex={0}>
      <table className={styles.table}><thead><tr><th>행</th><th>원문 품목</th><th>실제량</th><th>원문 금액/통화</th><th>관세율</th><th>기타비/단위</th><th>단당 송이</th><th>실제 원가</th></tr></thead>
        <tbody>{receiptLines.map((line, index) => {
          const lineInput = form.lineInputs.find(item => item.lineId === line.lineId) || {};
          const result = lineResult.get(String(line.lineId).toLowerCase());
          return <tr key={line.lineId || index}><td>{line.lineNo ?? index + 1}</td><td className={styles.productCell}><strong>{line.originalName || '품목명 없음'}</strong><small>{line.lengthText || ''}{line.prodKey ? `${line.lengthText ? ' · ' : ''}전산 품목 ${line.prodKey}` : ''}</small></td><td>{line.outQuantity ?? '—'} {line.outUnit || ''}</td><td>{line.lineAmount ?? '—'} {line.currency || '통화 없음'}</td>
            <td><input aria-label={`${index + 1}행 관세율`} type="number" min="0" max="1" step="0.000001" value={lineInput.tariffRate ?? ''} onChange={event => updateLine(line.lineId, 'tariffRate', event.target.value)} /></td>
            <td><input aria-label={`${index + 1}행 기타비`} type="number" min="0" step="0.000001" value={lineInput.otherCostPerUnitKRW ?? ''} onChange={event => updateLine(line.lineId, 'otherCostPerUnitKRW', event.target.value)} disabled={form.formulaId === 'NL_AMOUNT_V1'} /></td>
            <td><input aria-label={`${index + 1}행 단당 송이`} type="number" min="0" step="0.000001" value={lineInput.stemsPerBunch ?? ''} onChange={event => updateLine(line.lineId, 'stemsPerBunch', event.target.value)} disabled={form.formulaId !== 'NL_AMOUNT_V1'} /></td>
            <td>{result ? result.quantity === 0
              ? <><strong>취소행</strong><small>단위원가 미산정 · 합계 {money(result.totalCostKRW)}</small></>
              : <><strong>{money(result.costPerUnitKRW)}</strong><small>{unitLabel(result.unit)} · 합계 {money(result.totalCostKRW)}</small></> : '—'}</td></tr>;
        })}</tbody></table>
    </div>

    <div className={styles.actions}>
      <button type="button" onClick={runPreview} disabled={busy}>입력값으로 미리보기</button>
      <label><span>승인 사유</span><input value={reason} onChange={event => setReason(event.target.value)} placeholder="검토 근거를 입력하세요" /></label>
      <button type="button" className={styles.primary} onClick={save} disabled={busy || preview?.status !== 'APPROVED' || !reason.trim()}>{busy ? '저장 중…' : '원가 승인 저장'}</button>
    </div>

    {preview && <section className={styles.result} aria-live="polite">
      <header><strong>{preview.status === 'APPROVED' ? '계산 승인 가능' : '검토 필요'}</strong><span>실제 입고량 기준 합계 {money(preview.totals?.totalCostKRW)}</span></header>
      {preview.issues.length > 0 && <ul>{preview.issues.map((item, index) => <li key={`${item.code}-${item.lineId || index}`} className={item.severity === 'warning' ? styles.warning : styles.issue}>{item.message}</li>)}</ul>}
      {preview.expected95 && <div className={styles.comparison}><strong>95% 예상 비교</strong><span>{preview.expected95.quantity} {preview.expected95.unit} 기준</span><span>실제 원가를 대체하지 않음</span></div>}
      <p>{preview.note}</p>
    </section>}
  </section>;
}
