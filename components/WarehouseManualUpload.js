import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { ReceiptProductSearch } from './IncomingCorrectionRequest.js';
import { manualWarehouseLine, manualWarehouseMaxRows, manualWarehouseUnits } from '../lib/manualWarehouseUpload.js';
import {
  MANUAL_WAREHOUSE_FAVORITES_STORAGE_KEY,
  MAX_FARM_AUTOCOMPLETE_ITEMS,
  applyManualFavoriteToForm,
  buildManualFavoriteDraft,
  defaultManualFavoriteName,
  mergeManualFavoriteLists,
  normalizeFarmSearchKey,
  rankManualWarehouseFarms,
} from '../lib/manualWarehouseFavorites.js';
import styles from './WarehouseManualUpload.module.css';

const blankRow = id => ({ id, product: null, quantity: '', quantityUnit: '송이', stemsPerBox: '', stemsPerBunch: '', amountMode: 'total', amount: '' });
const number = value => value == null ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 10 });

function requestLine(row) {
  const { product, quantity, quantityUnit, stemsPerBox, stemsPerBunch, amountMode, amount } = row;
  return {
    prodKey: product?.ProdKey,
    prodName: product?.ProdName,
    expectedOutUnit: product?.OutUnit?.trim(),
    expectedEstUnit: product?.EstUnit?.trim(),
    quantity,
    quantityUnit,
    stemsPerBox,
    stemsPerBunch,
    amountMode,
    amount,
  };
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw Object.assign(new Error(body.error || '수기 입고 처리에 실패했습니다.'), {
      status: response.status,
      code: body.code,
      errors: body.errors,
    });
  }
  return body;
}

