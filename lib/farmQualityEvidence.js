export const QUALITY_EVIDENCE_MAX_FILES = 5;
export const QUALITY_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function normalizeEvidenceKeys(values) {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error('증거 이미지 목록을 다시 확인하세요.');
  const keys = [...new Set(values.map(value => String(value || '').toLowerCase()))];
  if (keys.length > QUALITY_EVIDENCE_MAX_FILES) throw new Error(`증거 이미지는 한 기록에 최대 ${QUALITY_EVIDENCE_MAX_FILES}장까지 첨부할 수 있습니다.`);
  if (keys.some(key => !uuid.test(key))) throw new Error('증거 이미지 식별값이 올바르지 않습니다.');
  return keys;
}

export function detectEvidenceImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export function evidenceFileName(value, extension) {
  const base = String(value || 'clipboard-image')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, 170) || 'clipboard-image';
  return `${base}.${extension}`;
}
