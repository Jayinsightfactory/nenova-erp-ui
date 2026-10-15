// Read-only response hydration for saved paste aliases. Identity remains the
// stored ERP key; names are copied only from that exact active master row.
function positiveKey(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const key = Number(value);
  return Number.isSafeInteger(key) && key > 0 ? key : null;
}

export function mappingKeys(mappings, field) {
  return [...new Set(Object.values(mappings || {}).map(value => positiveKey(value?.[field])).filter(Boolean))];
}

function activeMasterIndex(rows, keyField) {
  const index = new Map();
  for (const row of rows || []) {
    const key = positiveKey(row?.[keyField]);
    if (key && Number(row.isDeleted || 0) === 0) index.set(key, row);
  }
  return index;
}

export function hydrateCustomerMappings(mappings, customers) {
  const index = activeMasterIndex(customers, 'CustKey');
  return Object.fromEntries(Object.entries(mappings || {}).map(([alias, value]) => {
    const current = index.get(positiveKey(value?.custKey));
    return [alias, current && typeof current.CustName === 'string'
      ? { ...value, custName: current.CustName }
      : value];
  }));
}

export function hydrateProductMappings(mappings, products) {
  const index = activeMasterIndex(products, 'ProdKey');
  return Object.fromEntries(Object.entries(mappings || {}).map(([alias, value]) => {
    const current = index.get(positiveKey(value?.prodKey));
    return [alias, current && typeof current.ProdName === 'string'
      ? { ...value, prodName: current.ProdName,
        // SQL NULL is meaningful: it clears a stale saved display name.
        displayName: current.DisplayName === null || typeof current.DisplayName === 'string'
          ? current.DisplayName : value.displayName }
      : value];
  }));
}

async function readActiveNames(query, sql, ids, table, keyColumn, nameColumns) {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const params = Object.fromEntries(chunk.map((id, index) => [`id${index}`, { type: sql.Int, value: id }]));
    const placeholders = chunk.map((_, index) => `@id${index}`).join(',');
    const result = await query(
      `SELECT ${keyColumn}, ${nameColumns} FROM ${table}
        WHERE isDeleted=0 AND ${keyColumn} IN (${placeholders})`, params);
    rows.push(...(result.recordset || []));
  }
  return rows;
}

export function readActiveCustomerNames(query, sql, mappings) {
  return readActiveNames(query, sql, mappingKeys(mappings, 'custKey'), 'Customer', 'CustKey', 'CustName');
}

export function readActiveProductNames(query, sql, mappings) {
  return readActiveNames(query, sql, mappingKeys(mappings, 'prodKey'), 'Product', 'ProdKey', 'ProdName, DisplayName');
}
