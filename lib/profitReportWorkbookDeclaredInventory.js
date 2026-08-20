// 2026년 29~31차 재고수정 양식에서, 재고잔량 수량 없이 본표 기말상품재고액만 수기로 적힌 값.
// ProductStock 수량이 0이어도 금액이 있으면 실제 재고로 본다(2026-08-20 사용자 확정).
// 22~28차 historical F와 분리한다. 다른 연도로 전파하지 않는다.
const DECLARED_CLOSING_INVENTORY = {
  2026: {
    31: {
      fileHash: '56a5fdd4f12b65edc253d09820baedc172081e0cb2f83df38a443328a69c9556',
      sourceFile: '매출원가 양식 - 31차_재고수정.xlsx',
      categories: {
        네덜란드: { value: 2923273.166, sourceCell: 'F12' },
        태국: { value: 1149859.79, sourceCell: 'F14' },
        중국: { value: 1813712.94, sourceCell: 'F15' },
        에콰도르: { value: 3485942, sourceCell: 'F16' },
      },
    },
  },
};

export function getWorkbookDeclaredInventory(orderYear, major, category) {
  const year = String(orderYear || '');
  const week = String(Number(major || 0));
  const key = String(category || '');
  const entry = DECLARED_CLOSING_INVENTORY[year]?.[week]?.categories?.[key];
  if (!entry || !Number.isFinite(Number(entry.value))) return null;
  const file = DECLARED_CLOSING_INVENTORY[year][week];
  return {
    value: Number(entry.value),
    status: 'VERIFIED_DECLARED_INVENTORY',
    sourceRef: `workbook-sha256:${file.fileHash}#주차별 매출이익 보고서!${entry.sourceCell}`,
    sourceFile: file.sourceFile,
    sourceSheet: '주차별 매출이익 보고서',
    sourceCell: entry.sourceCell,
  };
}

/** 저장된 선언 금액이 있으면 그걸 쓰고, 없으면 해당 연도·차수 workbook 수기 F를 쓴다. */
export function resolveDeclaredInventoryAmount({
  orderYear, major, category, manualValue, manualSourceRef,
} = {}) {
  if (manualValue != null && Number.isFinite(Number(manualValue))) {
    return {
      value: Number(manualValue),
      status: 'VERIFIED_DECLARED_INVENTORY',
      sources: [manualSourceRef || `manual-declared-inventory:${orderYear}:${major}:${category}`],
    };
  }
  const workbook = getWorkbookDeclaredInventory(orderYear, major, category);
  if (!workbook) return null;
  return {
    value: workbook.value,
    status: workbook.status,
    sources: [workbook.sourceRef],
  };
}
