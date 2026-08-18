// lib/persistImportMappings.js — 업로드 매칭 → order-mappings.json 저장 (서버)

import { saveMapping } from './parseMappings';

/** 매칭된 품목을 서버 매핑 DB에 저장 (다음 업로드 재사용) */
export function persistImportMatchMappings(items, { force = true } = {}) {
  const saved = [];
  for (const it of items || []) {
    if (it.skip || !it.inputName || !it.prodKey) continue;

    // 자동 추론 결과를 강제로 학습하면 한 번의 오매칭이 다음 업로드의
    // exact 저장매핑으로 자기강화된다. 사용자 수동 선택 또는 이미 검증된
    // 저장매핑만 유지한다.
    const shouldSave = it.mappingMatchType === 'manual' || it.fromMapping;

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
