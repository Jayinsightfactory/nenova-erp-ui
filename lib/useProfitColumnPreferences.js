import { useEffect, useState } from 'react';
import { normalizeColumnSelection, readColumnSelection, writeColumnSelection } from './profitColumnPreferences.mjs';

export function useProfitColumnPreferences(key, allowed, defaults) {
  const [columns, setColumns] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let result;
    try { result = readColumnSelection(window.localStorage, key, allowed, defaults); }
    catch { result = { columns: [...defaults], error: '브라우저 설정 저장을 사용할 수 없습니다.' }; }
    setColumns(result.columns);
    setStorageError(result.error);
    setReady(true);
    // Keys/defaults are fixed for the lifetime of this report preference instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const updateColumns = value => {
    setColumns(previous => normalizeColumnSelection(typeof value === 'function' ? value(previous) : value, allowed, defaults));
  };
  useEffect(() => {
    if (!ready) return; // Never overwrite saved choices with SSR/first-render defaults.
    try { setStorageError(writeColumnSelection(window.localStorage, key, columns)); }
    catch { setStorageError('브라우저 설정 저장을 사용할 수 없습니다.'); }
  }, [key, columns, ready]);
  return { columns, setColumns: updateColumns, ready, storageError };
}
