// 데이터 소스 어댑터. ERP 원장과 ecount_work(이관 스냅샷)는 읽기만 한다.
// 이관 작업이 입출금·채권 스냅샷을 ecount_work.Head 에 적재하면 B군(입금대사·aging) 소스가 자동 확장된다.
import { query, sql } from '../db.js';
import { assertMgmtSqlReadOnlyOutsideSchema } from './boundary.js';

export const SOURCE = { ERP: 'erp', ECOUNT_WORK: 'ecount_work' };

async function readOnly(q, params) {
  assertMgmtSqlReadOnlyOutsideSchema(q);
  return query(q, params);
}

// ecount_work 활성 스냅샷 존재 여부(이관 측 스키마 변화에 느슨하게 대응: 없으면 false)
export async function ecountWorkHeadAvailable(menuId) {
  try {
    const r = await readOnly(
      `IF OBJECT_ID(N'ecount_work.Head', N'U') IS NULL SELECT CAST(0 AS BIT) AS ok
       ELSE SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM ecount_work.Head WHERE MenuId = @menuId) THEN 1 ELSE 0 END AS BIT) AS ok`,
      { menuId: { type: sql.NVarChar(100), value: menuId } },
    );
    return Boolean(r?.recordset?.[0]?.ok);
  } catch {
    return false;
  }
}

// 거래처 마스터(읽기). Customer.Descr 첫 '/' 앞 = 간판명.
export async function listCustomersBasic() {
  const r = await readOnly(
    `SELECT CustKey, CustName, Descr, Manager, Group1 FROM dbo.Customer WHERE ISNULL(isDeleted,0)=0 ORDER BY CustName`,
  );
  return (r?.recordset || []).map((row) => ({
    custKey: row.CustKey,
    custName: row.CustName,
    signboard: String(row.Descr || '').split('/')[0].trim() || row.CustName,
    manager: row.Manager,
    group1: row.Group1,
  }));
}

// 거래처 채권 잔액(읽기). /api/sales/ar 와 같은 원천을 쓰되 집계만 가져온다.
// NOTE: 실제 컬럼은 A군 ② 구현 시 /api/sales/ar 쿼리와 동일 원천으로 맞춘다(골든: 합계 일치).
export async function receivableSourceLabel() {
  return (await ecountWorkHeadAvailable('receivables')) ? SOURCE.ECOUNT_WORK : SOURCE.ERP;
}
