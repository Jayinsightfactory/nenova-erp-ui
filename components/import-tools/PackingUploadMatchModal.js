import React, { useEffect, useMemo, useState } from 'react';
import styles from '../../styles/PackingUploadMatchModal.module.css';
import {
  farmChoiceOptionKey,
  parseFarmChoiceOptionKey,
} from '../../lib/packingUploadMatchPrompt.js';
const text = value => String(value ?? '').normalize('NFKC').trim();
function normalizePackingAbbr(value) {
  const cleaned = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!/^[A-Z0-9]{3}$/.test(cleaned) || cleaned === 'UNK') return '';
  return cleaned;
}
const parseNum = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
};

export function PackingUploadMatchAlertBanner({ needs, onOpen, disabled = false }) {
  if (!needs || needs.totalCount <= 0) return null;
  const parts = [];
  if (needs.unmatchedFarms.length > 0) parts.push(`농장 미매칭 ${needs.unmatchedFarms.length}건`);
  if (needs.unmatchedProducts.length > 0) parts.push(`품목 매칭 확인 ${needs.unmatchedProducts.length}건`);
  if (needs.quantityIssues.length > 0) parts.push(`박스·송이·합계 대조 ${needs.quantityIssues.length}건`);

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="packing-matching-alert"
      className={styles.alertBanner}
    >
      <div className={styles.alertBody}>
        <span className={styles.purposeTag}>[핵심 목적 · PURPOSE] 입고 업로드 전 미매칭·수량 즉시 해결</span>
        <div className={styles.alertTitle}>
          입고 매칭 알림 · 확인 필요 {needs.totalCount}건 ({parts.join(' · ')})
        </div>
        <p className={styles.alertDesc}>
          한 화면에서 농장·품목 연결과 박스·송이·합계 대조를 저장하면 현재 패킹·입고 초안에 즉시 반영되고 다음 업로드부터 자동 매칭됩니다.
        </p>
      </div>
      <button
        type="button"
        data-testid="packing-matching-alert-open"
        className={styles.alertActionBtn}
        disabled={disabled}
        onClick={onOpen}
      >
        원스톱 매칭 창 열기 ({needs.totalCount}건)
      </button>
    </div>
  );
}

