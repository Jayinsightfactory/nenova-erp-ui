// 카탈로그 PPT 슬라이드 편집 — 수동 슬롯 배치 + 자동 품종 추가

import {
  buildCatalogExportPages,
  compareCatalogLineOrder,
} from './catalogLayout.js';
import {
  compareProductErpOrder,
  pickPrimaryImageRecord,
  productGroupKey,
} from './catalogUtils.js';

export function perPageSlotCount(perPage) {
  if (perPage === 6) return 6;
  if (perPage === 10) return 10;
  return 8;
}

export function catalogGridCols(perPage) {
  if (perPage === 6) return 3;
  if (perPage === 10) return 5;
  return 4;
}

export function hasCatalogImage(item, imagesByProd) {
  if (item?.imageUrl) return true;
  const key = item?.prodKey ?? item?.ProdKey;
  if (!key) return false;
  return Boolean(pickPrimaryImageRecord(imagesByProd, key));
}

export function compareCatalogLineImageOrder(a, b, imagesByProd) {
  const hasA = hasCatalogImage(a, imagesByProd);
  const hasB = hasCatalogImage(b, imagesByProd);
  if (hasA !== hasB) return hasA ? -1 : 1;
  return compareCatalogLineOrder(a, b);
}

export function sortLinesImageFirst(lines, imagesByProd) {
  return [...(lines || [])].sort((a, b) => compareCatalogLineImageOrder(a, b, imagesByProd));
}

export function sortProductsImageFirst(products, imagesByProd) {
  return [...(products || [])].sort((a, b) => {
    const hasA = hasCatalogImage(a, imagesByProd);
    const hasB = hasCatalogImage(b, imagesByProd);
    if (hasA !== hasB) return hasA ? -1 : 1;
    return compareProductErpOrder(a, b);
  });
}

export function newComposerSlide({ titleBig, titleSmall, perPage, slots } = {}) {
  const n = perPageSlotCount(perPage);
  const slotArr = slots ? [...slots] : Array(n).fill(null);
  while (slotArr.length < n) slotArr.push(null);
  return {
    id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    titleBig: titleBig || '미분류',
    titleSmall: titleSmall || '',
    slots: slotArr.slice(0, n),
  };
}

export function sanitizeComposerSlides(slides, validLineIds, perPage) {
  const valid = validLineIds instanceof Set ? validLineIds : new Set(validLineIds);
  const n = perPageSlotCount(perPage);
  return (slides || []).map(sl => ({
    ...sl,
    slots: (sl.slots || []).slice(0, n).map(id => (id && valid.has(id) ? id : null)),
  }));
}

/** perPage 변경 시 슬롯 재배치 */
export function resizeComposerSlides(slides, perPage, linesById) {
  const chunk = perPageSlotCount(perPage);
  const items = [];
  for (const sl of slides || []) {
    for (const id of sl.slots || []) {
      if (id && linesById[id]) {
        items.push({
          id,
          titleBig: sl.titleBig,
          titleSmall: sl.titleSmall,
        });
      }
    }
  }
  if (!items.length) return [];

  const newSlides = [];
  for (let i = 0; i < items.length; i += chunk) {
    const group = items.slice(i, i + chunk);
    const firstLine = linesById[group[0].id];
    const slots = Array(chunk).fill(null);
    group.forEach((item, idx) => { slots[idx] = item.id; });
    newSlides.push(newComposerSlide({
      titleBig: firstLine?.flowerName || group[0].titleBig,
      titleSmall: firstLine?.counName || group[0].titleSmall,
      perPage: chunk,
      slots,
    }));
  }
  return newSlides;
}

/** 품종 드롭 → 선택(또는 전체) 품목을 슬라이드에 자동 추가 */
export function addGroupToComposer(slides, {
  groupKey,
  lines,
  perPage,
  imagesByProd,
  groupMeta,
  targetSlideId = SLIDE_TARGET_AUTO,
}) {
  const groupLines = sortLinesImageFirst(
    (lines || []).filter(l => (l.countryFlower || productGroupKey(l)) === groupKey),
    imagesByProd,
  );
  if (!groupLines.length) return slides || [];

  const meta = groupMeta || {};
  const titleBig = meta.flowerName || groupLines[0].flowerName || '미분류';
  const titleSmall = meta.counName || groupLines[0].counName || '';
  const defaultTitle = { titleBig, titleSmall };

  if (targetSlideId && targetSlideId !== SLIDE_TARGET_AUTO) {
    return placeLinesOnComposer(slides, groupLines.map(l => l.id), {
      perPage,
      targetSlideId,
      defaultTitle,
    });
  }

  const chunk = perPageSlotCount(perPage);
  const next = [...(slides || [])];

  for (let i = 0; i < groupLines.length; i += chunk) {
    const chunkLines = groupLines.slice(i, i + chunk);
    const slotArr = Array(chunk).fill(null);
    chunkLines.forEach((l, idx) => { slotArr[idx] = l.id; });
    next.push(newComposerSlide({
      titleBig,
      titleSmall,
      perPage: chunk,
      slots: slotArr,
    }));
  }
  return next;
}

