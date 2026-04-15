// lib/chat/disambiguation.js — 모호 토큰 객관식 응답 (핸들러 공용)
//
// order / shipment / stock 등 여러 핸들러가 공통으로 사용한다.
// 사용자 메시지에 "네덜란드" 처럼 여러 의미 (거래처/원산지/지역) 로 해석 가능한
// 토큰이 있으면 객관식 카드 메시지를 반환, 없으면 null 반환.
//
// 반환값:
//   null                     → 모호하지 않음, 호출자는 원래 로직 진행
//   { messages: [...] }       → 객관식 카드 응답 (그대로 사용자에게 전달)

import { findAmbiguousTokens } from './catalog';
import { extractWeekDetail } from './router';

export async function buildDisambiguationForText(text, { intent, extraPayload = {} } = {}) {
  const ambigList = await findAmbiguousTokens(text);
  const realAmbig = ambigList.find(a => a.ambiguityCount >= 2);
  if (!realAmbig) return null;

  const wd = extractWeekDetail(text);
  const weekStr = wd?.exact ? wd.week : null;
  const majorWk = wd?.major || null;
  const weekTag = weekStr || (majorWk ? `${majorWk}차` : null);

  const { token, asCustomerName, asCustomerArea, asProductCountry, asProductFlower } = realAmbig;
  const choices = [];

  if (asCustomerName.length > 0) {
    choices.push({
      label: `🏢 거래처 "${token}" 의 ${labelFor(intent)}`,
      sub:   `이름에 "${token}" 포함된 거래처 ${asCustomerName.length}곳`,
      text:  `${token} ${weekTag || ''} ${nounFor(intent)}`.trim(),
      payload: {
        intent, scope: 'customer',
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...extraPayload,
      },
    });
  }
  if (asCustomerArea.length > 0 && asCustomerName.length === 0) {
    choices.push({
      label: `📍 지역 "${token}" 거래처들의 ${labelFor(intent)}`,
      sub:   `소재지=${token} 거래처 ${asCustomerArea.length}곳`,
      text:  `${token} 지역 ${weekTag || ''} ${nounFor(intent)}`.trim(),
      payload: {
        intent, scope: 'customer',
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...extraPayload,
      },
    });
  }
  if (asProductCountry) {
    choices.push({
      label: `🌍 원산지 "${token}" 인 꽃의 ${labelFor(intent)} (전체 합계)`,
      sub:   `해당 원산지 품목 ${asProductCountry.productCount}종`,
      text:  `${token}산 ${weekTag || ''} ${nounFor(intent)} 합계`.trim(),
      payload: {
        intent, scope: 'origin', country: asProductCountry.name,
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...extraPayload,
      },
    });
  }
  if (asProductFlower) {
    choices.push({
      label: `🌸 꽃 종류 "${token}" 의 ${labelFor(intent)}`,
      sub:   `해당 꽃 종류 품목 ${asProductFlower.productCount}종`,
      text:  `${token} ${weekTag || ''} 꽃 ${nounFor(intent)}`.trim(),
      payload: {
        intent, scope: 'flower', flower: asProductFlower.name,
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...extraPayload,
      },
    });
  }

  const promptParts = [];
  if (weekTag) promptParts.push(weekTag);
  promptParts.push(`"${token}" 의 의미`);

  return {
    messages: [
      {
        type: 'text',
        content: `🤔 "${token}" 가 여러 의미로 해석됩니다.\n어떤 데이터를 보여드릴까요?`,
      },
      { type: 'choices', prompt: promptParts.join(' · '), choices },
    ],
  };
}

function labelFor(intent) {
  switch (intent) {
    case 'order':    return '주문';
    case 'shipment': return '출고';
    case 'stock':    return '재고';
    case 'sales':    return '매출';
    default:         return '조회';
  }
}
function nounFor(intent) { return labelFor(intent); }
