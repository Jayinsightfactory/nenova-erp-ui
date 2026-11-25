import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../styles/PackingUploadMatchModal.module.css';
import {
  farmChoiceOptionKey,
  parseFarmChoiceOptionKey,
  analyzeRowQuantitySuggestion,
} from '../../lib/packingUploadMatchPrompt.js';
import {
  filterProductsByDetectedFamily,
  scoreProductMatch,
} from '../../lib/invoiceMatchAssist.js';
import { loadPdfPreview } from '../../lib/importPackingPdfPreview.js';

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
        <span className={styles.purposeTag}>[핵심 목적 · PURPOSE] 원본 인보이스와 나란히 대조해 미매칭·수량 즉시 해결</span>
        <div className={styles.alertTitle}>
          입고 매칭 알림 · 확인 필요 {needs.totalCount}건 ({parts.join(' · ')})
        </div>
        <p className={styles.alertDesc}>
          좌측 원본 PDF와 우측 전산 농장·품목·수량을 나란히 비교해 저장하면 현재 패킹·입고 초안에 즉시 반영되고 다음 업로드부터 자동 매칭됩니다.
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
  pdfBase64 = null,
  file = null,
  saving = false,
  error = '',
  onSave,
  onClose,
}) {
  const [farmDrafts, setFarmDrafts] = useState({});
  const [farmSearches, setFarmSearches] = useState({});
  const [productDrafts, setProductDrafts] = useState({});
  const [productSearches, setProductSearches] = useState({});
  const [showAllFamilies, setShowAllFamilies] = useState({});
  const [rowEdits, setRowEdits] = useState({});
  const [invoiceEdits, setInvoiceEdits] = useState({});
  const [localError, setLocalError] = useState('');

  // Split PDF viewer states
  const [activeItemId, setActiveItemId] = useState('');
  const [activeTarget, setActiveTarget] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfZoom, setPdfZoom] = useState(1.15);
  const [pdfHighlight, setPdfHighlight] = useState(null);
  const [pdfLabel, setPdfLabel] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const canvasRef = useRef(null);
  const highlightRef = useRef(null);

  const fileObjectUrl = useMemo(() => {
    if (!open || !file || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    try { return URL.createObjectURL(file); } catch { return ''; }
  }, [open, file]);

  useEffect(() => () => {
    if (fileObjectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(fileObjectUrl);
    }
  }, [fileObjectUrl]);

  const allItems = useMemo(() => {
    if (!needs) return [];
    return [
      ...needs.quantityIssues,
      ...needs.unmatchedProducts,
      ...needs.unmatchedFarms,
    ];
  }, [needs]);

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
          : (item.defaultProdKey || item.suggestions?.[0]?.product?.ProdKey || '');
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

  // Default focus on first item (prioritizing quantity mismatch so employee immediately sees the PDF table)
  useEffect(() => {
    if (!open || !allItems.length) return;
    setActiveItemId(prev => {
      if (prev && allItems.some(it => it.id === prev)) return prev;
      const first = allItems[0];
      setActiveTarget(first?.pdfTarget || null);
      return first?.id || '';
    });
  }, [open, allItems]);

  // Load PDF document when modal opens with pdfBase64
  useEffect(() => {
    if (!open || !pdfBase64) {
      setPdfDoc(null);
      setPdfLoading(false);
      setPdfError('');
      return undefined;
    }
    let cancelled = false;
    let instance = null;
    setPdfLoading(true);
    setPdfError('');
    loadPdfPreview(pdfBase64)
      .then(doc => {
        instance = doc;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setPdfLoading(false);
      })
      .catch(err => {
        if (!cancelled) {
          setPdfError(err?.message || '원본 PDF 미리보기를 불러오지 못했습니다.');
          setPdfLoading(false);
        }
      });
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [open, pdfBase64]);

  // Resolve target page + highlight whenever activeTarget changes
  useEffect(() => {
    if (!pdfDoc || !open) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!activeTarget) {
          setPdfPage(p => Math.min(pdfDoc.numPages, Math.max(1, p)));
          setPdfHighlight(null);
          setPdfLabel('');
          return;
        }
        const resolved = await pdfDoc.resolveTarget(activeTarget);
        if (cancelled) return;
        setPdfPage(resolved.page);
        setPdfHighlight(resolved.bbox || null);
        setPdfLabel(resolved.label || `${resolved.page}쪽 표시 중`);
      } catch {
        if (!cancelled) {
          setPdfHighlight(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, open, activeTarget]);

  // Render active PDF page onto canvas
  useEffect(() => {
    if (!open || !pdfDoc || !canvasRef.current) return undefined;
    let cancelled = false;
    const safePage = Math.min(pdfDoc.numPages, Math.max(1, pdfPage));
    pdfDoc.renderPage(safePage, canvasRef.current, pdfZoom)
      .then(res => {
        if (!cancelled && !res?.cancelled && pdfHighlight && highlightRef.current) {
          highlightRef.current.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
      })
      .catch(err => {
        if (!cancelled) setPdfError(err?.message || 'PDF 페이지를 그리지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, [open, pdfDoc, pdfPage, pdfZoom, pdfHighlight]);

  const focusItem = item => {
    if (!item) return;
    setActiveItemId(item.id);
    if (item.pdfTarget) setActiveTarget({ ...item.pdfTarget });
  };

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

  const hasPdfPane = Boolean(pdfBase64);

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

  const rightLedgerContent = (
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
            <span className={styles.sectionHint}>행을 누르면 좌측 원본 PDF가 해당 송장 페이지로 이동합니다.</span>
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
                    <tr
                      key={item.supplierKey}
                      data-testid="upload-match-farm-row"
                      className={activeItemId === item.id ? styles.activeRow : undefined}
                      onClick={() => focusItem(item)}
                    >
                      <td style={{ minWidth: 210 }}>
                        <div className={styles.sourceHeaderRow}>
                          <div className={styles.sourcePrimary}>{item.supplier}</div>
                          {hasPdfPane && (
                            <button type="button" className={styles.toolBtn} onClick={e => { e.stopPropagation(); focusItem(item); }}>
                              원본 보기
                            </button>
                          )}
                        </div>
                        <div className={styles.sourceMeta}>
                          송장 {item.invoices.join(', ') || '-'} · {item.reasonLabel}
                        </div>
                      </td>
                      <td style={{ minWidth: 300 }}>
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
                            style={{ width: 150 }}
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
                            style={{ minWidth: 210, flex: 1 }}
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
                        <td style={{ minWidth: 230 }}>
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
            <span className={styles.sectionHint}>원문 화종(수국·장미·카네이션 등) 기준으로 자동 필터링됩니다.</span>
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
                  const includeAll = Boolean(showAllFamilies[item.sourceKey]);
                  const familyScope = filterProductsByDetectedFamily(
                    item.description,
                    selectableCountryProducts,
                    { includeAll },
                  );
                  const scopedPool = familyScope.filtered;
                  const search = text(productSearches[item.sourceKey] || '').toLowerCase();
                  const rankedPool = [...scopedPool]
                    .map(p => ({ p, s: scoreProductMatch(item.description, p, { supplier: item.supplier }) }))
                    .sort((a, b) => b.s - a.s || String(a.p.ProdName).localeCompare(String(b.p.ProdName)))
                    .map(x => x.p);
                  const searchMatches = search
                    ? rankedPool
                      .filter(p => `${p.ProdName} ${p.DisplayName || ''} ${p.FlowerName || ''} ${p.ProdCode || ''}`.toLowerCase().includes(search))
                      .slice(0, 60)
                    : rankedPool.slice(0, 60);
                  const chosenObj = selectedProdKey
                    ? selectableCountryProducts.find(p => Number(p.ProdKey) === Number(selectedProdKey))
                    : null;
                  const selectOptions = chosenObj && !searchMatches.some(p => Number(p.ProdKey) === Number(chosenObj.ProdKey))
                    ? [chosenObj, ...searchMatches]
                    : searchMatches;

                  return (
                    <tr
                      key={item.sourceKey}
                      data-testid="upload-match-product-row"
                      className={activeItemId === item.id ? styles.activeRow : undefined}
                      onClick={() => focusItem(item)}
                    >
                      <td style={{ minWidth: 230 }}>
                        <div className={styles.sourceHeaderRow}>
                          <div className={styles.sourcePrimary}>{item.description}</div>
                          {hasPdfPane && (
                            <button type="button" className={styles.toolBtn} onClick={e => { e.stopPropagation(); focusItem(item); }}>
                              원본 보기
                            </button>
                          )}
                        </div>
                        <div className={styles.sourceMeta}>
                          송장 {item.invoices.join(', ') || '-'}
                          {item.boxes != null ? ` · ${item.boxes.toLocaleString('ko-KR')}박스` : ''}
                          {item.totalQty ? ` · ${item.totalQty.toLocaleString('ko-KR')}송이` : ''}
                          {item.unitPrice != null ? ` · 단가 ${item.unitPrice}` : ''}
                          {item.stemLength ? ` · 길이 ${item.stemLength}` : ''}
                          {` · ${item.statusLabel}`}
                        </div>
                      </td>
                      <td style={{ minWidth: 340 }}>
                        {familyScope.family && (
                          <div className={styles.familyFilterRow}>
                            <span className={styles.familyBadge} data-testid="upload-match-family-badge">
                              {includeAll
                                ? `전체 품목 검색 중 (${selectableCountryProducts.length}개)`
                                : `화종 자동 필터: ${familyScope.family.label} 전용 (${scopedPool.length}개)`}
                            </span>
                            <label className={styles.familyToggle} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={includeAll}
                                disabled={saving}
                                onChange={e => setShowAllFamilies(prev => ({ ...prev, [item.sourceKey]: e.target.checked }))}
                              />
                              전체 품목에서 검색
                            </label>
                          </div>
                        )}
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
                            placeholder={familyScope.family && !includeAll ? `${familyScope.family.label} 품목 내 검색` : '같은 국가 품목 검색'}
                            aria-label={`${item.description} 품목 검색`}
                            value={productSearches[item.sourceKey] || ''}
                            disabled={saving}
                            onChange={e => setProductSearches(prev => ({ ...prev, [item.sourceKey]: e.target.value }))}
                            style={{ width: 165 }}
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
                            style={{ minWidth: 220, flex: 1 }}
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
            <span className={styles.sectionHint}>좌측 원본 PDF 표와 비교한 뒤 자동 역산 추천 버튼을 누르거나 직접 수정하세요.</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>송장 · 품목 · 원본 인보이스 표시값</th>
                  <th>수치 대조 및 자동 검산</th>
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
                      <tr
                        key={issue.id}
                        data-testid="upload-match-qty-row"
                        className={activeItemId === issue.id ? styles.activeRow : undefined}
                        onClick={() => focusItem(issue)}
                      >
                        <td style={{ minWidth: 240 }}>
                          <div className={styles.sourceHeaderRow}>
                            <div className={styles.sourcePrimary}>{issue.supplier} · 송장 {issue.invoiceLabel}</div>
                            {hasPdfPane && (
                              <button type="button" className={styles.toolBtn} onClick={e => { e.stopPropagation(); focusItem(issue); }}>
                                원본 보기
                              </button>
                            )}
                          </div>
                          <div className={styles.sourceMeta}>{issue.messages.join(' / ')}</div>
                          {issue.evidenceBadges?.length > 0 && (
                            <div className={styles.evidenceBadgeList}>
                              {issue.evidenceBadges.map((badge, idx) => (
                                <span key={idx} className={styles.evidenceChip}>
                                  <span className={styles.evidenceChipLabel}>{badge.label}</span>
                                  <span>{badge.quote}</span>
                                </span>
                              ))}
                            </div>
                          )}
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
                            <label className={styles.fieldLabel} style={{ flex: 1, minWidth: 160 }}>
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
                  const suggestion = !rowOk
                    ? analyzeRowQuantitySuggestion({
                      country,
                      pcs: edit.pcs,
                      steam_box: edit.steam_box,
                      total_stems: edit.total_stems,
                      u_price: edit.u_price,
                      t_price: edit.t_price,
                    })
                    : { diagnosis: null, primaryAction: null, secondaryAction: null };

                  return (
                    <tr
                      key={issue.id}
                      data-testid="upload-match-qty-row"
                      className={activeItemId === issue.id ? styles.activeRow : undefined}
                      onClick={() => focusItem(issue)}
                    >
                      <td style={{ minWidth: 240 }}>
                        <div className={styles.sourceHeaderRow}>
                          <div className={styles.sourcePrimary}>
                            송장 {issue.invoiceLabel} · {issue.description}
                          </div>
                          {hasPdfPane && (
                            <button type="button" className={styles.toolBtn} onClick={e => { e.stopPropagation(); focusItem(issue); }}>
                              원본 보기
                            </button>
                          )}
                        </div>
                        <div className={styles.sourceMeta}>{issue.messages.join(' / ')}</div>
                        {issue.evidenceBadges?.length > 0 && (
                          <div className={styles.evidenceBadgeList}>
                            {issue.evidenceBadges.map((badge, idx) => (
                              <span key={idx} className={styles.evidenceChip}>
                                <span className={styles.evidenceChipLabel}>{badge.label}</span>
                                <span>{badge.quote}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className={styles.qtyGrid}>
                          <label className={styles.fieldLabel}>
                            박스 수
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
                          <label className={styles.fieldLabel} style={{ flex: 1, minWidth: 150 }}>
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

                        {!rowOk && (suggestion.diagnosis || suggestion.primaryAction) && (
                          <div className={styles.suggestionBox} data-testid="upload-match-qty-suggestion">
                            {suggestion.diagnosis && (
                              <div className={styles.suggestionText}>{suggestion.diagnosis}</div>
                            )}
                            <div className={styles.suggestionActions}>
                              {suggestion.primaryAction && (
                                <button
                                  type="button"
                                  data-testid="upload-match-autofix-primary"
                                  className={styles.autofixPrimaryBtn}
                                  disabled={saving}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setRowEdits(prev => ({
                                      ...prev,
                                      [issue.id]: {
                                        ...edit,
                                        ...suggestion.primaryAction.patch,
                                        reason: suggestion.primaryAction.reason,
                                      },
                                    }));
                                  }}
                                >
                                  {suggestion.primaryAction.label}
                                </button>
                              )}
                              {suggestion.secondaryAction && (
                                <button
                                  type="button"
                                  data-testid="upload-match-autofix-secondary"
                                  className={styles.autofixSecondaryBtn}
                                  disabled={saving}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setRowEdits(prev => ({
                                      ...prev,
                                      [issue.id]: {
                                        ...edit,
                                        ...suggestion.secondaryAction.patch,
                                        reason: suggestion.secondaryAction.reason,
                                      },
                                    }));
                                  }}
                                >
                                  {suggestion.secondaryAction.label}
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        <div className={`${styles.calcStatus} ${rowOk ? styles.calcOk : styles.calcMismatch}`}>
                          {rowOk
                            ? `검산 일치: ${pcsNum ?? '-'}박스 × ${steamBoxNum ?? '-'}송이 = ${stemsNum ?? '-'}송이 · 행금액 ${tPriceNum ?? '-'}`
                            : !boxStemOk
                              ? `불일치: 박스(${pcsNum}) × 박스당 송이(${steamBoxNum}) = ${pcsNum * steamBoxNum} ≠ 총 송이(${stemsNum})`
                              : `불일치: 총 송이(${stemsNum}) × 단가(${uPriceNum}) = ${(stemsNum * uPriceNum).toFixed(2)} ≠ 행금액(${tPriceNum})`}
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
  );

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
        className={`${styles.dialog} ${!hasPdfPane ? styles.dialogSingleCol : ''}`}
        onSubmit={handleSubmit}
      >
        <header className={styles.header}>
          <div>
            <span className={styles.purposeTag}>[핵심 목적 · PURPOSE] 원본 인보이스 PDF와 전산 농장·품목·수량을 한 화면에서 대조 연결</span>
            <h2 id="packing-upload-match-title" className={styles.headerTitle}>
              입고 업로드 매칭 확인 ({needs.totalCount}건)
            </h2>
            <p className={styles.headerSub}>
              우측 항목을 클릭하면 좌측 원본 PDF가 해당 송장 페이지로 자동 이동합니다. 저장한 농장·품목 연결은 다음 업로드부터 자동 적용됩니다.
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

        {hasPdfPane ? (
          <div className={styles.splitWorkspace}>
            <aside className={styles.pdfPane} aria-label="원본 인보이스 PDF 대조" data-testid="upload-match-pdf-pane">
              <div className={styles.pdfToolbar}>
                <div className={styles.pdfToolbarGroup}>
                  <span className={styles.pdfBadge}>
                    원본 PDF {activeTarget?.invoiceNo ? `· 송장 ${activeTarget.invoiceNo}` : ''}
                  </span>
                  <button
                    type="button"
                    className={styles.toolBtn}
                    disabled={!pdfDoc || pdfPage <= 1}
                    onClick={() => { setPdfHighlight(null); setPdfPage(p => Math.max(1, p - 1)); }}
                  >
                    이전 쪽
                  </button>
                  <span className={styles.pdfBadge}>
                    {pdfPage} / {pdfDoc?.numPages || 1}쪽
                  </span>
                  <button
                    type="button"
                    className={styles.toolBtn}
                    disabled={!pdfDoc || pdfPage >= (pdfDoc?.numPages || 1)}
                    onClick={() => { setPdfHighlight(null); setPdfPage(p => Math.min(pdfDoc?.numPages || 1, p + 1)); }}
                  >
                    다음 쪽
                  </button>
                </div>
                <div className={styles.pdfToolbarGroup}>
                  {[[1, '100%'], [1.35, '135%'], [1.7, '170%']].map(([z, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={`${styles.toolBtn} ${Math.abs(pdfZoom - z) < 0.05 ? styles.toolBtnActive : ''}`}
                      onClick={() => setPdfZoom(z)}
                    >
                      {label}
                    </button>
                  ))}
                  {fileObjectUrl && (
                    <a
                      href={fileObjectUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.toolBtn}
                    >
                      새 창으로 원본 열기
                    </a>
                  )}
                </div>
              </div>
              <div className={styles.pdfStatusHint}>
                <span>
                  {pdfLoading
                    ? '원본 PDF 페이지 불러오는 중…'
                    : pdfError
                      ? pdfError
                      : `${activeTarget?.supplier ? `${activeTarget.supplier} · ` : ''}${pdfLabel || `${pdfPage}쪽 표시 중`}`}
                </span>
                <span>주황색 강조 줄과 우측 입력값을 비교하세요</span>
              </div>
              <div className={styles.pdfCanvasScroller}>
                <div className={styles.pdfStage}>
                  <canvas ref={canvasRef} className={styles.pdfCanvas} data-testid="upload-match-pdf-canvas" />
                  {pdfHighlight && (
                    <div
                      ref={highlightRef}
                      data-testid="upload-match-pdf-highlight"
                      className={styles.pdfHighlight}
                      style={{
                        left: `${pdfHighlight[0] * 100}%`,
                        top: `${pdfHighlight[1] * 100}%`,
                        width: `${pdfHighlight[2] * 100}%`,
                        height: `${pdfHighlight[3] * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            </aside>
            {rightLedgerContent}
          </div>
        ) : (
          rightLedgerContent
        )}

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
