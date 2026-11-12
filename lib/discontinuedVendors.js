// 거래가 끝난 거래처의 품목 표식. 품목명 앞의 [MEL], [오경] 처럼 대괄호로 붙는다.
// 이 품목은 자동 매칭·후보에서 빼서, 현행 품목이 있으면 그쪽으로 연결되게 한다(원문에 같은 표식이 있으면 예외).
// 거래처가 더 끊기면 여기에만 추가한다.
export const DISCONTINUED_VENDOR_TAGS = Object.freeze(['MEL', '오경']);

const tagOf = value => String(value ?? '').match(/^\s*\[([^\]]+)\]/)?.[1]?.trim().toLowerCase() || '';
const ended = new Set(DISCONTINUED_VENDOR_TAGS.map(tag => tag.toLowerCase()));

/** 이름이 거래 종료 거래처 표식([MEL] 등)으로 시작하는가 */
export const isDiscontinuedVendorName = value => ended.has(tagOf(value));

/** 원문이 같은 표식을 직접 적었으면 그 거래처 품목을 허용한다. */
export function allowsDiscontinuedProduct(rawName, productName) {
  return !isDiscontinuedVendorName(productName) || tagOf(rawName) === tagOf(productName);
}
