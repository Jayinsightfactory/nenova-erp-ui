// lib/persistImportMappings.js — 업로드 매칭 → order-mappings.json 저장 (서버)

import { saveMapping } from './parseMappings';

/** 매칭된 품목을 서버 매핑 DB에 저장 (다음 업로드 재사용) */
export function persistImportMatchMappings(items, { force = true } = {}) {
  const saved = [];
  for (const it of items || []) {
    if (it.skip || !it.inputName || !it.prodKey) continue;

    const shouldSave = it.mappingMatchType === 'manual'
      || it.fromMapping
      || it.confidenceLabel === 'high'
      || (it.confidenceLabel === 'medium' && Number(it.confidence || 0) >= 0.5);

    if (!shouldSave) continue;

    const payload = {
      prodKey: Number(it.prodKey),
      prodName: it.prodName,
      displayName: it.displayName || it.prodName,
      flowerName: it.flowerName,
      counName: it.counName,
    };
    if (it.unit) payload.unit = it.unit;

    const result = saveMapping(it.inputName, payload, { force });
    if (result.saved) saved.push(it.inputName);
  }
  return saved;
}
