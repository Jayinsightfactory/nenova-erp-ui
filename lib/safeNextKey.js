// lib/safeNextKey.js — MAX(Key)+1 안전 INSERT 헬퍼
// HOLDLOCK + UPDLOCK 으로 PK 충돌 방지

export async function safeNextShipmentDetailKey(tQ) {
  const locked = await tQ(
    `SELECT ISNULL(MAX(sd.SdetailKey),0) AS ActiveMax,
            ISNULL((SELECT MAX(h.SdetailKey) FROM dbo.ShipmentHistory h WITH (UPDLOCK,HOLDLOCK)),0) AS HistoryMax,
            ISNULL((SELECT kn.LastKeyNo FROM dbo.KeyNumbering kn WITH (UPDLOCK,HOLDLOCK)
                     WHERE kn.Category=N'ShipmentDetailKey'),0) AS NumberingMax
       FROM dbo.ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK);`,
    {},
  );
  const row = locked.recordset?.[0] || {};
  const ceilings = ['ActiveMax','HistoryMax','NumberingMax'].map((name) => {
    if (!Object.prototype.hasOwnProperty.call(row,name)) {
      throw new Error(`missing ShipmentDetail key ceiling: ${name}`);
    }
    const value = row[name];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid ShipmentDetail key ceiling: ${name}`);
    }
    return value;
  });
  const key = Math.max(...ceilings) + 1;
  if (!Number.isSafeInteger(key) || key <= 0 || key > 2147483647) {
    throw new Error('invalid ShipmentDetail key allocation result');
  }
  await tQ(
    `IF EXISTS (SELECT 1 FROM dbo.KeyNumbering WITH (UPDLOCK,HOLDLOCK)
                 WHERE Category=N'ShipmentDetailKey')
       UPDATE dbo.KeyNumbering SET LastKeyNo=${key} WHERE Category=N'ShipmentDetailKey'
     ELSE
       INSERT dbo.KeyNumbering(Category,LastKeyNo,Descr)
       VALUES(N'ShipmentDetailKey',${key},N'');`,
    {},
  );
  return key;
}

export async function safeNextKey(tQ, table, keyCol) {
  if (table === 'ShipmentDetail' && keyCol === 'SdetailKey') {
    return safeNextShipmentDetailKey(tQ);
  }
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`,
    {}
  );
  return r.recordset[0].nk;
}

export function isPkCollision(e) {
  return e?.number === 2627 || e?.number === 2601 || /PRIMARY KEY|duplicate key|UNIQUE/i.test(e?.message || '');
}

export async function tryInsertWithRetry(tQ, table, keyCol, buildInsert, maxRetry = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt += 1) {
    const key = await safeNextKey(tQ, table, keyCol);
    try {
      await buildInsert(key);
      return key;
    } catch (e) {
      lastErr = e;
      if (isPkCollision(e)) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`${table} INSERT 재시도 실패`);
}

export async function syncKeyNumbering(tQ, category, table, keyCol) {
  const allowed = {
    OrderMasterKey: ['OrderMaster', 'OrderMasterKey'],
    OrderDetailKey: ['OrderDetail', 'OrderDetailKey'],
    ShipmentMasterKey: ['ShipmentMaster', 'ShipmentKey'],
    ShipmentDetailKey: ['ShipmentDetail', 'SdetailKey'],
  };
  const [safeTable, safeKeyCol] = allowed[category] || [];
  if (safeTable !== table || safeKeyCol !== keyCol) throw new Error('invalid key numbering sync target');
  const safeCategory = String(category).replace(/'/g, "''");

  await tQ(
    `IF EXISTS (SELECT 1 FROM KeyNumbering WHERE Category=N'${safeCategory}')
       UPDATE KeyNumbering
          SET LastKeyNo = CASE WHEN LastKeyNo < x.MaxKey THEN x.MaxKey ELSE LastKeyNo END
         FROM KeyNumbering
         CROSS JOIN (SELECT ISNULL(MAX(${keyCol}),0) AS MaxKey FROM ${table}) x
        WHERE Category=N'${safeCategory}'
     ELSE
       INSERT INTO KeyNumbering (Category, LastKeyNo, Descr)
       SELECT N'${safeCategory}', ISNULL(MAX(${keyCol}),0), '' FROM ${table}`,
    {}
  );
}
