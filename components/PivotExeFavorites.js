import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePivotExeView, parsePivotExeFavoriteView } from '../lib/pivotExeViewState';

const PAGE = 'stats-pivot-exe';

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

/** Compact, explicit CRUD toolbar for server-saved, per-user EXE pivot favorites. */
export default function PivotExeFavorites({ view, onApply, disabled = false }) {
  const [favorites, setFavorites] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [listLoading, setListLoading] = useState(true);
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
        if (mounted.current && listRequest.current.sequence === sequence) setFavorites(Array.isArray(payload.favorites) ? payload.favorites : []);
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
  const unavailable = disabled || pending || listLoading;
  const requireName = () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('즐겨찾기 이름을 입력하세요.');
    return trimmed;
  };
  const safeView = () => normalizePivotExeView(view);

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
    setStatus('새 즐겨찾기를 저장했습니다.');
  });

  const loadSelected = () => {
    if (!selected) { setStatus('불러올 즐겨찾기를 선택하세요.'); return; }
    try {
      onApply?.(parsePivotExeFavoriteView(selected.FilterData));
      setStatus(`“${selected.FavName}”을 불러왔습니다.`);
    } catch (error) { setStatus(error?.message || '즐겨찾기를 적용하지 못했습니다.'); }
  };

  const updateSelected = () => withPending(async () => {
    if (!selected) throw new Error('덮어쓸 즐겨찾기를 선택하세요.');
    const favoriteName = requireName();
    const filterData = JSON.stringify(safeView());
    await fetch('/api/favorites', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: selected.FavoriteKey, name: favoriteName, filterData }),
    }).then(readFavoriteResponse);
    if (!mounted.current) return;
    setFavorites((current) => current.map((favorite) => favoriteKey(favorite) === selectedKey
      ? { ...favorite, FavName: favoriteName, FilterData: filterData }
      : favorite));
    setStatus('선택한 즐겨찾기를 덮어썼습니다.');
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
  });

  return <div aria-label="전산 피벗 즐겨찾기" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, fontSize: 12 }}>
    <span style={{ color: '#52616b', whiteSpace: 'nowrap' }}>내 즐겨찾기 · 차수 유지</span>
    <select data-testid="pivot-exe-favorite-select" value={selectedKey} disabled={unavailable} style={{ maxWidth: 180 }} onChange={(event) => {
      const key = event.target.value;
      setSelectedKey(key);
      const favorite = favorites.find((item) => favoriteKey(item) === key);
      if (favorite) setName(favorite.FavName || '');
    }} aria-label="즐겨찾기 선택">
      <option value="">즐겨찾기 선택</option>
      {favorites.map((favorite) => <option key={favoriteKey(favorite)} value={favoriteKey(favorite)}>{favorite.FavName}</option>)}
    </select>
    <input data-testid="pivot-exe-favorite-name" value={name} disabled={unavailable} maxLength={100} style={{ width: 130, maxWidth: 180 }} onChange={(event) => setName(event.target.value)} placeholder="즐겨찾기 이름" aria-label="즐겨찾기 이름" />
    <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-refresh" disabled={disabled || pending || listLoading} onClick={loadFavorites}>목록 새로고침</button>
    <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-load" disabled={unavailable || !selected} onClick={loadSelected}>불러오기</button>
    <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-save" disabled={unavailable} onClick={saveNew}>새로 저장</button>
    <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-update" disabled={unavailable || !selected} onClick={updateSelected}>선택 덮어쓰기</button>
    <button type="button" className="btn btn-sm" data-testid="pivot-exe-favorite-delete" disabled={unavailable || !selected} onClick={deleteSelected}>삭제</button>
    <span data-testid="pivot-exe-favorite-status" role="status" aria-live="polite" style={{ color: status.includes('실패') || status.includes('못했') || status.includes('올바르지') ? '#b42318' : '#52616b' }}>{pending ? '요청 처리 중…' : listLoading ? '즐겨찾기 목록 불러오는 중…' : status.replace(/^FAVORITE:\s*/, '즐겨찾기 설정 오류: ')}</span>
  </div>;
}
