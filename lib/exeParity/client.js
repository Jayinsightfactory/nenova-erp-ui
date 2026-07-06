/**
 * 프론트엔드 — exe parity API 호출 (기본 ON, 레거시는 exeParity=0)
 */
import { apiGet } from '../useApi.js';

export function apiGetExe(path, params = {}) {
  if (params.exeParity === '0' || params.exeParity === 'false') {
    return apiGet(path, params);
  }
  const { exeParity, ...rest } = params;
  return apiGet(path, rest);
}
