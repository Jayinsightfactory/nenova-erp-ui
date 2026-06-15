import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import CatalogImagePicker from '../../components/catalog/CatalogImagePicker';
import { exportCatalogPpt } from '../../lib/catalogPptExport';
import { apiGet } from '../../lib/useApi';
import { useWeekInput, useYearInput, YearInput, WeekSpinInput } from '../../lib/useWeekInput';
import {
  absCatalogUrl,
  displayProductName,
  effectiveArrival,
  filterProducts,
  fmtNum,
  fmtPct,
  groupProductsByFlower,
  marginPct,
  newCatalogLine,
  pickPrimaryImageRecord,
} from '../../lib/catalogUtils';

const STORAGE_KEY = 'nenovaCatalogDraft';

function findProd(prods, prodKey) {
  return prods.find(p => String(p.ProdKey) === String(prodKey));
}

function lineImageFields(byProdKey, prodKey) {
  const img = pickPrimaryImageRecord(byProdKey, prodKey);
  return img
    ? { imageId: img.id, imageUrl: absCatalogUrl(img.url) }
    : { imageId: null, imageUrl: null };
}

export default function CatalogPage() {
  const yearInput = useYearInput(String(new Date().getFullYear()));
  const selectedWeekInput = useWeekInput('');

  const [costMode, setCostMode] = useState('recent');
  const [latestWeek, setLatestWeek] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [arrivalStats, setArrivalStats] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageInfo, setImageInfo] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [imagesByProd, setImagesByProd] = useState({});

  const [custKey, setCustKey] = useState('');
  const [catalogTitle, setCatalogTitle] = useState('NENOVA 카탈로그');
  const [useVatArrival, setUseVatArrival] = useState(true);
  const [perPage, setPerPage] = useState(8);

  const [selectedFlower, setSelectedFlower] = useState('__all__');
  const [flowerSearch, setFlowerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState([]);
  const [checkedKeys, setCheckedKeys] = useState(new Set());

  const [picker, setPicker] = useState(null);

  const custName = useMemo(
    () => customers.find(c => String(c.CustKey) === String(custKey))?.CustName || '',
    [customers, custKey],
  );

  const flowerGroups = useMemo(() => groupProductsByFlower(products), [products]);

  const filteredFlowerGroups = useMemo(() => {
    const q = flowerSearch.trim().toLowerCase();
    if (!q) return flowerGroups;
    return flowerGroups.filter(({ flower }) => flower.toLowerCase().includes(q));
  }, [flowerGroups, flowerSearch]);

  const visibleProducts = useMemo(
    () => filterProducts(products, { flower: selectedFlower, search }),
    [products, selectedFlower, search],
  );

  const syncLinesFromProducts = useCallback((prods, imgMap) => {
    setLines(prev => prev.map(line => {
      const prod = findProd(prods, line.prodKey);
      if (!prod) return line;
      const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
      const img = pickPrimaryImageRecord(imgMap, line.prodKey);
      return {
        ...line,
        arrivalCost: arrival,
        arrivalUnit: prod.arrivalUnit || line.arrivalUnit,
        salePrice: line.salePrice > 0 ? line.salePrice : (prod.customerCost ?? prod.Cost ?? 0),
        imageId: line.imageId || img?.id || null,
        imageUrl: line.imageUrl || absCatalogUrl(img?.url) || null,
      };
    }));
  }, [useVatArrival]);

  const loadData = useCallback(async () => {
    if (costMode === 'selected' && !selectedWeekInput.value) {
      setErr('선택 차수를 지정하거나 [최근원가] 모드를 사용하세요.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const data = await apiGet('/api/catalog/bootstrap', {
        orderYear: yearInput.value,
        costMode,
        weekStart: costMode === 'selected' ? selectedWeekInput.value : undefined,
        custKey: custKey || undefined,
      });
      const prods = data.products || [];
      setProducts(prods);
      setCustomers(data.customers || []);
      setArrivalStats(data.arrivalStats || null);
      setUploadMeta(data.uploadMeta || null);
      setLatestWeek(data.arrivalStats?.latestWeek || data.costMeta?.latestWeek || null);
      if (data.arrivalStats?.error && !(data.arrivalStats?.fromUpload > 0)) {
        setErr(`도착원가: ${data.arrivalStats.error}`);
      } else       if (data.arrivalStats?.withArrival === 0 && !(data.arrivalStats?.fromUpload > 0)) {
        const anchor = data.arrivalStats?.anchorWeek || latestWeek || '—';
        setErr(`도착원가 데이터가 없습니다. (기준 차수: ${anchor}) — 엑셀 업로드 가능`);
      }
      if (data.imageAutoImport?.ran && data.imageAutoImport.message) {
        setErr(data.imageAutoImport.message);
      } else if (data.imageAutoImport?.error) {
        setErr(`통합본 자동등록: ${data.imageAutoImport.error}`);
      }
      let imgMap = {};
      try {
        const imgData = await apiGet('/api/catalog/images');
        imgMap = imgData.byProdKey || {};
        setImagesByProd(imgMap);
        const regCount = Object.keys(imgMap).filter(k => imgMap[k]?.length).length;
        setImageInfo({ registered: regCount, total: imgData.images?.length || 0 });
      } catch (e) {
        console.warn('[catalog] images:', e.message);
        setImageInfo({ error: e.message });
      }
      setLines(prev => {
        if (!prev.length) return prev;
        return prev.map(line => {
          const prod = findProd(prods, line.prodKey);
          if (!prod) return line;
          const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
          const img = pickPrimaryImageRecord(imgMap, line.prodKey);
          return {
            ...line,
            arrivalCost: arrival,
            arrivalUnit: prod.arrivalUnit || line.arrivalUnit,
            salePrice: line.salePrice > 0 ? line.salePrice : (prod.customerCost ?? prod.Cost ?? 0),
            imageId: line.imageId || img?.id || null,
            imageUrl: line.imageUrl || absCatalogUrl(img?.url) || null,
          };
        });
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [yearInput.value, costMode, selectedWeekInput.value, custKey, useVatArrival, latestWeek]);

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.lines?.length) setLines(saved.lines);
      if (saved.catalogTitle) setCatalogTitle(saved.catalogTitle);
      if (saved.custKey) setCustKey(saved.custKey);
      if (saved.perPage) setPerPage(saved.perPage);
      if (saved.useVatArrival != null) setUseVatArrival(saved.useVatArrival);
      if (saved.costMode) setCostMode(saved.costMode);
      if (saved.selectedWeek) selectedWeekInput.setValue(saved.selectedWeek);
    } catch (_) { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const displayWeek = costMode === 'selected'
      ? selectedWeekInput.value
      : latestWeek;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      lines: lines.map(l => ({
        ...l,
        imageUrl: absCatalogUrl(l.imageUrl),
      })),
      catalogTitle, custKey, perPage, useVatArrival, costMode,
      selectedWeek: selectedWeekInput.value,
      custName, orderYear: yearInput.value,
      weekStart: displayWeek || null,
      weekEnd: null,
    }));
  }, [lines, catalogTitle, custKey, perPage, useVatArrival, costMode, selectedWeekInput.value, latestWeek, custName, yearInput.value]);

  useEffect(() => {
    if (!products.length || !lines.length) return;
    setLines(prev => prev.map(line => {
      const prod = findProd(products, line.prodKey);
      if (!prod) return line;
      return { ...line, arrivalCost: effectiveArrival(prod.arrivalCost, useVatArrival) };
    }));
  }, [useVatArrival]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (products.length && Object.keys(imagesByProd).length) {
      syncLinesFromProducts(products, imagesByProd);
    }
  }, [imagesByProd]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPicker = (prod, lineId) => {
    const line = lineId ? lines.find(l => l.id === lineId) : null;
    setPicker({
      prodKey: prod.ProdKey,
      prodLabel: displayProductName(prod),
      lineId: lineId || null,
      selectedImageId: line?.imageId || pickPrimaryImageRecord(imagesByProd, prod.ProdKey)?.id || null,
    });
  };

  const applyImageToLines = (prodKey, img) => {
    const fields = img
      ? { imageId: img.id, imageUrl: absCatalogUrl(img.url) }
      : { imageId: null, imageUrl: null };
    setLines(prev => prev.map(l => (l.prodKey === prodKey ? { ...l, ...fields } : l)));
  };

  const handlePickerSelect = (img) => {
    if (!picker) return;
    applyImageToLines(picker.prodKey, img);
    setPicker(p => (p ? { ...p, selectedImageId: img?.id || null } : p));
  };

  const handleImagesChange = (prodKey, images) => {
    setImagesByProd(prev => ({ ...prev, [String(prodKey)]: images }));
  };

  const addProductLine = (prod) => {
    const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
    const sale = prod.customerCost ?? prod.Cost ?? 0;
    const imgFields = lineImageFields(imagesByProd, prod.ProdKey);
    return newCatalogLine(prod, {
      arrivalCost: arrival,
      arrivalUnit: prod.arrivalUnit,
      salePrice: sale,
      catalogName: displayProductName(prod),
      ...imgFields,
    });
  };

  const toggleProduct = (prod) => {
    const key = prod.ProdKey;
    if (checkedKeys.has(key)) {
      setCheckedKeys(prev => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      setLines(prev => prev.filter(l => l.prodKey !== key));
      return;
    }
    setCheckedKeys(prev => new Set(prev).add(key));
    setLines(prev => [...prev, addProductLine(prod)]);
  };

  const updateLine = (id, patch) => {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id) => {
    const line = lines.find(l => l.id === id);
    setLines(prev => prev.filter(l => l.id !== id));
    if (line) {
      setCheckedKeys(prev => {
        const n = new Set(prev);
        n.delete(line.prodKey);
        return n;
      });
    }
  };

  const addVisibleFlower = () => {
    const toAdd = visibleProducts.filter(p => !checkedKeys.has(p.ProdKey));
    if (!toAdd.length) return;
    const nextKeys = new Set(checkedKeys);
    const newLines = toAdd.map(prod => {
      nextKeys.add(prod.ProdKey);
      return addProductLine(prod);
    });
    setCheckedKeys(nextKeys);
    setLines(prev => [...prev, ...newLines]);
  };

  const openPrint = () => {
    if (!lines.length) { alert('카탈로그에 담긴 품목이 없습니다.'); return; }
    window.open('/catalog/print', 'catalogPrint', 'width=1100,height=820,scrollbars=yes');
  };

  const openPreview = () => {
    if (!lines.length) { alert('카탈로그에 담긴 품목이 없습니다.'); return; }
    window.open('/catalog/preview', 'catalogPreview', 'width=1100,height=900,scrollbars=yes');
  };

  const handleArrivalFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('orderYear', yearInput.value);
      const res = await fetch('/api/catalog/arrival-upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '업로드 실패');
      }
      setUploadMeta({
        fileName: data.fileName,
        updatedAt: data.updatedAt,
        count: data.matchedCount,
        matchedCount: data.matchedCount,
      });
      await loadData();
      if (data.unmatchedCount > 0) {
        setErr(`엑셀 ${data.matchedCount}건 적용 · 미매칭 ${data.unmatchedCount}행 (ProdKey/품목명 확인)`);
      }
    } catch (ex) {
      setErr(`엑셀 업로드: ${ex.message}`);
    } finally {
      setUploadBusy(false);
    }
  };

  const clearArrivalUpload = async () => {
    if (!uploadMeta?.count) return;
    if (!confirm('업로드한 도착원가를 초기화하고 시스템 원가로 되돌릴까요?')) return;
    setUploadBusy(true);
    try {
      const res = await fetch('/api/catalog/arrival-upload', { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '초기화 실패');
      setUploadMeta(null);
      await loadData();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setUploadBusy(false);
    }
  };

  const downloadArrivalTemplate = () => {
    window.open('/api/catalog/arrival-upload?template=1', '_blank');
  };

  const reloadImages = async () => {
    const imgData = await apiGet('/api/catalog/images');
    const imgMap = imgData.byProdKey || {};
    setImagesByProd(imgMap);
    const regCount = Object.keys(imgMap).filter(k => imgMap[k]?.length).length;
    setImageInfo({ registered: regCount, total: imgData.images?.length || 0 });
    if (lines.length && products.length) {
      syncLinesFromProducts(products, imgMap);
    }
    return imgMap;
  };

  const handleBulkImages = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setImageBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('file', f));
      const res = await fetch('/api/catalog/images/bulk-import', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '일괄 업로드 실패');
      await reloadImages();
      setErr(`이미지 ${data.matchedCount}건 등록 · 스킵 ${data.skipped?.length || 0} · 미매칭 ${data.unmatched?.length || 0} (파일명=ProdKey/품목명)`);
    } catch (ex) {
      setErr(`이미지 일괄업로드: ${ex.message}`);
    } finally {
      setImageBusy(false);
    }
  };

  const scanBulkFolder = async () => {
    setImageBusy(true);
    setErr('');
    try {
      const [imgRes, srcRes] = await Promise.all([
        fetch('/api/catalog/images/bulk-import?scan=1', { method: 'POST', credentials: 'include' }),
        fetch('/api/catalog/images/import-source?scan=1', { method: 'POST', credentials: 'include' }),
      ]);
      const imgData = await imgRes.json();
      const srcData = await srcRes.json();
      await reloadImages();
      const parts = [];
      if (imgData.success && imgData.matchedCount) parts.push(`이미지파일 ${imgData.matchedCount}건`);
      if (srcData.success && srcData.matchedCount) parts.push(`통합본 ${srcData.matchedCount}건`);
      if (!parts.length) {
        throw new Error(srcData.error || imgData.error || '등록된 항목 없음 — _bulk_import 폴더 확인');
      }
      setErr(`폴더 가져오기: ${parts.join(' · ')}`);
    } catch (ex) {
      setErr(`폴더 가져오기: ${ex.message}`);
    } finally {
      setImageBusy(false);
    }
  };

  const handleCatalogSource = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/catalog/images/import-source', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '가져오기 실패');
      await reloadImages();
      setErr(`통합본: ${data.message} · 미매칭 ${data.unmatched?.length || 0}건`);
    } catch (ex) {
      setErr(`카탈로그 원본: ${ex.message}`);
    } finally {
      setImageBusy(false);
    }
  };

  const [pptBusy, setPptBusy] = useState(false);

  const handlePpt = async () => {
    if (!lines.length) return;
    setPptBusy(true);
    setErr('');
    try {
      const weekLabel = costMode === 'selected' && selectedWeekInput.value
        ? `${yearInput.value} · ${selectedWeekInput.value}`
        : latestWeek
          ? `${yearInput.value} · ${latestWeek} (최근원가)`
          : '';
      await exportCatalogPpt({
        title: catalogTitle,
        lines: lines.map(l => ({ ...l, imageUrl: absCatalogUrl(l.imageUrl) })),
        perPage,
        custName,
        weekLabel,
      });
    } catch (e) {
      setErr(`PPT 생성 실패: ${e.message}`);
    } finally {
      setPptBusy(false);
    }
  };

  const renderThumb = (prod, { size = 44, onClick, lineId } = {}) => {
    const img = pickPrimaryImageRecord(imagesByProd, prod.ProdKey);
    const line = lineId ? lines.find(l => l.id === lineId) : null;
    const url = line?.imageUrl || img?.url;
    const style = {
      width: size,
      height: size,
      borderRadius: 4,
      flexShrink: 0,
      overflow: 'hidden',
      background: 'var(--header-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: onClick ? 'pointer' : 'default',
      border: '1px solid var(--border)',
    };
    return (
      <div
        style={style}
        title="클릭 → 이미지 업로드/관리"
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter') { e.stopPropagation(); onClick(); } } : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {url ? (
          <img src={absCatalogUrl(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontWeight: 700, fontSize: size > 50 ? 14 : 11, color: 'var(--text3)' }}>
            {prod.FlowerName?.slice(0, 2) || '📷'}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <Head><title>거래처 카탈로그 | NENOVA</title></Head>

      {picker && (
        <CatalogImagePicker
          open
          prodKey={picker.prodKey}
          prodLabel={picker.prodLabel}
          images={imagesByProd[String(picker.prodKey)] || []}
          selectedImageId={picker.selectedImageId}
          onClose={() => setPicker(null)}
          onImagesChange={handleImagesChange}
          onSelect={handlePickerSelect}
        />
      )}

      <div className="catalog-page">
        <div className="filter-bar" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
          <YearInput yearInput={yearInput} label="연도" />
          <span className="filter-label">최신 차수</span>
          <span className="filter-input" style={{ width: 72, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--header-bg)', fontWeight: 600 }}>
            {latestWeek || (loading ? '…' : '—')}
          </span>
          <select className="filter-select" style={{ minWidth: 100 }} value={costMode} onChange={e => setCostMode(e.target.value)}>
            <option value="recent">최근원가</option>
            <option value="selected">선택차수</option>
          </select>
          {costMode === 'selected' && (
            <WeekSpinInput weekInput={selectedWeekInput} label="선택 차수" />
          )}
          <span className="filter-label">거래처</span>
          <select className="filter-select" style={{ minWidth: 160 }} value={custKey} onChange={e => setCustKey(e.target.value)}>
            <option value="">— 선택 —</option>
            {customers.map(c => (
              <option key={c.CustKey} value={c.CustKey}>{c.CustName}</option>
            ))}
          </select>
          <span className="filter-label">제목</span>
          <input className="filter-input" style={{ width: 200 }} value={catalogTitle} onChange={e => setCatalogTitle(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={useVatArrival} onChange={e => setUseVatArrival(e.target.checked)} />
            도착원가(부가세포)
          </label>
          <button className="btn btn-primary" onClick={() => loadData()} disabled={loading || uploadBusy}>
            {loading ? '불러오는 중…' : '① 도착원가 불러오기'}
          </button>
          <label className="btn" style={{ cursor: uploadBusy ? 'wait' : 'pointer', margin: 0 }}>
            {uploadBusy ? '엑셀 처리…' : '📥 도착원가 엑셀'}
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={uploadBusy} onChange={handleArrivalFile} />
          </label>
          <button type="button" className="btn btn-sm" onClick={downloadArrivalTemplate} title="ProdKey·품목명·도착원가 양식">양식</button>
          {uploadMeta?.count > 0 && (
            <button type="button" className="btn btn-sm btn-danger" onClick={clearArrivalUpload} disabled={uploadBusy} title={uploadMeta.fileName || ''}>
              엑셀 초기화 ({uploadMeta.count})
            </button>
          )}
          <label className="btn btn-sm btn-primary" style={{ cursor: imageBusy ? 'wait' : 'pointer', margin: 0 }} title="카달로그_통합본.pptx — 품목별 사진+이름 (391품목)">
            {imageBusy ? '…' : '📂 통합본 가져오기'}
            <input type="file" accept=".pptx,.zip" style={{ display: 'none' }} disabled={imageBusy} onChange={handleCatalogSource} />
          </label>
          <label className="btn btn-sm" style={{ cursor: imageBusy ? 'wait' : 'pointer', margin: 0 }} title="파일명: ProdKey 또는 품목명.jpg">
            {imageBusy ? '이미지…' : '📁 이미지 일괄'}
            <input type="file" accept="image/*,.bmp" multiple style={{ display: 'none' }} disabled={imageBusy} onChange={handleBulkImages} />
          </label>
          <button type="button" className="btn btn-sm" onClick={scanBulkFolder} disabled={imageBusy} title="서버 _bulk_import 폴더 (PPTX·이미지)">
            폴더가져오기
          </button>
          <div className="page-actions">
            <select className="filter-select" value={perPage} onChange={e => setPerPage(Number(e.target.value))}>
              <option value={6}>6개형</option>
              <option value={8}>8개형</option>
            </select>
            <button className="btn btn-primary" onClick={openPreview} disabled={!lines.length}>👁 미리보기</button>
            <button className="btn" onClick={openPrint} disabled={!lines.length}>🖨 인쇄</button>
            <button className="btn btn-success" onClick={handlePpt} disabled={!lines.length || pptBusy}>
              {pptBusy ? 'PPT 생성 중…' : '📊 PPT 다운로드'}
            </button>
          </div>
        </div>

        {err && <div className="banner-warn">{err}</div>}
        {!err && imageInfo?.registered === 0 && !imageInfo?.error && products.length > 0 && (
          <div className="banner-warn" style={{ background: '#fff8e6' }}>
            <b>이미지 0품목</b> — 사진은 서버의 <b>카달로그_통합본.pptx</b>에서 자동 등록됩니다.
            통합본을 서버 <code>_bulk_import</code>에 한 번만 두면 매번 업로드할 필요 없습니다.
            최초 1회는 <b>📂 통합본 가져오기</b> 또는 <b>① 도착원가 불러오기</b> 시 자동 처리됩니다.
          </div>
        )}
        {imageInfo?.error && (
          <div className="banner-warn">이미지 목록 로드 실패: {imageInfo.error}</div>
        )}

        <div className="catalog-flow-hint banner-info">
          <b>작업 순서</b> — ① 도착원가 → ② 품종·품목 → ③ <b>이미지</b>(📷 클릭 업로드) → ④ 단가 → ⑤ <b>미리보기</b> → 인쇄/PPT
          {products.length > 0 && (
            <span style={{ marginLeft: 12, color: 'var(--text3)' }}>
              품목 {products.length}
              {arrivalStats && arrivalStats.withArrival > 0 && (
                <> · 도착원가 {arrivalStats.withArrival}건</>
              )}
              {arrivalStats?.fromFallback > 0 && (
                <> · 이전차수 {arrivalStats.fromFallback}건</>
              )}
              {arrivalStats?.fromUpload > 0 && (
                <> · <span style={{ color: 'var(--blue)' }}>엑셀 {arrivalStats.fromUpload}건</span></>
              )}
              {uploadMeta?.fileName && (
                <> · {uploadMeta.fileName}</>
              )}
              {arrivalStats?.latestWeek && costMode === 'recent' && (
                <> · 기준 {arrivalStats.latestWeek}</>
              )}
              · 이미지 {Object.keys(imagesByProd).filter(k => imagesByProd[k]?.length).length}품목
            </span>
          )}
        </div>

        <div className="catalog-layout">
          <aside className="catalog-sidebar card">
            <div className="card-header"><span className="card-title">② 품종</span></div>
            <div style={{ padding: '4px 6px' }}>
              <input
                className="filter-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
                placeholder="품종 검색…"
                value={flowerSearch}
                onChange={e => setFlowerSearch(e.target.value)}
              />
            </div>
            <div className="catalog-sidebar-body">
              <button type="button" className={`catalog-flower-item ${selectedFlower === '__all__' ? 'active' : ''}`} onClick={() => setSelectedFlower('__all__')}>
                전체 <span className="badge badge-gray">{products.length}</span>
              </button>
              {filteredFlowerGroups.map(({ flower, items }) => (
                <button key={flower} type="button" className={`catalog-flower-item ${selectedFlower === flower ? 'active' : ''}`} onClick={() => setSelectedFlower(flower)}>
                  {flower} <span className="badge badge-gray">{items.length}</span>
                </button>
              ))}
              {flowerSearch && !filteredFlowerGroups.length && (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--text3)' }}>검색 결과 없음</div>
              )}
            </div>
          </aside>

          <section className="catalog-center card">
            <div className="card-header">
              <span className="card-title">③ 세부 품목</span>
              <input className="filter-input" style={{ marginLeft: 'auto', width: 180 }} placeholder="품목명 검색…" value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-sm" onClick={addVisibleFlower} disabled={!visibleProducts.length}>표시 품목 일괄추가</button>
            </div>
            <div className="catalog-product-grid">
              {!products.length && !loading && (
                <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                  <div className="empty-text">[도착원가 불러오기]로 최근원가를 불러오세요.</div>
                </div>
              )}
              {visibleProducts.map(prod => {
                const checked = checkedKeys.has(prod.ProdKey);
                const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
                return (
                  <div
                    key={prod.ProdKey}
                    className={`catalog-prod-card ${checked ? 'checked' : ''}`}
                    onClick={() => toggleProduct(prod)}
                    onKeyDown={e => e.key === 'Enter' && toggleProduct(prod)}
                    role="button"
                    tabIndex={0}
                  >
                    <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                    {renderThumb(prod, { onClick: () => openPicker(prod) })}
                    <div className="catalog-prod-meta">
                      <div className="catalog-prod-flower">{prod.CounName} · {prod.FlowerName}</div>
                      <div className="catalog-prod-name">{displayProductName(prod)}</div>
                      <div className="catalog-prod-cost">
                        도착 <strong className="num">{fmtNum(arrival) || '—'}</strong>
                        {arrival > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                            {' '}/{prod.arrivalUnit || prod.OutUnit}
                            {prod.arrivalSource === 'upload' && <> · 엑셀</>}
                            {prod.arrivalIsFallback && prod.arrivalWeek && (
                              <> · {prod.arrivalWeek}</>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="catalog-right card">
            <div className="card-header">
              <span className="card-title">④ 단가·이름 ({lines.length})</span>
              {custName && <span style={{ fontSize: 11, color: 'var(--blue)' }}>{custName}</span>}
            </div>
            <div className="table-wrap catalog-lines-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>이미지</th>
                    <th>품종</th>
                    <th>카탈로그명</th>
                    <th style={{ textAlign: 'right' }}>도착원가</th>
                    <th style={{ textAlign: 'right' }}>판매단가</th>
                    <th style={{ textAlign: 'right' }}>마진</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!lines.length && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>품목을 선택하세요</td></tr>
                  )}
                  {lines.map(line => {
                    const m = marginPct(line.arrivalCost, line.salePrice);
                    const prod = findProd(products, line.prodKey) || line;
                    return (
                      <tr key={line.id}>
                        <td>
                          {renderThumb(
                            { ...prod, ProdKey: line.prodKey, FlowerName: line.flowerName },
                            { size: 40, lineId: line.id, onClick: () => openPicker(prod, line.id) },
                          )}
                        </td>
                        <td style={{ fontSize: 11 }}>{line.flowerName}</td>
                        <td>
                          <input className="form-control" style={{ width: '100%', minWidth: 90 }} value={line.catalogName} onChange={e => updateLine(line.id, { catalogName: e.target.value })} />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control num"
                            style={{ width: 72, textAlign: 'right', color: 'var(--amber)' }}
                            value={line.arrivalCost || ''}
                            onChange={e => updateLine(line.id, { arrivalCost: Number(e.target.value) || 0 })}
                          />
                          <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right' }}>/{line.arrivalUnit}</div>
                        </td>
                        <td>
                          <input type="number" className="form-control num" style={{ width: 80, textAlign: 'right' }} value={line.salePrice || ''} onChange={e => updateLine(line.id, { salePrice: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="num" style={{ color: m != null && m < 15 ? 'var(--red)' : 'var(--green)', fontSize: 11 }}>
                          {m != null ? fmtPct(m) : '—'}
                        </td>
                        <td>
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => removeLine(line.id)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <style jsx global>{`
        .catalog-page { display: flex; flex-direction: column; height: calc(100vh - 8px); padding: 4px; box-sizing: border-box; }
        .catalog-flow-hint { flex-shrink: 0; margin-bottom: 4px; font-size: 12px; }
        .catalog-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px 1fr 460px; gap: 4px; }
        .catalog-sidebar { display: flex; flex-direction: column; min-height: 0; }
        .catalog-sidebar-body { flex: 1; overflow-y: auto; padding: 4px; }
        .catalog-flower-item {
          display: flex; align-items: center; justify-content: space-between; width: 100%;
          padding: 6px 8px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 2px;
          background: transparent; cursor: pointer; font-size: 12px; text-align: left; font-family: inherit;
        }
        .catalog-flower-item:hover { background: var(--blue-bg); }
        .catalog-flower-item.active { background: var(--blue-sel); font-weight: bold; border-color: var(--border2); }
        .catalog-center, .catalog-right { display: flex; flex-direction: column; min-height: 0; }
        .catalog-product-grid {
          flex: 1; overflow-y: auto; padding: 8px;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; align-content: start;
        }
        .catalog-prod-card {
          border: 1px solid var(--border2); border-radius: 4px; padding: 8px; cursor: pointer;
          background: var(--surface); display: flex; gap: 8px; align-items: flex-start;
        }
        .catalog-prod-card:hover { border-color: var(--blue); background: var(--blue-bg); }
        .catalog-prod-card.checked { border-color: var(--green); background: var(--green-bg); }
        .catalog-prod-meta { min-width: 0; flex: 1; }
        .catalog-prod-flower { font-size: 10px; color: var(--text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .catalog-prod-name { font-size: 12px; font-weight: 600; margin: 2px 0; line-height: 1.25; }
        .catalog-prod-cost { font-size: 11px; }
        .catalog-lines-wrap { flex: 1; min-height: 0; border: none; }
        @media (max-width: 1100px) {
          .catalog-layout { grid-template-columns: 140px 1fr; grid-template-rows: 1fr auto; }
          .catalog-right { grid-column: 1 / -1; max-height: 260px; }
        }
      `}</style>
    </>
  );
}
