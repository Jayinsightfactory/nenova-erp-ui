// 카탈로그 작업 저장 — 직렬화 유틸

import { absCatalogUrl } from './catalogUtils.js';

export function buildCatalogDraftPayload(state) {
  return {
    catalogTitle: state.catalogTitle,
    custKey: state.custKey,
    custName: state.custName,
    perPage: state.perPage,
    catalogFields: state.catalogFields,
    editorOpen: state.editorOpen,
    useVatArrival: state.useVatArrival,
    costMode: state.costMode,
    selectedWeek: state.selectedWeek,
    orderYear: state.orderYear,
    activeSlideTarget: state.activeSlideTarget,
    lines: (state.lines || []).map(l => ({
      ...l,
      imageUrl: absCatalogUrl(l.imageUrl),
    })),
    composerSlides: state.composerSlides || [],
    checkedKeys: [...(state.checkedKeys || [])],
  };
}

export function normalizeLoadedLines(lines) {
  return (lines || []).map(l => ({
    ...l,
    extra1: l.extra1 ?? '',
    extra2: l.extra2 ?? '',
    extra3: l.extra3 ?? '',
    imageUrl: absCatalogUrl(l.imageUrl),
    imagePosX: l.imagePosX ?? 50,
    imagePosY: l.imagePosY ?? 50,
    imageScale: l.imageScale ?? 100,
    imageRotate: l.imageRotate ?? 0,
    imageAutoAdjusted: l.imageAutoAdjusted ?? false,
    imageManualAdjusted: l.imageManualAdjusted ?? false,
  }));
}
