// 품목 검색 후보 정렬 — DB 품목명 일치도 + 실제 사용량
//
// 이 모듈은 브라우저와 API 양쪽에서 사용할 수 있도록 DB/파일 의존성을 두지 않는다.
// 사용량은 OrderDetail 집계(UsageCount/orderCount)와 기존 매칭 집계(MappingCount)를
// 전달받아 사용한다. 품목명 일치도가 먼저 후보를 제한하고, 비슷한 후보 안에서
// 실제 업무 사용 빈도가 높은 품목을 앞에 배치한다.

import { getDisplayName, getEnglishOf, scoreMatch, tokenizeForMatch } from './displayName.js';

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function usageRank(product) {
  const usageCount = Number(product?.UsageCount ?? product?.usageCount ?? product?.orderCount ?? 0) || 0;
  const recentUsageCount = Number(product?.RecentUsageCount ?? product?.recentUsageCount ?? 0) || 0;
  const mappingCount = Number(product?.MappingCount ?? product?.mappingCount ?? 0) || 0;
  return {
    usageCount,
    recentUsageCount,
    mappingCount,
    // 최근 업무 사용량은 같은 품목이 오래된 데이터만 많은 경우를 보정한다.
    rank: usageCount + recentUsageCount * 2 + mappingCount * 2,
  };
}

function productText(product) {
  return [
    product?.ProdName,
    product?.DisplayName,
    product?.FlowerName,
    product?.CounName,
    product?.label,
    product?.sub,
    product?.ProdCode,
  ].filter(Boolean).join(' ');
}

function directMatch(query, product) {
  const wanted = compact(query);
  if (!wanted) return false;
  const text = compact(productText(product));
  return text.includes(wanted);
}

const GENERIC_ALIASES = new Set([
  'rose', 'carnation', 'hydrangea', 'lily', 'tulip', 'ruscus', 'lisianthus',
  'alstro', 'alstroemeria', 'gerbera', '장미', '카네이션', '수국', '백합',
  '튤립', '루스커스', '리시안셔스', '알스트로', '거베라', 'colombia',
  'china', 'netherlands', 'holland', 'ecuador', 'australia', '태국',
  '베트남', '호주', '중국', '콜롬비아', '네덜란드', '에콰도르',
]);

function hasDirectAlias(query, product) {
  const groups = tokenizeForMatch(query)
    .map((token) => [...new Set([token, getEnglishOf(token)].filter(Boolean).map(compact))])
    .filter((group) => group.length);
  if (!groups.length) return true;
  const target = compact(productText(product));
  const meaningful = groups.filter((group) => group.some((alias) => !GENERIC_ALIASES.has(alias)));
  const required = meaningful.length ? meaningful : groups;
  return required.every((group) => group.some((alias) => target.includes(alias)));
}

/**
 * 품목 후보를 기존 주문등록 매칭과 같은 방향으로 정렬한다.
 *
 * - 빈 검색어: 실제 사용량이 높은 품목부터 표시
 * - 검색어 있음: 일치도(`scoreMatch`)를 기본으로 하고, 유사 후보의 동률을
 *   실제 사용량·최근 사용량·저장 매핑 빈도로 해소
 * - 영문/한글 자연어 매칭은 `displayName.scoreMatch`에 위임
 */
export function rankProductSearchOptions(query, options = [], { limit = 200 } = {}) {
  const keyword = String(query || '').trim();
  const scored = (options || []).map((option, index) => {
    const product = option?.__product || option;
    const usage = usageRank(product);
    const matchScore = keyword ? scoreMatch(keyword, product, '') : 0;
    const isDirect = keyword ? directMatch(keyword, product) : true;
    const popularity = Math.min(30, Math.log10(usage.rank + 1) * 10);
    const exactBonus = keyword && compact(getDisplayName(product)) === compact(keyword) ? 16 : 0;
    return {
      option,
      index,
      usage,
      matchScore,
      isDirect,
      rankScore: keyword
        ? matchScore + popularity + exactBonus
        : popularity,
    };
  });

  const filtered = keyword
    ? scored.filter((item) => item.isDirect || item.matchScore > 0)
    : scored;
  // 직접 별칭이 있는 후보가 하나라도 있으면 `문라이트`와 `Candlelight`처럼
  // 글자 일부만 겹치는 퍼지 후보는 결과에서 제외한다. 직접 후보가 없을 때만
  // 오타 검색을 위해 퍼지 점수 결과를 그대로 사용한다.
  const direct = keyword ? filtered.filter((item) => hasDirectAlias(keyword, item.option?.__product || item.option)) : filtered;
  const ranked = keyword && direct.length ? direct : filtered;

  return ranked
    .sort((a, b) => b.rankScore - a.rankScore
      || b.matchScore - a.matchScore
      || b.usage.rank - a.usage.rank
      || b.usage.usageCount - a.usage.usageCount
      || String(a.option?.label || a.option?.ProdName || '').localeCompare(
        String(b.option?.label || b.option?.ProdName || ''), 'ko')
      || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.option);
}
