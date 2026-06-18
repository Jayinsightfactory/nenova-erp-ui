import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import CatalogImagePicker from '../../components/catalog/CatalogImagePicker';
import CatalogLineEditor from '../../components/catalog/CatalogLineEditor';
import CatalogSlideComposer, { setCatalogDragData } from '../../components/catalog/CatalogSlideComposer';
import { exportCatalogPpt } from '../../lib/catalogPptExport';
import { buildCatalogDraftPayload, normalizeLoadedLines } from '../../lib/catalogDraft';
import { DEFAULT_CATALOG_FIELDS, normalizeCatalogFields } from '../../lib/catalogLineText';
import { resolveCatalogProductNames } from '../../lib/catalogNameResolve';
import { catalogImageFieldsFromRecord, mergeLineImageFields } from '../../lib/catalogImagePosition';
import CatalogSlideImage from '../../components/catalog/CatalogSlideImage';
import {
  buildCatalogAutoFitTransform,
  needsCatalogImageAutoFit,
} from '../../lib/catalogImageAutoFit';
import { persistCatalogImageSelection, persistCatalogProductMatch } from '../../lib/catalogMatchClient';
import { updateCatalogImagePosition } from '../../lib/catalogImageClient';
import { apiGet } from '../../lib/useApi';
import { useCatalogDragSelect } from '../../lib/useCatalogDragSelect';
import { useWeekInput, useYearInput, YearInput, WeekSpinInput } from '../../lib/useWeekInput';
import {
  absCatalogUrl,
  compactProductKorHint,
  compactProductTitle,
  displayProductName,
  effectiveArrival,
  filterProducts,
  fmtArrivalDisplay,
  fmtArrivalCostMeta,
  fmtArrivalVatLabel,
  fmtNum,
  groupProductsByCountryFlower,
  newCatalogLine,
  pickPrimaryImageRecord,
  productGroupKey,
  repairCatalogLineNames,
} from '../../lib/catalogUtils';
import {
  addGroupToComposer,
  assignComposerSlot,
  clearComposerSlot,
  collectPlacedLineIds,
  newComposerSlide,
  placeLineOnComposer as assignLineToComposer,
  placeLinesOnComposer,
  removeComposerSlide,
  resizeComposerSlides,
  sanitizeComposerSlides,
  updateComposerSlide,
  SLIDE_TARGET_AUTO,
  SLIDE_TARGET_NEW,
  sortProductsImageFirst,
} from '../../lib/catalogSlides';

const STORAGE_KEY = 'nenovaCatalogDraft';

function readSavedCatalog() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function findProd(prods, prodKey) {
  return prods.find(p => String(p.ProdKey) === String(prodKey));
}

function lineImageFields(byProdKey, prodKey) {
  const img = pickPrimaryImageRecord(byProdKey, prodKey);
  if (!img) return {
    imageId: null, imageUrl: null,
    imagePosX: 50, imagePosY: 50, imageScale: 100, imageRotate: 0,
    imageAutoAdjusted: false, imageManualAdjusted: false,
  };
  const fields = catalogImageFieldsFromRecord(img);
  return {
    imageId: fields.imageId,
    imageUrl: absCatalogUrl(fields.imageUrl),
    imagePosX: fields.imagePosX,
    imagePosY: fields.imagePosY,
    imageScale: fields.imageScale,
    imageRotate: fields.imageRotate,
    imageAutoAdjusted: fields.imageAutoAdjusted,
    imageManualAdjusted: fields.imageManualAdjusted,
  };
}

