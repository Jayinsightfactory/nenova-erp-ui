import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRaumPnlJson } from '../../lib/raumPnlHttp';
import { isCurrentShillaPnlSearchRequest, readShillaPnlProductSearchResponse, runShillaPnlSearchEnter, shillaPnlProductSearchUrl, shillaPnlSearchEmptyMessage } from '../../lib/shillaPnlSearch';

const border = '1px solid #cbd5e1';
const btn = { height: 28, padding: '0 8px', border, borderRadius: 4, background: '#fff', fontSize: 12, cursor: 'pointer' };
const primary = { ...btn, background: '#0f766e', borderColor: '#0f766e', color: '#fff', fontWeight: 700 };
const productKey = product => { const key = Number(product?.prodKey ?? product?.ProdKey); return Number.isInteger(key) && key > 0 ? key : null; };
const productName = product => String(product?.prodName ?? product?.ProdName ?? product?.name ?? product?.Name ?? '').trim();
const eligible = (group, draft) => group?.suggestion?.status !== 'conflict' && Number.isInteger(Number(draft?.prodKey)) && Number(draft.prodKey) > 0;

export function buildShillaBulkMatchPayload(orderYear, groups, drafts) {
  return { partnerCode: 'shilla', orderYear: String(orderYear), action: 'MATCH_SELECTED_GROUPS', confirmed: true,
    groups: (groups || []).filter(group => drafts?.[group.groupKey]?.selected && eligible(group, drafts[group.groupKey])).map(group => ({ groupKey: group.groupKey, prodKey: Number(drafts[group.groupKey].prodKey), expected: group.expected })) };
}
export function shillaBulkMatchPayloadBytes(payload) {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}
export function shillaBulkMatchPayloadError(payload) {
  return shillaBulkMatchPayloadBytes(payload) > 900 * 1024
    ? '선택한 그룹이 한 번에 보낼 수 있는 900KB를 넘습니다. 일부 그룹 선택을 해제한 뒤 다시 확인하세요.'
    : '';
}
export function submitShillaBulkMatchPayload(payload, send) {
  const error = shillaBulkMatchPayloadError(payload);
  if (error) return { sent: false, error, payload };
  return Promise.resolve(send(payload)).then(result => ({ sent: true, result, payload }));
}
export function shillaBulkSelection(groups, drafts) {
  const selected = (groups || []).filter(group => drafts?.[group.groupKey]?.selected && eligible(group, drafts[group.groupKey]));
  return { selected, groupCount: selected.length, itemCount: selected.reduce((sum, group) => sum + Number(group.unmatchedCount || 0), 0), majors: [...new Set(selected.flatMap(group => group.majors || []).map(Number).filter(Number.isInteger))].sort((a, b) => b - a) };
}
export function invalidateShillaBulkSearch(requestRef, setSearching) {
  requestRef.current += 1;
  setSearching(false);
}

