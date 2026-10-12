import { useCallback, useEffect, useRef, useState } from 'react';
import { EXE_FIELDS } from '../lib/pivotExeModel.js';
import { getUnavailablePivotExeSelections, normalizePivotExeView, parsePivotExeFavoriteView } from '../lib/pivotExeViewState';

const PAGE = 'stats-pivot-exe';
const FIELD_LABELS = new Map(EXE_FIELDS.map(({ id, label }) => [id, label]));

function favoriteKey(favorite) {
  return String(favorite?.FavoriteKey ?? favorite?.favoriteKey ?? '');
}

async function readFavoriteResponse(response) {
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch {
    throw new Error('즐겨찾기 서버가 올바른 응답을 반환하지 않았습니다. 잠시 후 다시 시도하세요.');
  }
  if (!response.ok || !payload?.success) throw new Error(payload?.error || '즐겨찾기 요청을 처리하지 못했습니다.');
  return payload;
}

function summarize(view) {
  const zone = (ids) => ids.map((id) => FIELD_LABELS.get(id) || id).join(' · ') || '없음';
  const valueNames = view.zones.values.map(({ id, aggregation }) => `${FIELD_LABELS.get(id) || id}(${aggregation})`).join(' · ') || '없음';
  const selected = Object.entries(view.selections)
    .filter(([, values]) => values.length)
    .map(([id, values]) => {
      const examples = values.slice(0, 3).map((value) => value === null ? '(빈값)' : String(value)).join(', ');
      return `${FIELD_LABELS.get(id) || id}: ${examples}${values.length > 3 ? ` 외 ${values.length - 3}개` : ''}`;
    });
  const advanced = view.ast?.children?.length ? [`고급조건 ${view.ast.children.length}개`] : [];
  return [
    `행: ${zone(view.zones.rows)}`,
    `열: ${zone(view.zones.cols)}`,
    `값: ${valueNames}`,
    `필터: ${[...selected, ...advanced].join(' · ') || '없음'}`,
    `표시: 소수점 ${view.decimals}자리 · 0 ${view.zeroVisible ? '표시' : '숨김'} · 행 높이 ${view.rowHeight}px${view.weekGrouping === 'main' ? ' · 메인차수 합산' : ''}`,
  ];
}