function pickImageForLine(imgMap, line) {
  const list = imgMap?.[String(line.prodKey)] || imgMap?.[line.prodKey] || [];
  if (line.imageId) return list.find(i => i.id === line.imageId) || pickPrimaryImageRecord(imgMap, line.prodKey);
  return pickPrimaryImageRecord(imgMap, line.prodKey);
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
  const [catalogFields, setCatalogFields] = useState({ ...DEFAULT_CATALOG_FIELDS });

  const [selectedGroup, setSelectedGroup] = useState('__all__');
  const [flowerSearch, setFlowerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState(() => normalizeLoadedLines(readSavedCatalog()?.lines || []));
  const [checkedKeys, setCheckedKeys] = useState(() => {
    const saved = readSavedCatalog();
    return new Set(saved?.checkedKeys || saved?.lines?.map(l => l.prodKey) || []);
  });
  const [composerSlides, setComposerSlides] = useState(() => readSavedCatalog()?.composerSlides || []);
  const [activeSlideTarget, setActiveSlideTarget] = useState(() => readSavedCatalog()?.activeSlideTarget || SLIDE_TARGET_AUTO);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedProdKeys, setExpandedProdKeys] = useState(new Set());
  const [cropLineId, setCropLineId] = useState(null);
  const [selectedLineId, setSelectedLineId] = useState(null);

  const [savedDraftId, setSavedDraftId] = useState(null);
  const [savedDraftName, setSavedDraftName] = useState('');
  const [draftList, setDraftList] = useState([]);
  const [draftPickId, setDraftPickId] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);

  const [picker, setPicker] = useState(null);
  const [matchSaveInfo, setMatchSaveInfo] = useState('');
  const persistTimers = useRef({});

  const applySavedMatchToProduct = useCallback((prodKey, { engName, korName }) => {
    setProducts(prev => prev.map(p => {
      if (String(p.ProdKey) !== String(prodKey)) return p;
      return {
        ...p,
        catalogMatchEngName: engName || p.catalogMatchEngName,
        catalogMatchKorName: korName || p.catalogMatchKorName,
        catalogEngName: engName || p.catalogEngName,
        catalogKorName: korName || p.catalogKorName,
        mappingKorName: korName || p.mappingKorName,
        korNameSource: (engName || korName) ? 'catalog' : p.korNameSource,
      };
    }));
  }, []);

  const queuePersistMatch = useCallback((line) => {
    const prod = findProd(products, line?.prodKey);
    if (!prod || !line?.prodKey) return;
    const eng = String(line.engName || '').trim();
    const kor = String(line.korName || '').trim();
    if (!eng && !kor && !line.imageId) return;

    clearTimeout(persistTimers.current[line.prodKey]);
    persistTimers.current[line.prodKey] = setTimeout(async () => {
      try {
        await persistCatalogProductMatch({
          prodKey: line.prodKey,
          prodName: prod.ProdName,
          flowerName: prod.FlowerName,
          counName: prod.CounName,
          engName: eng,
          korName: kor,
          imageId: line.imageId || undefined,
        });
        applySavedMatchToProduct(line.prodKey, { engName: eng, korName: kor });
        setMatchSaveInfo(`매칭 저장: ${kor || eng || prod.ProdName}`);
      } catch (e) {
        console.warn('[catalog] match persist:', e.message);
        setMatchSaveInfo(`매칭 저장 실패: ${e.message}`);
      }
    }, 700);
  }, [products, applySavedMatchToProduct]);

  const fieldVisibility = useMemo(
    () => normalizeCatalogFields(catalogFields),
    [catalogFields],
  );

  const costContext = useMemo(() => {
    const anchorWeek = arrivalStats?.anchorWeek || latestWeek || null;
    const displayWeek = costMode === 'selected' && selectedWeekInput.value
      ? selectedWeekInput.value
      : anchorWeek;
    return {
      costMode,
      anchorWeek,
      selectedWeek: selectedWeekInput.value,
      displayWeek,
      useVat: useVatArrival,
      vatLabel: fmtArrivalVatLabel(useVatArrival),
    };
  }, [arrivalStats, latestWeek, costMode, selectedWeekInput.value, useVatArrival]);

  const custName = useMemo(
    () => customers.find(c => String(c.CustKey) === String(custKey))?.CustName || '',
    [customers, custKey],
  );

  const buildDraftPayload = useCallback(() => buildCatalogDraftPayload({
    catalogTitle,
    custKey,
    custName,
    perPage,
    catalogFields,
    editorOpen,
    useVatArrival,
    costMode,
    selectedWeek: selectedWeekInput.value,
    orderYear: yearInput.value,
    activeSlideTarget,
    lines,
    composerSlides,
    checkedKeys: [...checkedKeys],
  }), [
    catalogTitle, custKey, custName, perPage, catalogFields, editorOpen,
    useVatArrival, costMode, selectedWeekInput.value, yearInput.value,
    activeSlideTarget, lines, composerSlides, checkedKeys,
  ]);

  const applyDraftPayload = useCallback((payload, meta = {}) => {
    if (!payload) return;
    setCatalogTitle(payload.catalogTitle || meta.name || 'NENOVA 카탈로그');
    setCustKey(payload.custKey || '');
    setPerPage(payload.perPage || 8);
    setCatalogFields({ ...DEFAULT_CATALOG_FIELDS, ...(payload.catalogFields || {}) });
    setEditorOpen(payload.editorOpen === true);
    setUseVatArrival(payload.useVatArrival !== false);
    setCostMode(payload.costMode || 'recent');
    if (payload.selectedWeek) selectedWeekInput.setValue(payload.selectedWeek);
    if (payload.orderYear) yearInput.setValue(String(payload.orderYear));
    setActiveSlideTarget(payload.activeSlideTarget || SLIDE_TARGET_AUTO);
    setLines(normalizeLoadedLines(payload.lines));
    setComposerSlides(payload.composerSlides || []);
    setCheckedKeys(new Set(payload.checkedKeys || payload.lines?.map(l => l.prodKey) || []));
    setSavedDraftId(meta.id || null);
    setSavedDraftName(meta.name || payload.catalogTitle || '');
    setSelectedLineId(null);
  }, [selectedWeekInput, yearInput]);

  const refreshDraftList = useCallback(async () => {
    try {
      const data = await apiGet('/api/catalog/drafts');
      setDraftList(data.drafts || []);
    } catch (e) {
      console.warn('[catalog] drafts list:', e.message);
    }
  }, []);

  useEffect(() => {
    refreshDraftList();
  }, [refreshDraftList]);

  const productGroups = useMemo(() => groupProductsByCountryFlower(products), [products]);

  const filteredProductGroups = useMemo(() => {
    const q = flowerSearch.trim().toLowerCase();
    if (!q) return productGroups;
    return productGroups.filter(({ label, counName, flowerName }) => {
      const hay = `${label} ${counName} ${flowerName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [productGroups, flowerSearch]);

  const visibleProducts = useMemo(
    () => sortProductsImageFirst(
      filterProducts(products, { countryFlower: selectedGroup, search }),
      imagesByProd,
    ),
    [products, selectedGroup, search, imagesByProd],
  );

  const linesById = useMemo(
    () => Object.fromEntries(lines.map(l => [l.id, l])),
    [lines],
  );

  const placedLineIds = useMemo(
    () => collectPlacedLineIds(composerSlides),
    [composerSlides],
  );

  const editorLines = useMemo(
    () => lines.filter(l => placedLineIds.has(l.id)),
    [lines, placedLineIds],
  );

  const syncLinesFromProducts = useCallback((prods, imgMap) => {
    setLines(prev => prev.map(line => {
      const prod = findProd(prods, line.prodKey);
      if (!prod) return line;
      const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
      const img = pickImageForLine(imgMap, line);
      const imgFields = mergeLineImageFields(line, img);
      return {
        ...line,
        arrivalCost: arrival,
        arrivalUnit: prod.arrivalUnit || line.arrivalUnit,
        arrivalWeek: prod.arrivalWeek || line.arrivalWeek || null,
        arrivalSource: prod.arrivalSource || line.arrivalSource || null,
        arrivalIsFallback: prod.arrivalIsFallback ?? line.arrivalIsFallback ?? false,
        salePrice: line.salePrice > 0 ? line.salePrice : (prod.customerCost ?? prod.Cost ?? 0),
        ...imgFields,
      };
    }));
  }, [useVatArrival]);

  const refreshCatalogImages = useCallback(async () => {
    try {
      const imgData = await apiGet('/api/catalog/images');
      const imgMap = imgData.byProdKey || {};
      setImagesByProd(imgMap);
      const regCount = Object.keys(imgMap).filter(k => imgMap[k]?.length).length;
      setImageInfo({ registered: regCount, total: imgData.images?.length || 0 });
      return imgMap;
    } catch (e) {
      console.warn('[catalog] images:', e.message);
      setImageInfo({ error: e.message });
      return {};
    }
  }, []);

  const mergeBootstrapLines = useCallback((prods, imgMap) => {
    setLines(prev => {
      if (!prev.length) return prev;
      return prev.map(line => {
        const prod = findProd(prods, line.prodKey);
        if (!prod) return line;
        const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
        const img = pickImageForLine(imgMap, line) || pickPrimaryImageRecord(imgMap, line.prodKey);
        const imgFields = mergeLineImageFields(line, img);
        return {
          ...line,
          arrivalCost: arrival,
          arrivalUnit: prod.arrivalUnit || line.arrivalUnit,
          salePrice: line.salePrice > 0 ? line.salePrice : (prod.customerCost ?? prod.Cost ?? 0),
          ...imgFields,
        };
      });
    });
  }, [useVatArrival]);

  /** 페이지 진입 — 품목·이미지·거래처만 (도착원가 SQL 스캔 없음) */
  const loadProductsLite = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await apiGet('/api/catalog/bootstrap', {
        orderYear: yearInput.value,
        costMode: 'recent',
        skipArrival: '1',
        autoImport: '0',
        custKey: custKey || undefined,
      });
      const prods = data.products || [];
      setProducts(prods);
      setCustomers(data.customers || []);
      setArrivalStats(data.arrivalStats || null);
      setUploadMeta(data.uploadMeta || null);
      const imgMap = await refreshCatalogImages();
      mergeBootstrapLines(prods, imgMap);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [yearInput.value, custKey, refreshCatalogImages, mergeBootstrapLines]);

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
      if (!data.arrivalStats?.skipped && data.arrivalStats?.error && !(data.arrivalStats?.fromUpload > 0)) {
        setErr(`도착원가: ${data.arrivalStats.error}`);
      } else if (!data.arrivalStats?.skipped && data.arrivalStats?.withArrival === 0 && !(data.arrivalStats?.fromUpload > 0)) {
        const anchor = data.arrivalStats?.anchorWeek || latestWeek || '—';
        setErr(`도착원가 자동 계산 결과가 없습니다. (기준 차수: ${anchor}) — 입고원장·운송기준원가(/freight) 데이터를 확인하세요.`);
      }
      if (data.imageAutoImport?.ran && data.imageAutoImport.message) {
        setErr(data.imageAutoImport.message);
      } else if (data.imageAutoImport?.error) {
        setErr(`통합본 자동등록: ${data.imageAutoImport.error}`);
      }
      let imgMap = {};
      try {
        imgMap = await refreshCatalogImages();
      } catch {
        imgMap = {};
      }
      mergeBootstrapLines(prods, imgMap);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [yearInput.value, costMode, selectedWeekInput.value, custKey, useVatArrival, latestWeek, refreshCatalogImages, mergeBootstrapLines]);

  useEffect(() => {
    loadProductsLite();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const saved = readSavedCatalog();
      if (!saved) return;
      if (saved.savedDraftId) {
        setSavedDraftId(saved.savedDraftId);
        setSavedDraftName(saved.savedDraftName || '');
      }
      if (saved.catalogTitle) setCatalogTitle(saved.catalogTitle);
      if (saved.custKey) setCustKey(saved.custKey);
      if (saved.perPage) setPerPage(saved.perPage);
      if (saved.catalogFields) setCatalogFields({ ...DEFAULT_CATALOG_FIELDS, ...saved.catalogFields });
      else if (saved.showNames != null || saved.showPrice != null) {
        setCatalogFields(normalizeCatalogFields({
          showNames: saved.showNames,
          showPrice: saved.showPrice,
          showExtra1: saved.showExtra1,
          showExtra2: saved.showExtra2,
          showExtra3: saved.showExtra3,
        }));
      }
      if (saved.editorOpen != null) setEditorOpen(saved.editorOpen);
      else if (saved.pricePanelOpen != null) setEditorOpen(saved.pricePanelOpen);
      if (saved.useVatArrival != null) setUseVatArrival(saved.useVatArrival);
      if (saved.costMode) setCostMode(saved.costMode);
      if (saved.selectedWeek) selectedWeekInput.setValue(saved.selectedWeek);
      if (saved.orderYear) yearInput.setValue(String(saved.orderYear));
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
      composerSlides,
      activeSlideTarget,
      savedDraftId,
      savedDraftName,
      catalogTitle, custKey, perPage, catalogFields, editorOpen, useVatArrival, costMode,
      selectedWeek: selectedWeekInput.value,
      custName, orderYear: yearInput.value,
      weekStart: displayWeek || null,
      weekEnd: null,
    }));
  }, [lines, composerSlides, activeSlideTarget, savedDraftId, savedDraftName, catalogTitle, custKey, perPage, catalogFields, editorOpen, useVatArrival, costMode, selectedWeekInput.value, latestWeek, custName, yearInput.value]);

  useEffect(() => {
    const valid = new Set(lines.map(l => l.id));
    setComposerSlides(prev => sanitizeComposerSlides(prev, valid, perPage));
  }, [lines, perPage]);

  useEffect(() => {
    if (!products.length || !lines.length) return;
    setLines(prev => prev.map(line => {
      const prod = findProd(products, line.prodKey);
      if (!prod) return line;
      const names = resolveCatalogProductNames(prod, prod.mappingKorName);
      return {
        ...line,
        arrivalCost: effectiveArrival(prod.arrivalCost, useVatArrival),
        arrivalUnit: prod.arrivalUnit || line.arrivalUnit,
        arrivalWeek: prod.arrivalWeek || line.arrivalWeek || null,
        arrivalSource: prod.arrivalSource || line.arrivalSource || null,
        arrivalIsFallback: prod.arrivalIsFallback ?? line.arrivalIsFallback ?? false,
        countryFlower: line.countryFlower || prod.CountryFlower || productGroupKey(prod),
        cSort: line.cSort ?? prod.cSort ?? null,
        fSort: line.fSort ?? prod.fSort ?? null,
        fOrderNo: line.fOrderNo ?? prod.fOrderNo ?? null,
        engName: line.engName || names.engName,
        korName: line.korName || names.korName,
        extra1: line.extra1 ?? '',
        extra2: line.extra2 ?? '',
        extra3: line.extra3 ?? '',
      };
    }));
  }, [useVatArrival, products]);

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
      ? (() => {
        const f = catalogImageFieldsFromRecord(img);
        return {
          imageId: f.imageId,
          imageUrl: absCatalogUrl(f.imageUrl),
          imagePosX: f.imagePosX,
          imagePosY: f.imagePosY,
          imageScale: f.imageScale,
          imageRotate: f.imageRotate,
          imageAutoAdjusted: f.imageAutoAdjusted,
          imageManualAdjusted: f.imageManualAdjusted,
        };
      })()
      : {
        imageId: null, imageUrl: null,
        imagePosX: 50, imagePosY: 50, imageScale: 100, imageRotate: 0,
        imageAutoAdjusted: false, imageManualAdjusted: false,
      };
    setLines(prev => prev.map(l => (l.prodKey === prodKey ? { ...l, ...fields } : l)));
  };

  const handlePickerSelect = async (img) => {
    if (!picker) return;
    applyImageToLines(picker.prodKey, img);
    setPicker(p => (p ? { ...p, selectedImageId: img?.id || null } : p));
    if (!img?.id) return;
    const prod = findProd(products, picker.prodKey);
    const line = lines.find(l => l.prodKey === picker.prodKey);
    try {
      await persistCatalogImageSelection({
        prodKey: picker.prodKey,
        imageId: img.id,
        prod,
        line,
      });
      const data = await apiGet('/api/catalog/images', { prodKey: picker.prodKey });
      handleImagesChange(picker.prodKey, data.images || []);
      setMatchSaveInfo(`대표 이미지 저장: ${prod?.ProdName || picker.prodKey}`);
    } catch (e) {
      console.warn('[catalog] image match persist:', e.message);
      setMatchSaveInfo(`이미지 저장 실패: ${e.message}`);
    }
  };

  const handleImagesChange = (prodKey, images) => {
    setImagesByProd(prev => ({ ...prev, [String(prodKey)]: images }));
    setLines(prev => prev.map(l => {
      if (String(l.prodKey) !== String(prodKey)) return l;
      const img = l.imageId
        ? images.find(i => i.id === l.imageId)
        : (images.find(i => i.isPrimary) || images[0]);
      if (!img) return l;
      const f = mergeLineImageFields(l, img);
      return {
        ...l,
        imageUrl: absCatalogUrl(f.imageUrl || l.imageUrl),
        imagePosX: f.imagePosX,
        imagePosY: f.imagePosY,
        imageScale: f.imageScale,
        imageRotate: f.imageRotate,
        imageAutoAdjusted: f.imageAutoAdjusted,
        imageManualAdjusted: f.imageManualAdjusted,
      };
    }));
  };

  const addProductLine = (prod) => {
    const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
    const sale = prod.customerCost ?? prod.Cost ?? 0;
    const imgFields = lineImageFields(imagesByProd, prod.ProdKey);
    const names = resolveCatalogProductNames(prod, prod.mappingKorName);
    return {
      ...newCatalogLine(prod, {
        arrivalCost: arrival,
        arrivalUnit: prod.arrivalUnit,
        salePrice: sale,
        catalogName: displayProductName(prod),
        engName: names.engName,
        korName: names.korName,
        ...imgFields,
      }),
      arrivalWeek: prod.arrivalWeek || null,
      arrivalSource: prod.arrivalSource || null,
      arrivalIsFallback: !!prod.arrivalIsFallback,
    };
  };

  const applyMatchingKor = useCallback((lineId) => {
    setLines(prev => prev.map(line => {
      if (line.id !== lineId) return line;
      const prod = findProd(products, line.prodKey);
      if (!prod) return line;
      const names = resolveCatalogProductNames(prod, prod.mappingKorName);
      const repaired = repairCatalogLineNames({
        ...line,
        engName: line.engName || names.engName,
        korName: line.korName || names.korName,
        prodName: prod.ProdName,
        catalogName: line.catalogName || displayProductName(prod),
      });
      return {
        ...line,
        korName: repaired.korName || names.korName || line.korName,
        engName: repaired.engName || names.engName || line.engName,
      };
    }));
  }, [products]);

  const applyMatchingKorAll = useCallback(() => {
    setLines(prev => prev.map(line => {
      const prod = findProd(products, line.prodKey);
      if (!prod) return line;
      const names = resolveCatalogProductNames(prod, prod.mappingKorName);
      const repaired = repairCatalogLineNames({
        ...line,
        engName: line.engName || names.engName,
        korName: line.korName || names.korName,
        prodName: prod.ProdName,
        catalogName: line.catalogName || displayProductName(prod),
      });
      return {
        ...line,
        korName: repaired.korName || names.korName || line.korName,
        engName: repaired.engName || names.engName || line.engName,
      };
    }));
  }, [products]);

  const toggleCatalogField = (key) => {
    setCatalogFields(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const focusLine = useCallback((lineId) => {
    setSelectedLineId(lineId);
    setEditorOpen(true);
  }, []);

  const toggleProductsByKeys = useCallback((prodKeys) => {
    const list = [...new Set((Array.isArray(prodKeys) ? prodKeys : [prodKeys]).filter(Number.isFinite))];
    if (!list.length) return;
    setCheckedKeys(prev => {
      const n = new Set(prev);
      list.forEach(pk => {
        if (n.has(pk)) n.delete(pk);
        else n.add(pk);
      });
      return n;
    });
    setLines(prev => {
      let lines = prev;
      list.forEach(pk => {
        if (lines.some(l => l.prodKey === pk)) {
          lines = lines.filter(l => l.prodKey !== pk);
        } else {
          const prod = findProd(products, pk);
          if (prod) lines = [...lines, addProductLine(prod)];
        }
      });
      return lines;
    });
  }, [products, imagesByProd, useVatArrival]); // eslint-disable-line react-hooks/exhaustive-deps

  const { dragging: dragSelecting, marquee, onPointerDown: onGridPointerDown, shouldSuppressClick } = useCatalogDragSelect(toggleProductsByKeys);

  const toggleProdExpanded = (prodKey, e) => {
    e?.stopPropagation();
    setExpandedProdKeys(prev => {
      const n = new Set(prev);
      if (n.has(prodKey)) n.delete(prodKey);
      else n.add(prodKey);
      return n;
    });
  };

  const toggleProduct = (prod) => {
    if (shouldSuppressClick()) return;
    toggleProductsByKeys([prod.ProdKey]);
  };

  const updateLine = (id, patch) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if ('engName' in patch || 'korName' in patch) {
        queuePersistMatch(next);
      }
      return next;
    }));
  };

  const saveLineImageTransform = async (line, {
    posX, posY, scale, rotate, autoAdjusted, manualAdjusted,
  }) => {
    const isManual = manualAdjusted === true;
    const patch = {
      imagePosX: posX,
      imagePosY: posY,
      imageScale: scale,
      imageRotate: rotate ?? 0,
      imageAutoAdjusted: isManual ? false : !!autoAdjusted,
      imageManualAdjusted: isManual,
    };

    const imageId = line.imageId
      || pickImageForLine(imagesByProd, line)?.id
      || pickPrimaryImageRecord(imagesByProd, line.prodKey)?.id;

    const fitKey = `${line.id}:${imageId || line.imageUrl}`;
    autoFitDoneRef.current.add(fitKey);

    if (imageId) {
      try {
        const savedImage = await updateCatalogImagePosition(imageId, {
          posX, posY, scale, rotate,
          autoAdjusted: patch.imageAutoAdjusted,
          manualAdjusted: patch.imageManualAdjusted,
        });
        const fields = catalogImageFieldsFromRecord(savedImage);
        updateLine(line.id, {
          ...fields,
          imageManualAdjusted: true,
          imageAutoAdjusted: fields.imageAutoAdjusted,
        });
        const data = await apiGet('/api/catalog/images', { prodKey: line.prodKey });
        setImagesByProd(prev => ({ ...prev, [String(line.prodKey)]: data.images || [] }));
      } catch (e) {
        setMatchSaveInfo(`이미지 위치 저장 실패: ${e.message}`);
        return false;
      }
    } else {
      updateLine(line.id, patch);
      setMatchSaveInfo(`이미지 위치 저장됨(품목만): ${line.engName || line.catalogName || line.prodKey} — 이미지 등록 시 서버에도 반영됩니다`);
      return true;
    }

    setMatchSaveInfo(`이미지 위치 저장됨: ${line.engName || line.catalogName || line.prodKey}`);
    return true;
  };

  const autoFitDoneRef = useRef(new Set());

  const runAutoFitForLine = useCallback(async (line) => {
    if (!line?.imageUrl) return;
    const img = pickImageForLine(imagesByProd, line);
    const source = { ...img, ...line };
    if (!needsCatalogImageAutoFit(source)) return;
    const key = `${line.id}:${line.imageId || line.imageUrl}`;
    if (autoFitDoneRef.current.has(key)) return;
    autoFitDoneRef.current.add(key);
    try {
      const t = buildCatalogAutoFitTransform();
      await saveLineImageTransform(line, t);
    } catch (e) {
      autoFitDoneRef.current.delete(key);
      console.warn('[catalog] auto-fit:', e.message);
    }
  }, [imagesByProd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lines.length || cropLineId) return;
    lines.forEach(line => { runAutoFitForLine(line); });
  }, [lines, imagesByProd, runAutoFitForLine, cropLineId]);

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
    placeProdKeysOnComposer(toAdd.map(p => p.ProdKey));
  };

  const handleComposerDropGroup = useCallback((groupKey) => {
    const group = productGroups.find(g => g.key === groupKey);
    const targets = sortProductsImageFirst(group?.items || [], imagesByProd);

    setLines(prev => {
      const existingKeys = new Set(prev.map(l => l.prodKey));
      const missing = targets.filter(p => !existingKeys.has(p.ProdKey));
      const added = missing.map(p => addProductLine(p));
      if (added.length) {
        setCheckedKeys(keys => {
          const next = new Set(keys);
          missing.forEach(p => next.add(p.ProdKey));
          return next;
        });
      }
      const merged = [...prev, ...added];
      setComposerSlides(slPrev => addGroupToComposer(slPrev, {
        groupKey,
        lines: merged,
        perPage,
        imagesByProd,
        groupMeta: group,
        targetSlideId: activeSlideTarget,
      }));
      return merged;
    });
  }, [productGroups, imagesByProd, perPage, addProductLine, activeSlideTarget]);

  const placeLineOnComposer = useCallback((line) => {
    if (!line) return;
    setComposerSlides(prev => assignLineToComposer(prev, line.id, {
      perPage,
      targetSlideId: activeSlideTarget,
      defaultTitle: {
        titleBig: line.flowerName || '미분류',
        titleSmall: line.counName || '',
      },
    }));
  }, [perPage, activeSlideTarget]);

  const placeProdKeysOnComposer = useCallback((prodKeys) => {
    const list = [...new Set((Array.isArray(prodKeys) ? prodKeys : [prodKeys]).map(Number).filter(Number.isFinite))];
    if (!list.length) return;
    setLines(prev => {
      const existingKeys = new Set(prev.map(l => l.prodKey));
      const added = list
        .filter(pk => !existingKeys.has(pk))
        .map(pk => findProd(products, pk))
        .filter(Boolean)
        .map(prod => addProductLine(prod));
      const merged = added.length ? [...prev, ...added] : prev;
      if (added.length) {
        setCheckedKeys(keys => {
          const next = new Set(keys);
          added.forEach(l => next.add(l.prodKey));
          return next;
        });
      }
      const lineIds = list
        .map(pk => merged.find(l => Number(l.prodKey) === Number(pk))?.id)
        .filter(Boolean);
      if (lineIds.length) {
        const first = merged.find(l => lineIds.includes(l.id));
        setComposerSlides(slPrev => placeLinesOnComposer(slPrev, lineIds, {
          perPage,
          targetSlideId: activeSlideTarget,
          defaultTitle: {
            titleBig: first?.flowerName || '미분류',
            titleSmall: first?.counName || '',
          },
        }));
      }
      return merged;
    });
  }, [products, addProductLine, perPage, activeSlideTarget]);

  const handleComposerAutoSlot = useCallback((data) => {
    if (data.type === 'group') {
      handleComposerDropGroup(data.groupKey);
      return;
    }
    if (data.type === 'line') {
      const line = linesById[data.lineId];
      if (line) placeLineOnComposer(line);
      return;
    }
    if (data.type === 'prod-batch' || data.type === 'prod') {
      const keys = data.type === 'prod-batch'
        ? data.prodKeys
        : (data.prodKeys?.length > 1 ? data.prodKeys : [data.prodKey]);
      placeProdKeysOnComposer(keys);
    }
  }, [handleComposerDropGroup, linesById, placeProdKeysOnComposer, placeLineOnComposer]);

  const handleComposerDropSlot = useCallback((slideId, slotIndex, data) => {
    if (!data) return;
    if (data.type === 'group') {
      handleComposerDropGroup(data.groupKey);
      return;
    }
    if (data.type === 'line') {
      const line = linesById[data.lineId];
      if (line) setComposerSlides(prev => assignComposerSlot(prev, slideId, slotIndex, line.id));
      return;
    }
    if (data.type === 'prod') {
      const existing = lines.find(l => String(l.prodKey) === String(data.prodKey));
      if (existing) {
        setComposerSlides(prev => assignComposerSlot(prev, slideId, slotIndex, existing.id));
        return;
      }
      const prod = findProd(products, data.prodKey);
      if (!prod) return;
      const line = addProductLine(prod);
      setCheckedKeys(prev => new Set(prev).add(prod.ProdKey));
      setLines(prev => [...prev, line]);
      setComposerSlides(prev => assignComposerSlot(prev, slideId, slotIndex, line.id));
    }
  }, [handleComposerDropGroup, linesById, lines, products, addProductLine]);

  const handlePerPageChange = (next) => {
    setComposerSlides(prev => (prev.length
      ? resizeComposerSlides(prev, next, linesById)
      : prev));
    setPerPage(next);
  };

  const handleAddEmptySlide = () => {
    const ref = lines[0];
    const sl = newComposerSlide({
      titleBig: ref?.flowerName || '미분류',
      titleSmall: ref?.counName || '',
      perPage,
    });
    setComposerSlides(prev => [...prev, sl]);
    setActiveSlideTarget(sl.id);
  };

  const handleSelectSlideTarget = useCallback((targetId) => {
    setActiveSlideTarget(targetId || SLIDE_TARGET_AUTO);
  }, []);

  const handleUpdateSlide = useCallback((slideId, patch) => {
    setComposerSlides(prev => updateComposerSlide(prev, slideId, patch));
  }, []);

  const handleSaveDraft = async () => {
    if (!lines.length) {
      alert('저장할 품목이 없습니다.');
      return;
    }
    const defaultName = savedDraftName || catalogTitle || '카탈로그';
    const name = window.prompt('카탈로그 저장 이름', defaultName);
    if (!name?.trim()) return;
    setDraftBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/catalog/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: savedDraftId || undefined,
          name: name.trim(),
          payload: buildDraftPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '저장 실패');
      setSavedDraftId(data.draft.id);
      setSavedDraftName(data.draft.name);
      setCatalogTitle(name.trim());
      await refreshDraftList();
      setErr(`카탈로그 저장됨: ${data.draft.name} (${data.draft.lineCount}품목 · ${data.draft.slideCount}슬라이드)`);
    } catch (e) {
      setErr(`카탈로그 저장: ${e.message}`);
    } finally {
      setDraftBusy(false);
    }
  };

  const handleLoadDraft = async () => {
    if (!draftPickId) {
      alert('불러올 저장본을 선택하세요.');
      return;
    }
    if (lines.length && !confirm('현재 작업을 덮어쓰고 저장본을 불러올까요?')) return;
    setDraftBusy(true);
    setErr('');
    try {
      const data = await apiGet('/api/catalog/drafts', { id: draftPickId });
      if (!data.draft?.payload) throw new Error('저장본 데이터가 없습니다.');
      applyDraftPayload(data.draft.payload, data.draft);
      setDraftPickId(data.draft.id);
      await loadData();
      setErr(`불러옴: ${data.draft.name} (${data.draft.payload.lines?.length || 0}품목)`);
    } catch (e) {
      setErr(`카탈로그 불러오기: ${e.message}`);
    } finally {
      setDraftBusy(false);
    }
  };

  const handleDeleteDraft = async () => {
    const id = draftPickId || savedDraftId;
    if (!id) {
      alert('삭제할 저장본을 선택하세요.');
      return;
    }
    const target = draftList.find(d => d.id === id);
    if (!confirm(`"${target?.name || id}" 저장본을 삭제할까요?`)) return;
    setDraftBusy(true);
    try {
      const res = await fetch(`/api/catalog/drafts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '삭제 실패');
      if (savedDraftId === id) {
        setSavedDraftId(null);
        setSavedDraftName('');
      }
      if (draftPickId === id) setDraftPickId('');
      await refreshDraftList();
      setErr('저장본 삭제됨');
    } catch (e) {
      setErr(`저장본 삭제: ${e.message}`);
    } finally {
      setDraftBusy(false);
    }
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
      await exportCatalogPpt({
        fileName: catalogTitle,
        lines: lines.map(l => ({ ...l, imageUrl: absCatalogUrl(l.imageUrl) })),
        composerSlides,
        imagesByProd,
        perPage,
        catalogFields: fieldVisibility,
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
    const posSource = line?.imageId ? line : (img || line);
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
        className="catalog-thumb"
        style={style}
        title="클릭 → 이미지 업로드/관리"
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter') { e.stopPropagation(); onClick(); } } : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {url ? (
          <CatalogSlideImage source={posSource || {}} src={absCatalogUrl(url)} />
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="체크=부가세 포함 금액, 해제=부가세 별도">
            <input type="checkbox" checked={useVatArrival} onChange={e => setUseVatArrival(e.target.checked)} />
            도착원가 {fmtArrivalVatLabel(useVatArrival)}
          </label>
          {costContext.displayWeek && (
            <span className="catalog-cost-badge" title="현재 표시 중인 도착원가 기준 차수">
              기준 {costContext.displayWeek} · {costContext.vatLabel}
            </span>
          )}
          <button className="btn btn-primary" onClick={() => loadData()} disabled={loading || uploadBusy}>
            {loading ? '불러오는 중…' : '① 도착원가 불러오기'}
          </button>
          <label className="btn" style={{ cursor: uploadBusy ? 'wait' : 'pointer', margin: 0 }} title="선택: SQL 자동 계산값을 수동으로 덮어쓸 때만 사용">
            {uploadBusy ? '엑셀 처리…' : '📥 도착원가 덮어쓰기(선택)'}
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
          <span className="filter-label">카탈로그</span>
          <select
            className="filter-select"
            style={{ minWidth: 160 }}
            value={draftPickId}
            onChange={e => setDraftPickId(e.target.value)}
            disabled={draftBusy}
          >
            <option value="">— 저장본 선택 —</option>
            {draftList.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.lineCount}품목 · {d.slideCount}장 · {d.updatedAt?.slice(0, 10) || ''})
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={handleLoadDraft} disabled={draftBusy || !draftPickId}>
            📂 불러오기
          </button>
          <button type="button" className="btn btn-sm btn-success" onClick={handleSaveDraft} disabled={draftBusy || !lines.length}>
            💾 {savedDraftId ? '저장' : '새로 저장'}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={handleDeleteDraft} disabled={draftBusy || !(draftPickId || savedDraftId)}>
            🗑
          </button>
          {savedDraftId && (
            <span style={{ fontSize: 11, color: 'var(--blue)' }} title={savedDraftId}>
              편집중: {savedDraftName}
            </span>
          )}
          <div className="page-actions catalog-field-toggles">
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>PPT표시:</span>
            {[
              ['showEng', '영문'],
              ['showKor', '한글'],
              ['showPrice', '단가'],
              ['showExtra1', '기타1'],
              ['showExtra2', '기타2'],
              ['showExtra3', '기타3'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }} title={`PPT·미리보기 ${label} 표시`}>
                <input type="checkbox" checked={!!catalogFields[key]} onChange={() => toggleCatalogField(key)} />
                {label}
              </label>
            ))}
            <button className="btn btn-primary" onClick={openPreview} disabled={!lines.length}>👁 미리보기</button>
            <button className="btn" onClick={openPrint} disabled={!lines.length}>🖨 인쇄</button>
            <button className="btn btn-success" onClick={handlePpt} disabled={!lines.length || pptBusy}>
              {pptBusy ? 'PPT 생성 중…' : '📊 PPT 다운로드'}
            </button>
          </div>
        </div>

        {err && <div className="banner-warn">{err}</div>}
        {matchSaveInfo && !err && <div className="banner-ok">{matchSaveInfo}</div>}
        {!err && arrivalStats?.skipped && (
          <div className="banner-info" style={{ marginBottom: 4 }}>
            품목 목록은 준비됨 — <b>① 도착원가 불러오기</b>를 누르면 도착원가·기준 차수가 조회됩니다.
          </div>
        )}
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
          <b>작업 순서</b> — ① 도착원가 → ② 품종 → ③ 품목 → ④ PPT(슬라이드 선택) → ⑤ 텍스트 → 💾저장 → 미리보기/PPT
          <span style={{ marginLeft: 8, color: 'var(--text3)', fontSize: 11 }}>
            슬라이드 1·2 지정 후 추가 · 저장본 불러와 수정 재사용
          </span>
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
              <button type="button" className={`catalog-flower-item ${selectedGroup === '__all__' ? 'active' : ''}`} onClick={() => setSelectedGroup('__all__')}>
                전체 <span className="badge badge-gray">{products.length}</span>
              </button>
              {filteredProductGroups.map(({ key, label, items }) => (
                <button
                  key={key}
                  type="button"
                  className={`catalog-flower-item ${selectedGroup === key ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setCatalogDragData(e, { type: 'group', groupKey: key });
                    e.stopPropagation();
                  }}
                  onClick={() => setSelectedGroup(key)}
                  title="PPT 편집기로 끌어 슬라이드 자동 추가"
                >
                  {label} <span className="badge badge-gray">{items.length}</span>
                </button>
              ))}
              {flowerSearch && !filteredProductGroups.length && (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--text3)' }}>검색 결과 없음</div>
              )}
            </div>
          </aside>

          <section className="catalog-center card">
            <div className="card-header catalog-center-hdr">
              <span className="card-title">③ 세부 품목</span>
            </div>
            <div className="catalog-center-toolbar">
              {costContext.displayWeek && (
                <span className="catalog-cost-chip">
                  도착원가 {costContext.displayWeek} · {costContext.vatLabel}
                </span>
              )}
              <input className="filter-input catalog-prod-search" placeholder="품목명 검색…" value={search} onChange={e => setSearch(e.target.value)} />
              <span className="catalog-drag-select-hint" title="빈 공간 드래그 — 선택/해제 토글 (클릭과 동일)">빈 공간 드래그 토글</span>
              <button className="btn btn-sm" onClick={addVisibleFlower} disabled={!visibleProducts.length}>표시 품목 일괄추가</button>
            </div>
            <div
              className={`catalog-product-grid ${dragSelecting ? 'drag-selecting' : ''}`}
              onPointerDown={onGridPointerDown}
            >
              {marquee?.active ? (
                <div
                  className="catalog-marquee-box"
                  style={{
                    position: 'fixed',
                    left: marquee.left,
                    top: marquee.top,
                    width: marquee.width,
                    height: marquee.height,
                    pointerEvents: 'none',
                    zIndex: 50,
                  }}
                />
              ) : null}
              {!products.length && !loading && (
                <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                  <div className="empty-text">품목 목록을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.</div>
                </div>
              )}
              {visibleProducts.map(prod => {
                const checked = checkedKeys.has(prod.ProdKey);
                const arrival = effectiveArrival(prod.arrivalCost, useVatArrival);
                const hasImg = Boolean(pickPrimaryImageRecord(imagesByProd, prod.ProdKey));
                return (
                  <div
                    key={prod.ProdKey}
                    data-prod-key={prod.ProdKey}
                    className={`catalog-prod-card ${checked ? 'checked' : ''} ${!hasImg ? 'no-image' : ''}`}
                    draggable={!dragSelecting}
                    onDragStart={(e) => {
                      if (dragSelecting) { e.preventDefault(); return; }
                      const prodKeys = checkedKeys.has(prod.ProdKey) && checkedKeys.size > 1
                        ? [...checkedKeys]
                        : [prod.ProdKey];
                      setCatalogDragData(e, { type: 'prod', prodKey: prod.ProdKey, prodKeys });
                      e.stopPropagation();
                    }}
                    onClick={() => toggleProduct(prod)}
                    onKeyDown={e => e.key === 'Enter' && toggleProduct(prod)}
                    role="button"
                    tabIndex={0}
                    title={hasImg ? 'PPT 칸으로 끌어 배치' : '사진 없음 — 후순위 · PPT 칸으로 끌어 배치'}
                  >
                    <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                    {renderThumb(prod, { size: 36, onClick: () => openPicker(prod) })}
                    <div className="catalog-prod-meta">
                      <div className="catalog-prod-name-row">
                        <div className="catalog-prod-name">{compactProductTitle(prod)}</div>
                        <button
                          type="button"
                          className="catalog-prod-expand"
                          onClick={(e) => toggleProdExpanded(prod.ProdKey, e)}
                          title="한글명·도착원가 펼치기"
                        >
                          {expandedProdKeys.has(prod.ProdKey) ? '▲' : '▼'}
                        </button>
                      </div>
                      {expandedProdKeys.has(prod.ProdKey) && (
                        <div className="catalog-prod-extra">
                          <div className="catalog-prod-flower">{prod.CounName} · {prod.FlowerName}</div>
                          {(() => {
                            const titleKor = compactProductKorHint(prod);
                            const mapped = prod.catalogKorName || prod.mappingKorName;
                            const kor = mapped || titleKor;
                            if (!kor) return null;
                            return (
                              <div className="catalog-prod-kor" title={mapped ? `한글 제안 (${prod.korNameSource || '—'})` : '품목명 한글'}>
                                {kor}
                              </div>
                            );
                          })()}
                          <div className="catalog-prod-cost">
                            <div>
                              도착 <strong className="num">{fmtArrivalDisplay(arrival, prod.arrivalUnit || prod.saleUnit || prod.OutUnit)}</strong>
                            </div>
                            <div className="catalog-prod-cost-meta">
                              {fmtArrivalCostMeta(prod, costContext).text}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`catalog-ppt-panel card ${editorOpen ? 'with-editor' : ''}`}>
            <div className="card-header">
              <span className="card-title">④ PPT 슬라이드</span>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                {composerSlides.length}장 · {perPage}칸 · 16:9
                {costContext.displayWeek ? ` · 도착 ${costContext.displayWeek} ${costContext.vatLabel}` : ''}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setEditorOpen(v => !v)}
              >
                {editorOpen ? '⑤ 편집 패널 닫기' : `⑤ 텍스트 편집 (${editorLines.length})`}
              </button>
            </div>
            <CatalogSlideComposer
              perPage={perPage}
              onPerPageChange={handlePerPageChange}
              slides={composerSlides}
              linesById={linesById}
              catalogFields={fieldVisibility}
              onDropZone={handleComposerDropGroup}
              onDropAutoSlot={handleComposerAutoSlot}
              onDropSlot={handleComposerDropSlot}
              onClearSlot={(slideId, slotIndex) => {
                setComposerSlides(prev => clearComposerSlot(prev, slideId, slotIndex));
              }}
              onRemoveSlide={(slideId) => {
                const removedIds = new Set(
                  (composerSlides.find(s => s.id === slideId)?.slots || []).filter(Boolean),
                );
                setComposerSlides(prev => removeComposerSlide(prev, slideId));
                setActiveSlideTarget(t => (t === slideId ? SLIDE_TARGET_AUTO : t));
                if (cropLineId && removedIds.has(cropLineId)) setCropLineId(null);
                setSelectedLineId(cur => (cur && removedIds.has(cur) ? null : cur));
              }}
              onAddEmptySlide={handleAddEmptySlide}
              onUpdateSlide={handleUpdateSlide}
              onSelectLine={focusLine}
              selectedLineId={selectedLineId}
              cropLineId={cropLineId}
              onToggleCropLine={setCropLineId}
              onSaveLineCrop={saveLineImageTransform}
              onUpdateLine={updateLine}
              activeSlideTarget={activeSlideTarget}
              onSelectSlideTarget={handleSelectSlideTarget}
              editorOpen={editorOpen}
            />
            {editorOpen && (
              <CatalogLineEditor
                lines={editorLines}
                products={products}
                selectedLineId={selectedLineId}
                onSelectLine={setSelectedLineId}
                onUpdateLine={updateLine}
                onRemoveLine={removeLine}
                onApplyKor={applyMatchingKor}
                onApplyKorAll={applyMatchingKorAll}
                renderThumb={renderThumb}
                findProd={findProd}
                openPicker={openPicker}
                costContext={costContext}
              />
            )}
          </section>
        </div>
      </div>

      <style jsx global>{`
        .catalog-page { display: flex; flex-direction: column; height: calc(100vh - 8px); padding: 4px; box-sizing: border-box; }
        .catalog-flow-hint { flex-shrink: 0; margin-bottom: 4px; font-size: 12px; }
        .catalog-layout {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 128px minmax(240px, 0.26fr) minmax(0, 0.74fr);
          grid-template-rows: 1fr;
          gap: 4px;
        }
        .catalog-sidebar { grid-column: 1; min-height: 0; }
        .catalog-center { grid-column: 2; min-height: 0; max-width: 420px; }
        .catalog-ppt-panel {
          grid-column: 3;
          display: flex;
          flex-direction: column;
          min-height: 0;
          min-width: 0;
        }
        .catalog-ppt-panel.with-editor :global(.catalog-composer) {
          flex: 1;
          min-height: 0;
          max-height: none;
        }
        .catalog-ppt-panel.with-editor :global(.catalog-line-editor) {
          flex: 0 0 min(38%, 280px);
          min-height: 140px;
        }
        .catalog-cost-badge {
          font-size: 11px;
          font-weight: 600;
          color: var(--blue);
          background: var(--blue-bg);
          padding: 2px 8px;
          border-radius: 3px;
        }
        .catalog-cost-chip {
          font-size: 11px;
          font-weight: 600;
          color: var(--blue);
          background: var(--blue-bg);
          padding: 3px 8px;
          border-radius: 3px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .catalog-center-hdr { padding-bottom: 4px; }
        .catalog-center-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          padding: 4px 8px 6px;
          border-bottom: 1px solid var(--border);
        }
        .catalog-prod-search {
          flex: 1;
          min-width: 120px;
          max-width: 200px;
        }
        .catalog-field-toggles {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .catalog-sidebar { display: flex; flex-direction: column; min-height: 0; }
        .catalog-sidebar-body { flex: 1; overflow-y: auto; padding: 4px; }
        .catalog-flower-item {
          display: flex; align-items: center; justify-content: space-between; width: 100%;
          padding: 6px 8px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 2px;
          background: transparent; cursor: pointer; font-size: 12px; text-align: left; font-family: inherit;
        }
        .catalog-flower-item:hover { background: var(--blue-bg); }
        .catalog-flower-item.active { background: var(--blue-sel); font-weight: bold; border-color: var(--border2); }
        .catalog-center { display: flex; flex-direction: column; min-height: 0; }
        .catalog-product-grid {
          flex: 1; overflow-y: auto; padding: 6px;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; align-content: start;
          touch-action: pan-y;
          position: relative;
        }
        .catalog-product-grid.drag-selecting {
          user-select: none; cursor: crosshair;
        }
        .catalog-marquee-box {
          border: 2px solid var(--blue);
          background: rgba(0, 102, 204, 0.12);
          border-radius: 2px;
        }
        .catalog-drag-select-hint {
          font-size: 10px; color: var(--text3); padding: 2px 6px; border: 1px dashed var(--border2);
          border-radius: 3px; white-space: nowrap;
        }
        .catalog-prod-card {
          border: 1px solid var(--border2); border-radius: 4px; padding: 6px; cursor: pointer;
          background: var(--surface); display: flex; gap: 6px; align-items: flex-start;
        }
        .catalog-prod-card:hover { border-color: var(--blue); background: var(--blue-bg); }
        .catalog-prod-card.checked { border-color: var(--green); background: var(--green-bg); }
        .catalog-prod-card.no-image { opacity: 0.72; border-style: dashed; }
        .catalog-prod-meta { min-width: 0; flex: 1; }
        .catalog-prod-name-row { display: flex; align-items: flex-start; gap: 2px; }
        .catalog-prod-expand {
          flex-shrink: 0; border: none; background: transparent; cursor: pointer;
          font-size: 9px; color: var(--text3); padding: 0 2px; line-height: 1.2;
        }
        .catalog-prod-expand:hover { color: var(--blue); }
        .catalog-prod-extra { margin-top: 4px; }
        .catalog-prod-flower { font-size: 9px; color: var(--text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .catalog-prod-name { font-size: 11px; font-weight: 600; line-height: 1.25; flex: 1; min-width: 0; }
        .catalog-prod-kor { font-size: 10px; color: var(--blue); line-height: 1.2; margin-bottom: 2px; }
        .catalog-prod-cost { font-size: 10px; line-height: 1.25; }
        .catalog-prod-cost-meta { font-size: 9px; color: var(--text3); margin-top: 1px; }
        @media (max-width: 1100px) {
          .catalog-layout {
            grid-template-columns: 120px minmax(200px, 0.34fr) minmax(0, 0.66fr);
          }
          .catalog-center { max-width: none; }
        }
        @media (max-width: 900px) {
          .catalog-layout {
            grid-template-columns: 1fr;
            grid-template-rows: minmax(0, 28%) minmax(0, 72%);
          }
          .catalog-sidebar { grid-column: 1; grid-row: 1; max-height: 120px; }
          .catalog-center { grid-column: 1; grid-row: 1; margin-left: 128px; max-width: none; }
          .catalog-ppt-panel { grid-column: 1; grid-row: 2; }
        }
      `}</style>
    </>
  );
}
