// 영업수입불량차감 수동단가 · 누락 처리 · 목록 수정/정리 상태 제어 훅
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../useApi';
import { parseJsonResponse } from '../parseJsonResponse';
import { canUseDefectIncoming, canUseDefectSupport } from '../salesDefectDeductionCore';
import { buildManagementDescriptor } from './pageHelpers';

export function useDefectManualCostController({
  year,
  week,
  viewContextRef,
  loadSupport,
  loadCarryover,
  setError,
  setMessage,
}) {
  const [manualCostModal, setManualCostModal] = useState(null);
  const [manualCostValue, setManualCostValue] = useState('');
  const [manualCostSaving, setManualCostSaving] = useState(false);
  const manualCostInputRef = useRef(null);
  const manualCostSavingRef = useRef(false);

  useEffect(() => {
    setManualCostModal(null);
    setManualCostValue('');
  }, [year, week]);

  useEffect(() => {
    if (!manualCostModal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !manualCostSaving) {
        event.preventDefault();
        setManualCostModal(null);
        setManualCostValue('');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => manualCostInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
    };
  }, [manualCostModal, manualCostSaving]);

  const closeManualCostModal = useCallback(() => {
    setManualCostModal(null);
    setManualCostValue('');
  }, []);

  const openManualCost = useCallback((row) => {
    if (!row?.manualCostEditable || !(Number(row.deductionKey) > 0)) return;
    const existing = Number(row.manualCost);
    setError('');
    setManualCostValue(existing > 0 ? String(existing) : '');
    setManualCostModal({
      row,
      year: String(year),
      week: String(week),
      hasExisting: existing > 0,
    });
  }, [year, week, setError]);

  const saveManualCost = useCallback(async (clear = false) => {
    const modal = manualCostModal;
    if (!modal || manualCostSaving || manualCostSavingRef.current) return;
    const raw = clear ? null : String(manualCostValue).trim();
    if (!clear) {
      if (!raw) { setError('불량차감 단가를 입력하세요.'); return; }
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || !(Number(raw) > 0) || Number(raw) > 9999999999.9999) {
        setError('단가는 0보다 큰 숫자이며 소수점 이하 4자리까지 입력할 수 있습니다.');
        return;
      }
    }
    manualCostSavingRef.current = true;
    setManualCostSaving(true);
    setError('');
    setMessage('');
    try {
      await apiPost('/api/sales/defect-deductions', {
        action: 'manual-cost-save',
        year: modal.year,
        week: modal.week,
        deductionKey: modal.row.deductionKey,
        cost: raw,
        expectedRowVersionNo: modal.row.rowVersionNo,
        expectedEstimateUnit: modal.row.distributionCostUnit,
        custKey: modal.row.custKey,
        prodKey: modal.row.prodKey,
      });
      setManualCostModal(null);
      setManualCostValue('');
      const current = viewContextRef.current;
      let refreshed = true;
      if (String(current.year) === String(modal.year) && String(current.week) === String(modal.week)) {
        if (current.activeTab === 'support') refreshed = Boolean(await loadSupport());
        else if (current.activeTab === 'carryover') refreshed = Boolean(await loadCarryover());
      }
      setMessage(clear
        ? (refreshed ? '수동단가를 삭제하고 자동 분배단가로 되돌렸습니다.' : '수동단가는 저장했지만 목록을 새로고침하지 못했습니다.')
        : (refreshed ? '수동단가를 저장했습니다. 등록 가능 여부를 다시 확인했습니다.' : '수동단가는 저장했지만 목록을 새로고침하지 못했습니다.'));
    } catch (e) {
      setError(e.message);
    } finally {
      manualCostSavingRef.current = false;
      setManualCostSaving(false);
    }
  }, [manualCostModal, manualCostSaving, manualCostValue, viewContextRef, loadCarryover, loadSupport, setError, setMessage]);

  return {
    manualCostModal,
    manualCostValue,
    setManualCostValue,
    manualCostSaving,
    setManualCostSaving,
    manualCostInputRef,
    openManualCost,
    saveManualCost,
    closeManualCostModal,
  };
}