/** Per-user EXE pivot view favorites; range and fetched ERP rows are never stored here. */
export default function PivotExeFavorites({ view, onApply, dataValues = {}, disabled = false }) {
  const [favorites, setFavorites] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState('');
  const mounted = useRef(true);
  const pendingRef = useRef(false);
  const listRequest = useRef({ sequence: 0, controller: null });

  const withPending = useCallback(async (action) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    if (mounted.current) setPending(true);
    try { await action(); }
    catch (error) { if (mounted.current) setStatus(error?.message || '즐겨찾기 요청에 실패했습니다.'); }
    finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  const loadFavorites = useCallback(() => {
    const sequence = listRequest.current.sequence + 1;
    listRequest.current.controller?.abort();
    const controller = new AbortController();
    listRequest.current = { sequence, controller };
    if (mounted.current) { setListLoading(true); setStatus(''); }
    return fetch(`/api/favorites?page=${encodeURIComponent(PAGE)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(readFavoriteResponse)
      .then((payload) => {
        if (mounted.current && listRequest.current.sequence === sequence) {
          const next = Array.isArray(payload.favorites) ? payload.favorites : [];
          setFavorites(next);
          setSelectedKey((current) => next.some((favorite) => favoriteKey(favorite) === current) ? current : '');
        }
      })
      .catch((error) => {
        if (mounted.current && listRequest.current.sequence === sequence && error?.name !== 'AbortError') setStatus(error?.message || '즐겨찾기 목록을 불러오지 못했습니다.');
      })
      .finally(() => { if (mounted.current && listRequest.current.sequence === sequence) setListLoading(false); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadFavorites();
    return () => { mounted.current = false; listRequest.current.controller?.abort(); };
  }, [loadFavorites]);

  const selected = favorites.find((favorite) => favoriteKey(favorite) === selectedKey);
  const selectedView = selected ? (() => { try { return parsePivotExeFavoriteView(selected.FilterData); } catch { return null; } })() : null;
  const summary = selectedView ? summarize(selectedView) : [];
  const unavailable = disabled || pending || listLoading;
  const requireName = () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('즐겨찾기 이름을 입력하세요.');
    return trimmed;
  };
  const safeView = () => normalizePivotExeView(view);
  const updateLocal = (key, update) => setFavorites((current) => current.map((favorite) => favoriteKey(favorite) === key ? { ...favorite, ...update } : favorite));

  const saveNew = () => withPending(async () => {
    const favoriteName = requireName();
    const filterData = JSON.stringify(safeView());
    const payload = await fetch('/api/favorites', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: PAGE, name: favoriteName, filterData }),
    }).then(readFavoriteResponse);
    const key = Number(payload.favoriteKey);
    if (!Number.isSafeInteger(key) || key <= 0) throw new Error('즐겨찾기 저장 결과가 올바르지 않습니다.');
    const favorite = { FavoriteKey: key, FavName: favoriteName, FilterData: filterData };
    if (!mounted.current) return;
    setFavorites((current) => [...current, favorite]);
    setSelectedKey(favoriteKey(favorite));
    setName(favoriteName);
    setStatus('새 즐겨찾기를 저장했습니다.');
    setManageOpen(false);
  });

  const loadSelected = () => {
    if (!selected) { setStatus('불러올 즐겨찾기를 선택하세요.'); return; }
    try {
      const savedView = parsePivotExeFavoriteView(selected.FilterData);
      const missing = getUnavailablePivotExeSelections(savedView, dataValues).map(({ field, missing: values }) => `${FIELD_LABELS.get(field) || field}: 선택값 ${values.length}개`);
      if (missing.length && typeof window !== 'undefined' && !window.confirm(`현재 차수/조회 데이터에 없는 저장 필터가 있습니다. 적용하면 해당 필터가 빈 결과를 만들 수 있습니다.\n\n${missing.join('\n')}\n\n계속 적용할까요?`)) return;
      onApply?.(savedView);
      setStatus(`“${selected.FavName}”을 불러왔습니다. 현재 차수 범위는 유지했습니다.`);
    } catch (error) { setStatus(error?.message || '즐겨찾기를 적용하지 못했습니다.'); }
  };

  const overwriteSelected = () => withPending(async () => {
    if (!selected) throw new Error('덮어쓸 즐겨찾기를 선택하세요.');
    const filterData = JSON.stringify(safeView());
    await fetch('/api/favorites', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: selected.FavoriteKey, name: selected.FavName, filterData }),
    }).then(readFavoriteResponse);
    if (!mounted.current) return;
    updateLocal(selectedKey, { FilterData: filterData });
    setStatus('현재 화면 설정으로 선택한 즐겨찾기를 덮어썼습니다.');
    setManageOpen(false);
  });

  const renameSelected = () => withPending(async () => {
    if (!selected) throw new Error('이름을 바꿀 즐겨찾기를 선택하세요.');
    const favoriteName = requireName();
    await fetch('/api/favorites', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: selected.FavoriteKey, name: favoriteName, filterData: selected.FilterData }),
    }).then(readFavoriteResponse);
    if (!mounted.current) return;
    updateLocal(selectedKey, { FavName: favoriteName });
    setStatus('즐겨찾기 이름을 변경했습니다. 저장된 화면 설정은 유지했습니다.');
    setManageOpen(false);
  });

  const deleteSelected = () => withPending(async () => {
    if (!selected) throw new Error('삭제할 즐겨찾기를 선택하세요.');
    if (typeof window !== 'undefined' && !window.confirm(`“${selected.FavName}” 즐겨찾기를 삭제할까요?`)) return;
    await fetch('/api/favorites', {
      method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: selected.FavoriteKey }),
    }).then(readFavoriteResponse);
    if (!mounted.current) return;
    setFavorites((current) => current.filter((favorite) => favoriteKey(favorite) !== selectedKey));
    setSelectedKey('');
    setName('');
    setStatus('즐겨찾기를 삭제했습니다.');
    setManageOpen(false);
  });

  return <section aria-label="전산 피벗 즐겨찾기" data-testid="pivot-exe-favorites" style={panelStyle}>
    <div style={toolbarStyle}>
      <b style={{ whiteSpace: 'nowrap', color: '#34445a' }}>내 즐겨찾기</b>
      <select data-testid="pivot-exe-favorite-select" value={selectedKey} disabled={unavailable} style={selectStyle} onChange={(event) => {
        const key = event.target.value;
        setSelectedKey(key);
        const favorite = favorites.find((item) => favoriteKey(item) === key);
        setName(favorite?.FavName || '');
      }} aria-label="즐겨찾기 선택">
        <option value="">즐겨찾기 선택</option>
        {favorites.map((favorite) => <option key={favoriteKey(favorite)} value={favoriteKey(favorite)}>{favorite.FavName}</option>)}
      </select>
      <button type="button" className="btn btn-sm btn-primary" data-testid="pivot-exe-favorite-load" disabled={unavailable || !selected} onClick={loadSelected}>불러오기</button>
      <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-manage" disabled={disabled || pending} onClick={() => { setName(selected?.FavName || ''); setManageOpen(true); }}>저장·관리</button>
      <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-refresh" disabled={disabled || pending || listLoading} onClick={loadFavorites} title="목록 새로고침" aria-label="즐겨찾기 목록 새로고침">↻</button>
    </div>
    {selected ? <div data-testid="pivot-exe-favorite-preview" style={previewStyle}>
      <b>{selected.FavName}</b>
      <div style={summaryGrid}>{summary.map((line) => <span key={line}>{line}</span>)}</div>
      <small style={{ color: '#52616b' }}>차수 범위는 현재 선택을 유지합니다.</small>
    </div> : <div style={emptyStyle}>{listLoading ? '즐겨찾기 목록 불러오는 중…' : favorites.length ? '즐겨찾기를 선택하면 행·열·값·필터 구성을 미리 봅니다.' : '저장된 즐겨찾기가 없습니다. 현재 구성을 저장해 시작하세요.'}</div>}
    <span data-testid="pivot-exe-favorite-status" role="status" aria-live="polite" style={{ color: status.includes('실패') || status.includes('못했') || status.includes('올바르지') ? '#b42318' : '#52616b', fontSize: 11 }}>{pending ? '요청 처리 중…' : status.replace(/^FAVORITE:\s*/, '즐겨찾기 설정 오류: ')}</span>
    {manageOpen && <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && setManageOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="pivot-favorites-dialog-title" style={dialogStyle}>
        <header style={dialogHeader}><b id="pivot-favorites-dialog-title">즐겨찾기 저장·관리</b><button type="button" aria-label="닫기" onClick={() => setManageOpen(false)}>×</button></header>
        <div style={{ display: 'grid', gap: 10, padding: 14 }}>
          <label style={fieldLabel}>즐겨찾기 이름<input data-testid="pivot-exe-favorite-name" value={name} disabled={unavailable} maxLength={100} style={nameInputStyle} onChange={(event) => setName(event.target.value)} placeholder="예: 주간 농장별 주문" /></label>
          <div style={calloutStyle}>새로 저장하거나 현재 화면으로 덮어씁니다. 이름 변경은 저장된 화면 설정을 바꾸지 않습니다. 현재 차수 범위와 원본 자료는 즐겨찾기에 저장되지 않습니다.</div>
          <div style={actionBlock}><b>현재 화면 저장</b><button type="button" className="btn btn-sm btn-primary" data-testid="pivot-exe-favorite-save" disabled={unavailable} onClick={saveNew}>새 즐겨찾기로 저장</button></div>
          <div style={actionBlock}><b>선택한 즐겨찾기</b><div style={buttonRow}>
            <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-update" disabled={unavailable || !selected} onClick={overwriteSelected}>현재 화면으로 덮어쓰기</button>
            <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-rename" disabled={unavailable || !selected} onClick={renameSelected}>이름만 변경</button>
            <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-delete" disabled={unavailable || !selected} onClick={deleteSelected}>삭제</button>
          </div></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-sm" onClick={() => setManageOpen(false)}>닫기</button></div>
        </div>
      </section>
    </div>}
  </section>;
}

const panelStyle = { display: 'grid', gap: 5, minWidth: 0, padding: '6px 8px', border: '1px solid #d5dfeb', borderRadius: 7, background: '#fff' };
const toolbarStyle = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' };
const selectStyle = { minWidth: 150, maxWidth: 250, flex: '1 1 180px' };
const previewStyle = { display: 'grid', gap: 4, padding: '6px 8px', borderRadius: 5, background: '#f5f8fc', fontSize: 11 };
const summaryGrid = { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '2px 12px', color: '#52616b' };
const emptyStyle = { color: '#667085', fontSize: 11 };
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(15,23,42,.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 };
const dialogStyle = { width: 480, maxWidth: 'min(100%, 600px)', maxHeight: '90vh', overflow: 'auto', border: '1px solid #b9c7d8', borderRadius: 9, background: '#fff', boxShadow: '0 18px 55px rgba(15,23,42,.28)' };
const dialogHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #e1e7ef', color: '#26384d' };
const fieldLabel = { display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 };
const nameInputStyle = { width: '100%', padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 5, font: 'inherit', fontWeight: 400 };
const calloutStyle = { padding: '8px 10px', borderRadius: 5, background: '#f2f7fc', color: '#52616b', fontSize: 11, lineHeight: 1.5 };
const actionBlock = { display: 'grid', gap: 7, padding: 10, border: '1px solid #e1e7ef', borderRadius: 6, fontSize: 12 };
const buttonRow = { display: 'flex', flexWrap: 'wrap', gap: 6 };
