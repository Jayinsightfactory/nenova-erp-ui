/**
 * 카탈로그 이미지 PATCH 저장 프로브
 * 사용: CATALOG_COOKIE="..." node scripts/probe-catalog-image-patch.mjs
 */
const BASE = process.env.CATALOG_BASE || 'https://nenovaweb.com';
const COOKIE = process.env.CATALOG_COOKIE || '';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}

const images = await api('/api/catalog/images');
if (!images.data?.images?.length) {
  console.log('No images or auth required:', images.status, images.data);
  process.exit(1);
}

const img = images.data.images.find(i => i.id) || images.data.images[0];
const testPos = { posX: 42, posY: 57, scale: 138, rotate: 0, manualAdjusted: true, autoAdjusted: false };

console.log('Image:', img.id, 'prodKey:', img.prodKey, 'before:', { posX: img.posX, posY: img.posY, scale: img.scale, manual: img.manualAdjusted });

const patch = await api(`/api/catalog/images/${img.id}`, { method: 'PATCH', body: testPos });
console.log('PATCH', patch.status, patch.data?.success, patch.data?.error || patch.data?.image?.posX);

const put = await api(`/api/catalog/images/${img.id}?action=position`, {
  method: 'PUT',
  body: { ...testPos, posX: 43 },
});
console.log('PUT position', put.status, put.data?.success, put.data?.error || put.data?.image?.posX);

const again = await api(`/api/catalog/images?prodKey=${img.prodKey}`);
const saved = again.data?.images?.find(i => i.id === img.id);
console.log('After reload:', { posX: saved?.posX, posY: saved?.posY, scale: saved?.scale, manual: saved?.manualAdjusted });