export function useDefectOmissionController({
  year,
  week,
  activeTab,
  supportRows,
  supportSelected,
  setSupportSelected,
  setSupportLoading,
  loadSupport,
  loadCarryover,
  setError,
  setMessage,
}) {
  const [omissionRows, setOmissionRows] = useState(null);
  const [omissionBusy, setOmissionBusy] = useState(false);

  const loadOmissionHistory = async () => {
    setOmissionBusy(true);
    try {
      const r = await fetch(`/api/sales/defect-deductions?view=omission-history&year=${year}`, { credentials: 'include' });
      const d = await parseJsonResponse(r);
      if (!r.ok || !d.success) throw Error(d.error || '조회 실패');
      setOmissionRows(d.rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setOmissionBusy(false);
    }
  };

  const undoOmission = async (row) => {
    if (!window.confirm(`${row.customerName || ''} / ${row.productName || ''} / ${row.orderWeek}차 ${row.quantity}${row.sourceUnit} 누락 처리를 취소합니까?`)) return;
    setOmissionBusy(true);
    try {
      await apiPost('/api/sales/defect-deductions', { action: 'permanent-omit-cancel', year, historyKey: row.historyKey });
      await loadOmissionHistory();
      if (activeTab === 'carryover') await loadCarryover();
      else await loadSupport();
      setMessage('누락 취소 완료. 출고·단가·중복 검사 후 등록할 수 있습니다.');
    } catch (e) {
      setError(e.message);
    } finally {
      setOmissionBusy(false);
    }
  };

  const markSupportOmitted = async () => {
    const selected = supportRows.filter((r) => supportSelected.has(Number(r.deductionKey)) && r.registrationEligible);
    if (!selected.length) { setError('등록 가능한 행을 선택하세요.'); return; }
    if (!window.confirm(`선택한 ${selected.length}건을 누락 처리합니다. 같은 연도·차수·업체·품목·수량·단위는 이후 업로드에서도 고정 제외됩니다. 새 차수나 다른 수량은 제외하지 않습니다.`)) return;
    setSupportLoading(true);
    setError('');
    try {
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'permanent-omit',
        year,
        week,
        rows: selected.map((r) => ({ deductionKey: r.deductionKey, expectedRowVersionNo: r.rowVersionNo })),
      });
      setMessage(`누락 처리 ${data.omitted}건 · 동일 자료 재업로드 고정 제외`);
      setSupportSelected(new Set());
      if (activeTab === 'carryover') await loadCarryover();
      else await loadSupport();
    } catch (e) {
      setError(e.message);
    } finally {
      setSupportLoading(false);
    }
  };

  return {
    omissionRows,
    setOmissionRows,
    omissionBusy,
    loadOmissionHistory,
    undoOmission,
    markSupportOmitted,
  };
}

