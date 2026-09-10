const EPSILON = 1e-6;
const FULL_WEEK_RE = /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
const ISO_WITH_TIMEZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveKey(value) {
  return Number.isInteger(value) && value > 0;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function timestamp(value) {
  if (typeof value !== 'string' || !ISO_WITH_TIMEZONE_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validUnit(value) {
  return typeof value === 'string' && value.length > 0;
}

function validTopLevel(input) {
  return /^20\d{2}$/.test(input.year || '')
    && Array.isArray(input.weeks)
    && input.weeks.length > 0
    && input.weeks.every(week => typeof week === 'string' && FULL_WEEK_RE.test(week));
}

function expectedDelta(request) {
  if (!isFiniteNumber(request?.qty) || request.qty <= 0) return null;
  if (request.action === 'ADD') return request.qty;
  if (request.action === 'CANCEL') return -request.qty;
  return null;
}

function requestProblem(request, input, asOf) {
  if (input.asOf !== undefined && input.asOf !== null && asOf === null) return '기준 시각 형식이 올바르지 않아 이력 증거를 비교할 수 없습니다.';
  if (!validTopLevel(input)) return '비교 연도 또는 전체 차수 범위가 올바르지 않습니다.';
  if (typeof request?.id !== 'string' || request.id.length === 0) return '요청 식별자가 올바르지 않습니다.';
  if (typeof request.sourceIdentity !== 'string' || request.sourceIdentity.length === 0) return '원본 식별자가 올바르지 않습니다.';
  if (request.year !== input.year || !input.weeks.includes(request.week)) return '요청의 연도 또는 전체 차수가 비교 범위와 정확히 일치하지 않습니다.';
  if (!isPositiveKey(request.custKey) || !isPositiveKey(request.prodKey)) return '양수 업체·품목 키가 있어야 이력 증거를 비교할 수 있습니다.';
  if (request.mappingConfirmed !== true) return '매핑 확인 전에는 이력 증거를 비교할 수 없습니다.';
  if (expectedDelta(request) === null) return '동작과 수량은 유효한 ADD/CANCEL 및 양수 유한 수량이어야 합니다.';
  if (!validUnit(request.unit)) return '명시적인 단위가 있어야 이력 증거를 비교할 수 있습니다.';
  if (timestamp(request.sourceAt) === null) return '원본 시각은 시간대가 포함된 ISO 형식이어야 합니다.';
  if (request.timestamp_approximate === true) return '원본 시각이 근사값이어서 이력 증거를 자동 일치로 판정할 수 없습니다.';
  if (request.shipmentDate !== null && !isCalendarDate(request.shipmentDate)) return '출고일은 YYYY-MM-DD 형식이거나 비어 있어야 합니다.';
  return null;
}

function isHistoryCandidate(history, request, input, sourceAt, asOf) {
  if (!history || history.year !== input.year || history.week !== request.week) return false;
  if (!isPositiveKey(history.custKey) || !isPositiveKey(history.prodKey)) return false;
  if (history.custKey !== request.custKey || history.prodKey !== request.prodKey || history.unit !== request.unit) return false;
  if (typeof history.eventId !== 'string' || history.eventId.length === 0 || !validUnit(history.unit) || !isCalendarDate(history.shipmentDate)) return false;
  if (!isFiniteNumber(history.before) || !isFiniteNumber(history.after)) return false;
  const changeAt = timestamp(history.changeAt);
  if (changeAt === null || changeAt < sourceAt || (asOf !== null && changeAt > asOf)) return false;
  return request.shipmentDate === null || history.shipmentDate === request.shipmentDate;
}

function resultFor(request) {
  return {
    id: typeof request?.id === 'string' ? request.id : null,
    sourceIdentity: typeof request?.sourceIdentity === 'string' ? request.sourceIdentity : null,
    advisoryOnly: true,
    status: 'NEEDS_REVIEW',
    reasonKorean: '',
    candidateEventIds: [],
    expectedDelta: expectedDelta(request),
  };
}

function compareDistributionChanges(rawInput) {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const requests = Array.isArray(input.requests) ? input.requests : [];
  const history = Array.isArray(input.history) ? input.history : [];
  const asOf = input.asOf === undefined || input.asOf === null ? null : timestamp(input.asOf);
  const results = requests.map(resultFor);
  const duplicateIds = new Set();
  const idCounts = new Map();

  for (const request of requests) {
    if (typeof request?.id === 'string' && request.id.length) idCounts.set(request.id, (idCounts.get(request.id) || 0) + 1);
  }
  for (const [id, count] of idCounts) if (count > 1) duplicateIds.add(id);

  const candidateClaims = new Map();
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const result = results[index];
    const problem = requestProblem(request, input, asOf);
    if (problem) {
      result.reasonKorean = problem;
      continue;
    }
    const sourceAt = timestamp(request.sourceAt);
    const candidates = history.filter(event => isHistoryCandidate(event, request, input, sourceAt, asOf));
    result.candidateEventIds = candidates.map(event => event.eventId);
    result._candidates = candidates;
    for (const event of candidates) {
      const claims = candidateClaims.get(event.eventId) || [];
      claims.push(index);
      candidateClaims.set(event.eventId, claims);
    }
    if (duplicateIds.has(request.id)) {
      result.status = 'AMBIGUOUS';
      result.reasonKorean = '동일한 요청 식별자가 반복되어 이력 증거를 하나의 요청에 연결할 수 없습니다.';
      continue;
    }
    if (request.shipmentDate === null && candidates.length > 0) {
      result.status = 'NEEDS_REVIEW';
      result.reasonKorean = '출고일 지정이 없어 같은 수량 이력만 참고';
      continue;
    }
    if (candidates.length === 0) {
      if (input.historyComplete === true) {
        result.status = 'NO_MATCHING_HISTORY';
        result.reasonKorean = '완전한 이력 범위에서 일치하는 이력 증거를 찾지 못했습니다. 이 결과만으로 삭제·고아 이력을 판단할 수는 없습니다.';
      } else {
        result.status = 'NEEDS_REVIEW';
        result.reasonKorean = '이력 범위가 완전하다고 확인되지 않아 일치하는 이력 증거의 부재를 판단할 수 없습니다.';
      }
      continue;
    }
    if (candidates.length > 1) {
      result.status = 'AMBIGUOUS';
      const dates = new Set(candidates.map(event => event.shipmentDate));
      result.reasonKorean = request.shipmentDate === null && dates.size > 1
        ? '출고일이 없는 요청에 서로 다른 출고일의 이력 증거가 있어 임의로 합치지 않습니다.'
        : '여러 이력 증거가 있어 임의로 합치거나 하나를 선택하지 않습니다.';
      continue;
    }
    const delta = candidates[0].after - candidates[0].before;
    if (Math.abs(delta - result.expectedDelta) <= EPSILON) {
      result.status = 'MATCHING_HISTORY';
      result.reasonKorean = '동일한 이력 증거가 있으나 실제 적용 또는 완료를 뜻하지 않습니다.';
    } else if (delta * result.expectedDelta > EPSILON * EPSILON && Math.abs(delta) < Math.abs(result.expectedDelta) - EPSILON) {
      result.status = 'PARTIAL_HISTORY';
      result.reasonKorean = '같은 방향의 일부 이력 증거만 있으며 실제 적용 또는 완료를 뜻하지 않습니다.';
    } else {
      result.status = 'NEEDS_REVIEW';
      result.reasonKorean = '이력 변화량이 요청 변화량과 정확히 일치하지 않아 검토가 필요합니다.';
    }
  }

  for (const [eventId, indexes] of candidateClaims) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      results[index].status = 'AMBIGUOUS';
      results[index].reasonKorean = `이력 증거 ${eventId}가 둘 이상의 요청에 연결되어 하나의 요청을 증명할 수 없습니다.`;
    }
  }

  return results.map(result => {
    delete result._candidates;
    return result;
  });
}

module.exports = { EPSILON, compareDistributionChanges };