export function assignComposerSlot(slides, slideId, slotIndex, lineId) {
  const perSlide = slides?.[0]?.slots?.length || 8;
  return (slides || []).map(sl => {
    if (sl.id !== slideId) {
      return {
        ...sl,
        slots: (sl.slots || []).map(id => (id === lineId ? null : id)),
      };
    }
    const slots = [...(sl.slots || Array(perSlide).fill(null))];
    while (slots.length < perSlide) slots.push(null);
    const prev = slots[slotIndex] ?? null;
    slots[slotIndex] = lineId;
    return { ...sl, slots };
  });
}

export function clearComposerSlot(slides, slideId, slotIndex) {
  return (slides || []).map(sl => {
    if (sl.id !== slideId) return sl;
    const slots = [...(sl.slots || [])];
    if (slotIndex >= 0 && slotIndex < slots.length) slots[slotIndex] = null;
    return { ...sl, slots };
  });
}

export function removeComposerSlide(slides, slideId) {
  return (slides || []).filter(sl => sl.id !== slideId);
}

export const SLIDE_TARGET_AUTO = '__auto__';
export const SLIDE_TARGET_NEW = '__new__';

/** 선택 슬라이드부터 빈 칸에 순서대로 배치 */
export function placeLinesOnComposer(slides, lineIds, {
  perPage = 8,
  targetSlideId = SLIDE_TARGET_AUTO,
  defaultTitle = {},
} = {}) {
  if (!lineIds?.length) return slides || [];

  const chunk = perPageSlotCount(perPage);
  let next = [...(slides || [])];

  const appendSlide = () => {
    const sl = newComposerSlide({
      titleBig: defaultTitle.titleBig || '미분류',
      titleSmall: defaultTitle.titleSmall || '',
      perPage: chunk,
    });
    next = [...next, sl];
    return sl.id;
  };

  if (targetSlideId === SLIDE_TARGET_NEW || !next.length) {
    appendSlide();
  }

  let startIdx = 0;
  if (targetSlideId && targetSlideId !== SLIDE_TARGET_AUTO && targetSlideId !== SLIDE_TARGET_NEW) {
    const idx = next.findIndex(s => s.id === targetSlideId);
    if (idx >= 0) startIdx = idx;
  } else if (targetSlideId === SLIDE_TARGET_NEW) {
    startIdx = next.length - 1;
  }

  for (const lineId of lineIds) {
    let placed = false;
    for (let si = startIdx; si < next.length; si += 1) {
      const slotIdx = (next[si].slots || []).findIndex(s => !s);
      if (slotIdx >= 0) {
        next = assignComposerSlot(next, next[si].id, slotIdx, lineId);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const id = appendSlide();
      next = assignComposerSlot(next, id, 0, lineId);
      startIdx = next.length - 1;
    }
  }
  return next;
}

export function placeLineOnComposer(slides, lineId, opts = {}) {
  return placeLinesOnComposer(slides, [lineId], opts);
}

/** composerSlides 우선, 없으면 lines 자동 페이징 */
export function resolveCatalogPages({
  lines,
  composerSlides,
  perPage,
  imagesByProd,
}) {
  const chunk = perPageSlotCount(perPage);
  if (composerSlides?.length) {
    const byId = new Map((lines || []).map(l => [l.id, l]));
    return composerSlides
      .map(sl => ({
        titleBig: sl.titleBig,
        titleSmall: sl.titleSmall,
        lines: (sl.slots || [])
          .slice(0, chunk)
          .map(id => (id ? byId.get(id) : null))
          .filter(Boolean),
      }))
      .filter(p => p.lines.length);
  }
  const sorted = sortLinesImageFirst(lines, imagesByProd);
  return buildCatalogExportPages(sorted, { perPage });
}
