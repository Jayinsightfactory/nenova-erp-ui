// Explicit hotel-scoped mapping: only web settlement rows and parent audit change.
import { requirePnlPartner } from './pnlHotelRegistry.js';
import { normalizeShillaPnlProductMatchRequest, saveScopedPnlProductMatch } from './shillaPnlProductMatch.js';

export async function savePnlHotelProductMatch({ actor, ...raw }) {
  if (typeof raw.partnerCode !== 'string' || !raw.partnerCode.trim()) {
    const error = new Error('연결할 호텔을 명시해야 합니다.');
    error.statusCode = 400;
    error.code = 'PNL_PARTNER_REQUIRED';
    throw error;
  }
  const partner = await requirePnlPartner(raw.partnerCode);
  if (partner.code !== 'shilla' && partner.customHotel !== true) {
    const error = new Error('라움·초이문은 기존 품목 매칭 기능을 사용하세요.');
    error.statusCode = 400;
    error.code = 'PNL_HOTEL_MAPPING_SCOPE_INVALID';
    throw error;
  }
  const request = { ...normalizeShillaPnlProductMatchRequest({ ...raw, partnerCode: 'shilla' }), partnerCode: partner.code };
  return saveScopedPnlProductMatch(request, actor, tQuery => requirePnlPartner(partner.code, tQuery));
}