export default function ShillaBulkMatchModal({ orderYear, onSaved, onClose, onBusyChange }) {
  const [groups, setGroups] = useState([]); const [drafts, setDrafts] = useState({}); const [ungroupedCount, setUngroupedCount] = useState(0);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState(null);
  const [filter, setFilter] = useState(''); const [confirming, setConfirming] = useState(false); const [searchKey, setSearchKey] = useState(''); const [query, setQuery] = useState(''); const [products, setProducts] = useState([]); const [searching, setSearching] = useState(false); const [hasSearched, setHasSearched] = useState(false);
  const getRequest = useRef(0); const searchRequest = useRef(0); const savingRef = useRef(false); const scopeKey = `shilla:${String(orderYear)}`;
  const load = async (preserve = false) => {
    const request = ++getRequest.current; setLoading(true); setError('');
    try {
      const data = await fetchRaumPnlJson(`/api/raum/shilla-bulk-mapping?partnerCode=shilla&orderYear=${encodeURIComponent(String(orderYear))}`, undefined, { operation: 'load' });
      if (!isCurrentShillaPnlSearchRequest(request, getRequest.current)) return false;
      if (data?.scope?.partnerCode !== 'shilla' || String(data?.scope?.orderYear) !== String(orderYear)) throw new Error('선택 연도·신라호텔 범위와 다른 응답입니다. 다시 열어 주세요.');
      if (!Array.isArray(data.groups)) throw new Error('서버에서 미매칭 그룹 목록을 받지 못했습니다. 다시 불러오세요.');
      const next = data.groups;
      setGroups(next); setUngroupedCount(Number(data.ungroupedCount || 0));
      setDrafts(previous => next.reduce((out, group) => { const old = preserve ? previous[group.groupKey] : null; const suggestion = group?.suggestion?.status === 'unique' ? group.suggestion.product : null; out[group.groupKey] = { prodKey: old?.prodKey ?? productKey(suggestion), product: old?.product ?? suggestion ?? null, selected: old?.selected === true }; return out; }, {}));
      return true;
    } catch (cause) { if (isCurrentShillaPnlSearchRequest(request, getRequest.current)) setError(cause.message || '미매칭 품목을 불러오지 못했습니다. 선택은 유지됩니다.'); throw cause; }
    finally { if (isCurrentShillaPnlSearchRequest(request, getRequest.current)) setLoading(false); }
  };
  useEffect(() => { setResult(null); setConfirming(false); setSearchKey(''); setProducts([]); load().catch(() => {}); return () => { getRequest.current += 1; searchRequest.current += 1; }; }, [scopeKey]);
  const visible = useMemo(() => { const needle = filter.trim().toLocaleLowerCase(); return needle ? groups.filter(group => [group.label, group.unit, ...(group.majors || [])].join(' ').toLocaleLowerCase().includes(needle)) : groups; }, [filter, groups]);
  const selection = useMemo(() => shillaBulkSelection(groups, drafts), [groups, drafts]); const searchGroup = groups.find(group => group.groupKey === searchKey);
  const setDraft = (key, patch) => { if (!saving) { setDrafts(old => ({ ...old, [key]: { ...old[key], ...patch } })); setConfirming(false); setResult(null); } };
  const toggleAll = checked => { if (!saving) { setDrafts(old => groups.reduce((out, group) => eligible(group, out[group.groupKey]) ? { ...out, [group.groupKey]: { ...out[group.groupKey], selected: checked } } : out, { ...old })); setConfirming(false); } };
  const openSearch = group => { if (saving || group?.suggestion?.status === 'conflict') return; invalidateShillaBulkSearch(searchRequest, setSearching); setSearchKey(group.groupKey); setQuery(String(group.label || '')); setProducts([]); setHasSearched(false); setError(''); };
  const search = async raw => { const keyword = String(raw ?? query).trim(); if (!keyword || saving) return; const request = ++searchRequest.current; setQuery(raw ?? query); setHasSearched(true); setSearching(true); setError(''); try { const response = await fetch(shillaPnlProductSearchUrl(keyword)); const found = await readShillaPnlProductSearchResponse(response); if (isCurrentShillaPnlSearchRequest(request, searchRequest.current)) setProducts(found); } catch (cause) { if (isCurrentShillaPnlSearchRequest(request, searchRequest.current)) { setProducts([]); setError(cause.message || '품목을 찾지 못했습니다.'); } } finally { if (isCurrentShillaPnlSearchRequest(request, searchRequest.current)) setSearching(false); } };
  const pick = product => { if (!searchGroup || saving || !productKey(product)) return; setDraft(searchGroup.groupKey, { prodKey: productKey(product), product, selected: false }); setSearchKey(''); setProducts([]); };
  const save = async () => {
    const payload = buildShillaBulkMatchPayload(orderYear, groups, drafts); if (savingRef.current || !payload.groups.length) return;
    const payloadError = shillaBulkMatchPayloadError(payload);
    if (payloadError) { setError(payloadError); return; }
    savingRef.current = true; getRequest.current += 1; setSaving(true); onBusyChange?.(true); setError('');
    try {
      const submitted = await submitShillaBulkMatchPayload(payload, body => fetchRaumPnlJson('/api/raum/shilla-bulk-mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { operation: 'save' }));
      const saved = submitted.result;
      let refreshed = false; let refreshError = '';
      try { refreshed = await load(true); refreshed = (await onSaved?.(saved)) !== false && refreshed; } catch (cause) { refreshError = cause.message || '저장 후 화면 갱신에 실패했습니다.'; }
      setResult({ saved, refreshed, refreshError }); setConfirming(false);
    } catch (cause) { setError(cause.message || '일괄 연결 저장에 실패했습니다. 선택은 유지됩니다.'); }
    finally { savingRef.current = false; setSaving(false); onBusyChange?.(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label="신라 미매칭 품목 일괄 연결" style={{ position: 'fixed', inset: 0, zIndex: 61, display: 'grid', placeItems: 'center', padding: 14, background: 'rgba(15,23,42,.45)' }}><div style={{ width: 'min(1180px, 100%)', maxHeight: 'min(860px, 94vh)', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, padding: 14 }}>
    <style>{'@media (max-width:900px){.shilla-bulk-grid{grid-template-columns:minmax(0,1fr)!important}.shilla-bulk-search{border-left:0!important;border-top:1px solid #cbd5e1;padding-left:0!important;padding-top:10px!important}}'}</style>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><div><b>신라 미매칭 품목 일괄 연결</b><span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>신라호텔 {orderYear}년 · 원본 품목명과 단위가 같은 행만</span></div><button type="button" style={btn} disabled={saving} onClick={onClose}>닫기</button></div>
    <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>추천 품목은 저장 전 초안입니다. 그룹을 체크하고 확인해야만 한 번에 연결됩니다.</div>
    {ungroupedCount > 0 ? <div style={{ marginTop: 7, fontSize: 12, color: '#92400e' }}>품목명 또는 단위가 없어 묶지 못한 {ungroupedCount}건은 원본을 확인하세요.</div> : null}
    {error ? <div role="alert" style={{ marginTop: 7, fontSize: 12, color: '#b91c1c' }}>{error} <button type="button" style={{ ...btn, height: 23 }} disabled={saving || loading} onClick={() => load(true).catch(() => {})}>다시 불러오기</button></div> : null}
    {result ? <div role="status" style={{ marginTop: 7, padding: 7, fontSize: 12, color: result.refreshed && !ungroupedCount ? '#166534' : '#92400e', background: result.refreshed && !ungroupedCount ? '#f0fdf4' : '#fffbeb' }}>{result.refreshed ? (ungroupedCount ? '선택 그룹 저장·목록 갱신 완료 — 묶지 못한 원본 행이 남아 있습니다.' : '저장 및 목록 갱신 완료') : `저장은 완료됐지만 목록 갱신을 확인하지 못했습니다${result.refreshError ? `: ${result.refreshError}` : ''}`} · ${Number(result.saved.changedGroupCount || 0)}그룹 · ${Number(result.saved.changedItemCount || 0)}행 · ${(result.saved.affectedMajors || []).map(major => `${major}차`).join(', ')}</div> : null}
    <div className="shilla-bulk-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(500px, 1fr) minmax(300px, .58fr)', gap: 12, marginTop: 9, maxHeight: '60vh', overflow: 'auto' }}><section style={{ minWidth: 0 }}><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 5 }}><input aria-label="미매칭 품목 찾기" value={filter} disabled={saving} onChange={event => setFilter(event.target.value)} placeholder="품목명·단위·차수 찾기" style={{ width: 185, height: 27, padding: '0 6px', border, borderRadius: 4, fontSize: 12 }} /><button type="button" style={btn} disabled={saving || loading} onClick={() => toggleAll(true)}>후보 선택 전체 적용</button><button type="button" style={btn} disabled={saving || loading} onClick={() => toggleAll(false)}>선택 해제</button><span style={{ fontSize: 12 }}>선택 {selection.groupCount}그룹 · 미연결 {selection.itemCount}행</span></div><div style={{ overflowX: 'auto' }}><table style={{ width: 'auto', minWidth: 710, borderCollapse: 'collapse', fontSize: 12 }}><colgroup><col style={{ width: 42 }} /><col style={{ width: 205 }} /><col style={{ width: 92 }} /><col style={{ width: 78 }} /><col style={{ width: 110 }} /><col style={{ width: 183 }} /></colgroup><thead><tr>{['적용', '품목명 · 단위', '차수', '미연결/전체', '상태', '선택 품목'].map(label => <th key={label} style={{ padding: '4px 6px', borderBottom: border, textAlign: 'left' }}>{label}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={6} style={{ padding: 8 }}>불러오는 중…</td></tr> : null}{!loading && !visible.length ? <tr><td colSpan={6} style={{ padding: 8 }}>{groups.length ? '찾는 그룹이 없습니다.' : ungroupedCount ? '묶을 수 있는 미매칭 품목이 없습니다.' : '미매칭 품목이 없습니다.'}</td></tr> : null}{visible.map(group => { const draft = drafts[group.groupKey] || {}; const conflict = group?.suggestion?.status === 'conflict'; return <tr key={group.groupKey}><td style={{ padding: 4, borderBottom: border }}><input type="checkbox" aria-label={`${group.label} ${group.unit} 일괄 연결 적용`} checked={draft.selected === true} disabled={saving || loading || !eligible(group, draft)} onChange={event => setDraft(group.groupKey, { selected: event.target.checked })} /></td><td title={`${group.label} · ${group.unit}`} style={{ maxWidth: 200, padding: 4, borderBottom: border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{group.label}</b> · {group.unit}</td><td style={{ padding: 4, borderBottom: border }}>{(group.majors || []).map(major => `${major}차`).join(', ')}</td><td style={{ padding: 4, borderBottom: border }}>{group.unmatchedCount}/{group.memberCount}</td><td style={{ padding: 4, borderBottom: border, color: conflict ? '#b91c1c' : '#475569' }}>{conflict ? '충돌: 단건 해결' : group?.suggestion?.status === 'unique' ? '기존 연결 추천' : '후보 필요'}</td><td style={{ padding: 4, borderBottom: border }}><span title={productName(draft.product)}>{productName(draft.product) || '미선택'}</span> <button type="button" style={{ ...btn, height: 24 }} disabled={saving || loading || conflict} onClick={() => openSearch(group)}>검색</button></td></tr>; })}</tbody></table></div></section>
    <aside className="shilla-bulk-search" style={{ borderLeft: border, paddingLeft: 10, minWidth: 0 }}><b style={{ fontSize: 13 }}>전산 품목 검색</b>{searchGroup ? <><div style={{ marginTop: 5, fontSize: 12 }}><b>{searchGroup.label}</b> · {searchGroup.unit}<br />검색 결과 선택은 이 그룹 초안만 바꿉니다.</div><div style={{ display: 'flex', gap: 4, marginTop: 6 }}><input aria-label={`${searchGroup.label} 전산 품목 검색`} value={query} disabled={saving} onChange={event => { invalidateShillaBulkSearch(searchRequest, setSearching); setQuery(event.target.value); setProducts([]); setHasSearched(false); }} onKeyDown={event => runShillaPnlSearchEnter(event, search)} placeholder="전산 품목명 검색" style={{ minWidth: 0, flex: 1, height: 27, padding: '0 6px', border, borderRadius: 4, fontSize: 12 }} /><button type="button" style={btn} disabled={saving || searching} onClick={() => search(query)}>{searching ? '검색 중…' : '검색'}</button></div>{products.map(product => <div key={productKey(product)} style={{ padding: '5px 0', borderBottom: border, fontSize: 12 }}><b>{productName(product)} #{productKey(product)}</b><br /><span style={{ color: '#64748b' }}>{[product.counName ?? product.CounName, product.flowerName ?? product.FlowerName, product.outUnit ?? product.OutUnit].filter(Boolean).join(' · ')}</span><br /><button type="button" style={{ ...primary, height: 24, marginTop: 3 }} disabled={saving} onClick={() => pick(product)}>이 그룹에 선택</button></div>)}{!searching && shillaPnlSearchEmptyMessage({ hasSearched, products, error }) ? <div style={{ padding: 7, fontSize: 12 }}>검색 결과 없음</div> : null}</> : <div style={{ marginTop: 7, fontSize: 12, color: '#64748b' }}>왼쪽 그룹의 검색 버튼을 누르세요.</div>}</aside></div>
    <div style={{ position: 'sticky', bottom: 0, background: '#fff', paddingTop: 9, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 12 }}>{confirming ? `확인: ${selection.groupCount}그룹 · ${selection.itemCount}행 · ${selection.majors.map(major => `${major}차`).join(', ')}` : '기존 연결과 원본 수량·단가·분배율은 바꾸지 않습니다.'}</span>{confirming ? <span><button type="button" style={btn} disabled={saving || loading} onClick={() => setConfirming(false)}>돌아가기</button> <button type="button" style={primary} disabled={saving || loading || !selection.groupCount} onClick={save}>{saving ? '저장 중…' : '확인하고 일괄 연결'}</button></span> : <button type="button" style={primary} disabled={saving || loading || !selection.groupCount} onClick={() => setConfirming(true)}>선택 적용 확인</button>}</div>
  </div></div>;
}
