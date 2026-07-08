import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';
import { importProductOverrideKey, IMPORT_IGNORE_CUSTOMER_VALUE, isImportIgnoreCustomerValue } from '../../lib/shipmentImportQty';

const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const fmtUpload = r => {
  const mult = Number(r.quantityMultiplier || 1);
  if (mult > 1) return `${fmt(r.uploadQty)} (${fmt(r.excelQty)}×${fmt(mult)})`;
  if (r.excelQty != null && !Number.isNaN(Number(r.excelQty)) && Number(r.excelQty) !== Number(r.uploadQty)) {
    const unit = r.excelUnit ? ` ${r.excelUnit}` : ((r.productFamily === 'rose' || r.productFamily === 'carnation' || r.productFamily === 'minicarnation') && !r.excelUnit ? ' 단' : '');
    return `${fmt(r.uploadQty)} (←${fmt(r.excelQty)}${unit})`;
  }
  return fmt(r.uploadQty);
};
const qtyWarningText = r => (r.qtyWarnings || []).filter(w => w.severity === 'critical').map(w => w.message).join(' / ');
const hasQtyDiff = n => Math.abs(Number(n || 0)) > 0.0001;
const statusText = status => status === '주문없음' ? '신규추가' : status === '엑셀누락' ? '분배삭제' : status === '확정차단' ? '확정차단' : status;
const rowChanged = r => r?.status !== '동일' && r?.status !== '확정차단';
const orderChanged = r => hasQtyDiff(r?.orderDiffQty) || r?.status === '주문없음';
const shipmentDiffQty = r => Number(r?.shipmentDiffQty ?? (Number(r?.uploadQty || 0) - Number(r?.currentOutQty || 0)));
const shipmentNeedsApply = r => !!r?.needsShipmentApply || hasQtyDiff(shipmentDiffQty(r));
const applyTarget = r => !r.fixBlocked && (rowChanged(r) || shipmentNeedsApply(r));
const rowStatusText = r => r?.status === '동일' && shipmentNeedsApply(r) ? '분배반영' : statusText(r?.status);
const rowBg = r => r?.fixBlocked ? '#f3f4f6' : r?.status === '주문없음' ? '#eff6ff' : r?.status === '엑셀누락' ? '#fee2e2' : rowChanged(r) ? '#fff7ed' : shipmentNeedsApply(r) ? '#f0fdf4' : '#fff';

