// 상단 원가 계산기(.xlsx 생성) ↔ /arrival-cost 업로드 검토 패널(ArrivalUploadReview) 원클릭 브릿지.
// 운영 DB 직접 저장(INSERT/UPDATE)을 자동 수행하지 않으며, 생성된 .xlsx 바이트를
// 기존 검증 업로드 패널(preview 단계 · dbWrites: 0)로 즉시 전달해 사용자가 검토 후 저장하게 한다.

export const ARRIVAL_UPLOAD_BRIDGE_KEY = 'nenova.arrivalCost.uploadBridge.v1';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SESSION_BYTES = 3.5 * 1024 * 1024;

const COUNTRY_KO_BY_CODE = {
  CO: '콜롬비아',
  NL: '네덜란드',
  CN: '중국',
  EC: '에콰도르',
  TH: '태국',
  VN: '베트남',
  AU: '호주',
  US: '미국',
  NZ: '뉴질랜드',
};

export function arrivalBridgeCountryLabel(country = '') {
  const raw = String(country || '').trim();
  if (!raw) return '';
  return COUNTRY_KO_BY_CODE[raw.toUpperCase()] || raw;
}

export function toArrivalXlsxFile(blob, fileName) {
  const safeName = /\.xlsx?$/i.test(String(fileName || ''))
    ? String(fileName)
    : `${String(fileName || '도착원가_계산본')}.xlsx`;
  if (typeof File === 'function') {
    return new File([blob], safeName, { type: XLSX_MIME });
  }
  return Object.assign(blob, { name: safeName });
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sendWorkbookToArrivalUploadReview({
  blob,
  fileName,
  orderYear = '',
  orderWeek = '',
  country = '',
  onSendToUploadReview = null,
} = {}) {
  if (!blob) throw new Error('전달할 원가 엑셀 데이터가 없습니다.');
  const countryLabel = arrivalBridgeCountryLabel(country);
  const file = toArrivalXlsxFile(blob, fileName);
  const payload = {
    id: Date.now(),
    file,
    fileName: file.name,
    orderYear: String(orderYear || ''),
    orderWeek: String(orderWeek || ''),
    country: countryLabel,
  };
  if (typeof onSendToUploadReview === 'function') {
    onSendToUploadReview(payload);
    return { mode: 'inline', fileName: file.name };
  }
  if (typeof window !== 'undefined') {
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength <= MAX_SESSION_BYTES && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(ARRIVAL_UPLOAD_BRIDGE_KEY, JSON.stringify({
          fileName: file.name,
          base64: bytesToBase64(new Uint8Array(buffer)),
          orderYear: payload.orderYear,
          orderWeek: payload.orderWeek,
          country: payload.country,
          createdAt: Date.now(),
        }));
        const qs = new URLSearchParams({ bridgeUpload: '1' });
        if (payload.orderYear) qs.set('orderYear', payload.orderYear);
        if (payload.orderWeek) qs.set('orderWeek', payload.orderWeek);
        window.location.assign(`/arrival-cost?${qs}#arrival-upload-section`);
        return { mode: 'redirect', fileName: file.name };
      } catch {
        // sessionStorage 용량 초과 시 아래 다운로드 안내로 폴백
      }
    }
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    window.location.assign('/arrival-cost#arrival-upload-section');
    return { mode: 'download-fallback', fileName: file.name };
  }
  return { mode: 'noop', fileName: file.name };
}

export function consumePendingArrivalUploadBridge() {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  const raw = window.sessionStorage.getItem(ARRIVAL_UPLOAD_BRIDGE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(ARRIVAL_UPLOAD_BRIDGE_KEY);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.base64 || !parsed?.fileName) return null;
    if (parsed.createdAt && Date.now() - Number(parsed.createdAt) > 15 * 60 * 1000) return null;
    const bytes = base64ToBytes(parsed.base64);
    const blob = new Blob([bytes], { type: XLSX_MIME });
    const file = toArrivalXlsxFile(blob, parsed.fileName);
    return {
      id: Date.now(),
      file,
      fileName: file.name,
      orderYear: String(parsed.orderYear || ''),
      orderWeek: String(parsed.orderWeek || ''),
      country: String(parsed.country || ''),
    };
  } catch {
    return null;
  }
}