export default function PackingUploadMatchModal({
  open,
  needs,
  country,
  products = [],
  farms = [],
  saving = false,
  error = '',
  onSave,
  onClose,
}) {
  const [farmDrafts, setFarmDrafts] = useState({});
  const [farmSearches, setFarmSearches] = useState({});
  const [productDrafts, setProductDrafts] = useState({});
  const [productSearches, setProductSearches] = useState({});
  const [rowEdits, setRowEdits] = useState({});
  const [invoiceEdits, setInvoiceEdits] = useState({});
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open || !needs) return;
    setLocalError('');
    setFarmDrafts(prev => {
      const next = {};
      for (const item of needs.unmatchedFarms) {
        next[item.supplierKey] = prev[item.supplierKey] || {
          optionKey: item.defaultOptionKey || '',
          packingAbbr: item.defaultPackingAbbr || '',
          packingShort: item.defaultPackingShort || '',
          coRegion: item.defaultCoRegion || 'ANTIOQUIA',
        };
      }
      return next;
    });
    setProductDrafts(prev => {
      const next = {};
      for (const item of needs.unmatchedProducts) {
        next[item.sourceKey] = prev[item.sourceKey] !== undefined
          ? prev[item.sourceKey]
          : (item.defaultProdKey || '');
      }
      return next;
    });
    setRowEdits(prev => {
      const next = {};
      for (const issue of needs.quantityIssues) {
        if (issue.kind !== 'ROW') continue;
        next[issue.id] = prev[issue.id] || {
          pcs: issue.fields.pcs,
          steam_box: issue.fields.steam_box,
          total_stems: issue.fields.total_stems,
          u_price: issue.fields.u_price,
          t_price: issue.fields.t_price,
          reason: '인보이스 원문 대조 확인',
        };
      }
      return next;
    });
    setInvoiceEdits(prev => {
      const next = {};
      for (const issue of needs.quantityIssues) {
        if (issue.kind !== 'INVOICE_TOTAL') continue;
        next[issue.id] = prev[issue.id] || {
          freight: issue.fields.freight,
          invoice_total: issue.fields.invoice_total,
          reason: '인보이스 총액·부대비 원문 대조 확인',
        };
      }
      return next;
    });
  }, [open, needs]);

  const selectableCountryProducts = useMemo(
    () => (Array.isArray(products) ? products : []).filter(p => p && p.selectable !== false && String(p.country).toUpperCase() === String(country).toUpperCase()),
    [products, country],
  );

  const activeCountryFarms = useMemo(() => {
    const countryKrMap = { CO: '콜롬비아', NL: '네덜란드', CN: '중국', EC: '에콰도르', TH: '태국', AU: '호주', US: '미국', VN: '베트남', NZ: '뉴질랜드' };
    const kr = countryKrMap[String(country).toUpperCase()] || '';
    return (Array.isArray(farms) ? farms : []).filter(f => !f?.isDeleted && (!kr || !f.CounName || f.CounName === kr));
  }, [farms, country]);

  if (!open || !needs || needs.totalCount <= 0) return null;

  const selectedFarmCount = needs.unmatchedFarms.filter(item => {
    const draft = farmDrafts[item.supplierKey];
    if (!draft?.optionKey) return false;
    if (country === 'CO' && !normalizePackingAbbr(draft.packingAbbr)) return false;
    return true;
  }).length;

  const selectedProductCount = needs.unmatchedProducts.filter(item => {
    const prodKey = Number(productDrafts[item.sourceKey]);
    return Number.isSafeInteger(prodKey) && prodKey > 0;
  }).length;

  const handleSubmit = async event => {
    event.preventDefault();
    setLocalError('');

    const farmEntries = [];
    for (const item of needs.unmatchedFarms) {
      const draft = farmDrafts[item.supplierKey];
      if (!draft?.optionKey) continue;
      const parsed = parseFarmChoiceOptionKey(draft.optionKey);
      if (!parsed) {
        setLocalError(`"${item.supplier}" 농장의 전산 연결 대상을 다시 선택하세요.`);
        return;
      }
      if (country === 'CO' && !normalizePackingAbbr(draft.packingAbbr)) {
        setLocalError(`"${item.supplier}" 농장의 콜롬비아 패킹 약어(영문/숫자 3자, UNK 제외)를 입력하세요.`);
        return;
      }
      farmEntries.push({
        country,
        supplier: item.supplier,
        farmKey: parsed.farmKey,
        farmSourceWarehouseKey: parsed.farmSourceWarehouseKey,
        packingAbbr: country === 'CO' ? normalizePackingAbbr(draft.packingAbbr) : null,
        packingShort: country === 'CO' ? text(draft.packingShort || item.defaultPackingShort || item.supplier) : null,
        coRegion: country === 'CO' ? (draft.coRegion === 'BOGOTA' ? 'BOGOTA' : 'ANTIOQUIA') : null,
      });
    }

    const productEntries = [];
    for (const item of needs.unmatchedProducts) {
      const prodKey = Number(productDrafts[item.sourceKey]);
      if (!Number.isSafeInteger(prodKey) || prodKey <= 0) continue;
      productEntries.push({
        country,
        description: item.description,
        prodKey,
      });
    }

    if (!farmEntries.length && !productEntries.length && !needs.quantityIssues.length) {
      setLocalError('저장할 농장·품목 매칭을 하나 이상 선택하세요.');
      return;
    }

    await onSave({
      farmEntries,
      productEntries,
      rowEdits,
      invoiceEdits,
    });
  };

  return (
    <div
      className={styles.backdrop}
      onKeyDown={event => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="packing-upload-match-title"
        data-testid="packing-upload-match-modal"
        className={styles.dialog}
        onSubmit={handleSubmit}
      >
        <header className={styles.header}>
          <div>
            <span className={styles.purposeTag}>[핵심 목적 · PURPOSE] 미매칭 농장·품목 연결 및 박스·송이·합계 오류 즉시 차단</span>
            <h2 id="packing-upload-match-title" className={styles.headerTitle}>
              입고 업로드 매칭 확인 ({needs.totalCount}건)
            </h2>
            <p className={styles.headerSub}>
              인보이스 원문과 전산 농장·품목·수량을 나란히 대조해 저장합니다. 저장한 농장·품목 매칭은 팀 공용 저장소에 기록되어 다음 업로드부터 자동으로 연결됩니다.
            </p>
            <div className={styles.summaryPills}>
              {needs.unmatchedFarms.length > 0 && (
                <span className={`${styles.pill} ${selectedFarmCount === needs.unmatchedFarms.length ? styles.pillOk : styles.pillWarn}`}>
                  농장 매칭 {selectedFarmCount}/{needs.unmatchedFarms.length}건 선택
                </span>
              )}
              {needs.unmatchedProducts.length > 0 && (
                <span className={`${styles.pill} ${selectedProductCount === needs.unmatchedProducts.length ? styles.pillOk : styles.pillWarn}`}>
                  품목 매칭 {selectedProductCount}/{needs.unmatchedProducts.length}건 선택
                </span>
              )}
              {needs.quantityIssues.length > 0 && (
                <span className={`${styles.pill} ${styles.pillDanger}`}>
                  박스·송이·합계 확인 {needs.quantityIssues.length}건
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            data-testid="packing-match-modal-later"
            className={styles.secondaryBtn}
            disabled={saving}
            onClick={onClose}
          >
            닫기 · 표에서 개별 확인
          </button>
        </header>

        <div className={styles.body}>
          {(localError || error) && (
            <div role="alert" className={styles.errorBox}>
              {localError || error}
            </div>
          )}

          {needs.unmatchedFarms.length > 0 && (
            <section className={styles.section} aria-label="농장 매칭 목록">
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>1. 농장 매칭 ({needs.unmatchedFarms.length}건)</h3>
                <span className={styles.sectionHint}>인보이스 공급처 원문을 전산 농장(또는 기존 입고 이력 농장)과 연결합니다.</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th>인보이스 원문 농장 · 송장</th>
                      <th>전산 농장 연결 (추천 후보 클릭 또는 검색)</th>
                      {country === 'CO' && <th>콜롬비아 패킹 약어 · 양식</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {needs.unmatchedFarms.map(item => {
                      const draft = farmDrafts[item.supplierKey] || {};
                      const q = text(farmSearches[item.supplierKey] || '').toLowerCase();
                      const filteredFarms = q
                        ? activeCountryFarms.filter(f => String(f.FarmName || '').toLowerCase().includes(q)).slice(0, 40)
                        : activeCountryFarms.slice(0, 40);

                      return (
                        <tr key={item.supplierKey} data-testid="upload-match-farm-row">
                          <td style={{ minWidth: 230 }}>
                            <div className={styles.sourcePrimary}>{item.supplier}</div>
                            <div className={styles.sourceMeta}>
                              송장 {item.invoices.join(', ') || '-'} · {item.reasonLabel}
                            </div>
                          </td>
                          <td style={{ minWidth: 360 }}>
                            {item.candidates.length > 0 && (
                              <div className={styles.chipRow}>
                                {item.candidates.slice(0, 4).map(cand => {
                                  const optKey = farmChoiceOptionKey(cand);
                                  const selected = draft.optionKey === optKey;
                                  return (
                                    <button
                                      key={optKey}
                                      type="button"
                                      aria-pressed={selected}
                                      className={`${styles.candidateChip} ${selected ? styles.candidateChipSelected : ''}`}
                                      disabled={saving}
                                      onClick={() => setFarmDrafts(prev => ({
                                        ...prev,
                                        [item.supplierKey]: { ...draft, optionKey: optKey },
                                      }))}
                                    >
                                      <span>{cand.FarmName}</span>
                                      <span className={styles.chipScore}>
                                        {cand.FarmKey ? '마스터' : `입고이력 ${Number(cand.UsageCount || 0)}회`}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className={styles.searchRow}>
                              <input
                                type="search"
                                className={styles.input}
                                placeholder="농장명 검색"
                                aria-label={`${item.supplier} 농장 검색`}
                                value={farmSearches[item.supplierKey] || ''}
                                disabled={saving}
                                onChange={e => setFarmSearches(prev => ({ ...prev, [item.supplierKey]: e.target.value }))}
                                style={{ width: 170 }}
                              />
                              <select
                                className={styles.select}
                                aria-label={`${item.supplier} 전산 농장 선택`}
                                value={draft.optionKey || ''}
                                disabled={saving}
                                onChange={e => setFarmDrafts(prev => ({
                                  ...prev,
                                  [item.supplierKey]: { ...draft, optionKey: e.target.value },
                                }))}
                                style={{ minWidth: 240, flex: 1 }}
                              >
                                <option value="">-- 전산 농장 선택 --</option>
                                {filteredFarms.map(f => {
                                  const optKey = farmChoiceOptionKey(f);
                                  return (
                                    <option key={optKey} value={optKey}>
                                      {f.FarmName} ({f.FarmKey ? `마스터 #${f.FarmKey}` : `입고이력 ${Number(f.UsageCount || 0)}회`})
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </td>
                          {country === 'CO' && (
                            <td style={{ minWidth: 250 }}>
                              <div className={styles.coConfigGrid}>
                                <label className={styles.fieldLabel}>
                                  파일 약어(3자)
                                  <input
                                    type="text"
                                    maxLength={3}
                                    aria-label={`${item.supplier} 패킹 약어`}
                                    className={`${styles.input} ${styles.abbrInput}`}
                                    value={draft.packingAbbr || ''}
                                    disabled={saving}
                                    onChange={e => setFarmDrafts(prev => ({
                                      ...prev,
                                      [item.supplierKey]: { ...draft, packingAbbr: e.target.value.toUpperCase() },
                                    }))}
                                  />
                                </label>
                                <label className={styles.fieldLabel}>
                                  패킹 양식
                                  <select
                                    aria-label={`${item.supplier} 패킹 양식`}
                                    className={styles.select}
                                    value={draft.coRegion || 'ANTIOQUIA'}
                                    disabled={saving}
                                    onChange={e => setFarmDrafts(prev => ({
                                      ...prev,
                                      [item.supplierKey]: { ...draft, coRegion: e.target.value },
                                    }))}
                                  >
                                    <option value="ANTIOQUIA">안티오키아 수국 (CO-수국)</option>
                                    <option value="BOGOTA">보고타 일반 (BOG CO)</option>
                                  </select>
                                </label>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {needs.unmatchedProducts.length > 0 && (
            <section className={styles.section} aria-label="품목 매칭 목록">
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {needs.unmatchedFarms.length > 0 ? '2. ' : '1. '}품목 매칭 ({needs.unmatchedProducts.length}건)
                </h3>
                <span className={styles.sectionHint}>원문 품명·단가·수량을 확인하고 같은 국가의 전산 품목을 선택합니다.</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th>인보이스 원문 품명 · 규격 · 단가</th>
                      <th>전산 품목 선택 (추천 후보 클릭 또는 검색)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.unmatchedProducts.map(item => {
                      const selectedProdKey = Number(productDrafts[item.sourceKey]) || '';
                      const search = text(productSearches[item.sourceKey] || '').toLowerCase();
                      const searchMatches = search
                        ? selectableCountryProducts
                          .filter(p => `${p.ProdName} ${p.DisplayName || ''} ${p.FlowerName || ''} ${p.ProdCode || ''}`.toLowerCase().includes(search))
                          .slice(0, 50)
                        : selectableCountryProducts.slice(0, 50);
                      const chosenObj = selectedProdKey
                        ? selectableCountryProducts.find(p => Number(p.ProdKey) === Number(selectedProdKey))
                        : null;
                      const selectOptions = chosenObj && !searchMatches.some(p => Number(p.ProdKey) === Number(chosenObj.ProdKey))
                        ? [chosenObj, ...searchMatches]
                        : searchMatches;

                      return (
                        <tr key={item.sourceKey} data-testid="upload-match-product-row">
                          <td style={{ minWidth: 270 }}>
                            <div className={styles.sourcePrimary}>{item.description}</div>
                            <div className={styles.sourceMeta}>
                              송장 {item.invoices.join(', ') || '-'}
                              {item.boxes != null ? ` · ${item.boxes.toLocaleString('ko-KR')}박스` : ''}
                              {item.totalQty ? ` · ${item.totalQty.toLocaleString('ko-KR')}송이` : ''}
                              {item.unitPrice != null ? ` · 단가 ${item.unitPrice}` : ''}
                              {item.stemLength ? ` · 길이 ${item.stemLength}` : ''}
                              {` · ${item.statusLabel}`}
                            </div>
                          </td>
                          <td style={{ minWidth: 420 }}>
                            {item.suggestions.length > 0 && (
                              <div className={styles.chipRow}>
                                {item.suggestions.slice(0, 3).map(({ product, score }) => {
                                  const isSelected = Number(selectedProdKey) === Number(product.ProdKey);
                                  return (
                                    <button
                                      key={product.ProdKey}
                                      type="button"
                                      aria-pressed={isSelected}
                                      className={`${styles.candidateChip} ${isSelected ? styles.candidateChipSelected : ''}`}
                                      disabled={saving}
                                      onClick={() => setProductDrafts(prev => ({
                                        ...prev,
                                        [item.sourceKey]: Number(product.ProdKey),
                                      }))}
                                    >
                                      <span>{product.ProdName}</span>
                                      <span className={styles.chipScore}>{score}%</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className={styles.searchRow}>
                              <input
                                type="search"
                                className={styles.input}
                                placeholder="같은 국가 품목 검색"
                                aria-label={`${item.description} 품목 검색`}
                                value={productSearches[item.sourceKey] || ''}
                                disabled={saving}
                                onChange={e => setProductSearches(prev => ({ ...prev, [item.sourceKey]: e.target.value }))}
                                style={{ width: 190 }}
                              />
                              <select
                                className={styles.select}
                                aria-label={`${item.description} 전산 품목 선택`}
                                value={selectedProdKey}
                                disabled={saving}
                                onChange={e => setProductDrafts(prev => ({
                                  ...prev,
                                  [item.sourceKey]: e.target.value ? Number(e.target.value) : '',
                                }))}
                                style={{ minWidth: 260, flex: 1 }}
                              >
                                <option value="">-- 전산 품목 선택 --</option>
                                {selectOptions.map(p => (
                                  <option key={p.ProdKey} value={p.ProdKey}>
                                    {p.ProdName}{p.FlowerName ? ` (${p.FlowerName})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {needs.quantityIssues.length > 0 && (
            <section className={styles.section} aria-label="박스·송이·합계 불일치 확인 목록">
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  박스·송이·합계 대조 ({needs.quantityIssues.length}건)
                </h3>
                <span className={styles.sectionHint}>원문 인용값과 대조해 박스·송이·단가·총액을 보정하면 즉시 재검산합니다.</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th>송장 · 품목 · 불일치 원문 근거</th>
                      <th>수치 대조 및 실시간 검산 (tabular-nums)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.quantityIssues.map(issue => {
                      if (issue.kind === 'INVOICE_TOTAL') {
                        const edit = invoiceEdits[issue.id] || {};
                        const freightNum = parseNum(edit.freight) ?? 0;
                        const totalNum = parseNum(edit.invoice_total);
                        const expectedSum = Math.round((Number(issue.fields.goodsSum || 0) + freightNum) * 100) / 100;
                        const diff = totalNum === null ? null : Math.round((totalNum - expectedSum) * 100) / 100;
                        const ok = diff !== null && Math.abs(diff) <= 0.02;

                        return (
                          <tr key={issue.id} data-testid="upload-match-qty-row">
                            <td style={{ minWidth: 280 }}>
                              <div className={styles.sourcePrimary}>{issue.supplier} · 송장 {issue.invoiceLabel}</div>
                              <div className={styles.sourceMeta}>{issue.messages.join(' / ')}</div>
                              {issue.evidenceQuote && <div className={styles.sourceMeta}>원문 인용: {issue.evidenceQuote}</div>}
                            </td>
                            <td>
                              <div className={styles.qtyGrid}>
                                <label className={styles.fieldLabel}>
                                  상품합계
                                  <input className={`${styles.input} ${styles.numInput}`} value={Number(issue.fields.goodsSum || 0).toFixed(2)} readOnly />
                                </label>
                                <label className={styles.fieldLabel}>
                                  운송·부대비
                                  <input
                                    type="number"
                                    step="any"
                                    aria-label={`송장 ${issue.invoiceLabel} 운송비`}
                                    className={`${styles.input} ${styles.numInput}`}
                                    value={edit.freight ?? ''}
                                    disabled={saving}
                                    onChange={e => setInvoiceEdits(prev => ({ ...prev, [issue.id]: { ...edit, freight: e.target.value } }))}
                                  />
                                </label>
                                <label className={styles.fieldLabel}>
                                  송장 총액
                                  <input
                                    type="number"
                                    step="any"
                                    aria-label={`송장 ${issue.invoiceLabel} 총액`}
                                    className={`${styles.input} ${styles.numInput}`}
                                    value={edit.invoice_total ?? ''}
                                    disabled={saving}
                                    onChange={e => setInvoiceEdits(prev => ({ ...prev, [issue.id]: { ...edit, invoice_total: e.target.value } }))}
                                  />
                                </label>
                                <label className={styles.fieldLabel} style={{ flex: 1, minWidth: 180 }}>
                                  확인 사유
                                  <input
                                    type="text"
                                    aria-label={`송장 ${issue.invoiceLabel} 확인 사유`}
                                    className={styles.input}
                                    value={edit.reason ?? ''}
                                    disabled={saving}
                                    onChange={e => setInvoiceEdits(prev => ({ ...prev, [issue.id]: { ...edit, reason: e.target.value } }))}
                                  />
                                </label>
                              </div>
                              <div className={`${styles.calcStatus} ${ok ? styles.calcOk : styles.calcMismatch}`}>
                                {ok
                                  ? `검산 일치: 상품+부대비 ${expectedSum.toFixed(2)} = 송장 총액 ${totalNum.toFixed(2)}`
                                  : `검산 차이: 상품+부대비 ${expectedSum.toFixed(2)} vs 송장 총액 ${totalNum ?? '미입력'} (차액 ${diff ?? '-'})`}
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      const edit = rowEdits[issue.id] || {};
                      const pcsNum = parseNum(edit.pcs);
                      const steamBoxNum = parseNum(edit.steam_box);
                      const stemsNum = parseNum(edit.total_stems);
                      const uPriceNum = parseNum(edit.u_price);
                      const tPriceNum = parseNum(edit.t_price);
                      const boxStemOk = !(country === 'CO' && pcsNum > 0 && steamBoxNum > 0 && stemsNum > 0)
                        || Math.abs(pcsNum * steamBoxNum - stemsNum) <= 0.02;
                      const lineAmountOk = !(stemsNum !== null && uPriceNum !== null && tPriceNum !== null && ['CO', 'EC', 'VN'].includes(country))
                        || Math.abs(Math.round(stemsNum * uPriceNum * 100) / 100 - tPriceNum) <= 0.02;
                      const rowOk = boxStemOk && lineAmountOk;

                      return (
                        <tr key={issue.id} data-testid="upload-match-qty-row">
                          <td style={{ minWidth: 280 }}>
                            <div className={styles.sourcePrimary}>
                              송장 {issue.invoiceLabel} · {issue.description}
                            </div>
                            <div className={styles.sourceMeta}>{issue.messages.join(' / ')}</div>
                            {issue.evidenceQuote && <div className={styles.sourceMeta}>원문 인용: {issue.evidenceQuote}</div>}
                          </td>
                          <td>
                            <div className={styles.qtyGrid}>
                              <label className={styles.fieldLabel}>
                                박스(pcs)
                                <input
                                  type="number"
                                  step="any"
                                  aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 박스`}
                                  className={`${styles.input} ${styles.numInput}`}
                                  value={edit.pcs ?? ''}
                                  disabled={saving}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, pcs: e.target.value } }))}
                                />
                              </label>
                              {issue.hasSteamBox && (
                                <label className={styles.fieldLabel}>
                                  박스당 송이
                                  <input
                                    type="number"
                                    step="any"
                                    aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 박스당 송이`}
                                    className={`${styles.input} ${styles.numInput}`}
                                    value={edit.steam_box ?? ''}
                                    disabled={saving}
                                    onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, steam_box: e.target.value } }))}
                                  />
                                </label>
                              )}
                              <label className={styles.fieldLabel}>
                                총 송이
                                <input
                                  type="number"
                                  step="any"
                                  aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 총 송이`}
                                  className={`${styles.input} ${styles.numInput}`}
                                  value={edit.total_stems ?? ''}
                                  disabled={saving}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, total_stems: e.target.value } }))}
                                />
                              </label>
                              <label className={styles.fieldLabel}>
                                단가
                                <input
                                  type="number"
                                  step="any"
                                  aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 단가`}
                                  className={`${styles.input} ${styles.numInput}`}
                                  value={edit.u_price ?? ''}
                                  disabled={saving}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, u_price: e.target.value } }))}
                                />
                              </label>
                              <label className={styles.fieldLabel}>
                                행금액
                                <input
                                  type="number"
                                  step="any"
                                  aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 금액`}
                                  className={`${styles.input} ${styles.numInput}`}
                                  value={edit.t_price ?? ''}
                                  disabled={saving}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, t_price: e.target.value } }))}
                                />
                              </label>
                              <label className={styles.fieldLabel} style={{ flex: 1, minWidth: 160 }}>
                                확인 사유
                                <input
                                  type="text"
                                  aria-label={`${issue.invoiceLabel} ${issue.lineIndex + 1}행 사유`}
                                  className={styles.input}
                                  value={edit.reason ?? ''}
                                  disabled={saving}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [issue.id]: { ...edit, reason: e.target.value } }))}
                                />
                              </label>
                            </div>
                            <div className={`${styles.calcStatus} ${rowOk ? styles.calcOk : styles.calcMismatch}`}>
                              {rowOk
                                ? `검산 일치: ${pcsNum ?? '-'}박스 × ${steamBoxNum ?? '-'} = ${stemsNum ?? '-'}송이 · 행금액 ${tPriceNum ?? '-'}`
                                : !boxStemOk
                                  ? `불일치: 박스(${pcsNum}) × 박스당 송이(${steamBoxNum}) = ${pcsNum * steamBoxNum} ≠ 총 송이(${stemsNum})`
                                  : `불일치: 송이(${stemsNum}) × 단가(${uPriceNum}) = ${(stemsNum * uPriceNum).toFixed(2)} ≠ 행금액(${tPriceNum})`}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerHint}>
            선택 완료: 농장 {selectedFarmCount}/{needs.unmatchedFarms.length}건 · 품목 {selectedProductCount}/{needs.unmatchedProducts.length}건
            {needs.quantityIssues.length > 0 ? ` · 수량 대조 ${needs.quantityIssues.length}건` : ''}
          </div>
          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={saving}
              onClick={onClose}
            >
              나중에 표에서 확인
            </button>
            <button
              type="submit"
              data-testid="packing-match-modal-save"
              className={styles.primaryBtn}
              disabled={saving}
            >
              {saving ? '매칭 저장 중…' : '매칭·보정 저장 후 계속'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
