// pages/freight.js — 운송기준원가 탭
// BILL(AWB) 선택 → 차수 요약 + 카테고리 분배 + 품목 상세 그리드 → 스냅샷 저장 / 엑셀 다운로드
import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { apiGet } from '../lib/useApi';
import { useLang } from '../lib/i18n';
import { computeFreightCost, normalizeFlower } from '../lib/freightCalc';

const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n))) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmt2 = n => fmt(n, 2);
const fmt4 = n => fmt(n, 4);
const pct = n => (n == null || Number.isNaN(Number(n))) ? '–' : (Number(n) * 100).toFixed(2) + '%';

export default function FreightPage() {
  const { t } = useLang();
  const [groups, setGroups] = useState([]);          // AWB 그룹 리스트 ([{ GroupKey, AWB, AllKeys, MergeCount, ... }])
  const [groupKey, setGroupKey] = useState('');      // 선택된 GroupKey
  const [basis, setBasis] = useState('AUTO');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [apiData, setApiData] = useState(null);
  const [master, setMaster] = useState(null);
  const [customs, setCustoms] = useState(null);
  const [rowsOverride, setRowsOverride] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);  // 스냅샷 저장 이후 수정 여부
  const [catEditing, setCatEditing] = useState({});   // { flowerName: { BoxWeight, BoxCBM, StemsPerBox } } — liveResult 에 병합
  const [catSaving, setCatSaving] = useState('');

  // localStorage 초안 key
  const draftKey = apiData ? `freight-draft-${apiData.primaryKey}` : null;

  // AWB 그룹 리스트 로드
  useEffect(() => {
    apiGet('/api/freight').then(d => setGroups(d.groups || [])).catch(e => setErr(e.message));
  }, []);

  // 그룹 선택시 로드
  useEffect(() => {
    if (!groupKey) return;
    const g = groups.find(x => x.GroupKey === groupKey);
    if (!g) return;
    setLoading(true);
    setErr(''); setMsg('');
    // AWB 있으면 awb 파라미터로, 없으면 warehouseKey
    const queryParams = g.AWB ? { awb: g.AWB } : { warehouseKey: g.PrimaryKey };
    apiGet('/api/freight', queryParams)
      .then(d => {
        if (!d.success) throw new Error(d.error);
        setApiData(d);
        // localStorage 초안 있으면 먼저 확인 (스냅샷보다 최신일 수 있음)
        const dk = `freight-draft-${d.primaryKey}`;
        const draft = (typeof window !== 'undefined') ? localStorage.getItem(dk) : null;
        if (draft) {
          try {
            const parsed = JSON.parse(draft);
            // 초안이 스냅샷보다 최신이면 복구
            const snapshotDtm = d.snapshot ? new Date(d.snapshot.UpdateDtm || d.snapshot.CreateDtm).getTime() : 0;
            if (parsed.savedAt > snapshotDtm && confirm('저장되지 않은 변경사항이 있습니다. 복구하시겠습니까?')) {
              setMaster(parsed.master);
              setCustoms(parsed.customs);
              setBasis(parsed.basis || 'AUTO');
              setRowsOverride(parsed.rowsOverride || {});
              setDirty(true);
              return;
            }
            // 거절하면 초안 삭제
            localStorage.removeItem(dk);
          } catch {}
        }
        setMaster({ ...d.input.master });
        setCustoms({ ...d.input.customs });
        setBasis(d.input.basis || 'AUTO');
        setRowsOverride({});
        setDirty(false);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [groupKey, groups]);

  // dirty 상태에서 창 닫으려 할 때 경고
  useEffect(() => {
    const h = (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; return ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // 값 변경 시 dirty 표시 + localStorage 초안 자동 저장 (debounce)
  useEffect(() => {
    if (!apiData || !master || !customs || !draftKey) return;
    const t = setTimeout(() => {
      if (dirty) {
        localStorage.setItem(draftKey, JSON.stringify({
          master, customs, basis, rowsOverride, savedAt: Date.now(),
        }));
      }
    }, 500);
    return () => clearTimeout(t);
  }, [master, customs, basis, rowsOverride, dirty, apiData, draftKey]);

  // 실시간 재계산 (클라이언트)
  const liveResult = useMemo(() => {
    if (!apiData || !master || !customs) return null;
    const details = apiData.input.details.map(d => {
      const ov = rowsOverride[d.prodKey] || {};
      return { ...d,
        flowerName:    ov.flowerName    ?? d.flowerName,   // 카테고리 수동 오버라이드
        stemsPerBunch: ov.stemsPerBunch ?? d.stemsPerBunch,
        salePriceKRW:  ov.salePriceKRW  ?? d.salePriceKRW,
        tariffRate:    ov.tariffRate    ?? d.tariffRate,
      };
    });
    // 카테고리 인라인 편집(catEditing) 을 flowerMeta 에 즉시 반영 — 💾 저장 전에도 프리뷰 갱신
    const mergedFlowerMeta = { ...(apiData.flowerMeta || {}) };
    for (const [flowerName, edit] of Object.entries(catEditing || {})) {
      const key = normalizeFlower(flowerName);
      const base = mergedFlowerMeta[key] || {};
      const pick = (raw, fallback) => {
        if (raw === '' || raw == null) return fallback;
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : fallback;
      };
      mergedFlowerMeta[key] = {
        ...base,
        boxWeight:   pick(edit.BoxWeight,   base.boxWeight),
        boxCBM:      pick(edit.BoxCBM,      base.boxCBM),
        stemsPerBox: pick(edit.StemsPerBox, base.stemsPerBox),
      };
    }
    return computeFreightCost({
      master, basis, customs, details,
      productMeta: apiData.productMeta,
      flowerMeta: mergedFlowerMeta,
    });
  }, [apiData, master, customs, rowsOverride, basis, catEditing]);

  const selectedGroup = groups.find(g => g.GroupKey === groupKey);

  const updateRow = (prodKey, field, val) => {
    setRowsOverride(m => ({ ...m, [prodKey]: { ...(m[prodKey] || {}), [field]: val === '' ? null : Number(val) } }));
    setDirty(true);
  };
  // 카테고리(FlowerName)는 문자열이라 별도 핸들러
  const updateRowCategory = (prodKey, flowerName) => {
    setRowsOverride(m => ({ ...m, [prodKey]: { ...(m[prodKey] || {}), flowerName: flowerName || null } }));
    setDirty(true);
  };
  const updMaster = (field, val) => { setMaster(m => ({ ...m, [field]: val })); setDirty(true); };
  const updCustoms = (field, val) => { setCustoms(c => ({ ...c, [field]: val })); setDirty(true); };

  // 카테고리(Flower) 기본값 편집 → Flower 테이블에 저장 (전역).
  // state 선언은 위에서 했음 (liveResult 가 참조하므로 TDZ 회피).
  const startCatEdit = (flowerName, current) => {
    // apiData.flowerMeta 에서 defaultTariff 도 가져옴 (카테고리 객체엔 없음)
    const key = normalizeFlower(flowerName);
    const fm = apiData?.flowerMeta?.[key] || {};
    setCatEditing(m => ({ ...m, [flowerName]: {
      BoxWeight: current.boxWeight ?? '',
      BoxCBM: current.boxCBM ?? '',
      StemsPerBox: current.stemsPerBox ?? '',
      DefaultTariff: fm.defaultTariff != null ? (fm.defaultTariff * 100).toFixed(2) : '',  // % 로 표시
    }}));
  };
  const updCatField = (flowerName, field, val) => {
    setCatEditing(m => ({ ...m, [flowerName]: { ...(m[flowerName] || {}), [field]: val } }));
  };
  const saveCatEdit = async (flowerName, flowerKey) => {
    const v = catEditing[flowerName];
    if (!v) return;
    setCatSaving(flowerName);
    try {
      // /api/master?entity=flower (PUT → flowerKey 있으면 UPDATE)
      // 관세(%) 입력 → 소수로 변환 (예: 8 → 0.08)
      const tariffPct = v.DefaultTariff === '' ? null : parseFloat(v.DefaultTariff);
      const defaultTariff = tariffPct != null && !Number.isNaN(tariffPct) ? tariffPct / 100 : null;
      const res = await fetch('/api/master?entity=flower', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowerKey,
          boxWeight: v.BoxWeight === '' ? null : parseFloat(v.BoxWeight),
          boxCBM: v.BoxCBM === '' ? null : parseFloat(v.BoxCBM),
          stemsPerBox: v.StemsPerBox === '' ? null : parseFloat(v.StemsPerBox),
          defaultTariff,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setMsg(`✅ ${flowerName} 기본값 저장됨 (다음 BILL 부터 자동 적용)`);
      setTimeout(() => setMsg(''), 3000);
      setCatEditing(m => { const n = { ...m }; delete n[flowerName]; return n; });
      // 현재 apiData.flowerMeta 도 업데이트해서 즉시 반영
      if (apiData?.flowerMeta) {
        const key = normalizeFlower(flowerName);
        const next = { ...apiData.flowerMeta };
        next[key] = {
          ...(next[key] || {}),
          boxWeight: v.BoxWeight === '' ? null : parseFloat(v.BoxWeight),
          boxCBM: v.BoxCBM === '' ? null : parseFloat(v.BoxCBM),
          stemsPerBox: v.StemsPerBox === '' ? null : parseFloat(v.StemsPerBox),
          defaultTariff,
        };
        setApiData(a => ({ ...a, flowerMeta: next }));
      }
    } catch (e) { alert(e.message); } finally { setCatSaving(''); }
  };
  // FlowerKey 찾기 — apiData.flowerMeta 에는 FlowerKey 가 없어서 별도 state에 보관 필요.
  // 간편하게: Flower 목록 따로 로드해서 name→key 맵 관리.
  const [flowerNameToKey, setFlowerNameToKey] = useState({});
  useEffect(() => {
    apiGet('/api/master', { entity: 'codes' })
      .then(d => {
        const map = {};
        for (const f of (d.flowers || [])) map[normalizeFlower(f.FlowerName)] = f.FlowerKey;
        setFlowerNameToKey(map);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!apiData || !master) return;
    if (!master.gw || !master.cw || !master.rateUSD || !master.exchangeRate) {
      alert('GW, CW, Rate, 환율은 필수입니다.'); return;
    }
    setSaving(true);
    try {
      const rows = apiData.input.details.map(d => {
        const ov = rowsOverride[d.prodKey] || {};
        return { ...d,
          stemsPerBunch: ov.stemsPerBunch ?? d.stemsPerBunch,
          salePriceKRW:  ov.salePriceKRW  ?? d.salePriceKRW,
          tariffRate:    ov.tariffRate    ?? d.tariffRate,
        };
      });
      const res = await fetch('/api/freight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseKey: apiData.primaryKey,
          warehouseKeys: apiData.warehouseKeys,
          basis, master, customs, rows,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setMsg(`✅ 스냅샷 저장 완료 (FreightKey ${d.freightKey}, 품목 ${d.saved}건)`);
      setTimeout(() => setMsg(''), 4000);
      setDirty(false);
      if (draftKey) localStorage.removeItem(draftKey);  // 저장 성공시 초안 제거
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const handleExcel = async () => {
    if (!apiData) { alert('BILL을 선택하세요.'); return; }
    // 클라이언트 편집값(마스터/통관비/바디 오버라이드/카테고리 편집)을 POST 로 전달 — 저장 없이도 즉시 반영됨
    const rowsPayload = (apiData.input?.details || []).map(d => {
      const ov = rowsOverride[d.prodKey] || {};
      return {
        prodKey: d.prodKey,
        flowerName:    ov.flowerName    ?? d.flowerName,    // 카테고리 오버라이드 엑셀에도 반영
        stemsPerBunch: ov.stemsPerBunch ?? d.stemsPerBunch,
        salePriceKRW:  ov.salePriceKRW  ?? d.salePriceKRW,
        tariffRate:    ov.tariffRate    ?? d.tariffRate,
      };
    });
    const flowerOverrides = {};
    for (const [flowerName, edit] of Object.entries(catEditing || {})) {
      flowerOverrides[normalizeFlower(flowerName)] = {
        BoxWeight:   edit.BoxWeight,
        BoxCBM:      edit.BoxCBM,
        StemsPerBox: edit.StemsPerBox,
      };
    }
    try {
      const res = await fetch('/api/freight/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          warehouseKeys: apiData.warehouseKeys || [apiData.primaryKey],
          awb: apiData.awb || '',
          basis, master, customs,
          rows: rowsPayload,
          flowerOverrides,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
        throw new Error(err.error || 'Excel 다운로드 실패');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      const dlUrl = URL.createObjectURL(blob);
      link.href = dlUrl;
      link.download = `freight_${apiData.awb || apiData.primaryKey}_${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 2000);
      setMsg('📊 엑셀 다운로드 완료');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <Head><title>운송기준원가 / Shipping Cost</title></Head>

      {/* 필터 바 */}
      <div className="filter-bar">
        <span className="filter-label">BILL / AWB</span>
        <select className="filter-input" value={groupKey} onChange={e => setGroupKey(e.target.value)} style={{ minWidth: 380 }}>
          <option value="">선택하세요</option>
          {groups.map(g => (
            <option key={g.GroupKey} value={g.GroupKey}>
              {g.AWB ? `AWB ${g.AWB}` : `[AWB없음]`}
              {g.MergeCount > 1 ? ` · ${g.MergeCount}원장 합산` : ''}
              {` · ${g.OrderWeek || ''} · ${g.FarmName || ''} (${g.InputDate})`}
              {g.FreightKey ? ' 💾' : ''}
            </option>
          ))}
        </select>
        <span className="filter-label" style={{ marginLeft: 12 }}>기준</span>
        <label style={{ fontSize: 12, cursor: 'pointer' }}>
          <input type="radio" checked={basis === 'AUTO'} onChange={() => setBasis('AUTO')} /> 자동
        </label>
        <label style={{ fontSize: 12, cursor: 'pointer', marginLeft: 8 }}>
          <input type="radio" checked={basis === 'GW'} onChange={() => setBasis('GW')} /> GW (무게)
        </label>
        <label style={{ fontSize: 12, cursor: 'pointer', marginLeft: 8 }}>
          <input type="radio" checked={basis === 'CBM'} onChange={() => setBasis('CBM')} /> CBM (부피)
        </label>
        <div className="page-actions">
          <label style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={editMode} onChange={e => setEditMode(e.target.checked)} /> 편집모드
          </label>
          <button
            className={dirty ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={handleSave} disabled={saving || !apiData}
            title={dirty ? '저장 안 된 변경사항이 있습니다' : '현재 값을 DB에 스냅샷으로 저장'}
          >{saving ? '저장 중...' : dirty ? '⚠️ 저장 필요' : '💾 저장'}</button>
          <button className="btn btn-secondary" onClick={handleExcel} disabled={!apiData}>📊 엑셀</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기</button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>⚠️ {err}</div>}
      {msg && <div style={{ padding: '8px 14px', background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{msg}</div>}

      {!groupKey && (
        <div className="empty-state" style={{ padding: 80 }}>
          <div className="empty-icon">📦</div>
          <div className="empty-text">상단에서 BILL을 선택하세요. 같은 AWB로 여러 번 업로드된 경우 자동으로 합산됩니다.</div>
        </div>
      )}

      {loading && <div className="skeleton" style={{ height: 400, borderRadius: 8 }}></div>}

      {apiData && master && customs && liveResult && (
        <>
          {/* 경고 배너 */}
          {liveResult.warnings.length > 0 && (
            <div style={{ padding: '8px 14px', background: 'var(--amber-bg, #fff8e1)', color: 'var(--amber, #f57c00)', borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
              {liveResult.warnings.map((w, i) => (
                <div key={i}>{w.level === 'error' ? '⛔' : '⚠️'} {w.msg}</div>
              ))}
            </div>
          )}

          {/* 상태 배지 */}
          <div style={{ padding: '6px 10px', marginBottom: 10, fontSize: 12, color: 'var(--text3)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <strong style={{ color: 'var(--text)' }}>{selectedGroup?.OrderWeek} · {selectedGroup?.FarmName} · AWB {selectedGroup?.AWB || '–'} · {selectedGroup?.InputDate}</strong>
            {apiData.mergeCount > 1 && <span style={{ padding: '2px 6px', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>🔗 {apiData.mergeCount}원장 합산</span>}
            {apiData.freightForwarder && <span style={{ padding: '2px 6px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>✈️ 항공료 {apiData.freightForwarder.farmNames.join(',')} = ${apiData.freightForwarder.actualFreightUSD.toFixed(2)}</span>}
            {apiData.snapshot
              ? <span style={{ padding: '2px 8px', background: 'var(--green-bg)', color: 'var(--green)', borderRadius: 4, fontWeight: 600 }}>💾 저장됨 · {new Date(apiData.snapshot.UpdateDtm || apiData.snapshot.CreateDtm).toLocaleString()}</span>
              : <span style={{ padding: '2px 8px', background: 'var(--amber-bg, #fff8e1)', color: 'var(--amber, #f57c00)', borderRadius: 4, fontWeight: 600 }}>🆕 최초 입력 중</span>}
            {dirty && <span style={{ padding: '2px 8px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 4, fontWeight: 600 }}>⚠️ 미저장 변경</span>}
          </div>

          {/* ━━ Row 1: 좌(차수·항공료) | 중(품목별 운임비) | 우(그외 통관비) ━━ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(280px, 1.1fr) minmax(340px, 1.4fr)', gap: 10, marginBottom: 10 }}>

            {/* ① 차수 · 항공료 */}
            <div className="card">
              <div className="card-header"><span className="card-title">① 차수 · 항공료 (USD)</span></div>
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>차수 (AWB)</span>
                    {apiData?.invoiceCurrency && (
                      <span style={{ padding: '1px 6px', background: apiData.invoiceCurrency === 'CNY' ? '#ffebee' : apiData.invoiceCurrency === 'EUR' ? '#e3f2fd' : '#e8f5e9', color: apiData.invoiceCurrency === 'CNY' ? '#c62828' : apiData.invoiceCurrency === 'EUR' ? '#1565c0' : '#2e7d32', borderRadius: 3, fontSize: 10, fontWeight: 700 }}
                            title={apiData.countryDistribution?.map(([c,n]) => `${c} ${n}건`).join(', ')}>
                        💱 {apiData.invoiceCurrency}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)' }}>{selectedGroup?.AWB || selectedGroup?.OrderWeek || '–'}</div>
                </div>
                <NumField label={`총금액 Invoice (${apiData?.invoiceCurrency || 'USD'})`} value={master.invoiceUSD} onChange={v => updMaster('invoiceUSD', v)} readOnly={!editMode} />
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>환율 (KRW/{apiData?.invoiceCurrency || 'USD'})</span>
                    {master.exchangeRateAutoFilled && <span style={{ fontSize: 9, color: 'var(--amber, #f57c00)', fontWeight: 600 }} title="CurrencyMaster 에서 자동 채움">~자동</span>}
                  </div>
                  {editMode
                    ? <input type="number" step="any" value={master.exchangeRate ?? ''} onChange={e => updMaster('exchangeRate', e.target.value === '' ? null : Number(e.target.value))} style={{ width: '100%', height: 26, border: '1px solid var(--blue)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 6px', background: master.exchangeRateAutoFilled ? '#fff8e1' : '#e3f2fd' }} />
                    : <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{master.exchangeRate != null ? Number(master.exchangeRate).toLocaleString() : '–'}</div>}
                </div>
                <NumField label="GW 실중량 (kg)" value={master.gw} onChange={v => updMaster('gw', v)} readOnly={!editMode} />
                <NumField label="CW 과금중량 (kg)" value={master.cw} onChange={v => updMaster('cw', v)} readOnly={!editMode} />
                <NumField label={`Rate (${apiData?.invoiceCurrency || 'USD'}/kg)`} value={master.rateUSD} onChange={v => updMaster('rateUSD', v)} readOnly={!editMode} />
                <NumField label={`서류 (${apiData?.invoiceCurrency || 'USD'})`} value={master.docFeeUSD} onChange={v => updMaster('docFeeUSD', v)} readOnly={!editMode} />
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>품목수 (자동)</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{fmt(master.itemCount)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>총수량 (송이)</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{fmt(liveResult.rows.reduce((a,r) => a + (Number(r.steamQty)||0), 0))}</div>
                </div>
              </div>
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: '#fafafa' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                  항공료 {liveResult.header.freightSource === 'ACTUAL' ? <span style={{color:'var(--green)',fontWeight:700}}>· FREIGHTWISE 실제 청구</span> : <span>· 계산값 (Rate×CW + Doc)</span>} · 기준 {liveResult.header.basis}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: liveResult.header.freightSource === 'ACTUAL' ? 'var(--green)' : 'var(--blue)', fontFamily: 'var(--mono)' }}>{fmt2(liveResult.header.freightTotalUSD)} USD</div>
                {liveResult.header.actualFreightUSD && Math.abs(liveResult.header.actualFreightUSD - liveResult.header.freightComputedUSD) > 1 && (
                  <div style={{ fontSize: 10, color: 'var(--amber)' }}>⚠️ 계산값 {fmt2(liveResult.header.freightComputedUSD)} 과 차이 {fmt2(liveResult.header.actualFreightUSD - liveResult.header.freightComputedUSD)}</div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>운송비 = Rate × CW = {fmt2((Number(master.rateUSD)||0) * (Number(master.cw)||0))} USD</div>
              </div>
            </div>

            {/* ② 품목별 운임비 */}
            <div className="card">
              <div className="card-header"><span className="card-title">② 품목별 운임비</span></div>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>카테고리</th>
                    <th style={{ textAlign: 'right' }}>운임비 (USD)</th>
                    <th style={{ textAlign: 'right' }}>수량 (송이)</th>
                    <th style={{ textAlign: 'right' }}>송이당 운임비</th>
                  </tr>
                </thead>
                <tbody>
                  {liveResult.categories.map(c => (
                    <tr key={c.flowerName}>
                      <td className="name"><span className="badge badge-purple">{c.flowerName}</span></td>
                      <td className="num">{fmt2(c.freightUSD)}</td>
                      <td className="num">{fmt(c.stemsCount)}</td>
                      <td className="num" style={{ fontWeight: 600, color: 'var(--blue)' }}>{fmt4(c.freightPerStemUSD)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td style={{ textAlign: 'right' }}>합계</td>
                    <td className="num">{fmt2(liveResult.categories.reduce((a,c) => a + (c.freightUSD||0), 0))}</td>
                    <td className="num">{fmt(liveResult.categories.reduce((a,c) => a + (c.stemsCount||0), 0))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ③ 그외 통관비 */}
            <div className="card">
              <div className="card-header"><span className="card-title">③ 그외 통관비 (KRW)</span></div>
              <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                <NumField label="백상 단가 × GW" value={customs.bakSangRate} onChange={v => updCustoms('bakSangRate', v)} readOnly={!editMode} />
                <NumField label="차감" value={customs.deductFee} onChange={v => updCustoms('deductFee', v)} readOnly={!editMode} />
                <NumField label="수수료 (handling)" value={customs.handlingFee} onChange={v => updCustoms('handlingFee', v)} readOnly={!editMode} />
                <NumField label="검역 × 품목수" value={customs.quarantinePerItem} onChange={v => updCustoms('quarantinePerItem', v)} readOnly={!editMode} />
                <NumField label="국내운송" value={customs.domesticFreight} onChange={v => updCustoms('domesticFreight', v)} readOnly={!editMode} />
                <NumField label="추가 통관" value={customs.extraFee} onChange={v => updCustoms('extraFee', v)} readOnly={!editMode} />
              </div>
              <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--blue)', fontWeight: 700, background: '#fafafa' }}>
                → 통관 합계: {fmt(liveResult.header.customsTotalKRW)} 원
              </div>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>카테고리</th>
                    <th style={{ textAlign: 'right' }}>품목별 통관비</th>
                    <th style={{ textAlign: 'right' }}>송이당 통관비</th>
                  </tr>
                </thead>
                <tbody>
                  {liveResult.categories.map(c => (
                    <tr key={c.flowerName}>
                      <td className="name"><span className="badge badge-purple">{c.flowerName}</span></td>
                      <td className="num">{fmt(c.customsKRW)}</td>
                      <td className="num" style={{ fontWeight: 600, color: 'var(--blue)' }}>{fmt2(c.customsPerStemKRW)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ━━ Row 2: 좌(종 합계) | 우(운송비 분배 비율 계산) ━━ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(500px, 2.6fr)', gap: 10, marginBottom: 10 }}>

            {/* ④ 종 합계 */}
            <div className="card">
              <div className="card-header"><span className="card-title">④ 종 합계</span></div>
              <div style={{ padding: 14, display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>종 이익률</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: liveResult.totals.overallProfitRate < 0 ? 'var(--red)' : 'var(--blue)', fontFamily: 'var(--mono)' }}>{pct(liveResult.totals.overallProfitRate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>종 판매가</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmt(liveResult.totals.totalSaleKRW)} 원</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>종 이익</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: liveResult.totals.totalProfitKRW < 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' }}>{fmt(liveResult.totals.totalProfitKRW)} 원</div>
                </div>
              </div>
            </div>

            {/* ⑤ 운송비 품목별 분배 비율 계산 */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">⑤ 운송비 품목별 분배 비율 계산</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>💡 박스무게/CBM/송이박스 셀 클릭 → 편집 → 💾 누르면 전역 저장</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {/* 무게 기준 */}
                <div>
                  <div style={{ padding: '6px 10px', background: liveResult.header.basis === 'GW' ? '#e3f2fd' : '#f5f5f5', fontWeight: 700, fontSize: 11, color: liveResult.header.basis === 'GW' ? 'var(--blue)' : 'var(--text3)' }}>
                    GW ≈ CW · 무게로 계산 {liveResult.header.basis === 'GW' && '✓ 사용 중'}
                  </div>
                  <table className="tbl" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th>카테고리</th>
                        <th style={{ textAlign: 'right' }}>박스당 무게</th>
                        <th style={{ textAlign: 'right' }}>박스 수</th>
                        <th style={{ textAlign: 'right' }}>비율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveResult.categories.map(c => {
                        const edit = catEditing[c.flowerName];
                        const fkKey = normalizeFlower(c.flowerName);
                        const fkId = flowerNameToKey[fkKey];
                        const cellStyle = { width: 60, height: 22, border: '1px solid var(--blue)', borderRadius: 3, textAlign: 'right', fontSize: 11, fontFamily: 'var(--mono)', padding: '0 4px', background: '#e3f2fd' };
                        return (
                          <tr key={c.flowerName}>
                            <td className="name"><span className="badge badge-purple">{c.flowerName}</span></td>
                            <td className="num" onClick={() => !edit && fkId && startCatEdit(c.flowerName, c)} style={{ cursor: fkId ? 'pointer' : 'default', background: edit ? '#fffde7' : undefined }}>
                              {edit ? <input type="number" step="0.1" style={cellStyle} value={edit.BoxWeight} onChange={e => updCatField(c.flowerName, 'BoxWeight', e.target.value)} /> : (c.boxWeight ?? '–')}
                            </td>
                            <td className="num">{fmt(c.boxCount)}</td>
                            <td className="num" style={{ fontWeight: liveResult.header.basis === 'GW' ? 700 : 400, color: liveResult.header.basis === 'GW' ? 'var(--blue)' : 'var(--text3)' }}>{pct(c.weightRatio)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* CBM 기준 */}
                <div style={{ borderLeft: '1px solid var(--border)' }}>
                  <div style={{ padding: '6px 10px', background: liveResult.header.basis === 'CBM' ? '#fff3e0' : '#f5f5f5', fontWeight: 700, fontSize: 11, color: liveResult.header.basis === 'CBM' ? 'var(--amber, #f57c00)' : 'var(--text3)' }}>
                    GW &lt;&lt; CW · CBM으로 계산 {liveResult.header.basis === 'CBM' && '✓ 사용 중'}
                  </div>
                  <table className="tbl" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th>카테고리</th>
                        <th style={{ textAlign: 'right' }}>박스당 CBM</th>
                        <th style={{ textAlign: 'right' }}>박스 수</th>
                        <th style={{ textAlign: 'right' }}>비율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveResult.categories.map(c => {
                        const edit = catEditing[c.flowerName];
                        const fkKey = normalizeFlower(c.flowerName);
                        const fkId = flowerNameToKey[fkKey];
                        const cellStyle = { width: 60, height: 22, border: '1px solid var(--blue)', borderRadius: 3, textAlign: 'right', fontSize: 11, fontFamily: 'var(--mono)', padding: '0 4px', background: '#e3f2fd' };
                        return (
                          <tr key={c.flowerName}>
                            <td className="name"><span className="badge badge-purple">{c.flowerName}</span></td>
                            <td className="num" onClick={() => !edit && fkId && startCatEdit(c.flowerName, c)} style={{ cursor: fkId ? 'pointer' : 'default', background: edit ? '#fffde7' : undefined }}>
                              {edit ? <input type="number" step="0.1" style={cellStyle} value={edit.BoxCBM} onChange={e => updCatField(c.flowerName, 'BoxCBM', e.target.value)} /> : (c.boxCBM ?? '–')}
                            </td>
                            <td className="num">{fmt(c.boxCount)}</td>
                            <td className="num" style={{ fontWeight: liveResult.header.basis === 'CBM' ? 700 : 400, color: liveResult.header.basis === 'CBM' ? 'var(--amber, #f57c00)' : 'var(--text3)' }}>{pct(c.cbmRatio)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 박스당 송이수 + 관세 + 저장 버튼 영역 */}
              <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', background: '#fafafa' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>📦 카테고리 기본값 (송이/박스 + 관세%) — 전역 저장 (Flower 마스터)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                  {liveResult.categories.map(c => {
                    const edit = catEditing[c.flowerName];
                    const fkKey = normalizeFlower(c.flowerName);
                    const fkId = flowerNameToKey[fkKey];
                    const fm = apiData?.flowerMeta?.[fkKey] || {};
                    const curTariffPct = fm.defaultTariff != null ? (fm.defaultTariff * 100).toFixed(2) : null;
                    const cellStyle = { width: 54, height: 22, border: '1px solid var(--blue)', borderRadius: 3, textAlign: 'right', fontSize: 11, fontFamily: 'var(--mono)', padding: '0 4px', background: '#e3f2fd' };
                    return (
                      <div key={c.flowerName} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', background: edit ? '#fffde7' : '#fff', border: '1px solid var(--border)', borderRadius: 4, flexWrap: 'wrap' }}>
                        <span className="badge badge-purple" style={{ fontSize: 10 }}>{c.flowerName}</span>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>송이/박스</span>
                        {edit
                          ? <input type="number" style={cellStyle} value={edit.StemsPerBox} onChange={e => updCatField(c.flowerName, 'StemsPerBox', e.target.value)} />
                          : <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, cursor: fkId ? 'pointer' : 'default' }} onClick={() => fkId && startCatEdit(c.flowerName, c)}>{c.stemsPerBox ?? '–'}</span>}
                        <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>관세</span>
                        {edit
                          ? <>
                              <input type="number" step="0.01" style={cellStyle} value={edit.DefaultTariff ?? ''} onChange={e => updCatField(c.flowerName, 'DefaultTariff', e.target.value)} placeholder="0" />
                              <span style={{ fontSize: 10 }}>%</span>
                            </>
                          : <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: curTariffPct ? 'var(--amber, #f57c00)' : 'var(--text3)', cursor: fkId ? 'pointer' : 'default' }} onClick={() => fkId && startCatEdit(c.flowerName, c)}>{curTariffPct != null ? curTariffPct + '%' : '–'}</span>}
                        {edit
                          ? <span style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                              <button className="btn btn-primary btn-sm" style={{ height: 22, padding: '0 6px', fontSize: 11 }} onClick={() => saveCatEdit(c.flowerName, fkId)} disabled={catSaving === c.flowerName}>💾</button>
                              <button className="btn btn-secondary btn-sm" style={{ height: 22, padding: '0 6px', fontSize: 11 }} onClick={() => setCatEditing(m => { const n = { ...m }; delete n[c.flowerName]; return n; })}>✕</button>
                            </span>
                          : <button className="btn btn-secondary btn-sm" style={{ height: 22, padding: '0 6px', fontSize: 11, marginLeft: 'auto' }} disabled={!fkId} onClick={() => startCatEdit(c.flowerName, c)}>✏️</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ━━ Row 3: 품목 상세 원가 ━━ */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">품목 상세 원가</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>{liveResult.rows.length}개 품목</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 1600, fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>농장</th><th>품목명</th>
                    <th style={{ background: '#fff3e0' }}>카테고리</th>
                    <th style={{ textAlign: 'right', background: '#e8f5e9' }}>박스수</th>
                    <th style={{ textAlign: 'right', background: '#e8f5e9' }}>단수</th>
                    <th style={{ textAlign: 'right', background: '#e8f5e9' }}>송이수</th>
                    <th style={{ textAlign: 'right', background: '#e8f5e9' }}>단가(USD)</th>
                    <th style={{ textAlign: 'right', background: '#e8f5e9' }}>총액(USD)</th>
                    <th style={{ textAlign: 'right' }}>운송비/송이</th>
                    <th style={{ textAlign: 'right' }}>CNF USD</th>
                    <th style={{ textAlign: 'right' }}>CNF 원</th>
                    <th style={{ textAlign: 'right' }}>관세</th>
                    <th style={{ textAlign: 'right' }}>그외통관</th>
                    <th style={{ textAlign: 'right' }}>도착원가/송이</th>
                    <th style={{ textAlign: 'right' }}>단당송이(N)</th>
                    <th style={{ textAlign: 'right' }}>도착원가/단</th>
                    <th style={{ textAlign: 'right' }}>판매가(Q)</th>
                    <th style={{ textAlign: 'right' }}>단이익</th>
                    <th style={{ textAlign: 'right' }}>이익률</th>
                    <th style={{ textAlign: 'right' }}>종 판매</th>
                    <th style={{ textAlign: 'right' }}>종 이익</th>
                  </tr>
                </thead>
                <tbody>
                  {liveResult.rows.map((r, i) => {
                    const overridden = rowsOverride[r.prodKey] || {};
                    const profitNeg = (r.profitPerBunch || 0) < 0;
                    // 농장 바뀔 때만 표시 (엑셀 원본과 동일)
                    const prevFarm = i > 0 ? liveResult.rows[i-1].farmName : null;
                    const showFarm = r.farmName && r.farmName !== prevFarm;
                    const isFarmBoundary = i > 0 && r.farmName !== prevFarm;
                    const steamZero = (Number(r.steamQty) || 0) === 0 && ((r.rawBoxQty || 0) > 0 || (r.bunchQty || 0) > 0);
                    const usingDefault = r.steamQtySource === 'bunch_default' || r.steamQtySource === 'box_default' || r.stemsPerBunchSource === 'default';
                    return (
                      <tr key={i} style={{
                        background: overridden.stemsPerBunch != null || overridden.salePriceKRW != null ? '#fffde7'
                                  : steamZero ? '#ffebee'
                                  : usingDefault ? '#fff8e1' : undefined,
                        borderTop: isFarmBoundary ? '2px solid var(--blue)' : undefined,
                      }}>
                        <td style={{ color: 'var(--blue)', fontSize: 11, fontWeight: showFarm ? 700 : 400 }}>{showFarm ? r.farmName : ''}</td>
                        <td>{r.prodName}</td>
                        <td style={{ background: overridden.flowerName ? '#fff9c4' : (r.flowerName === '기타' || !r.flowerName ? '#ffebee' : '#fff3e0') }}>
                          {editMode ? (
                            <select
                              value={overridden.flowerName ?? r.flowerName ?? ''}
                              onChange={e => updateRowCategory(r.prodKey, e.target.value)}
                              style={{ width: '100%', height: 22, border: '1px solid var(--border2)', borderRadius: 3, fontSize: 10, padding: '0 2px', background: '#fff' }}
                            >
                              <option value="">(없음)</option>
                              {Object.keys(flowerNameToKey).map(nk => {
                                // flowerNameToKey 는 normalized key. 실제 한글 라벨은 apiData.flowerMeta 에서 찾아야 함
                                // 간단히 nk 를 그대로 노출 (대부분 한글명)
                                return <option key={nk} value={nk}>{nk}</option>;
                              })}
                              {/* 추가 선택지: 업계 표준 카테고리 */}
                              {['장미','카네이션','리모니움','유칼립투스','리시안서스','안개꽃','아스파라거스','스프레이카네이션','알스트로','루스커스','릴리','튤립','소국','기타'].filter(c => !flowerNameToKey[c]).map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontSize: 11, color: r.flowerName === '기타' || !r.flowerName ? 'var(--red)' : 'var(--text)' }}>
                              {r.flowerName || '(없음)'}{overridden.flowerName ? ' *' : ''}
                            </span>
                          )}
                        </td>
                        <td className="num">{fmt(r.rawBoxQty)}</td>
                        <td className="num">{fmt(r.bunchQty)}</td>
                        <td className="num"
                          style={{ color: steamZero ? 'var(--red)' : usingDefault ? 'var(--amber, #f57c00)' : 'inherit', fontWeight: steamZero || usingDefault ? 700 : 400 }}
                          title={steamZero ? '수량 계산 불가 (단수·박스수 모두 0)' : usingDefault ? '단당송이 미설정 → 카테고리 표준값으로 자동 계산. 품목 마스터에서 정확히 설정하세요.' : undefined}
                        >
                          {fmt(r.steamQty)}{steamZero ? ' ⚠' : usingDefault ? ' ~' : ''}
                        </td>
                        <td className="num">{fmt2(r.fobUSD)}</td>
                        <td className="num">{fmt2(r.totalPriceUSD)}</td>
                        <td className="num">{fmt4(r.freightPerStemUSD)}</td>
                        <td className="num">{fmt4(r.cnfUSD)}</td>
                        <td className="num">{fmt2(r.cnfKRW)}</td>
                        <td className="num" style={{ color: r.tariffKRW > 0 ? 'var(--amber)' : 'var(--text3)' }}>{fmt2(r.tariffKRW)}</td>
                        <td className="num">{fmt2(r.customsPerStem)}</td>
                        <td className="num">{fmt2(r.arrivalPerStem)}</td>
                        <td className="num">
                          {editMode
                            ? <input type="number" value={rowsOverride[r.prodKey]?.stemsPerBunch ?? r.stemsPerBunch ?? ''} onChange={e => updateRow(r.prodKey, 'stemsPerBunch', e.target.value)} style={iCell} />
                            : fmt(r.stemsPerBunch)}
                        </td>
                        <td className="num">{fmt2(r.arrivalPerBunch)}</td>
                        <td className="num">
                          {editMode
                            ? <input type="number" value={rowsOverride[r.prodKey]?.salePriceKRW ?? r.salePriceKRW ?? ''} onChange={e => updateRow(r.prodKey, 'salePriceKRW', e.target.value)} style={iCell} />
                            : fmt(r.salePriceKRW)}
                        </td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'inherit' }}>{fmt2(r.profitPerBunch)}</td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'inherit', fontWeight: 600 }}>{pct(r.profitRate)}</td>
                        <td className="num">{fmt(r.totalSaleKRW)}</td>
                        <td className="num" style={{ color: profitNeg ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{fmt(r.totalProfitKRW)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td style={{ textAlign: 'right' }} colSpan={3}>합계</td>
                    <td className="num">{fmt(liveResult.rows.reduce((a,r) => a + (r.rawBoxQty || 0), 0))}</td>
                    <td className="num">{fmt(liveResult.rows.reduce((a,r) => a + (r.bunchQty || 0), 0))}</td>
                    <td className="num">{fmt(liveResult.rows.reduce((a,r) => a + (r.steamQty || 0), 0))}</td>
                    <td></td>
                    <td className="num">{fmt2(liveResult.rows.reduce((a,r) => a + (r.totalPriceUSD || 0), 0))}</td>
                    <td colSpan={11}></td>
                    <td className="num">{fmt(liveResult.totals.totalSaleKRW)}</td>
                    <td className="num" style={{ color: liveResult.totals.totalProfitKRW < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{fmt(liveResult.totals.totalProfitKRW)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const iCell = { width: 70, height: 22, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 11, fontFamily: 'var(--mono)', padding: '0 4px', background: '#fff' };

function NumField({ label, value, onChange, readOnly }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      {readOnly
        ? <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{value != null ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '–'}</div>
        : <input type="number" step="any" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ width: '100%', height: 26, border: '1px solid var(--blue)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 6px', background: '#e3f2fd' }} />}
    </div>
  );
}
