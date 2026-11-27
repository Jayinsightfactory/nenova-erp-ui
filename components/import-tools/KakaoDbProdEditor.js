import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  KAKAO_DB_PRODUCT_ALIASES_STORAGE_KEY,
  mergeKakaoProductAliasMaps,
  normalizeKakaoProductAliasMap,
  removeKakaoProductAliasMap,
  resolveKakaoProductAlias,
  sanitizeKakaoProductAliasEntry,
  upsertKakaoProductAliasMap,
} from '../../lib/importKakaoDbProductAliases';

function readLocalAliases() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KAKAO_DB_PRODUCT_ALIASES_STORAGE_KEY);
    if (!raw) return {};
    return normalizeKakaoProductAliasMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeLocalAliases(aliasMap) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      KAKAO_DB_PRODUCT_ALIASES_STORAGE_KEY,
      JSON.stringify(normalizeKakaoProductAliasMap(aliasMap)),
    );
    return true;
  } catch {
    return false;
  }
}

export function useKakaoProductAliases({ serverAliases = null, onNotice } = {}) {
  const [aliases, setAliases] = useState(() => normalizeKakaoProductAliasMap(serverAliases));
  const [savingKey, setSavingKey] = useState('');
  const syncedServerRef = useRef(false);

  // Hydrate from localStorage on client mount & listen for cross-tab storage updates
  useEffect(() => {
    const localMap = readLocalAliases();
    if (Object.keys(localMap).length > 0) {
      setAliases((prev) => mergeKakaoProductAliasMaps(prev, localMap).merged);
    }
    function onStorage(event) {
      if (event.key !== KAKAO_DB_PRODUCT_ALIASES_STORAGE_KEY) return;
      const updatedLocal = readLocalAliases();
      setAliases((prev) => mergeKakaoProductAliasMaps(prev, updatedLocal).merged);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Reconcile serverAliases from /api/import/tools/kakao-additions and push any unsynced local backups once
  useEffect(() => {
    if (!serverAliases || typeof serverAliases !== 'object') return;
    const localMap = readLocalAliases();
    const { merged, changed: localHasUnsynced } = mergeKakaoProductAliasMaps(serverAliases, localMap);
    setAliases(merged);
    writeLocalAliases(merged);

    if (localHasUnsynced && !syncedServerRef.current) {
      syncedServerRef.current = true;
      fetch('/api/import/tools/kakao-product-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', aliases: localMap }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (body?.aliases) {
            const next = normalizeKakaoProductAliasMap(body.aliases);
            setAliases(next);
            writeLocalAliases(next);
          }
        })
        .catch(() => {});
    }
  }, [serverAliases]);

  const resolveAlias = useCallback(
    (item) => resolveKakaoProductAlias(aliases, item),
    [aliases],
  );

  const saveAlias = useCallback(
    async ({ rowKey = '', country = '', product = '', dbProdName = '', dbProdKey = null, isCustom = false }) => {
      let optimisticEntry;
      try {
        optimisticEntry = sanitizeKakaoProductAliasEntry({
          country,
          product,
          dbProdName,
          dbProdKey,
          isCustom: Boolean(isCustom || !dbProdKey),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        onNotice?.(err?.message || '품목 영문명을 확인하세요.');
        return false;
      }

      // 0ms immediate state + localStorage persistence
      setAliases((prev) => {
        const next = upsertKakaoProductAliasMap(prev, optimisticEntry);
        writeLocalAliases(next);
        return next;
      });
      setSavingKey(rowKey);

      try {
        const response = await fetch('/api/import/tools/kakao-product-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upsert',
            country: optimisticEntry.country,
            product: optimisticEntry.product,
            dbProdName: optimisticEntry.dbProdName,
            dbProdKey: optimisticEntry.dbProdKey,
            isCustom: optimisticEntry.isCustom,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || '서버 저장에 실패했습니다.');
        }
        if (body.aliases) {
          const synced = normalizeKakaoProductAliasMap(body.aliases);
          setAliases(synced);
          writeLocalAliases(synced);
        }
        onNotice?.(
          `[${optimisticEntry.product}] 영문 품목명을 "${optimisticEntry.dbProdName}"(으)로 저장했습니다. 이후 동일 품목 발주에도 자동 적용됩니다.`,
        );
        return true;
      } catch (err) {
        onNotice?.(
          `[${optimisticEntry.product}] 영문 품목명을 현재 브라우저에 우선 저장했습니다 (${err?.message || '서버 동기화 대기'}).`,
        );
        return true;
      } finally {
        setSavingKey('');
      }
    },
    [onNotice],
  );

  const resetAlias = useCallback(
    async ({ rowKey = '', country = '', product = '' }) => {
      setAliases((prev) => {
        const next = removeKakaoProductAliasMap(prev, { country, product });
        writeLocalAliases(next);
        return next;
      });
      setSavingKey(rowKey);

      try {
        const response = await fetch('/api/import/tools/kakao-product-aliases', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, product }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.aliases) {
          const synced = normalizeKakaoProductAliasMap(body.aliases);
          setAliases(synced);
          writeLocalAliases(synced);
        }
        onNotice?.(`[${product}] 수동 지정 영문명을 초기화했습니다.`);
        return true;
      } catch {
        onNotice?.(`[${product}] 수동 지정 영문명을 현재 화면에서 초기화했습니다.`);
        return true;
      } finally {
        setSavingKey('');
      }
    },
    [onNotice],
  );

  return {
    productAliases: aliases,
    savingKey,
    resolveAlias,
    saveAlias,
    resetAlias,
  };
}

const searchCache = new Map();

export function KakaoDbProdInlineEditor({
  item,
  cardCountry = '',
  hasManualAlias = false,
  saving = false,
  onSave,
  onReset,
  onCancel,
}) {
  const effectiveCountry = String(cardCountry || item?.country || '').trim();
  const [draft, setDraft] = useState(() => String(item?.dbProdName || '').trim());
  const [allCountries, setAllCountries] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const listboxId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  const searchKeyword = useMemo(() => {
    const trimmed = draft.trim();
    return trimmed || String(item?.product || '').trim();
  }, [draft, item?.product]);

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = `${allCountries ? '*' : effectiveCountry}::${searchKeyword.toLowerCase()}`;
    if (searchCache.has(cacheKey)) {
      setCandidates(searchCache.get(cacheKey));
      setSearching(false);
      setSearchError('');
      setActiveIndex(-1);
      return () => controller.abort();
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const params = new URLSearchParams({
          search: '1',
          q: searchKeyword,
          limit: '30',
        });
        if (effectiveCountry) params.set('country', effectiveCountry);
        if (allCountries) params.set('allCountries', '1');
        const response = await fetch(`/api/import/tools/kakao-product-aliases?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || 'DB 품목 목록을 불러오지 못했습니다.');
        }
        const list = Array.isArray(body.products) ? body.products : [];
        if (searchCache.size > 120) searchCache.clear();
        searchCache.set(cacheKey, list);
        if (!controller.signal.aborted) {
          setCandidates(list);
          setActiveIndex(-1);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setSearchError(err?.message || '검색 실패');
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 110);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchKeyword, effectiveCountry, allCountries]);

  function handlePickCandidate(cand) {
    if (!cand) return;
    onSave?.({
      rowKey: item.key,
      country: effectiveCountry,
      product: item.product,
      dbProdName: cand.englishName || cand.prodName,
      dbProdKey: cand.prodKey || null,
      isCustom: false,
    });
  }

  function handleDirectSave(e) {
    if (e) e.preventDefault();
    if (activeIndex >= 0 && activeIndex < candidates.length) {
      handlePickCandidate(candidates[activeIndex]);
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    const exactCand = candidates.find(
      (c) =>
        String(c.englishName || '').toLowerCase() === trimmed.toLowerCase() ||
        String(c.prodName || '').toLowerCase() === trimmed.toLowerCase(),
    );
    onSave?.({
      rowKey: item.key,
      country: effectiveCountry,
      product: item.product,
      dbProdName: exactCand ? (exactCand.englishName || exactCand.prodName) : trimmed,
      dbProdKey: exactCand?.prodKey || null,
      isCustom: !exactCand,
    });
  }

  return (
    <div className="kakao-db-editor" role="region" aria-label={`${item.product} DB 영문 품목명 지정`}>
      <div className="kakao-db-editor-top">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={candidates.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={`${item.product} DB 품목 검색 또는 영문명 직접 입력`}
          placeholder="DB 품목 검색(한글·영문) 또는 영문명 직접 입력"
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel?.();
              return;
            }
            if (e.key === 'ArrowDown' && candidates.length > 0) {
              e.preventDefault();
              setActiveIndex((prev) => (prev + 1) % candidates.length);
              return;
            }
            if (e.key === 'ArrowUp' && candidates.length > 0) {
              e.preventDefault();
              setActiveIndex((prev) => (prev <= 0 ? candidates.length - 1 : prev - 1));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              handleDirectSave();
            }
          }}
        />
        <button
          type="button"
          className="kakao-primary-btn kakao-db-save-btn"
          disabled={saving || (!draft.trim() && activeIndex < 0)}
          onClick={handleDirectSave}
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="kakao-db-cancel-edit-btn" disabled={saving} onClick={onCancel}>
          취소
        </button>
      </div>

      <div className="kakao-db-editor-bar">
        <span className="kakao-db-editor-hint">
          기준 품목: <b>{item.product}</b>
          {effectiveCountry ? ` (${effectiveCountry})` : ''}
        </span>
        <div className="kakao-db-editor-toggles">
          {draft.trim() && draft.trim() !== item.product && (
            <button
              type="button"
              className="kakao-db-mini-btn"
              onClick={() => {
                setDraft('');
                setActiveIndex(-1);
                inputRef.current?.focus();
              }}
            >
              원문 품목으로 재검색
            </button>
          )}
          {effectiveCountry && (
            <button
              type="button"
              className="kakao-db-mini-btn"
              aria-pressed={allCountries}
              onClick={() => setAllCountries((v) => !v)}
            >
              {allCountries ? '전체 국가 검색 중' : `${effectiveCountry} 우선 · 전체 국가 검색`}
            </button>
          )}
          {hasManualAlias && (
            <button
              type="button"
              className="kakao-db-reset-btn"
              disabled={saving}
              onClick={() => onReset?.({ rowKey: item.key, country: effectiveCountry, product: item.product })}
            >
              수동지정 초기화
            </button>
          )}
        </div>
      </div>

      {searchError && (
        <p className="kakao-db-editor-status is-error" role="alert">
          {searchError} · 위 입력창에 영문 품목명을 직접 입력해 저장할 수 있습니다.
        </p>
      )}

      <div id={listboxId} role="listbox" aria-label="DB 품목 검색 결과" className="kakao-db-cand-list">
        {searching && candidates.length === 0 && (
          <div className="kakao-db-editor-status">DB 품목 검색 중…</div>
        )}
        {!searching && candidates.length === 0 && !searchError && (
          <div className="kakao-db-editor-status">
            일치하는 DB 등록 품목이 없습니다. 위 입력창에 영문 품목명을 직접 입력하고 [저장]을 누르세요.
          </div>
        )}
        {candidates.map((cand, idx) => {
          const isSelected = idx === activeIndex;
          const koSub = [cand.flowerName, cand.displayName !== cand.prodName ? cand.displayName : '']
            .filter(Boolean)
            .join(' · ');
          return (
            <button
              key={`${cand.prodKey || cand.prodName}-${idx}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={'kakao-db-cand-item' + (isSelected ? ' is-active' : '')}
              onClick={() => handlePickCandidate(cand)}
            >
              <span className="kakao-db-cand-en">{cand.englishName}</span>
              <span className="kakao-db-cand-meta">
                {cand.country && (
                  <span className={'kakao-db-cand-country' + (cand.otherCountry ? ' is-other' : '')}>
                    {cand.country}
                  </span>
                )}
                {koSub && <span className="kakao-db-cand-ko">{koSub}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
