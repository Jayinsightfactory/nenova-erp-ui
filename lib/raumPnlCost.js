// 라움 품목별 수기 원가 학습. 결산 원장 저장과 분리해 다차수 원장 transaction의
// 허용 쓰기 범위를 WebRaumPnl/WebRaumPnlItem으로 고정한다.
import { query, sql } from './db';

export async function learnManualRaumCost(tQuery, { itemName, costPrice, actor }) {
  await tQuery(
    `MERGE WebRaumCostPrice AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
     WHEN MATCHED THEN UPDATE SET CostPrice=@c, UpdatedBy=@actor, UpdatedAt=GETDATE()
     WHEN NOT MATCHED THEN INSERT (ItemName, CostPrice, UpdatedBy) VALUES (@n, @c, @actor);`,
    {
      n: { type: sql.NVarChar, value: itemName }, c: { type: sql.Float, value: costPrice },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
}

export async function saveRaumConsignedRecord(key, consigned, actor) {
  if (!consigned) {
    await query(`DELETE FROM WebRaumConsignedItem WHERE ItemName=@n`, { n: { type: sql.NVarChar, value: key } });
    return { removed: true };
  }
  await query(
    `MERGE WebRaumConsignedItem AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
     WHEN MATCHED THEN UPDATE SET UpdatedBy=@actor, UpdatedAt=GETDATE()
     WHEN NOT MATCHED THEN INSERT (ItemName, UpdatedBy) VALUES (@n, @actor);`,
    { n: { type: sql.NVarChar, value: key }, actor: { type: sql.NVarChar, value: actor || 'user' } }
  );
  return { consigned: true };
}

export async function saveRaumItemMapRecord(key, prodKey, actor) {
  if (prodKey == null) {
    await query(`DELETE FROM WebRaumItemMap WHERE ItemName=@n`, { n: { type: sql.NVarChar, value: key } });
    return { removed: true };
  }
  const prod = await query(
    `SELECT ProdKey, ProdName FROM Product WHERE ProdKey=@pk AND isDeleted=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } }
  );
  if (!prod.recordset[0]) throw new Error(`ProdKey=${prodKey} 품목을 찾을 수 없습니다.`);
  await query(
    `MERGE WebRaumItemMap AS t USING (SELECT @n AS ItemName) AS s ON t.ItemName=s.ItemName
     WHEN MATCHED THEN UPDATE SET ProdKey=@pk, ProdName=@pn, UpdatedBy=@actor, UpdatedAt=GETDATE()
     WHEN NOT MATCHED THEN INSERT (ItemName, ProdKey, ProdName, UpdatedBy) VALUES (@n, @pk, @pn, @actor);`,
    {
      n: { type: sql.NVarChar, value: key }, pk: { type: sql.Int, value: Number(prodKey) },
      pn: { type: sql.NVarChar, value: String(prod.recordset[0].ProdName || '').slice(0, 200) },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
  return { prodKey: Number(prodKey), prodName: prod.recordset[0].ProdName };
}