function getDefaultImportWeek() {
  const current = getCurrentWeek();
  const match = String(current || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return current;
  let year = Number(match[1]);
  let week = Number(match[2]) + 1;
  const seq = match[3];
  if (week > 52) {
    year += 1;
    week = 1;
  }
  return `${year}-${String(week).padStart(2, '0')}-${seq}`;
}

function buildPivotModel(sourceRows) {
  const customers = new Map();
  const products = new Map();
  for (const r of sourceRows || []) {
    const custKey = String(r.custKey || r.custName || '');
    const prodKey = String(r.prodKey || r.prodName || '');
    if (!custKey || !prodKey) continue;
    if (!customers.has(custKey)) {
      customers.set(custKey, {
        key: custKey,
        name: r.custName,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
      });
    }
    if (!products.has(prodKey)) {
      products.set(prodKey, {
        key: prodKey,
        name: r.displayName || r.prodName,
        prodName: r.prodName,
        outUnit: r.outUnit,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
        cells: new Map(),
      });
    }
    const c = customers.get(custKey);
    const p = products.get(prodKey);
    c.orderQty += Number(r.orderQty || 0);
    c.currentOutQty += Number(r.currentOutQty || 0);
    c.uploadQty += Number(r.uploadQty || 0);
    c.changeQty += Number(r.changeQty || 0);
    c.shipmentDiffQty += shipmentDiffQty(r);
    p.orderQty += Number(r.orderQty || 0);
    p.currentOutQty += Number(r.currentOutQty || 0);
    p.uploadQty += Number(r.uploadQty || 0);
    p.changeQty += Number(r.changeQty || 0);
    p.shipmentDiffQty += shipmentDiffQty(r);
    if (rowChanged(r)) {
      c.changedLines += 1;
      p.changedLines += 1;
    }
    if (applyTarget(r)) {
      c.shipmentChangedLines += 1;
      p.shipmentChangedLines += 1;
    }
    p.cells.set(custKey, r);
  }
  return {
    customers: [...customers.values()],
    products: [...products.values()],
  };
}

export default function DistributeImport() {
  const router = useRouter();
  const weekInput = useWeekInput(getDefaultImportWeek());
  const fileRef = useRef(null);
  const applyResultRef = useRef(null);
  const comparisonRef = useRef(null);
  const preAlignAvailable = false;
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [applyResult, setApplyResult] = useState(null);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [preAligning, setPreAligning] = useState(false);
  const [preAlignResult, setPreAlignResult] = useState(null);
  const [filter, setFilter] = useState('apply');
  const [viewMode, setViewMode] = useState('pivot');
  const [unmatchedModalOpen, setUnmatchedModalOpen] = useState(false);
  const [matchTab, setMatchTab] = useState('customer');
  const [custOverrides, setCustOverrides] = useState({});   // { 원본업체라벨: custKey }
  const [prodOverrides, setProdOverrides] = useState({});   // { productOverrideKey: prodKey }
  const [shipmentOnly, setShipmentOnly] = useState(false);  // true: 주문(OrderDetail) 미변경, 출고분배만 반영
  const custOverridesRef = useRef({});
  const prodOverridesRef = useRef({});
  const verifiedOverridesRef = useRef({ cust: {}, prod: {} });  // 직전 검증에 보낸 override 스냅샷
  const setOverrides = next => { custOverridesRef.current = next; setCustOverrides(next); };
  const setProdOverridesState = next => { prodOverridesRef.current = next; setProdOverrides(next); };

  const rows = preview?.rows || [];
  const changedRows = useMemo(() => rows.filter(r => r.status !== '동일' && !r.fixBlocked), [rows]);
  const fixBlockedRows = useMemo(() => rows.filter(r => r.fixBlocked), [rows]);
  const orderlessRows = useMemo(() => changedRows.filter(r => r.status === '주문없음'), [changedRows]);
  const orderChangeRows = useMemo(() => changedRows.filter(orderChanged), [changedRows]);
  const applyRows = useMemo(() => rows.filter(applyTarget), [rows]);
  const qtyWarningRows = useMemo(() => rows.filter(r => r.hasQtyWarning), [rows]);
  const shipmentRows = useMemo(() => rows.filter(shipmentNeedsApply), [rows]);
  const visibleRows = useMemo(() => {
    if (filter === 'unmatched') return (preview?.unmatched || []).slice(0, 1000);
    const base = filter === 'apply' ? applyRows : filter === 'changed' ? changedRows : filter === 'shipment' ? shipmentRows : rows;
    const source = base.length > 0 ? base : rows;
    return source.slice(0, 1000);
  }, [rows, applyRows, changedRows, shipmentRows, filter, preview?.unmatched]);
  const pivotSourceRows = useMemo(() => {
    const filtered = filter === 'apply' ? applyRows
      : filter === 'changed' ? changedRows
      : filter === 'shipment' ? shipmentRows
      : filter === 'unmatched' ? []
      : rows;
    if (filtered.length > 0 || filter === 'unmatched') return filtered;
    return rows;
  }, [rows, applyRows, changedRows, shipmentRows, filter]);
  const pivotModel = useMemo(() => buildPivotModel(pivotSourceRows), [pivotSourceRows]);
  const pivotFilterFallback = pivotSourceRows.length > 0 && (
    (filter === 'apply' && applyRows.length === 0) ||
    (filter === 'changed' && changedRows.length === 0) ||
    (filter === 'shipment' && shipmentRows.length === 0)
  );

  // 파일엔 있는데 업체 매칭 실패한 미매칭 라벨(중복 제거)
  const unmatchedCustomers = useMemo(() => {
    const map = new Map();
    for (const u of preview?.unmatched || []) {
      if (!/업체/.test(u.reason || '')) continue;
      const label = u.customerLabel || '';
      if (!label) continue;
      if (!map.has(label)) {
        map.set(label, {
          label,
          count: 0,
          sample: u.productLabel || '',
          matchKind: u.matchKind || 'customer',
          suggestedCustomers: u.suggestedCustomers || [],
        });
      }
      map.get(label).count += 1;
    }
    return [...map.values()];
  }, [preview]);

  const unmatchedProducts = useMemo(() => {
    const map = new Map();
    for (const u of preview?.unmatched || []) {
      if (!/품목/.test(u.reason || '')) continue;
      const key = u.productOverrideKey || importProductOverrideKey(u);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          productLabel: u.productLabel || '',
          sheetName: u.sheetName || '',
          productFamily: u.productFamily || '',
          count: 0,
          sampleCustomer: u.customerLabel || '',
          matchKind: u.matchKind || 'product',
          suggestedProducts: u.suggestedProducts || [],
        });
      }
      map.get(key).count += 1;
    }
    return [...map.values()];
  }, [preview]);

  const unmatchedQtyCount = (preview?.unmatched || []).filter(u => Number(u.uploadQty || u.excelQty || 0) !== 0).length;
  const custMatchPending = unmatchedCustomers.filter(it => !custOverrides[it.label]).length;
  const prodMatchPending = unmatchedProducts.filter(it => !prodOverrides[it.key]).length;

  // 미매칭 분류 무결성 가드 — 직전 검증에 override 를 보냈는데도 같은 라벨이 미매칭으로
  // 되돌아왔으면 반영 실패(회귀)다. 예전 "선택했는데 다른 업체로 매칭" 류 버그를 침묵 속에
  // 재발시키지 않도록 명시적으로 경고한다. (아직 검증 안 돌린 신규 선택은 대상 아님)
  const staleOverrideWarnings = useMemo(() => {
    const sent = verifiedOverridesRef.current || { cust: {}, prod: {} };
    const out = [];
    for (const it of unmatchedCustomers) {
      const ov = sent.cust[it.label];
      if (ov && !isImportIgnoreCustomerValue(ov)) out.push(`업체 "${it.label}" (지정 custKey=${ov})`);
    }
    for (const it of unmatchedProducts) {
      const ov = sent.prod[it.key];
      if (ov) out.push(`품목 "${it.productLabel}" (지정 prodKey=${ov})`);
    }
    return out;
  }, [unmatchedCustomers, unmatchedProducts, preview]);

  useEffect(() => {
    if (!router.isReady) return;
    const qWeek = Array.isArray(router.query.week) ? router.query.week[0] : router.query.week;
    if (qWeek) weekInput.setValue(String(qWeek));
  }, [router.isReady, router.query.week]);

  useEffect(() => {
    if (!applyResult || applyResult.running) return;
    applyResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [applyResult?.running, applyResult?.appliedCount, applyResult?.skippedNoChangeCount]);

  const handlePreview = async (options = {}) => {
    if (!weekInput.value) { setError('차수를 입력하세요.'); return; }
    if (!file) { setError('업로드할 엑셀 파일을 선택하세요.'); return; }
    setLoading(true);
    setError('');
    if (!options.preserveMessage) setMessage('');
    if (!options.preserveApplyResult) {
      setApplyResult(null);
      setApplyModalOpen(false);
    }
    if (!options.preserveApplyResult) setPreview(null);
    try {
      const form = new FormData();
      form.append('week', weekInput.value);
      form.append('file', file);
      if (Object.keys(custOverridesRef.current).length) {
        form.append('customerOverrides', JSON.stringify(custOverridesRef.current));
      }
      if (Object.keys(prodOverridesRef.current).length) {
        form.append('productOverrides', JSON.stringify(prodOverridesRef.current));
      }
      // 이번 검증에 실제로 보낸 override 스냅샷 — 검증 결과의 미매칭과 대조해
      // "지정했는데 반영 안 됨"(회귀)을 조용히 넘기지 않고 잡아낸다.
      verifiedOverridesRef.current = {
        cust: { ...custOverridesRef.current },
        prod: { ...prodOverridesRef.current },
      };
      const res = await fetch('/api/shipment/distribute-import-preview', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '검증 실패');
      setPreview(data);
      const orderless = (data.changedRows || []).filter(r => r.status === '주문없음').length;
      const applyCount = (data.rows || []).filter(applyTarget).length;
      const shipmentDiffCount = (data.rows || []).filter(shipmentNeedsApply).length;
      const rowCount = (data.rows || []).length;
      const nextFilter = applyCount > 0 ? 'apply' : rowCount > 0 ? 'all' : 'apply';
      setFilter(nextFilter);
      if (!options.preserveMessage) {
        const viewHint = applyCount === 0 && rowCount > 0 ? ' (변경 없음 — 전체 비교 표시)' : '';
        setMessage(`검증 완료: 적용대상 ${applyCount}건, 신규추가 ${orderless}건, 주문변경 ${data.changedRows?.length || 0}건, 분배차이 ${shipmentDiffCount}건, 미매칭 ${data.unmatched?.length || 0}건${viewHint}`);
      }
      if ((data.unmatched || []).length > 0) {
        const hasCust = (data.unmatched || []).some(u => /업체/.test(u.reason || ''));
        setMatchTab(hasCust ? 'customer' : 'product');
        setUnmatchedModalOpen(true);
      } else {
        setUnmatchedModalOpen(false);
        if (options.preserveModal) {
          setMessage(prev => prev || '미매칭 매칭 완료. 검증 결과를 확인하세요.');
        }
        if (rowCount > 0) {
          requestAnimationFrame(() => {
            comparisonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreAlign = async () => {
    if (!preAlignAvailable) {
      setError('업로드 품종 일괄분배는 전산 nenova.exe의 usp_DistributeTotal/One/Clear 경로와 1:1 검증이 끝날 때까지 비활성화했습니다. 먼저 검증하기로 변경분을 확인한 뒤 승인 후 주문등록+분배를 사용하세요.');
      return;
    }
    if (!weekInput.value) { setError('차수를 입력하세요.'); return; }
    if (!file) { setError('업로드할 엑셀 파일을 선택하세요.'); return; }
    if (!confirm(`${weekInput.value}차 업로드 파일에서 매칭되는 품목 범위를 먼저 일괄 출고분배합니다.\n\n기준: 기존 주문등록 수량\n변경: 출고분배/출고일만 정리\n주문등록 수량은 변경하지 않습니다.\n\n이 작업 후 검증하기를 눌러 엑셀 변경분을 다시 확인하세요.`)) return;

    setPreAligning(true);
    setError('');
    setMessage('');
    setPreview(null);
    setApplyResult(null);
    setApplyModalOpen(false);
    setPreAlignResult({
      running: true,
      logs: [
        `${weekInput.value}차 업로드 품종 일괄 출고분배 시작`,
        '엑셀 파일에서 업체와 품목을 읽고, 기존 주문등록 수량 기준으로 출고분배를 맞추는 중입니다.',
      ],
      appliedRows: [],
    });
    try {
      const form = new FormData();
      form.append('week', weekInput.value);
      form.append('file', file);
      const res = await fetch('/api/shipment/distribute-import-prealign', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '일괄 출고분배 실패');
      setPreAlignResult(data);
      setMessage(`업로드 품종 일괄 출고분배 완료: 반영 ${data.appliedCount || 0}건, 이미 동일 ${data.skippedNoChangeCount || 0}건. 이제 검증하기로 엑셀 변경분을 확인하세요.`);
    } catch (e) {
      setError(e.message);
      setPreAlignResult(prev => ({
        ...(prev || {}),
        running: false,
        failed: true,
        error: e.message,
        logs: [...((prev || {}).logs || []), `오류: ${e.message}`],
      }));
    } finally {
      setPreAligning(false);
    }
  };

  const pickOverride = (label, custKey) => {
    const next = { ...custOverridesRef.current };
    if (isImportIgnoreCustomerValue(custKey)) next[label] = IMPORT_IGNORE_CUSTOMER_VALUE;
    else if (custKey) next[label] = Number(custKey);
    else delete next[label];
    setOverrides(next);
  };

  const pickProdOverride = (key, prodKey) => {
    const next = { ...prodOverridesRef.current };
    if (prodKey) next[key] = Number(prodKey);
    else delete next[key];
    setProdOverridesState(next);
  };

  const handleReverify = async () => {
    await handlePreview({ preserveModal: true });
  };

  const handleApply = async () => {
    if (!preview) return;
    if (unmatchedQtyCount > 0) {
      setError(`미매칭 ${unmatchedQtyCount}건 — 업체·품목 매칭을 완료한 뒤 다시 검증하세요. (업체 ${custMatchPending} / 품목 ${prodMatchPending})`);
      setMatchTab(custMatchPending > 0 ? 'customer' : 'product');
      setUnmatchedModalOpen(true);
      return;
    }
    if (!applyRows.length) {
      const blocked = (preview?.fixBlockedCount || 0);
      setError(
        blocked > 0
          ? `적용 가능한 행이 없습니다. 확정 차단 ${blocked}건 — 미확정 품종만 적용됩니다. 검증 화면에서 '확정차단' 행을 확인하세요.`
          : '적용할 주문변경/분배반영 대상이 없습니다. 분배차이 또는 주문변경 행이 있는지 확인하세요.',
      );
      return;
    }
    const orderCreateText = orderlessRows.length ? `\n신규추가 ${orderlessRows.length}건은 주문등록을 먼저 만든 뒤 분배합니다.` : '';
    const orderChangeText = orderChangeRows.length ? `\n기존 주문수량 변경 ${orderChangeRows.length}건은 엑셀 최종 수량으로 동기화합니다.` : '';
    const shipmentOnlyInfoText = shipmentRows.length && !orderChangeRows.length
      ? `\n분배만 반영 ${shipmentRows.length}건 — 주문등록은 유지하고 출고분배 수량만 변경합니다.`
      : '';
    const shipmentOnlyModeText = shipmentOnly
      ? '\n※ 분배전용 모드: 주문등록(OrderDetail)은 전혀 변경하지 않고 출고분배(ShipmentDetail)만 반영합니다.'
      : '';
    let ackQtyWarnings = false;
    if (qtyWarningRows.length) {
      const sample = qtyWarningRows.slice(0, 3).map(r => `· ${r.custName} / ${r.prodName}: ${qtyWarningText(r)}`).join('\n');
      const ok = confirm(
        `⚠ 수량 단위 이상 징후 ${qtyWarningRows.length}건이 있습니다.\n` +
        `${sample}${qtyWarningRows.length > 3 ? `\n... 외 ${qtyWarningRows.length - 3}건` : ''}\n\n` +
        '박스/단/송이 혼동(예: 10배) 가능성이 있습니다.\n' +
        '그래도 적용하시겠습니까? (취소 권장)'
      );
      if (!ok) return;
      ackQtyWarnings = true;
    } else if (!confirm(`${preview.week}차 검증 결과를 일괄 ${shipmentOnly ? '출고분배' : '주문등록+출고분배'}로 적용하시겠습니까?\n적용대상 ${applyRows.length}건 / 주문변경 ${changedRows.length}건${fixBlockedRows.length ? `\n(확정차단 ${fixBlockedRows.length}건은 품종·라인 확정으로 제외)` : ''}${orderCreateText}${orderChangeText}${shipmentOnlyInfoText}${shipmentOnlyModeText}\n\n※ 분배만 변경되는 행은 주문등록을 삭제하지 않습니다.`)) {
      return;
    }
    setApplying(true); setError(''); setMessage('');
    const initialApplyResult = {
      running: true,
      logs: [
        `${preview.week}차 일괄 ${shipmentOnly ? '출고분배(주문 미변경)' : '주문등록+분배'} 적용 시작`,
        `적용대상 ${applyRows.length}건을 서버 트랜잭션으로 처리 중입니다.`,
      ],
      appliedRows: [],
    };
    setApplyResult(initialApplyResult);
    setApplyModalOpen(true);
    // 실시간 진행 로그 — 서버 트랜잭션이 도는 동안 몇 건째/어떤 업체·품목을 입력 중인지 폴링으로 표시
    const jobId = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' });
        const d = await r.json();
        if (d?.progress) {
          setApplyResult(prev => (prev && prev.running ? { ...prev, progress: d.progress } : prev));
        }
      } catch { /* 폴링 실패는 무시 — 본 요청이 결과를 준다 */ }
    }, 900);
    try {
      const res = await fetch('/api/shipment/distribute-import-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ week: preview.week, rows: applyRows, ackQtyWarnings, shipmentOnly, jobId }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`서버 응답 오류 (${res.status}). 로그인 세션이 만료됐을 수 있습니다.`);
      }
      if (!data.success) {
        if (res.status === 409 && data.code === 'QTY_WARNING') {
          throw new Error(data.error || '수량 단위 이상 징후로 적용이 차단되었습니다. 검증 화면을 다시 확인하세요.');
        }
        throw new Error(data.error || '적용 실패');
      }
      setApplyResult(data);
      const verifyMismatchCount = data.verification?.mismatchCount || 0;
      const verifyText = verifyMismatchCount > 0
        ? ` ⚠ 사후 검증 불일치 ${verifyMismatchCount}건 — 아래 검증 결과를 확인하세요.`
        : data.verification?.checked ? ` (사후 검증 ${data.verification.checked}건 정상 반영 확인)` : '';
      if ((data.appliedCount || 0) === 0) {
        setMessage(`적용 완료: 변경 없음 (이미 DB와 동일 ${data.skippedNoChangeCount || 0}건). 검증하기를 다시 눌러 최신 상태를 확인하세요.${verifyText}`);
      } else {
        setMessage(`적용 완료: 신규추가 ${data.orderCreatedCount || 0}건, 주문수정 ${data.orderUpdatedCount || 0}건, 분배 ${data.shipmentChangedCount || 0}건 (주문삭제 ${data.orderDeletedCount || 0}건)${verifyText}`);
      }
      if (verifyMismatchCount > 0) setError(`사후 검증에서 미반영·불일치 ${verifyMismatchCount}건이 발견됐습니다. 적용 내역 아래 검증 결과 표를 확인하세요.`);
      await handlePreview({ preserveMessage: true, preserveApplyResult: true });
    } catch (e) {
      setError(e.message);
      setApplyResult(prev => ({
        ...(prev || initialApplyResult),
        running: false,
        failed: true,
        error: e.message,
        logs: [...((prev || initialApplyResult).logs || []), `오류: ${e.message}`],
      }));
      setApplyModalOpen(true);
    } finally {
      clearInterval(pollTimer);
      setApplying(false);
    }
  };

  return (
    <Layout>
      <div style={st.page}>
        <div style={st.toolbar}>
          <div>
            <h1 style={st.title}>출고분배 엑셀 검증 업로드</h1>
            <div style={st.sub}>차수피벗 출고리스트 또는 분류프로그램 물량표를 읽어 기존 주문등록 수량 기준으로 변경을 검증합니다.</div>
          </div>
          <div style={st.controls}>
            <button onClick={weekInput.prevWeek} style={st.iconBtn}>◁</button>
            <button onClick={weekInput.prev} style={st.iconBtn}>‹</button>
            <input {...weekInput.props} style={st.weekInput} placeholder="22-01" />
            <button onClick={weekInput.next} style={st.iconBtn}>›</button>
            <button onClick={weekInput.nextWeek} style={st.iconBtn}>▷</button>
          </div>
        </div>

        <div style={st.uploadBand}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
              setApplyResult(null);
              setPreAlignResult(null);
              setMessage('');
              setError('');
              setOverrides({});
              setProdOverridesState({});
              setUnmatchedModalOpen(false);
            }}
          />
          <button style={st.secondaryBtn} onClick={() => fileRef.current?.click()}>파일 선택</button>
          <span style={st.fileName}>{file ? file.name : '차수피벗 출고리스트 또는 분류프로그램 결과 물량표 엑셀을 선택하세요'}</span>
          <button
            style={preAlignAvailable ? st.preAlignBtn : st.preAlignDisabledBtn}
            onClick={handlePreAlign}
            disabled={preAligning || loading || applying || !file || !preAlignAvailable}
            title="전산 nenova.exe의 usp_DistributeTotal/One/Clear 경로와 1:1 검증이 끝날 때까지 비활성화"
          >
            {preAligning ? '일괄분배 중...' : '업로드 품종 일괄분배'}
          </button>
          <button style={st.primaryBtn} onClick={handlePreview} disabled={loading}>{loading ? '읽는 중...' : '검증하기'}</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#374151', whiteSpace: 'nowrap' }} title="켜면 주문등록(OrderDetail)은 전혀 변경하지 않고 출고분배(ShipmentDetail)만 반영합니다.">
            <input type="checkbox" checked={shipmentOnly} onChange={e => setShipmentOnly(e.target.checked)} />
            분배만 반영(주문 미변경)
          </label>
          <button style={st.applyBtn} onClick={handleApply} disabled={applying || !preview}>
            {applying ? '적용 중...' : shipmentOnly ? '승인 후 분배만 반영' : '승인 후 주문등록+분배'}
          </button>
        </div>

        {error && <div style={st.error}>{error}</div>}
        {message && <div style={st.message}>{message}</div>}
        {staleOverrideWarnings.length > 0 && (
          <div style={{ ...st.error, background: '#fef2f2', borderColor: '#ef4444' }}>
            ⚠ 매칭 반영 실패 {staleOverrideWarnings.length}건 — 지정한 매칭이 검증 결과에 적용되지 않고 미매칭으로 되돌아왔습니다.
            같은 항목을 다시 지정하지 말고 이 메시지를 관리자에게 알려주세요.
            <div style={{ fontSize: 11, marginTop: 4 }}>{staleOverrideWarnings.join(' · ')}</div>
          </div>
        )}
        {preAlignResult && (
          <div style={{ marginBottom: 12 }}>
            <PreAlignResultLog result={preAlignResult} />
          </div>
        )}
        {applyResult && (
          <div ref={applyResultRef} style={{ marginBottom: 12 }}>
            <ApplyResultLog result={applyResult} />
          </div>
        )}
        <ApplyProgressModal
          result={applyResult}
          open={applyModalOpen}
          onClose={() => setApplyModalOpen(false)}
        />
        <UnmatchedMatchingModal
          open={unmatchedModalOpen}
          matchTab={matchTab}
          onTabChange={setMatchTab}
          customerItems={unmatchedCustomers}
          productItems={unmatchedProducts}
          customerOptions={preview?.customerOptions || []}
          productOptions={preview?.productOptions || []}
          custOverrides={custOverrides}
          prodOverrides={prodOverrides}
          onPickCustomer={pickOverride}
          onPickProduct={pickProdOverride}
          onReverify={handleReverify}
          onClose={() => setUnmatchedModalOpen(false)}
          loading={loading}
          custPending={custMatchPending}
          prodPending={prodMatchPending}
        />

        {preview && unmatchedQtyCount > 0 && (
          <div style={st.unmatchedBanner}>
            ⚠️ 미매칭 {unmatchedQtyCount}건 — 업체 {custMatchPending} / 품목 {prodMatchPending} 매칭 필요
            <button style={st.unmatchedBannerBtn} onClick={() => {
              setMatchTab(custMatchPending > 0 ? 'customer' : 'product');
              setUnmatchedModalOpen(true);
            }}>매칭하기</button>
          </div>
        )}
        {preview && qtyWarningRows.length > 0 && (
          <div style={st.qtyWarnBanner}>
            ⚠️ 수량 단위 이상 징후 {qtyWarningRows.length}건 — 박스/단/송이 혼동(10배 등) 가능성. 적용 전 반드시 확인하세요.
            <button style={st.unmatchedBannerBtn} onClick={() => { setFilter('all'); setViewMode('list'); }}>경고 행 보기</button>
          </div>
        )}

        {preview && (
          <>
            <div style={st.kpis}>
              <Kpi label="전체 표시" value={rows.length} />
              <Kpi label="주문변경" value={changedRows.length} warn={changedRows.length > 0} />
              <Kpi label="분배차이" value={shipmentRows.length} warn={shipmentRows.length > 0} />
              <Kpi label="신규추가" value={orderlessRows.length} warn={orderlessRows.length > 0} />
              <Kpi label="미매칭" value={preview.unmatched?.length || 0} danger={(preview.unmatched?.length || 0) > 0} />
              <Kpi label="적용가능" value={applyRows.length} warn={applyRows.length > 0} />
              <Kpi label="확정차단" value={fixBlockedRows.length} danger={fixBlockedRows.length > 0} />
              <Kpi label="수량경고" value={qtyWarningRows.length} danger={qtyWarningRows.length > 0} />
            </div>

            <div style={st.grid}>
              <section style={st.panel}>
                <div style={st.panelHead}>
                  <strong>검증 로그</strong>
                </div>
                <div style={st.logBox}>
                  {(preview.logs || []).map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </section>
              <section style={st.panel}>
                <div style={st.panelHead}>
                  <strong>업체별 합계</strong>
                </div>
                <div style={st.tableWrap}>
                  <table style={st.table}>
                    <thead><tr><th>업체</th><th>주문등록</th><th>현재분배</th><th>엑셀수량</th><th>주문변경</th><th>분배차이</th><th>주문변경품목</th><th>분배반영품목</th></tr></thead>
                    <tbody>
                      {(preview.summaryByCustomer || []).map(r => (
                        <tr key={r.custName}>
                          <td>{r.custName}</td><td>{fmt(r.orderQty)}</td><td>{fmt(r.currentOutQty)}</td>
                          <td>{fmt(r.uploadQty)}</td><td style={{ color: r.changeQty ? '#b45309' : '#475569' }}>{fmt(r.changeQty)}</td>
                          <td style={{ color: r.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(r.shipmentDiffQty)}</td><td>{r.changedLines}</td><td>{r.shipmentChangedLines}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div ref={comparisonRef} style={st.panel}>
              <div style={st.panelHead}>
                <strong>업체별 품목 수량 비교</strong>
                <div style={st.panelActions}>
                  {filter !== 'unmatched' && (
                    <div style={st.segment}>
                      <button onClick={() => setViewMode('pivot')} style={viewMode === 'pivot' ? st.segOn : st.seg}>피벗보기</button>
                      <button onClick={() => setViewMode('list')} style={viewMode === 'list' ? st.segOn : st.seg}>상세목록</button>
                    </div>
                  )}
                  <div style={st.segment}>
                    <button onClick={() => setFilter('apply')} style={filter === 'apply' ? st.segOn : st.seg}>적용대상</button>
                    <button onClick={() => setFilter('changed')} style={filter === 'changed' ? st.segOn : st.seg}>주문변경만</button>
                    <button onClick={() => setFilter('shipment')} style={filter === 'shipment' ? st.segOn : st.seg}>분배차이만</button>
                    <button onClick={() => setFilter('all')} style={filter === 'all' ? st.segOn : st.seg}>전체</button>
                    <button onClick={() => setFilter('unmatched')} style={filter === 'unmatched' ? st.segOn : st.seg}>미매칭</button>
                  </div>
                </div>
              </div>
              {filter === 'unmatched' ? (
                <SimpleUnmatched rows={preview.unmatched || []} />
              ) : viewMode === 'pivot' ? (
                <PivotComparison
                  model={pivotModel}
                  filter={filter}
                  filterFallback={pivotFilterFallback}
                  onShowAll={() => setFilter('all')}
                />
              ) : (
                <div style={st.tableWrapLarge}>
                  <table style={st.table}>
                    <thead>
                      <tr><th>상태</th><th>업체</th><th>품목</th><th>단위</th><th>주문등록</th><th>현재분배</th><th>엑셀수량</th><th>주문변경</th><th>분배차이</th><th>수량경고</th><th>셀</th></tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(r => (
                        <tr key={r.key} style={{ background: r.fixBlocked ? rowBg(r) : (r.hasQtyWarning ? '#fef2f2' : rowBg(r)) }}>
                          <td title={r.fixBlockReason || ''}>{rowStatusText(r)}</td>
                          <td>{r.custName}</td>
                          <td>{r.displayName || r.prodName}</td>
                          <td>{r.outUnit}</td>
                          <td>{fmt(r.orderQty)}</td>
                          <td>{fmt(r.currentOutQty)}</td>
                          <td>{fmtUpload(r)}</td>
                          <td>{fmt(r.changeQty)}</td>
                          <td>{fmt(shipmentDiffQty(r))}</td>
                          <td style={r.hasQtyWarning ? st.qtyWarnCell : undefined}>{qtyWarningText(r)}</td>
                          <td>{(r.cells || []).slice(0, 2).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <style jsx global>{`
        table th {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #f1f5f9;
          color: #334155;
          font-weight: 700;
        }
        table th, table td {
          border-bottom: 1px solid #e2e8f0;
          padding: 7px 8px;
          text-align: left;
          white-space: nowrap;
        }
        table td:nth-child(n+4), table th:nth-child(n+4) {
          text-align: right;
        }
        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
    </Layout>
  );
}

function PivotComparison({ model, filter, filterFallback, onShowAll }) {
  if (!model.products.length) {
    const filterLabel = filter === 'apply' ? '적용대상'
      : filter === 'changed' ? '주문변경'
      : filter === 'shipment' ? '분배차이'
      : '선택';
    return (
      <div style={{ padding: 18, color: '#64748b', lineHeight: 1.6 }}>
        {filter !== 'all' && filter !== 'unmatched'
          ? `${filterLabel} 필터에 표시할 품목이 없습니다.`
          : '표시할 품목 수량이 없습니다.'}
        {filter !== 'all' && onShowAll && (
          <div style={{ marginTop: 10 }}>
            <button style={st.unmatchedBannerBtn} onClick={onShowAll}>전체 비교 보기</button>
          </div>
        )}
      </div>
    );
  }
  const totals = model.customers.reduce((acc, c) => {
    acc.orderQty += c.orderQty;
    acc.currentOutQty += c.currentOutQty;
    acc.uploadQty += c.uploadQty;
    acc.changeQty += c.changeQty;
    acc.shipmentDiffQty += c.shipmentDiffQty;
    return acc;
  }, { orderQty: 0, currentOutQty: 0, uploadQty: 0, changeQty: 0, shipmentDiffQty: 0 });
  return (
    <div style={st.pivotWrap}>
      {filterFallback && (
        <div style={{ padding: '10px 12px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', color: '#1e40af', fontSize: 12, fontWeight: 700 }}>
          {filter === 'apply' ? '적용대상' : filter === 'changed' ? '주문변경' : '분배차이'} 필터에 해당 행이 없어 전체 비교를 표시합니다.
        </div>
      )}
      <table style={st.pivotTable}>
        <thead>
          <tr>
            <th style={{ ...st.pivotStickyHead, minWidth: 230 }}>품목</th>
            {model.customers.map(c => (
              <th key={c.key} style={st.pivotCustHead}>
                <div style={st.custName}>{c.name}</div>
                <div style={st.custMeta}>엑셀 {fmt(c.uploadQty)} / 주문변경 {fmt(c.changeQty)} / 분배차이 {fmt(c.shipmentDiffQty)}</div>
              </th>
            ))}
            <th style={st.pivotTotalHead}>주문등록</th>
            <th style={st.pivotTotalHead}>현재분배</th>
            <th style={st.pivotTotalHead}>엑셀수량</th>
            <th style={st.pivotTotalHead}>주문변경</th>
            <th style={st.pivotTotalHead}>분배차이</th>
          </tr>
        </thead>
        <tbody>
          {model.products.map(p => (
            <tr key={p.key}>
              <td style={st.pivotProductCell}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{p.outUnit || '박스'} · 주문변경 {p.changedLines}건 · 분배반영 {p.shipmentChangedLines}건</div>
              </td>
              {model.customers.map(c => {
                const r = p.cells.get(c.key);
                if (!r) return <td key={c.key} style={st.pivotEmptyCell} />;
                const changed = rowChanged(r);
                const orderDiff = orderChanged(r);
                const shipDiff = shipmentNeedsApply(r);
                return (
                  <td key={c.key} style={{
                    ...st.pivotQtyCell,
                    background: rowBg(r),
                    borderColor: changed ? '#fdba74' : shipDiff ? '#86efac' : '#e2e8f0',
                  }}>
                    <div style={{ ...st.qtyMain, color: changed ? '#9a3412' : '#0f172a' }}>
                      {fmtUpload(r)}
                    </div>
                    {orderDiff && (
                      <div style={{ ...st.qtySub, color: '#b45309' }}>
                        주문 {fmt(r.orderQty)} → {fmt(r.uploadQty)}
                      </div>
                    )}
                    {shipDiff && (
                      <div style={{ ...st.qtySub, color: '#15803d' }}>
                        분배 {fmt(r.currentOutQty)} → {fmt(r.uploadQty)}
                      </div>
                    )}
                    {r.status === '주문없음' && <div style={st.createBadge}>신규추가</div>}
                  </td>
                );
              })}
              <td style={st.totalCell}>{fmt(p.orderQty)}</td>
              <td style={st.totalCell}>{fmt(p.currentOutQty)}</td>
              <td style={st.totalCellStrong}>{fmt(p.uploadQty)}</td>
              <td style={{ ...st.totalCellStrong, color: p.changeQty ? '#b45309' : '#475569' }}>{fmt(p.changeQty)}</td>
              <td style={{ ...st.totalCellStrong, color: p.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(p.shipmentDiffQty)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={st.pivotProductCell}>합계</td>
            {model.customers.map(c => (
              <td key={c.key} style={st.totalCellStrong}>{fmt(c.uploadQty)}</td>
            ))}
            <td style={st.totalCellStrong}>{fmt(totals.orderQty)}</td>
            <td style={st.totalCellStrong}>{fmt(totals.currentOutQty)}</td>
            <td style={st.totalCellStrong}>{fmt(totals.uploadQty)}</td>
            <td style={{ ...st.totalCellStrong, color: totals.changeQty ? '#b45309' : '#475569' }}>{fmt(totals.changeQty)}</td>
            <td style={{ ...st.totalCellStrong, color: totals.shipmentDiffQty ? '#15803d' : '#475569' }}>{fmt(totals.shipmentDiffQty)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ApplyProgressModal({ result, open, onClose }) {
  if (!open || !result) return null;
  const statusText = result.running ? '처리 중' : result.failed ? '오류 발생' : `작업 ${fmt(result.appliedCount)}건 완료`;
  return (
    <div style={st.modalOverlay}>
      <div style={st.modalCard} role="dialog" aria-modal="true" aria-label="작업 현황">
        <div style={st.modalHead}>
          <div>
            <div style={st.modalTitle}>작업 현황</div>
            <div style={{
              ...st.modalSubtitle,
              color: result.running ? '#b45309' : result.failed ? '#b91c1c' : '#166534',
            }}>{statusText}</div>
          </div>
          <button
            type="button"
            style={{ ...st.modalCloseBtn, opacity: result.running ? 0.55 : 1 }}
            onClick={onClose}
            disabled={result.running}
          >
            닫기
          </button>
        </div>
        <ApplyResultContent result={result} />
      </div>
    </div>
  );
}

function ApplyResultLog({ result }) {
  return (
    <div style={st.panel}>
      <div style={st.panelHead}>
        <strong>주문등록 및 출고분배 작업 내역</strong>
        <span style={{ fontSize: 12, color: result.running ? '#b45309' : result.failed ? '#b91c1c' : '#166534', fontWeight: 800 }}>
          {result.running ? '처리 중' : result.failed ? '오류 발생' : `작업 ${fmt(result.appliedCount)}건 완료`}
        </span>
      </div>
      <ApplyResultContent result={result} />
    </div>
  );
}

function PreAlignResultLog({ result }) {
  const rows = result.appliedRows || [];
  const summary = [
    { label: '업로드 품목', value: result.productCount || 0, tone: '#0f766e' },
    { label: '대상 업체', value: result.customerCount || 0, tone: '#2563eb' },
    { label: '분배 반영', value: result.shipmentChangedCount || result.appliedCount || 0, tone: '#15803d' },
    { label: '이미 동일', value: result.skippedNoChangeCount || 0, tone: '#64748b' },
    { label: '주문없음 제외', value: result.skippedNoOrderCount || 0, tone: '#b45309' },
  ];
  return (
    <div style={st.panel}>
      <div style={st.panelHead}>
        <strong>업로드 품종 사전 일괄분배 내역</strong>
        <span style={{ fontSize: 12, color: result.running ? '#b45309' : result.failed ? '#b91c1c' : '#166534', fontWeight: 800 }}>
          {result.running ? '처리 중' : result.failed ? '오류 발생' : `분배 ${fmt(result.appliedCount)}건 반영`}
        </span>
      </div>
      <div style={st.applyResultBody}>
        <div style={st.applySummaryGrid}>
          {summary.map(s => (
            <div key={s.label} style={st.applySummaryCard}>
              <span>{s.label}</span>
              <strong style={{ color: s.tone }}>{fmt(s.value)}</strong>
            </div>
          ))}
        </div>
        {(result.logs || []).length > 0 && (
          <div style={st.applyLogBox}>
            {(result.logs || []).map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
        {result.error && (
          <div style={st.applyErrorBox}>{result.error}</div>
        )}
        {result.running && (
          <div style={st.applyStepBox}>
            <div>업로드 엑셀에서 업체와 품목을 매칭하고 있습니다.</div>
            <div>매칭된 품목만 기존 주문등록 수량 기준으로 출고분배와 출고일을 정리합니다.</div>
            <div>주문등록 수량은 변경하지 않습니다.</div>
          </div>
        )}
        <div style={st.applyTableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th>업체명</th>
                <th>품목명</th>
                <th>주문기준 수량</th>
                <th>출고분배 변화</th>
                <th>처리 내용</th>
                <th>출고일</th>
              </tr>
            </thead>
            <tbody>
              {result.running ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>작업이 끝나면 업체별 사전 분배 내역이 여기에 표시됩니다.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>사전 분배로 변경된 행이 없습니다.</td></tr>
              ) : rows.slice(0, 1000).map((r, i) => (
                <tr key={`${r.key || i}-${r.shipmentDetailKey || ''}`}>
                  <td>{r.custName}</td>
                  <td>{r.displayName || r.prodName}</td>
                  <td>{fmt(r.orderQty)}</td>
                  <td style={{ color: '#15803d', fontWeight: 800 }}>{fmt(r.beforeQty)} → {fmt(r.afterQty)}</td>
                  <td>
                    <span style={{
                      ...st.actionBadge,
                      background: r.shipmentAction === '분배삭제' ? '#fee2e2' : r.shipmentAction === '출고일정리' ? '#fef3c7' : '#dcfce7',
                      color: r.shipmentAction === '분배삭제' ? '#991b1b' : r.shipmentAction === '출고일정리' ? '#92400e' : '#166534',
                    }}>{r.shipmentAction}</span>
                  </td>
                  <td>{r.shipDate || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VerificationBanner({ verification }) {
  if (!verification) return null;
  const { checked = 0, matched = 0, mismatchCount = 0, mismatches = [], error } = verification;
  if (error) {
    return (
      <div style={st.verifyErrorBox}>
        ⚠ 사후 검증 실패(반영 여부 미확인): {error}
      </div>
    );
  }
  if (!checked) return null;
  const hasMismatch = mismatchCount > 0;
  return (
    <div style={hasMismatch ? st.verifyMismatchBox : st.verifyOkBox}>
      <div style={st.verifyHead}>
        {hasMismatch
          ? `⚠ 사후 검증: 정상 반영 ${fmt(matched)}건 / 미반영·불일치 ${fmt(mismatchCount)}건`
          : `✅ 사후 검증: 정상 반영 ${fmt(matched)}건 (확인 ${fmt(checked)}건 전체 일치)`}
      </div>
      {hasMismatch && (
        <div style={st.verifyTableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th>거래처</th>
                <th>품목</th>
                <th>의도 수량</th>
                <th>실제 DB 수량</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((m, i) => (
                <tr key={`${m.custKey}-${m.prodKey}-${i}`}>
                  <td>{m.custName}</td>
                  <td>{m.prodName}</td>
                  <td>{fmt(m.intended)}</td>
                  <td style={{ color: '#b91c1c', fontWeight: 800 }}>{fmt(m.actual)}</td>
                  <td>{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApplyResultContent({ result }) {
  const rows = result.appliedRows || [];
  const summary = [
    { label: '주문 신규/추가', value: result.orderCreatedCount || 0, tone: '#1d4ed8' },
    { label: '주문수량 수정', value: result.orderUpdatedCount || 0, tone: '#b45309' },
    { label: '주문 삭제', value: result.orderDeletedCount || 0, tone: '#b91c1c' },
    { label: '분배 입력/수정', value: result.shipmentChangedCount || 0, tone: '#15803d' },
    { label: '이미 동일해서 건너뜀', value: result.skippedNoChangeCount || 0, tone: '#64748b' },
  ];
  return (
    <div style={st.applyResultBody}>
      <div style={st.applySummaryGrid}>
        {summary.map(s => (
          <div key={s.label} style={st.applySummaryCard}>
            <span>{s.label}</span>
            <strong style={{ color: s.tone }}>{fmt(s.value)}</strong>
          </div>
        ))}
      </div>
      {!result.running && <VerificationBanner verification={result.verification} />}
      {(result.logs || []).length > 0 && (
        <div style={st.applyLogBox}>
          {(result.logs || []).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      {result.error && (
        <div style={st.applyErrorBox}>{result.error}</div>
      )}
      {result.running && result.progress && (
        <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: '#1d4ed8', marginBottom: 6 }}>
            <span>{result.progress.stage}</span>
            <span>{result.progress.done}/{result.progress.total}건</span>
          </div>
          <div style={{ height: 8, background: '#dbeafe', borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              height: '100%',
              width: `${result.progress.total > 0 ? Math.min(100, Math.round(result.progress.done / result.progress.total * 100)) : 0}%`,
              background: '#2563eb',
              transition: 'width .4s',
            }} />
          </div>
          {result.progress.current && (
            <div style={{ fontSize: 12, color: '#334155' }}>지금 처리 중: <b>{result.progress.current}</b></div>
          )}
          {(result.progress.logs || []).length > 0 && (
            <div style={{ ...st.applyLogBox, maxHeight: 180, marginTop: 8 }}>
              {result.progress.logs.slice(-40).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}
      {result.running && (
        <div style={st.applyStepBox}>
          <div>검증된 엑셀 수량으로 주문등록을 먼저 맞추는 중입니다.</div>
          <div>없는 주문은 새로 등록하고, 0으로 바뀐 주문은 삭제 처리합니다.</div>
          <div>주문등록이 맞춰지면 같은 수량으로 출고분배를 입력합니다.</div>
        </div>
      )}
      <div style={st.applyTableWrap}>
        <table style={st.table}>
          <thead>
            <tr>
              <th>업체명</th>
              <th>품목명</th>
              <th>주문등록 변화</th>
              <th>출고분배 변화</th>
              <th>처리 내용</th>
              <th>출고일</th>
            </tr>
          </thead>
          <tbody>
            {result.running ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>작업이 끝나면 업체별 처리 내역이 여기에 표시됩니다.</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>적용된 행이 없습니다.</td></tr>
            ) : rows.slice(0, 1000).map((r, i) => (
              <tr key={`${r.key || i}-${r.shipmentDetailKey || ''}`}>
                <td>{r.custName}</td>
                <td>{r.displayName || r.prodName}</td>
                <td style={{ color: r.orderChanged ? '#b45309' : '#64748b', fontWeight: r.orderChanged ? 800 : 500 }}>
                  {fmt(r.orderQty)} → {fmt(r.uploadQty)}
                </td>
                <td style={{ color: r.shipmentChanged ? '#15803d' : '#64748b', fontWeight: r.shipmentChanged ? 800 : 500 }}>
                  {fmt(r.beforeQty)} → {fmt(r.afterQty)}
                </td>
                <td>
                  <span style={{
                    ...st.actionBadge,
                    background: r.orderAction === '주문삭제' ? '#fee2e2' : r.orderAction?.includes('신규') || r.orderAction?.includes('추가') ? '#dbeafe' : '#fef3c7',
                    color: r.orderAction === '주문삭제' ? '#991b1b' : r.orderAction?.includes('신규') || r.orderAction?.includes('추가') ? '#1d4ed8' : '#92400e',
                  }}>{r.orderAction}</span>
                  <span style={{
                    ...st.actionBadge,
                    marginLeft: 6,
                    background: r.shipmentChanged ? '#dcfce7' : '#f1f5f9',
                    color: r.shipmentChanged ? '#166534' : '#64748b',
                  }}>{r.shipmentAction}</span>
                </td>
                <td>{r.shipDate || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchKindBadge({ kind }) {
  const label = kind === 'both' ? '업체+품목' : kind === 'product' ? '품목' : '업체';
  const bg = kind === 'both' ? '#fef3c7' : kind === 'product' ? '#dbeafe' : '#ffedd5';
  const color = kind === 'both' ? '#92400e' : kind === 'product' ? '#1d4ed8' : '#9a3412';
  return <span style={{ ...st.matchKindBadge, background: bg, color }}>{label}</span>;
}

function customerOptionLabel(o) {
  const area = o.area || o.CustArea || '';
  const name = o.custName || o.CustName || '';
  const code = o.orderCode || o.OrderCode || '';
  return `${area ? `[${area}] ` : ''}${name}${code ? ` (${code})` : ''}`;
}

// 드롭다운을 모달 밖(document.body)에 portal 로 띄우기 위한 위치 계산.
// 모달 content 가 overflow:auto 라 position:absolute 드롭다운이 모달 경계에 잘리는 문제 방지.
function computeDropdownRect(anchorEl, estimatedHeight = 320) {
  if (!anchorEl) return null;
  const r = anchorEl.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - r.bottom;
  const spaceAbove = r.top;
  const openUp = spaceBelow < Math.min(estimatedHeight, 240) && spaceAbove > spaceBelow;
  return {
    left: r.left,
    width: Math.max(r.width, 260),
    top: openUp ? undefined : r.bottom + 2,
    bottom: openUp ? viewportH - r.top + 2 : undefined,
    maxHeight: Math.max(160, (openUp ? spaceAbove : spaceBelow) - 12),
  };
}

function CustomerSearchSelect({ value, onChange, suggested = [], options = [], placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const pickLabel = (custKey) => {
    if (isImportIgnoreCustomerValue(custKey)) return '';
    const s = suggested.find(x => String(x.custKey) === String(custKey));
    if (s) return customerOptionLabel(s);
    const r = remote.find(x => String(x.CustKey) === String(custKey));
    if (r) return customerOptionLabel(r);
    const o = options.find(x => String(x.custKey ?? x.CustKey) === String(custKey));
    if (o) return customerOptionLabel(o);
    return '';
  };

  const recomputeRect = useCallback(() => {
    setRect(computeDropdownRect(inputRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    recomputeRect();
    const onScroll = () => recomputeRect();
    const onResize = () => recomputeRect();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, recomputeRect]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (e.target.closest?.('[data-cust-search-dropdown]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setRemote([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin' });
        const d = await res.json();
        setRemote(d.customers || []);
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const suggestedIds = new Set(suggested.map(s => String(s.custKey)));
  const searchHits = remote.filter(c => !suggestedIds.has(String(c.CustKey)));

  const dropdown = open && rect && typeof document !== 'undefined' ? createPortal(
    <div
      data-cust-search-dropdown="1"
      style={{
        ...st.searchDropdownFixed,
        left: rect.left,
        width: rect.width,
        top: rect.top,
        bottom: rect.bottom,
        maxHeight: rect.maxHeight,
      }}
    >
      {suggested.map(s => (
        <button
          key={`s-${s.custKey}`}
          type="button"
          style={st.searchPickRow}
          onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
          onClick={() => { onChange(String(s.custKey)); setQuery(''); setOpen(false); }}
        >
          ★ {customerOptionLabel(s)}
        </button>
      ))}
      {suggested.length > 0 && (searchHits.length > 0 || loading) && (
        <div style={st.searchSectionLabel}>검색 결과</div>
      )}
      {loading && <div style={st.searchHint}>검색 중…</div>}
      {!loading && query.trim() && searchHits.length === 0 && (
        <div style={st.searchHint}>검색 결과 없음</div>
      )}
      {searchHits.map(c => (
        <button
          key={c.CustKey}
          type="button"
          style={st.searchPickRow}
          onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
          onClick={() => { onChange(String(c.CustKey)); setQuery(''); setOpen(false); }}
        >
          {customerOptionLabel(c)}
        </button>
      ))}
      {!query.trim() && suggested.length === 0 && (
        <div style={st.searchHint}>이름·코드·Descr 일부를 입력하세요</div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 220 }}>
      <input
        ref={inputRef}
        style={{ ...st.custSelect, width: '100%', boxSizing: 'border-box' }}
        value={open ? query : (pickLabel(value) || query)}
        placeholder={placeholder || '거래처명·코드 검색'}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange('');
        }}
        onFocus={() => setOpen(true)}
      />
      {dropdown}
    </div>
  );
}

function productOptionLabel(p) {
  const name = p.displayName || p.DisplayName || p.prodName || p.ProdName || '';
  const unit = p.outUnit || p.OutUnit || '';
  const cf = p.countryFlower || p.CountryFlower || '';
  return [name, unit, cf].filter(Boolean).join(' · ');
}

/** 품목 검색+선택 — CustomerSearchSelect 와 동일 UX (★추천 + 전체 검색, portal 드롭다운) */
function ProductSearchSelect({ value, onChange, suggested = [], options = [], placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const pickLabel = (prodKey) => {
    const s = suggested.find(x => String(x.prodKey) === String(prodKey));
    if (s) return productOptionLabel(s);
    const r = remote.find(x => String(x.ProdKey) === String(prodKey));
    if (r) return productOptionLabel(r);
    const o = options.find(x => String(x.prodKey ?? x.ProdKey) === String(prodKey));
    if (o) return productOptionLabel(o);
    return '';
  };

  const recomputeRect = useCallback(() => {
    setRect(computeDropdownRect(inputRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    recomputeRect();
    const onScroll = () => recomputeRect();
    const onResize = () => recomputeRect();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, recomputeRect]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (e.target.closest?.('[data-cust-search-dropdown]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setRemote([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin' });
        const d = await res.json();
        setRemote((d.products || []).slice(0, 60));
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const suggestedIds = new Set(suggested.map(s => String(s.prodKey)));
  const searchHits = remote.filter(p => !suggestedIds.has(String(p.ProdKey)));

  const dropdown = open && rect && typeof document !== 'undefined' ? createPortal(
    <div
      data-cust-search-dropdown="1"
      style={{
        ...st.searchDropdownFixed,
        left: rect.left,
        width: rect.width,
        top: rect.top,
        bottom: rect.bottom,
        maxHeight: rect.maxHeight,
      }}
    >
      {suggested.map(s => (
        <button
          key={`s-${s.prodKey}`}
          type="button"
          style={st.searchPickRow}
          onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
          onClick={() => { onChange(String(s.prodKey)); setQuery(''); setOpen(false); }}
        >
          ★ {productOptionLabel(s)}
        </button>
      ))}
      {suggested.length > 0 && (searchHits.length > 0 || loading) && (
        <div style={st.searchSectionLabel}>검색 결과</div>
      )}
      {loading && <div style={st.searchHint}>검색 중…</div>}
      {!loading && query.trim() && searchHits.length === 0 && (
        <div style={st.searchHint}>검색 결과 없음</div>
      )}
      {searchHits.map(p => (
        <button
          key={p.ProdKey}
          type="button"
          style={st.searchPickRow}
          onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
          onClick={() => { onChange(String(p.ProdKey)); setQuery(''); setOpen(false); }}
        >
          {productOptionLabel(p)}
        </button>
      ))}
      {!query.trim() && suggested.length === 0 && (
        <div style={st.searchHint}>품목명·코드·품종 일부를 입력하세요</div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 220 }}>
      <input
        ref={inputRef}
        style={{ ...st.custSelect, width: '100%', boxSizing: 'border-box' }}
        value={open ? query : (pickLabel(value) || query)}
        placeholder={placeholder || '품목명·코드 검색'}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange('');
        }}
        onFocus={() => setOpen(true)}
      />
      {dropdown}
    </div>
  );
}

function SuggestSelect({ value, onChange, suggested = [], options = [], renderSuggested, renderOption, placeholder }) {
  const suggestedIds = new Set(suggested.map(s => String(s.custKey ?? s.prodKey)));
  return (
    <select style={st.custSelect} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder || '— 선택 —'}</option>
      {suggested.map(s => (
        <option key={`s-${s.custKey ?? s.prodKey}`} value={s.custKey ?? s.prodKey}>
          ★ {renderSuggested(s)}
        </option>
      ))}
      {suggested.length > 0 && options.some(o => !suggestedIds.has(String(o.custKey ?? o.prodKey))) && (
        <option disabled>────────</option>
      )}
      {options.filter(o => !suggestedIds.has(String(o.custKey ?? o.prodKey))).map(o => (
        <option key={o.custKey ?? o.prodKey} value={o.custKey ?? o.prodKey}>
          {renderOption(o)}
        </option>
      ))}
    </select>
  );
}

function UnmatchedMatchingModal({
  open, matchTab, onTabChange,
  customerItems, productItems,
  customerOptions, productOptions,
  custOverrides, prodOverrides,
  onPickCustomer, onPickProduct,
  onReverify, onClose, loading,
  custPending, prodPending,
}) {
  if (!open) return null;
  const custResolved = customerItems.filter(it => custOverrides[it.label]).length;
  const prodResolved = productItems.filter(it => prodOverrides[it.key]).length;
  const canReverify = custResolved + prodResolved > 0;
  return (
    <div style={st.modalOverlay}>
      <div style={{ ...st.modalCard, width: 'min(1100px, 97vw)' }} role="dialog" aria-modal="true" aria-label="미매칭 매칭">
        <div style={st.modalHead}>
          <div>
            <div style={st.modalTitle}>⚠️ 미매칭 — 업체/품목 수동 매칭</div>
            <div style={{ ...st.modalSubtitle, color: '#b45309' }}>
              추천 후보를 확인하고 거래처·품목을 지정한 뒤 <b>다시 검증</b>하세요.
            </div>
          </div>
          <button type="button" style={st.modalCloseBtn} onClick={onClose}>닫기</button>
        </div>
        <div style={st.matchTabRow}>
          <button type="button" style={matchTab === 'customer' ? st.matchTabOn : st.matchTabOff} onClick={() => onTabChange('customer')}>
            업체 미매칭 {customerItems.length > 0 ? `(${custPending} 남음)` : '(0)'}
          </button>
          <button type="button" style={matchTab === 'product' ? st.matchTabOn : st.matchTabOff} onClick={() => onTabChange('product')}>
            품목 미매칭 {productItems.length > 0 ? `(${prodPending} 남음)` : '(0)'}
          </button>
        </div>
        <div style={{ padding: 16, overflow: 'auto', maxHeight: '72vh' }}>
          {matchTab === 'customer' ? (
            customerItems.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>업체 미매칭 없음</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                  엑셀 업체명 → 실제 거래처. ★ 추천 후보 우선 · 이름/코드 입력으로 전체 검색 가능합니다.
                </div>
                <table style={st.table}>
                  <thead><tr><th>구분</th><th>엑셀 업체</th><th>건수</th><th>샘플 품목</th><th>→ 거래처 선택</th><th>제외</th></tr></thead>
                  <tbody>
                    {customerItems.map(it => {
                      const ignored = isImportIgnoreCustomerValue(custOverrides[it.label]);
                      return (
                        <tr key={it.label} style={{ background: ignored ? '#f1f5f9' : custOverrides[it.label] ? '#ecfdf5' : '#fff7ed' }}>
                          <td><MatchKindBadge kind={it.matchKind === 'both' ? 'both' : 'customer'} /></td>
                          <td style={{ fontWeight: 700 }}>{it.label}</td>
                          <td>{it.count}</td>
                          <td style={{ fontSize: 11, color: '#64748b' }}>{it.sample || '—'}</td>
                          <td>
                            {ignored ? (
                              <span style={st.ignoreBadge}>제외됨(분배 안 함)</span>
                            ) : (
                              <CustomerSearchSelect
                                value={custOverrides[it.label] || ''}
                                onChange={v => onPickCustomer(it.label, v)}
                                suggested={it.suggestedCustomers}
                                options={customerOptions}
                                placeholder="거래처 검색·선택"
                              />
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              style={ignored ? st.unignoreBtn : st.ignoreBtn}
                              onClick={() => onPickCustomer(it.label, ignored ? '' : IMPORT_IGNORE_CUSTOMER_VALUE)}
                              title="거래처가 아닌 열(농장 등)이면 제외 처리 — 주문·분배 모두 건드리지 않습니다."
                            >
                              {ignored ? '제외 취소' : '제외(농장 등)'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )
          ) : productItems.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>품목 미매칭 없음</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                엑셀 품목명 → DB 품목. 시트·품종별로 구분됩니다. ★ 추천 후보 우선 · 이름/코드/품종 입력으로 전체 검색 가능합니다.
              </div>
              <table style={st.table}>
                <thead><tr><th>구분</th><th>시트</th><th>엑셀 품목</th><th>건수</th><th>→ DB 품목 선택</th></tr></thead>
                <tbody>
                  {productItems.map(it => (
                    <tr key={it.key} style={{ background: prodOverrides[it.key] ? '#ecfdf5' : '#eff6ff' }}>
                      <td><MatchKindBadge kind={it.matchKind === 'both' ? 'both' : 'product'} /></td>
                      <td style={{ fontSize: 11 }}>{it.sheetName || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{it.productLabel}{it.productFamily ? <span style={{ fontWeight: 400, color: '#64748b' }}> ({it.productFamily})</span> : null}</td>
                      <td>{it.count}</td>
                      <td>
                        <ProductSearchSelect
                          value={prodOverrides[it.key] || ''}
                          onChange={v => onPickProduct(it.key, v)}
                          suggested={it.suggestedProducts}
                          options={productOptions}
                          placeholder="품목 검색·선택"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            업체 {custResolved}/{customerItems.length} · 품목 {prodResolved}/{productItems.length} 선택됨
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={st.secondaryBtn} onClick={onClose}>나중에</button>
            <button type="button" style={st.primaryBtn} onClick={onReverify} disabled={loading || !canReverify}>
              {loading ? '검증 중...' : '선택 반영 후 다시 검증'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, warn, danger }) {
  return (
    <div style={{ ...st.kpi, borderColor: danger ? '#ef4444' : warn ? '#f59e0b' : '#dbe3ef' }}>
      <span>{label}</span>
      <strong style={{ color: danger ? '#dc2626' : warn ? '#b45309' : '#0f172a' }}>{fmt(value)}</strong>
    </div>
  );
}

function SimpleUnmatched({ rows }) {
  return (
    <div style={st.tableWrapLarge}>
      <table style={st.table}>
        <thead><tr><th>구분</th><th>사유</th><th>시트</th><th>행</th><th>업체 라벨</th><th>품목 라벨</th><th>수량</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: '#fee2e2' }}>
              <td><MatchKindBadge kind={r.matchKind || (/품목/.test(r.reason) && /업체/.test(r.reason) ? 'both' : /품목/.test(r.reason) ? 'product' : 'customer')} /></td>
              <td>{r.reason}</td><td>{r.sheetName}</td><td>{r.rowNo}</td><td>{r.customerLabel}</td><td>{r.productLabel}</td><td>{fmt(r.uploadQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const st = {
  page: { padding: 18, maxWidth: 1600, margin: '0 auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12 },
  title: { margin: 0, fontSize: 22, color: '#0f172a' },
  sub: { marginTop: 4, fontSize: 13, color: '#64748b' },
  controls: { display: 'flex', alignItems: 'center', gap: 4 },
  iconBtn: { width: 32, height: 32, border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  weekInput: { width: 104, height: 32, border: '1px solid #cbd5e1', borderRadius: 6, textAlign: 'center', fontWeight: 700 },
  uploadBand: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, border: '1px solid #dbe3ef', background: '#f8fafc', borderRadius: 8, marginBottom: 12 },
  fileName: { flex: 1, color: '#475569', fontSize: 13 },
  secondaryBtn: { height: 34, padding: '0 14px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  primaryBtn: { height: 34, padding: '0 16px', border: 0, background: '#2563eb', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  preAlignBtn: { height: 34, padding: '0 16px', border: 0, background: '#0f766e', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  preAlignDisabledBtn: { height: 34, padding: '0 16px', border: '1px solid #cbd5e1', background: '#e2e8f0', color: '#64748b', borderRadius: 6, cursor: 'not-allowed', fontWeight: 700 },
  applyBtn: { height: 34, padding: '0 16px', border: 0, background: '#15803d', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  error: { padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 10 },
  message: { padding: 10, background: '#dcfce7', color: '#166534', borderRadius: 6, marginBottom: 10 },
  unmatchedBanner: { display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 8, marginBottom: 12, fontWeight: 700 },
  qtyWarnBanner: { display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 8, marginBottom: 12, fontWeight: 700 },
  unmatchedBannerBtn: { height: 30, padding: '0 14px', border: 0, background: '#ea580c', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  custSelect: { minWidth: 300, height: 38, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', background: '#fff' },
  searchDropdown: { position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', minWidth: 340, maxHeight: 400, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 10px 28px rgba(0,0,0,.16)', marginTop: 2 },
  // 모달(zIndex 5000) content 가 overflow:auto 라 절대위치 드롭다운이 잘리는 문제 방지 —
  // document.body 에 portal 로 띄우고 position:fixed + 입력창 getBoundingClientRect 기준 좌표.
  searchDropdownFixed: { position: 'fixed', zIndex: 5100, minWidth: 260, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 10px 28px rgba(0,0,0,.22)' },
  searchPickRow: { display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f1f5f9', background: '#fff', padding: '11px 12px', fontSize: 14, lineHeight: 1.35, cursor: 'pointer' },
  searchSectionLabel: { padding: '4px 10px', fontSize: 10, color: '#94a3b8', borderTop: '1px solid #f1f5f9' },
  searchHint: { padding: 8, fontSize: 12, color: '#64748b' },
  matchTabRow: { display: 'flex', gap: 6, padding: '8px 14px 0', borderBottom: '1px solid #e2e8f0' },
  matchTabOn: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: '6px 6px 0 0', padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  matchTabOff: { border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', borderRadius: '6px 6px 0 0', padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 },
  matchKindBadge: { display: 'inline-block', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 800 },
  ignoreBadge: { display: 'inline-block', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, background: '#e2e8f0', color: '#475569' },
  ignoreBtn: { border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' },
  unignoreBtn: { border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: 'min(1120px, 96vw)', maxHeight: '88vh', overflow: 'hidden', background: '#fff', borderRadius: 8, boxShadow: '0 24px 80px rgba(15,23,42,0.28)', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column' },
  modalHead: { minHeight: 56, padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: 800, color: '#0f172a' },
  modalSubtitle: { marginTop: 3, fontSize: 12, fontWeight: 800 },
  modalCloseBtn: { height: 32, padding: '0 14px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 10, marginBottom: 12 },
  kpi: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.8fr) minmax(460px, 1.2fr)', gap: 12, marginBottom: 12 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 42, padding: '0 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logBox: { padding: 12, height: 220, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, lineHeight: 1.55, background: '#0f172a', color: '#e2e8f0' },
  applyResultBody: { padding: 12 },
  applySummaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 8, marginBottom: 10 },
  applySummaryCard: { border: '1px solid #dbe3ef', borderRadius: 8, background: '#f8fafc', padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },
  applyLogBox: { border: '1px solid #cbd5e1', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', padding: 10, marginBottom: 10, maxHeight: 120, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, lineHeight: 1.55 },
  applyErrorBox: { border: '1px solid #fecaca', borderRadius: 8, background: '#fee2e2', color: '#991b1b', padding: 10, marginBottom: 10, fontSize: 12, fontWeight: 700 },
  applyStepBox: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 10, marginBottom: 10, fontSize: 12, lineHeight: 1.6 },
  verifyOkBox: { border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', color: '#166534', padding: 10, marginBottom: 10, fontSize: 12, fontWeight: 700 },
  verifyMismatchBox: { border: '2px solid #fca5a5', borderRadius: 8, background: '#fee2e2', color: '#991b1b', padding: 10, marginBottom: 10, fontSize: 12 },
  verifyErrorBox: { border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb', color: '#92400e', padding: 10, marginBottom: 10, fontSize: 12, fontWeight: 700 },
  verifyHead: { fontWeight: 800, marginBottom: 6 },
  verifyTableWrap: { maxHeight: 220, overflow: 'auto', border: '1px solid #fca5a5', borderRadius: 6, background: '#fff' },
  applyTableWrap: { maxHeight: 340, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 },
  actionBadge: { display: 'inline-block', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800 },
  tableWrap: { height: 220, overflow: 'auto' },
  tableWrapLarge: { maxHeight: 560, overflow: 'auto' },
  qtyWarnCell: { color: '#b91c1c', fontSize: 11, maxWidth: 220, whiteSpace: 'normal' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  panelActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  segment: { display: 'flex', gap: 4 },
  seg: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  segOn: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  pivotWrap: { maxHeight: 640, overflow: 'auto', background: '#fff' },
  pivotTable: { width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  pivotStickyHead: { position: 'sticky', top: 0, left: 0, zIndex: 4, background: '#e2e8f0', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '8px 10px', textAlign: 'left' },
  pivotCustHead: { position: 'sticky', top: 0, zIndex: 3, minWidth: 132, maxWidth: 150, background: '#e2e8f0', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '7px 8px', textAlign: 'center', verticalAlign: 'top' },
  pivotTotalHead: { position: 'sticky', top: 0, zIndex: 3, minWidth: 90, background: '#cbd5e1', color: '#0f172a', borderRight: '1px solid #94a3b8', borderBottom: '1px solid #94a3b8', padding: '7px 8px', textAlign: 'right' },
  pivotProductCell: { position: 'sticky', left: 0, zIndex: 2, minWidth: 230, maxWidth: 260, background: '#f8fafc', color: '#0f172a', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', whiteSpace: 'normal' },
  pivotQtyCell: { minWidth: 132, maxWidth: 150, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'right', verticalAlign: 'top' },
  pivotEmptyCell: { minWidth: 132, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', background: '#fff' },
  qtyMain: { fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  qtySub: { marginTop: 2, fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  createBadge: { marginTop: 3, display: 'inline-block', fontSize: 10, color: '#1d4ed8', background: '#dbeafe', borderRadius: 8, padding: '1px 6px', fontWeight: 700 },
  custName: { fontWeight: 700, lineHeight: 1.25, whiteSpace: 'normal' },
  custMeta: { marginTop: 3, fontSize: 10, color: '#64748b', fontWeight: 500, whiteSpace: 'normal' },
  totalCell: { minWidth: 90, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '7px 8px', textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' },
  totalCellStrong: { minWidth: 90, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', background: '#f8fafc' },
};