function readLocalFavorites() {
  try {
    const raw = localStorage.getItem(MANUAL_WAREHOUSE_FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(entries) {
  try {
    localStorage.setItem(MANUAL_WAREHOUSE_FAVORITES_STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

export function ManualWarehouseFarmAutocomplete({
  farms = [],
  recentManualFarms = [],
  favorites = [],
  value = '',
  disabled = false,
  onChange,
}) {
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [query, setQuery] = useState(value || '');
  const [composing, setComposing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isFiltering) setQuery(value || '');
  }, [value, isFiltering]);

  const ranked = useMemo(() => rankManualWarehouseFarms({
    farms,
    recentManualFarms,
    favorites,
    query: isFiltering ? query : '',
    limit: MAX_FARM_AUTOCOMPLETE_ITEMS,
  }), [farms, recentManualFarms, favorites, isFiltering, query]);

  const items = ranked.items;

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId]);

  const chooseFarm = farmName => {
    onChange(farmName);
    setQuery(farmName);
    setIsFiltering(false);
    setOpen(false);
    setActiveIndex(0);
  };

  const clearSelection = () => {
    onChange('');
    setQuery('');
    setIsFiltering(false);
    setOpen(true);
    setActiveIndex(0);
  };

  const openDropdown = () => {
    if (disabled) return;
    setOpen(true);
    const currentIdx = value ? items.findIndex(item => item.farmName === value) : 0;
    setActiveIndex(currentIdx >= 0 ? currentIdx : 0);
  };

  const handleBlur = () => {
    if (isFiltering) {
      const trimmed = query.trim();
      if (!trimmed) {
        onChange('');
        setQuery('');
      } else {
        const key = normalizeFarmSearchKey(trimmed);
        const exact = farms.find(f => normalizeFarmSearchKey(f.FarmName) === key);
        if (exact) {
          onChange(exact.FarmName);
          setQuery(exact.FarmName);
        } else {
          setQuery(value || '');
        }
      }
    } else {
      setQuery(value || '');
    }
    setIsFiltering(false);
    setOpen(false);
  };

  return (
    <div className={styles.farmField}>
      <label className={styles.farmFieldLabel} htmlFor={inputId}>농장명</label>
      <div className={styles.farmCombobox}>
        <div className={styles.farmInputWrap}>
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-label="농장명"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            placeholder="농장명 클릭 또는 입력 시 연관 농장이 아래에 표시됩니다"
            value={isFiltering ? query : (value || query)}
            disabled={disabled}
            autoComplete="off"
            className={styles.farmInput}
            onFocus={openDropdown}
            onClick={openDropdown}
            onBlur={handleBlur}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={event => {
              setComposing(false);
              const nextVal = event.currentTarget.value;
              setQuery(nextVal);
              setIsFiltering(true);
              setOpen(true);
              setActiveIndex(0);
              if (!nextVal.trim()) onChange('');
            }}
            onChange={event => {
              const nextVal = event.target.value;
              setQuery(nextVal);
              setIsFiltering(true);
              setOpen(true);
              setActiveIndex(0);
              if (!nextVal.trim()) onChange('');
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229 || composing) return;
              if (event.key === 'Escape' && open) {
                event.preventDefault();
                event.stopPropagation();
                setIsFiltering(false);
                setQuery(value || '');
                setOpen(false);
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!open) {
                  openDropdown();
                  return;
                }
                if (items.length) setActiveIndex(current => (current + 1) % items.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) {
                  openDropdown();
                  return;
                }
                if (items.length) setActiveIndex(current => (current - 1 + items.length) % items.length);
                return;
              }
              if (event.key === 'Enter' && open && items[activeIndex]) {
                event.preventDefault();
                chooseFarm(items[activeIndex].farmName);
              }
            }}
          />
          {(value || query) && !disabled && (
            <button
              type="button"
              className={styles.farmClearBtn}
              aria-label="선택 농장 지우기"
              onMouseDown={event => event.preventDefault()}
              onClick={clearSelection}
            >
              지우기
            </button>
          )}
        </div>
        {open && (
          <div id={listId} role="listbox" aria-label="농장명 연관 목록" className={styles.farmDropdown}>
            <div className={styles.farmDropdownMeta}>
              {isFiltering
                ? (ranked.totalMatches > 0
                  ? `연관 농장 ${ranked.totalMatches}개${ranked.totalMatches > items.length ? ` (상위 ${items.length}개 표시)` : ''}`
                  : '일치하는 등록 농장이 없습니다.')
                : `자주 쓰는 수기입고·즐겨찾기 농장 상단 우선 · 전체 ${ranked.totalFarms}개 농장`}
            </div>
            {items.map((item, idx) => {
              const isSelected = item.farmName === value;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.farmName}
                  id={`${listId}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected || isActive}
                  className={`${styles.farmOption} ${isActive ? styles.farmOptionActive : ''}`}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => chooseFarm(item.farmName)}
                >
                  <span className={styles.farmOptionMain}>
                    <strong>{item.farmName}</strong>
                    {item.countryName && <span className={styles.farmCountry}>{item.countryName}</span>}
                  </span>
                  <span className={styles.farmBadges}>
                    {item.favoriteCount > 0 && <span className={styles.farmBadgeFav}>즐겨찾기</span>}
                    {item.manualUseCount > 0 && <span className={styles.farmBadgeRecent}>수기 {item.manualUseCount}회</span>}
                    {isSelected && <span className={styles.farmBadgeSelected}>선택됨</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <small role="status" aria-live="polite" className={styles.farmStatus}>
        {value ? `선택 농장: ${value}` : `등록 농장 ${ranked.totalFarms}개 중 클릭하거나 입력해 선택하세요.`}
      </small>
    </div>
  );
}

export default function WarehouseManualUpload({ initial, onClose, onSaved }) {
  const [header, setHeader] = useState({
    orderYear: initial.orderYear,
    orderWeek: initial.orderWeek,
    inputDate: initial.inputDate,
    farmName: '',
    invoiceNo: '',
    awb: '',
  });
  const [rows, setRows] = useState([blankRow(1)]);
  const [catalog, setCatalog] = useState({ farms: [], products: [], periods: [], recentManualFarms: [] });
  const [favorites, setFavorites] = useState([]);
  const [favoriteRevision, setFavoriteRevision] = useState(0);
  const [favoriteName, setFavoriteName] = useState('');
  const [activeFavoriteId, setActiveFavoriteId] = useState('');
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [manualWeek, setManualWeek] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [recovery, setRecovery] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const nextId = useRef(2);
  const busy = useRef(false);
  const weekSelectRef = useRef(null);
  const firstQtyRef = useRef(null);
  const isBusy = Boolean(status);

  useEffect(() => {
    const localInitial = readLocalFavorites();
    if (localInitial.length) setFavorites(localInitial);

    const ctrl = new AbortController();
    const options = { signal: ctrl.signal };
    Promise.all([
      readJson('/api/warehouse?manualOptions=1', options),
      readJson('/api/products/search', options),
      readJson('/api/warehouse/manual-favorites', options).catch(() => null),
    ])
      .then(([farmResult, productResult, favoriteResult]) => {
        if (ctrl.signal.aborted) return;
        setCatalog({
          farms: farmResult.farms ?? [],
          products: productResult.products ?? [],
          periods: farmResult.periods ?? [],
          recentManualFarms: farmResult.recentManualFarms ?? [],
        });
        if (favoriteResult) {
          const serverList = favoriteResult.favorites ?? [];
          const merged = mergeManualFavoriteLists(serverList, localInitial);
          setFavorites(merged);
          setFavoriteRevision(favoriteResult.revision ?? 0);
          writeLocalFavorites(merged);
          if (merged.length > serverList.length) {
            readJson('/api/warehouse/manual-favorites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'syncLocal',
                entries: merged,
                expectedRevision: favoriteResult.revision ?? 0,
              }),
            })
              .then(synced => {
                if (!ctrl.signal.aborted && synced?.favorites) {
                  setFavorites(synced.favorites);
                  setFavoriteRevision(synced.revision ?? 0);
                  writeLocalFavorites(synced.favorites);
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(issue => { if (!ctrl.signal.aborted) setError(issue.message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!recovery) return;
    const blockExit = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', blockExit);
    return () => window.removeEventListener('beforeunload', blockExit);
  }, [recovery]);

  const selectedFarmObj = useMemo(
    () => catalog.farms.find(f => String(f.FarmName).trim() === header.farmName) ?? null,
    [catalog.farms, header.farmName],
  );

  const suggestedFavoriteName = useMemo(() => {
    if (!header.farmName) return '';
    const validItems = rows
      .filter(r => r.product?.ProdName)
      .map(r => ({ prodName: r.product.ProdName, quantityUnit: r.quantityUnit }));
    return defaultManualFavoriteName(header.farmName, validItems);
  }, [header.farmName, rows]);

  function clearPreview() { setPreview(null); setConfirmed(false); setError(''); }
  function changeHeader(field, value) { clearPreview(); setHeader(current => ({ ...current, [field]: value })); }
  function changeYear(orderYear) {
    clearPreview();
    setManualWeek(false);
    setHeader(current => ({ ...current, orderYear, orderWeek: '' }));
  }
  function changeRow(id, values) { clearPreview(); setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row)); }
  function close() { if (!busy.current && !recovery) onClose(); }

  function handleApplyFavorite(fav) {
    try {
      clearPreview();
      const applied = applyManualFavoriteToForm(fav, catalog.products, () => nextId.current++);
      setHeader(current => ({
        ...current,
        farmName: applied.farmName,
        invoiceNo: '',
        awb: '',
      }));
      setRows(applied.rows);
      setActiveFavoriteId(fav.id);
      setFavoriteName(fav.name);
      if (applied.missingProducts.length) {
        setError(`일부 품목(${applied.missingProducts.join(', ')})이 현재 마스터에서 확인되지 않습니다. 해당 행의 품목을 다시 선택하세요.`);
        setFavoriteNotice('');
      } else {
        setFavoriteNotice(`즐겨찾기 "${fav.name}" (${applied.rows.length}품목) 적용 완료 — 세부차수와 각 행의 수량·금액 숫자만 입력하세요.`);
      }
      requestAnimationFrame(() => {
        if (!header.orderWeek) weekSelectRef.current?.focus();
        else firstQtyRef.current?.focus();
      });
    } catch (issue) {
      setError(issue.message);
    }
  }

  async function handleSaveFavorite(overwriteExisting = false) {
    if (favoriteSaving || isBusy || recovery) return;
    setError('');
    setFavoriteNotice('');
    let draft;
    try {
      const targetId = overwriteExisting && activeFavoriteId ? activeFavoriteId : undefined;
      draft = buildManualFavoriteDraft({
        id: targetId,
        name: favoriteName.trim() || suggestedFavoriteName,
        farmName: header.farmName,
        farm: selectedFarmObj,
        rows,
      });
    } catch (validationIssue) {
      setError(validationIssue.message);
      return;
    }

    setFavoriteSaving(true);
    try {
      const result = await readJson('/api/warehouse/manual-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          id: draft.id,
          name: draft.name,
          farmName: draft.farmName,
          farm: selectedFarmObj,
          rows: rows.map(requestLine),
          expectedRevision: favoriteRevision,
        }),
      });
      const nextList = result.favorites ?? [];
      setFavorites(nextList);
      setFavoriteRevision(result.revision ?? favoriteRevision);
      setActiveFavoriteId(result.favorite?.id ?? draft.id);
      setFavoriteName(result.favorite?.name ?? draft.name);
      writeLocalFavorites(nextList);
      setFavoriteNotice(`즐겨찾기 등록 완료: ${result.favorite?.name ?? draft.name} (${draft.items.length}품목 조건 저장)`);
    } catch (saveIssue) {
      if (saveIssue.status === 403 || saveIssue.status === 400) {
        setError(saveIssue.message);
      } else {
        const fallbackList = mergeManualFavoriteLists([draft], favorites);
        setFavorites(fallbackList);
        setActiveFavoriteId(draft.id);
        setFavoriteName(draft.name);
        writeLocalFavorites(fallbackList);
        setFavoriteNotice(`서버 일시 지연으로 이 브라우저에 즐겨찾기를 우선 저장했습니다: ${draft.name}`);
      }
    } finally {
      setFavoriteSaving(false);
    }
  }

  async function handleDeleteFavorite(fav) {
    if (favoriteSaving || isBusy || recovery) return;
    setError('');
    setFavoriteSaving(true);
    try {
      const result = await readJson('/api/warehouse/manual-favorites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fav.id, expectedRevision: favoriteRevision }),
      });
      const nextList = result.favorites ?? favorites.filter(item => item.id !== fav.id);
      setFavorites(nextList);
      setFavoriteRevision(result.revision ?? favoriteRevision);
      writeLocalFavorites(nextList);
      if (activeFavoriteId === fav.id) {
        setActiveFavoriteId('');
        setFavoriteName('');
      }
      setFavoriteNotice(`즐겨찾기 "${fav.name}" 항목을 삭제했습니다.`);
    } catch (delIssue) {
      setError(delIssue.message);
    } finally {
      setFavoriteSaving(false);
    }
  }

  async function process(performWrite) {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setStatus(performWrite ? '원장 등록 및 재고 재계산 중' : '농장·품목·차수 검증 중');
    const payload = performWrite ? preview.payload
      : { ...header, source: 'manual', operationId: crypto.randomUUID(), items: rows.map(requestLine) };
    try {
      const result = await readJson('/api/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, previewOnly: !performWrite, ...(performWrite ? { previewToken: preview.previewToken } : {}) }),
      });
      if (result.warehouseKey) onSaved(result);
      else if (performWrite) throw new Error('서버 원장번호를 확인하지 못했습니다.');
      else {
        setConfirmed(false);
        setPreview({ payload, previewToken: result.previewToken, lines: result.manualPreview });
      }
    } catch (issue) {
      const unknown = performWrite && (issue.code === 'STOCK_GATE_BUSY' && recovery || ![400, 403, 409].includes(issue.status));
      if (unknown) setRecovery(true);
      else if (performWrite) { setRecovery(false); setPreview(null); setConfirmed(false); }
      setError(unknown ? '등록 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.'
        : [issue.message, ...(issue.errors ?? []).map(row => `${row.row}행 ${row.error}`)].join(' · '));
    } finally {
      busy.current = false;
      setStatus('');
    }
  }

  const activeFavoriteExists = Boolean(activeFavoriteId && favorites.some(item => item.id === activeFavoriteId));

  return (
    <Modal
      open
      title="수기 입고 업로드"
      width={1060}
      footer={null}
      onCancel={close}
      closable={!isBusy && !recovery}
      keyboard={!isBusy && !recovery}
      mask={{ closable: false }}
      focusTriggerAfterClose
    >
      <div className={styles.dialog}>
        {loading && <p role="status">농장과 품목을 불러오는 중입니다.</p>}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
        {status && <p role="status">{status}</p>}

        <section aria-label="수기 입고 즐겨찾기" className={styles.favoriteBox}>
          <div className={styles.favoriteTop}>
            <div>
              <div className={styles.favoriteTitle}>자주 쓰는 농장·품목 즐겨찾기</div>
              <div className={styles.favoriteHint}>농장·품명·단위와 추가한 품목행 조건을 저장해 두고, 불러온 뒤에는 차수와 숫자만 입력합니다.</div>
            </div>
            <div className={styles.favoriteControls}>
              <input
                type="text"
                aria-label="즐겨찾기 이름"
                className={styles.favoriteNameInput}
                placeholder={suggestedFavoriteName || '즐겨찾기 이름 (비워두면 자동 생성)'}
                value={favoriteName}
                maxLength={80}
                disabled={loading || isBusy || recovery || favoriteSaving}
                onChange={event => setFavoriteName(event.target.value)}
              />
              <Button
                size="small"
                type="primary"
                ghost
                loading={favoriteSaving}
                disabled={loading || !header.farmName || isBusy || recovery}
                onClick={() => handleSaveFavorite(false)}
              >
                즐겨찾기 등록
              </Button>
              {activeFavoriteExists && (
                <Button
                  size="small"
                  loading={favoriteSaving}
                  disabled={loading || !header.farmName || isBusy || recovery}
                  onClick={() => handleSaveFavorite(true)}
                >
                  선택 즐겨찾기 수정
                </Button>
              )}
            </div>
          </div>

          {favorites.length > 0 ? (
            <div className={styles.favoriteList} role="list" aria-label="저장된 수기 입고 즐겨찾기 목록">
              {favorites.map(fav => {
                const isCurrent = fav.id === activeFavoriteId;
                return (
                  <div
                    key={fav.id}
                    role="listitem"
                    className={`${styles.favoriteChip} ${isCurrent ? styles.favoriteChipActive : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.favoriteLoadBtn}
                      disabled={loading || isBusy || recovery}
                      onClick={() => handleApplyFavorite(fav)}
                      title={`${fav.farmName} · ${fav.items.map(i => `${i.prodName}(${i.quantityUnit})`).join(', ')}`}
                    >
                      <span>{fav.name}</span>
                      <span className={styles.favoriteCount}>{fav.items.length}품목</span>
                    </button>
                    <button
                      type="button"
                      className={styles.favoriteDeleteBtn}
                      aria-label={`${fav.name} 즐겨찾기 삭제`}
                      disabled={loading || isBusy || recovery || favoriteSaving}
                      onClick={() => handleDeleteFavorite(fav)}
                    >
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.favoriteEmpty}>
              저장된 즐겨찾기가 없습니다. 아래에서 농장·품목·단위(다중 품목행 포함)를 선택한 뒤 [즐겨찾기 등록]을 눌러 두세요.
            </p>
          )}
          {favoriteNotice && <p role="status" className={styles.favoriteNotice}>{favoriteNotice}</p>}
        </section>

        <fieldset disabled={loading || isBusy || recovery} className={styles.fields}>
          <legend>입고 정보</legend>
          <ManualWarehouseFarmAutocomplete
            farms={catalog.farms}
            recentManualFarms={catalog.recentManualFarms}
            favorites={favorites}
            value={header.farmName}
            disabled={loading || isBusy || recovery}
            onChange={value => changeHeader('farmName', value)}
          />
          <div className={styles.header}>
            <label>연도
              <select aria-label="입고 연도" value={header.orderYear} onChange={event => changeYear(event.target.value)}>
                {[...new Set([initial.orderYear, ...catalog.periods.map(period => String(period.OrderYear).trim())])].sort().reverse().map(year => <option key={year}>{year}</option>)}
              </select>
            </label>
            <label>세부차수
              <select
                ref={weekSelectRef}
                aria-label="입고 세부차수"
                value={manualWeek ? 'manual' : header.orderWeek}
                onChange={event => {
                  const week = event.target.value;
                  setManualWeek(week === 'manual');
                  changeHeader('orderWeek', week === 'manual' ? '' : week);
                }}
              >
                <option value="">세부차수 선택</option>
                {catalog.periods.filter(period => String(period.OrderYear).trim() === header.orderYear).map(period => {
                  const week = String(period.OrderWeek).trim();
                  return <option key={week}>{week}</option>;
                })}
                <option value="manual">직접 입력</option>
              </select>
            </label>
            {manualWeek && (
              <label>세부차수 직접 입력
                <input placeholder="47-02" value={header.orderWeek} onChange={event => changeHeader('orderWeek', event.target.value)} maxLength={5} />
              </label>
            )}
            <label>실제 입고일
              <input type="date" value={header.inputDate} onChange={event => changeHeader('inputDate', event.target.value)} />
            </label>
            <label>인보이스 번호
              <input value={header.invoiceNo} onChange={event => changeHeader('invoiceNo', event.target.value)} maxLength={50} />
            </label>
            <label>AWB
              <input value={header.awb} onChange={event => changeHeader('awb', event.target.value)} maxLength={50} />
            </label>
          </div>
        </fieldset>

        <fieldset disabled={loading || !header.farmName || isBusy || recovery} className={styles.fields}>
          <legend>입고 품목 ({rows.length}행)</legend>
          <p>원본 인보이스 통화로 금액을 입력하세요. 출고·견적 단위가 다르면 포장당 송이 수도 입력하세요.</p>
          {rows.map((row, index) => {
            let line;
            try { if (row.product) line = manualWarehouseLine(requestLine(row), row.product); } catch {}
            return (
              <fieldset className={styles.line} key={row.id}>
                <legend>{index + 1}행</legend>
                <ReceiptProductSearch
                  index={index}
                  productName={row.product?.ProdName ?? ''}
                  products={catalog.products}
                  onSelect={(_, product) => changeRow(row.id, { product })}
                />
                {row.product && (
                  <div className={styles.selectedProduct}>
                    <strong>{row.product.ProdName}</strong>
                    <span className={styles.unit}>전산 출고 {row.product.OutUnit} · 견적 {row.product.EstUnit}</span>
                  </div>
                )}
                <div className={styles.header}>
                  <label>입고 수량
                    <input
                      ref={index === 0 ? firstQtyRef : undefined}
                      inputMode="decimal"
                      aria-label={`${index + 1}행 입고 수량`}
                      placeholder="숫자 입력"
                      value={row.quantity}
                      onChange={event => changeRow(row.id, { quantity: event.target.value })}
                    />
                  </label>
                  <label>수량 단위
                    <select value={row.quantityUnit} onChange={event => changeRow(row.id, { quantityUnit: event.target.value })}>
                      {manualWarehouseUnits.map(unit => <option key={unit}>{unit}</option>)}
                    </select>
                  </label>
                  <label>송이/단
                    <input
                      inputMode="numeric"
                      aria-label={`${index + 1}행 송이/단`}
                      value={row.stemsPerBunch}
                      onChange={event => changeRow(row.id, { stemsPerBunch: event.target.value })}
                    />
                  </label>
                  <label>송이/박스
                    <input
                      inputMode="numeric"
                      aria-label={`${index + 1}행 송이/박스`}
                      value={row.stemsPerBox}
                      onChange={event => changeRow(row.id, { stemsPerBox: event.target.value })}
                    />
                  </label>
                  <label>금액 기준
                    <select value={row.amountMode} onChange={event => changeRow(row.id, { amountMode: event.target.value })}>
                      <option value="total">행 금액</option>
                      <option value="perStem">송이당 단가</option>
                    </select>
                  </label>
                  <label>{row.amountMode === 'total' ? '행 금액' : '송이당 단가'}
                    <input
                      inputMode="decimal"
                      aria-label={`${index + 1}행 금액`}
                      placeholder="숫자 입력"
                      value={row.amount}
                      onChange={event => changeRow(row.id, { amount: event.target.value })}
                    />
                  </label>
                </div>
                <div className={styles.actions}>
                  {line && (
                    <span>
                      {number(line.boxQty)}박스 · {number(line.bunchQty)}단 · {number(line.steamQty)}송이 · 송이당 {number(line.unitPrice)} · 합계 {number(line.totalPrice)}
                    </span>
                  )}
                  <Button
                    size="small"
                    disabled={rows.length === 1}
                    onClick={() => { clearPreview(); setRows(current => current.filter(item => item.id !== row.id)); }}
                  >
                    행 삭제
                  </Button>
                </div>
              </fieldset>
            );
          })}
          <div className={styles.rowToolbar}>
            <Button
              size="small"
              disabled={rows.length >= manualWarehouseMaxRows}
              onClick={() => { clearPreview(); setRows(current => [...current, blankRow(nextId.current++)]); }}
            >
              품목 행 추가
            </Button>
            <Button
              size="small"
              loading={favoriteSaving}
              disabled={loading || !header.farmName || isBusy || recovery}
              onClick={() => handleSaveFavorite(false)}
            >
              현재 품목행 조건 즐겨찾기 등록
            </Button>
          </div>
        </fieldset>

        {preview && (
          <section aria-label="수기 입고 검증 결과">
            <p role="status">서버 검증 통과 · {preview.payload.orderYear}년 {preview.payload.orderWeek} · {preview.lines.length}개 품목</p>
            <div className={styles.table} tabIndex={0} role="region" aria-label="등록 수량과 금액 미리보기">
              <table>
                <thead>
                  <tr>
                    {['품목', '박스', '단', '송이', '출고 수량', '견적 수량', '송이당 단가', '행 금액'].map(field => <th key={field} scope="col">{field}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, index) => (
                    <tr key={preview.payload.items[index].prodKey + '-' + index}>
                      <th scope="row">{line.prodName}</th>
                      <td>{number(line.boxQty)}</td>
                      <td>{number(line.bunchQty)}</td>
                      <td>{number(line.steamQty)}</td>
                      <td>{number(line.outQuantity)}{line.outUnit}</td>
                      <td>{number(line.estQuantity)}{line.estUnit}</td>
                      <td>{number(line.unitPrice)}</td>
                      <td>{number(line.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className={styles.actions}>
          {preview && !recovery && (
            <label>
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={isBusy} /> 차수·농장·품목과 금액을 확인했고 입고를 등록합니다.
            </label>
          )}
          <Button disabled={isBusy || recovery} onClick={close}>닫기</Button>
          <Button disabled={loading || !header.farmName || isBusy || recovery} onClick={() => process(false)}>등록 미리보기</Button>
          <Button type="primary" disabled={!preview || !confirmed || isBusy} onClick={() => process(true)}>
            {recovery ? '같은 등록 결과 다시 확인' : '입고 등록'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
