import React, { useEffect, useRef, useState } from 'react';
import { downloadInvoiceCostExport, invoiceCostExportEligibility } from '../../lib/invoiceReceiptStageLogClient.js';
import ledger from '../../styles/ArrivalCostLedger.module.css';
import NativeReceiptCost from './NativeReceiptCost';
import { filterInvoiceWarehouses } from '../../lib/invoiceWarehouseBrowse.js';
import SharedAwbCostReview from './SharedAwbCostReview';
import ArrivalWeekCostReview from './ArrivalWeekCostReview';
import { baseCountry } from '../../lib/countryClassification.js';

export default function InvoiceWarehouseCostBrowse({ orderYear, orderWeek, invoiceNo, country }) {
  const scope = `${orderYear}/${orderWeek}/${invoiceNo ?? '*'}/${country ?? '*'}`;
  const live = useRef(scope); live.current = scope;
  const [state, setState] = useState({ rows: [], loading: true });
  const [action, setAction] = useState({ busy: false, error: '' });
  const lock = useRef(false);
  const [nativeKey, setNativeKey] = useState(null);
  const [selectionKeys, setSelectionKeys] = useState([]);
  const [selectionRequest, setSelectionRequest] = useState(null);
  // 차수 통합이 기본이다. 기존 단일 AWB·개별 입고는 별도 선택으로 보존한다.
  const [showColombia, setShowColombia] = useState(false);
  const [sharedAwbState, setSharedAwbState] = useState({ awb: '', scope: 'MAIN' });
  const [individualCountry, setIndividualCountry] = useState('');

  useEffect(() => {
    setShowColombia(false);
    const controller = new AbortController();
    setState({ rows: [], loading: true }); setAction({ busy: false, error: '' });
    setNativeKey(null);
    setSelectionKeys([]); setSelectionRequest(null);
    fetch(`/api/import/receipts/warehouse-list?${new URLSearchParams({ orderYear, orderWeek })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.rows)) throw new Error(data.error || '조회 응답을 확인하지 못했습니다.');
        return data;
      })
      .then(data => { if (!controller.signal.aborted) setState({ ...data, loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setState({ rows: [], loading: false, error: error.message }); });
    return () => controller.abort();
  }, [orderYear, orderWeek, invoiceNo, country]);

  const rows = filterInvoiceWarehouses(state.rows, { orderYear, orderWeek }, invoiceNo)
    .filter(row => (!country || baseCountry(row.CountryName) === baseCountry(country)) && (!individualCountry || baseCountry(row.CountryName) === individualCountry));

  function nextSelection() {
    const selected = rows.filter(r => selectionKeys.includes(r.WarehouseKey));
    if (selected.length === 1 && selected[0].CostReferenceOnly) { open(selected[0], false); return; }
    if (selected.some(r => r.CostReferenceOnly)) {
      setAction({ busy: false, error: '운임·중량 참고자료는 상품 입고 선택에 합산하지 않습니다. 상품 입고만 선택하세요.' });
      return;
    }
    const countries = [...new Set(selected.map(r => baseCountry(r.CountryName)))];
    if (selected.length === 1 && !['중국', '콜롬비아'].includes(countries[0])) {
      setNativeKey(selected[0].WarehouseKey);
      return;
    }
    if (countries.length !== 1 || !['중국', '콜롬비아'].includes(countries[0])) {
      setAction({ busy: false, error: '같은 국가의 중국 CLOUD 또는 콜롬비아 입고를 선택하세요. 다른 국가는 1건씩 계산할 수 있습니다.' });
      return;
    }
    setNativeKey(null);
    setAction({ busy: false, error: '' });
    setSelectionRequest({ id: Date.now(), country: countries[0] === '중국' ? 'CN' : 'CO', keys: selected.map(r => r.WarehouseKey) });
  }

  async function open(row, download) {
    if (!download && row.CostReferenceOnly) {
      const awb = String(row.OrderNo ?? '').replace(/[\s-]/g, '');
      const sameAwbGoods = /^\d{11}$/.test(awb)
        ? state.rows.filter(r => !r.CostReferenceOnly && String(r.OrderNo ?? '').replace(/[\s-]/g, '') === awb)
        : [];
      const coGoods = sameAwbGoods.filter(r => baseCountry(r.CountryName) === '콜롬비아');
      setNativeKey(null);
      if (/^\d{11}$/.test(awb) && coGoods.length) {
        const invoiceHint = String(row.InvoiceNo ?? '');
        const inferredScope = /수국|hydrangea/i.test(invoiceHint) && !/카장/i.test(invoiceHint) ? 'HYDRANGEA' : 'MAIN';
        setSharedAwbState({ awb, scope: inferredScope });
        setShowColombia(true);
        setAction({ busy: false, error: '' });
      } else if (sameAwbGoods.length > 1 && sameAwbGoods.every(r => baseCountry(r.CountryName) === '중국')) {
        setShowColombia(false);
        setAction({ busy: false, error: '' });
        const keys = sameAwbGoods.map(r => r.WarehouseKey);
        setSelectionKeys(keys);
        setSelectionRequest({ id: Date.now(), country: 'CN', keys });
      } else if (sameAwbGoods.length >= 1) {
        setShowColombia(false);
        setNativeKey(sameAwbGoods[0].WarehouseKey);
        setAction({ busy: false, error: '' });
      } else {
        setAction({ busy: false, error: '이 입고는 운임·중량 참고자료이며 상품이 아닙니다. 해당 국가의 실제 상품 입고를 선택한 뒤 AWB 원문을 확인하세요.' });
      }
      return;
    }
    if (!download) { setNativeKey(row.WarehouseKey); return; }
    if (lock.current) return;
    lock.current = true;
    const expected = scope;
    setAction({ busy: true, error: '' });
    try {
      const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(row.WarehouseKey)}`, { cache: 'no-store' });
      const data = await response.json();
      if (live.current !== expected) return;
      if (!response.ok || !data.success) throw new Error(data.error || '원가 연결을 확인하지 못했습니다.');
      const costs = data.costs;
      const eligibility = invoiceCostExportEligibility(null, costs?.currentActual);
      if (!eligibility.allowed) throw new Error(eligibility.message || '승인 원가가 없습니다. 입고자료로 원가 계산을 선택하면 계산본을 다운로드할 수 있습니다.');
      await downloadInvoiceCostExport(costs.currentActual, { isCurrent: () => live.current === expected });
    } catch (error) {
      if (live.current === expected) setAction({ busy: false, error: error.message });
    } finally {
      lock.current = false;
      if (live.current === expected) setAction(value => ({ ...value, busy: false }));
    }
  }

  return (
    <section className={ledger.browseSection} aria-label="입고내역 도착원가 작업">
      <div className={ledger.browseHeader}>
        <div>
          <h3>{orderYear} / {orderWeek} 입고내역</h3>
          <p>인보이스 재연결 없이 입고자료로 계산합니다. 기존 입고·재고·승인 원가는 변경하지 않습니다.</p>
        </div>
        <span className={ledger.countBadge}>
          {state.loading ? '조회 중' : `표시 ${rows.length.toLocaleString('ko-KR')}건`}
        </span>
      </div>

      <section className={ledger.countryBar} aria-label="국가별 기존 원가 계산">
        <div className={ledger.countryBarInfo}>
          <h3>국가별 도착원가 · 기존 공식</h3>
          <p>네덜란드·중국·콜롬비아·에콰도르·미국·호주·뉴질랜드·태국·베트남은 아래 입고의 생성 버튼에서 기존 국가별 공식을 사용합니다. 중국 CLOUD A/B·콜롬비아 여러 입고는 별도 통합 계산을 사용합니다.</p>
        </div>
        <label className={ledger.countrySelectField}>
          <span>개별 원가 국가</span>
          <select
            aria-label="개별 원가 국가"
            value={individualCountry}
            onChange={e => { setIndividualCountry(e.target.value); setSelectionKeys([]); setNativeKey(null); }}
          >
            <option value="">전체 국가</option>
            {['네덜란드', '중국', '콜롬비아', '에콰도르', '미국', '호주', '뉴질랜드', '태국', '베트남'].map(n => <option key={n}>{n}</option>)}
          </select>
        </label>
      </section>

      <ArrivalWeekCostReview orderYear={orderYear} orderWeek={orderWeek} selectionRequest={selectionRequest} />

      {invoiceNo != null && (
        <p className={ledger.statusNotice}>
          송장 {invoiceNo}의 기존 입고만 표시합니다. 현재 초안의 수정값은 사용하지 않습니다. 농장·송장을 확인하고 선택하세요.
        </p>
      )}

      <div className={ledger.actionToolbar}>
        <div className={ledger.toolbarLeft}>
          <span className={`${ledger.selectionBadge} ${selectionKeys.length > 0 ? ledger.selectionBadgeActive : ''}`}>
            선택 {selectionKeys.length}건
          </span>
          <p className={ledger.toolbarHint}>
            입고는 여러 건을 선택한 뒤 다음을 누르세요. 체크만 하면 화면이 바뀌지 않습니다. 같은 국가·차수만 통합하며 개별 계산 버튼은 해당 1건만 사용합니다.
          </p>
        </div>
        <div className={ledger.toolbarActions}>
          <button
            type="button"
            className={ledger.btnPrimary}
            disabled={!selectionKeys.length || state.loading || action.busy}
            onClick={nextSelection}
          >
            선택 {selectionKeys.length}건 다음 · 도착원가 작성
          </button>
          <button
            type="button"
            className={ledger.btnSecondary}
            aria-expanded={showColombia}
            onClick={() => {
              if (!showColombia) setSharedAwbState({ awb: '', scope: 'MAIN' });
              setShowColombia(value => !value);
            }}
          >
            {showColombia ? 'AWB 업로드·공동 원가 접기' : 'AWB PDF 업로드·직접 입력 / 콜롬비아 공동 원가'}
          </button>
        </div>
      </div>

      {showColombia && (
        <SharedAwbCostReview
          key={`${sharedAwbState.awb}:${sharedAwbState.scope}`}
          native={{ orderYear, orderWeek, awb: sharedAwbState.awb, scope: sharedAwbState.scope }}
        />
      )}
      {state.loading && <p className={ledger.statusNotice} role="status">입고내역 조회 중…</p>}
      {(state.error || action.error) && <p className={ledger.alertError} role="alert">{state.error || action.error}</p>}

      {nativeKey ? (
        <NativeReceiptCost
          key={`${scope}/${nativeKey}`}
          orderYear={orderYear}
          orderWeek={orderWeek}
          warehouseKey={nativeKey}
          onClose={() => setNativeKey(null)}
          onOpenSharedAwb={awb => {
            setNativeKey(null);
            setSharedAwbState({ awb, scope: 'MAIN' });
            setShowColombia(true);
          }}
        />
      ) : rows.length > 0 ? (
        <div className={ledger.ledgerTableWrap}>
          <table className={ledger.ledgerTable} aria-label="입고 원장 목록">
            <thead>
              <tr>
                <th>선택</th>
                <th>입고번호 · 입고일</th>
                <th>국가 · 구분</th>
                <th>농장 · 송장번호</th>
                <th>AWB</th>
                <th>GW / CW (kg)</th>
                <th>원가 작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isSelected = selectionKeys.includes(row.WarehouseKey);
                const countryText = baseCountry(row.CountryName);
                return (
                  <tr
                    key={row.WarehouseKey}
                    className={`${isSelected ? ledger.rowSelected : ''} ${row.CostReferenceOnly ? ledger.rowReference : ''}`.trim()}
                  >
                    <td>
                      <label className={ledger.checkLabel}>
                        <input
                          type="checkbox"
                          aria-label={`입고 ${row.WarehouseKey} 원가 선택`}
                          checked={isSelected}
                          onChange={e => setSelectionKeys(current =>
                            e.target.checked ? [...current, row.WarehouseKey] : current.filter(k => k !== row.WarehouseKey))}
                        />
                        <span>원가에 포함</span>
                      </label>
                    </td>
                    <td className={ledger.receiptNoCell}>
                      <span className={ledger.receiptNo}>입고 #{row.WarehouseKey}</span>
                      <span className={ledger.receiptDate}>{row.InputDate || '날짜 미기재'}</span>
                    </td>
                    <td>
                      {row.CostReferenceOnly ? (
                        <span className={ledger.refBadge}>운임 참고</span>
                      ) : countryText ? (
                        <span className={ledger.countryBadge}>{countryText}</span>
                      ) : (
                        <span className={ledger.mutedBadge}>미기재</span>
                      )}
                    </td>
                    <td className={ledger.farmCell}>
                      <div className={ledger.farmPrimary}>
                        <strong>{row.FarmName || '농장 미기재'}</strong>
                        <span className={ledger.invoiceCode}>· {row.InvoiceNo || '송장번호 미기재'}</span>
                      </div>
                      {row.CostReferenceOnly && (
                        <p className={ledger.refNoticeText}>
                          운임·중량 참고자료 · 상품 수량에 합산하지 않습니다. AWB {row.OrderNo || '미확인'}
                        </p>
                      )}
                    </td>
                    <td>
                      {row.OrderNo ? (
                        <span>{row.OrderNo}</span>
                      ) : (
                        <span className={ledger.mutedBadge}>미기재</span>
                      )}
                    </td>
                    <td className={ledger.weightCell}>
                      <span className={ledger.weightPair}>
                        <span>GW {row.GrossWeight != null ? Number(row.GrossWeight).toLocaleString('ko-KR') : <span className={ledger.mutedBadge}>미기재</span>}</span>
                        <span className={ledger.weightSep}>/</span>
                        <span>CW {row.ChargeableWeight != null ? `${Number(row.ChargeableWeight).toLocaleString('ko-KR')} kg` : <><span className={ledger.mutedBadge}>미기재</span> kg</>}</span>
                      </span>
                    </td>
                    <td>
                      <div className={ledger.rowActions}>
                        <button type="button" className={ledger.btnPrimarySm} disabled={action.busy} onClick={() => open(row, false)}>
                          도착원가 엑셀 생성·다운로드
                        </button>
                        <button type="button" className={ledger.btnSecondarySm} disabled={action.busy} onClick={() => open(row, true)}>
                          기존 승인 원가 다운로드
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!state.loading && !state.error && !rows.length && (
        <p className={ledger.statusNotice}>
          해당 연도·세부차수{invoiceNo != null ? '·송장' : ''}의 입고내역이 없습니다. 조회 조건을 확인하세요. 새 입고를 자동 등록하지 않습니다.
        </p>
      )}
      {state.hasMore && <p className={ledger.statusNotice}>최신 500건까지 표시합니다. 입고관리에서 나머지 내역을 확인하세요.</p>}
    </section>
  );
}