export function useDefectManagementController({
  year,
  week,
  activeTab,
  currentUser,
  incomingLoading,
  supportLoading,
  incomingSaving,
  supportRegistering,
  incomingRows,
  visibleSupportRows,
  loadIncoming,
  loadSupport,
  setError,
  setMessage,
}) {
  const [managementMode, setManagementMode] = useState(false);
  const [managementSelected, setManagementSelected] = useState(new Set());
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementEdit, setManagementEdit] = useState(null);
  const [managementCandidates, setManagementCandidates] = useState([]);
  const managementSequence = useRef(0);
  const managementAllowed = canUseDefectIncoming(currentUser || {}) || canUseDefectSupport(currentUser || {});

  useEffect(() => {
    managementSequence.current += 1;
    setManagementSelected(new Set());
    setManagementEdit(null);
    setManagementCandidates([]);
  }, [year, week, activeTab, incomingLoading, supportLoading]);

  useEffect(() => {
    setManagementMode(false);
  }, [year, week, activeTab]);

  const managementLoading = managementBusy || incomingLoading || supportLoading || incomingSaving || supportRegistering;
  const managementRows = activeTab === 'incoming' ? incomingRows : visibleSupportRows;

  const toggleManagement = (key) => setManagementSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const refreshManagement = () => (activeTab === 'incoming' ? loadIncoming() : loadSupport());

  const archiveManagement = async () => {
    const selectedRows = managementRows.filter((row) => managementSelected.has(Number(row.deductionKey)));
    if (!selectedRows.length || managementLoading) return;
    const payload = { action: 'manage-archive', year, week, rows: selectedRows.map(buildManagementDescriptor) };
    const seq = managementSequence.current;
    setManagementBusy(true);
    setError('');
    try {
      await apiPost('/api/sales/defect-deductions', { ...payload, preview: true });
      if (seq !== managementSequence.current) return;
      const details = selectedRows.map((row) => `${row.customerName} · ${row.orderYear}년 ${row.orderWeek}차 · #${row.deductionKey}${row.estimateKey ? ` · 연결 견적 #${row.estimateKey}` : ''}`).join('\n');
      if (!window.confirm(`${details}\n\n${selectedRows.length}건을 불량 목록에서 제외할까요? 실제 견적서와 주문·출고·재고는 보존됩니다.`)) return;
      await apiPost('/api/sales/defect-deductions', { ...payload, preview: false });
      setManagementSelected(new Set());
      setMessage(`${selectedRows.length}건 목록 제외 완료. 실제 견적서와 처리 이력은 보존되었습니다.`);
      if (!await refreshManagement()) setError('목록 제외는 완료했지만 재조회에 실패했습니다. 다시 조회하세요. 제외 요청을 반복하지 마세요.');
    } catch (error) {
      setError(`목록 정리: ${error.message} 요청 결과가 불명확하면 새로 조회하여 확인하세요.`);
    } finally {
      setManagementBusy(false);
    }
  };

  const openManagementEdit = async (row) => {
    const seq = ++managementSequence.current;
    setManagementBusy(true);
    setError('');
    const descriptor = buildManagementDescriptor(row);
    try {
      const result = await apiPost('/api/sales/defect-deductions', { action: 'manage-edit', year, week, rows: [descriptor], changes: {}, preview: true });
      if (seq !== managementSequence.current) return;
      const plan = result.rows?.[0];
      const noteOnly = Boolean(plan?.noteOnly || row.estimateKey || ['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(row.status));
      setManagementEdit({
        descriptor,
        noteOnly,
        row,
        changes: {
          custKey: row.custKey,
          customerName: row.customerName,
          prodKey: row.prodKey,
          productName: row.productName,
          quantity: row.quantity,
          sourceUnit: row.sourceUnit,
          note: row.note || '',
        },
        query: '',
        kind: 'customer',
      });
      setManagementCandidates([]);
    } catch (error) {
      setError(`수정 확인: ${error.message}`);
    } finally {
      setManagementBusy(false);
    }
  };

  const searchManagement = async () => {
    const edit = managementEdit;
    const seq = managementSequence.current;
    if (!edit || edit.noteOnly) return;
    setManagementBusy(true);
    try {
      const data = await apiGet('/api/sales/defect-deductions', { view: 'lookups', kind: edit.kind, q: edit.query });
      if (seq === managementSequence.current) setManagementCandidates(data[edit.kind === 'customer' ? 'customers' : 'products'] || []);
    } catch (error) {
      setError(error.message);
    } finally {
      setManagementBusy(false);
    }
  };

  const saveManagementEdit = async () => {
    const edit = managementEdit;
    if (!edit || managementLoading) return;
    const editableChanges = edit.noteOnly ? { note: edit.changes.note } : edit.changes;
    const changes = Object.fromEntries(Object.entries(editableChanges).filter(([key, value]) => String(value ?? '') !== String(edit.row[key] ?? '')));
    if (!Object.keys(changes).length) { setError('변경할 내용을 입력하세요.'); return; }
    const payload = { action: 'manage-edit', year, week, rows: [edit.descriptor], changes };
    const seq = managementSequence.current;
    setManagementBusy(true);
    setError('');
    try {
      await apiPost('/api/sales/defect-deductions', { ...payload, preview: true });
      if (seq !== managementSequence.current) return;
      await apiPost('/api/sales/defect-deductions', { ...payload, preview: false });
      setManagementEdit(null);
      setMessage('불량 목록 수정 완료. 실제 견적서는 변경하지 않았습니다.');
      if (!await refreshManagement()) setError('수정은 완료했지만 재조회에 실패했습니다. 다시 조회하세요. 저장 요청을 반복하지 마세요.');
    } catch (error) {
      setError(`수정: ${error.message} 요청 결과가 불명확하면 새로 조회하여 확인하세요.`);
    } finally {
      setManagementBusy(false);
    }
  };

  const closeManagementEdit = () => {
    managementSequence.current += 1;
    setManagementEdit(null);
  };

  return {
    managementMode,
    setManagementMode,
    managementSelected,
    setManagementSelected,
    managementBusy,
    managementEdit,
    setManagementEdit,
    managementCandidates,
    setManagementCandidates,
    managementAllowed,
    managementLoading,
    managementRows,
    toggleManagement,
    archiveManagement,
    openManagementEdit,
    searchManagement,
    saveManagementEdit,
    closeManagementEdit,
  };
}
