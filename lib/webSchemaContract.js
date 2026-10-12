import { query, sql } from './db.js';

const cache = new Map();

/** Runtime에서는 schema를 변경하지 않고 migration 적용 여부만 읽기 전용으로 확인한다. */
export function assertWebSchemaContract(contractId, requirements) {
  if (cache.has(contractId)) return cache.get(contractId);
  const checks = [];
  const params = {};
  let index = 0;
  for (const requirement of requirements) {
    const tableParam = `table${index}`;
    params[tableParam] = { type: sql.NVarChar, value: `dbo.${requirement.table}` };
    checks.push(`SELECT @${tableParam} AS ObjectName, CASE WHEN OBJECT_ID(@${tableParam}, N'U') IS NULL THEN 0 ELSE 1 END AS ExistsFlag`);
    for (const column of requirement.columns || []) {
      const columnParam = `column${index}`;
      params[columnParam] = { type: sql.NVarChar, value: column };
      checks.push(`SELECT @${tableParam} + N'.' + @${columnParam} AS ObjectName, CASE WHEN COL_LENGTH(@${tableParam}, @${columnParam}) IS NULL THEN 0 ELSE 1 END AS ExistsFlag`);
      index += 1;
    }
    index += 1;
  }
  const promise = query(checks.join('\nUNION ALL\n'), params).then(result => {
    const rows = (result.recordsets || []).flat().length ? (result.recordsets || []).flat() : (result.recordset || []);
    const missing = rows.filter(row => Number(row.ExistsFlag) !== 1).map(row => row.ObjectName);
    if (missing.length) {
      const error = new Error(`필수 migration이 적용되지 않았습니다: ${missing.join(', ')}`);
      error.code = 'MIGRATION_REQUIRED';
      error.statusCode = 503;
      error.contractId = contractId;
      throw error;
    }
    return true;
  }).catch(error => { cache.delete(contractId); throw error; });
  cache.set(contractId, promise);
  return promise;
}

export function clearWebSchemaContractCache() { cache.clear(); }
