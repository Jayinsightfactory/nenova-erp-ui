const assert = require('node:assert/strict');

async function main() {
  const { findUnsafeSqlBlocks } = await import('../scripts/check-erp-write-contracts.mjs');

  const unsafeReuse = `const q = \`SELECT TOP 1 OrderMasterKey
    FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
    WHERE CustKey=@ck AND OrderWeek=@wk\`;`;
  assert.equal(findUnsafeSqlBlocks(unsafeReuse).length, 1, '연도 없는 Master 재사용 쿼리를 차단');

  const unsafeUnlockedReuse = `const q = \`SELECT OrderMasterKey FROM OrderMaster
    WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0\`;`;
  assert.equal(findUnsafeSqlBlocks(unsafeUnlockedReuse).length, 1, '잠금이 빠진 연도 없는 Master key 재사용도 차단');

  const safeReuse = `const q = \`SELECT TOP 1 OrderMasterKey
    FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
    WHERE CustKey=@ck AND OrderYear=@yr AND OrderWeek=@wk\`;`;
  assert.equal(findUnsafeSqlBlocks(safeReuse).length, 0, '연도 포함 Master 재사용 쿼리는 허용');

  const unsafeInsert = `const q = \`INSERT INTO ShipmentMaster
    (ShipmentKey, OrderWeek, CustKey) VALUES (@sk,@wk,@ck)\`;`;
  assert.equal(findUnsafeSqlBlocks(unsafeInsert).length, 1, '연도 없는 Master INSERT를 차단');

  const primaryKeyScoped = `const q = \`SELECT ShipmentKey, OrderWeek
    FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
    WHERE ShipmentKey=@sk /* ERP_YEAR_SCOPE: primary-key */\`;`;
  assert.equal(findUnsafeSqlBlocks(primaryKeyScoped).length, 0, '명시적 PK 스코프 예외는 허용');

  console.log('ERP write scope guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
