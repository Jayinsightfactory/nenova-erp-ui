// 카탈로그에서 수정한 품목명·이미지 → order-mappings + catalog-images 대표 영구 저장

import { deleteMapping, loadMappings, normalizeToken, saveMapping } from './parseMappings.js';
import { setPrimaryImage } from './catalogImages.js';
import { buildCatalogMappingToken, findCatalogMatchByProdKey } from './catalogNameResolve.js';

export { buildCatalogMappingToken, findCatalogMatchByProdKey };

function removeOtherCatalogMappings(prodKey, keepKey) {
  const cache = loadMappings(true);
  for (const [key, val] of Object.entries(cache)) {
    if (key === keepKey) continue;
    if (Number(val?.prodKey) === Number(prodKey) && val?.source === 'catalog') {
      deleteMapping(key);
    }
  }
}

export function persistCatalogMatch({
  prodKey,
  prodName,
  engName,
  korName,
  flowerName,
  counName,
  imageId,
  force = true,
} = {}) {
  const pk = Number(prodKey);
  if (!pk) return { saved: false, reason: 'invalid-prodKey' };

  const key = buildCatalogMappingToken({ counName, flowerName, engName, prodName }, normalizeToken);
  const eng = String(engName || '').trim();
  const kor = String(korName || '').trim();
  if (!key && !eng && !kor && !imageId) {
    return { saved: false, reason: 'empty-payload' };
  }

  let mappingResult = { saved: false };
  if (key && (eng || kor)) {
    removeOtherCatalogMappings(pk, key);
    mappingResult = saveMapping(
      key,
      {
        prodKey: pk,
        prodName: prodName || '',
        displayName: kor,
        engName: eng,
        flowerName: flowerName || '',
        counName: counName || '',
        source: 'catalog',
      },
      { force },
    );
  }

  let imageResult = null;
  if (imageId) {
    imageResult = setPrimaryImage(imageId);
  }

  return {
    saved: mappingResult.saved || !!imageResult,
    key: mappingResult.key || key || null,
    mapping: mappingResult,
    imagePrimary: imageResult?.id || null,
  };
}
