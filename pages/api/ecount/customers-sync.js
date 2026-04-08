// pages/api/ecount/customers-sync.js
// GET:  이카운트 거래처 목록 조회
// POST: 거래처 이카운트에 등록/업데이트
// Body: { custKeys: [1,2,3] } OR { all: true }

import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query, sql } from '../../../lib/db';
import { ecountPost, isConfigured } from '../../../lib/ecount';

async function ensureSyncLog() {
  await query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EcountSyncLog' AND xtype='U')
    CREATE TABLE EcountSyncLog (
      LogKey     INT IDENTITY PRIMARY KEY,
      SyncType   NVARCHAR(50),
      RefKey     INT,
      EcountRef  NVARCHAR(100),
      SyncDtm    DATETIME DEFAULT GETDATE(),
      SyncStatus NVARCHAR(20),
      ErrorMsg   NVARCHAR(500)
    )
  `);
}

async function writeSyncLog(syncType, refKey, ecountRef, status, errorMsg) {
  try {
    await query(
      `INSERT INTO EcountSyncLog (SyncType, RefKey, EcountRef, SyncStatus, ErrorMsg)
       VALUES (@syncType, @refKey, @ecountRef, @status, @errorMsg)`,
      {
        syncType:  { type: sql.NVarChar, value: syncType  || '' },
        refKey:    { type: sql.Int,      value: refKey    || null },
        ecountRef: { type: sql.NVarChar, value: (ecountRef || '').toString().slice(0, 100) },
        status:    { type: sql.NVarChar, value: status    || '' },
        errorMsg:  { type: sql.NVarChar, value: (errorMsg || '').toString().slice(0, 500) },
      }
    );
  } catch (e) {
    console.error('EcountSyncLog write error:', e.message);
  }
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({
      success: false,
      error:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요.',
    });
  }

  // ── GET: 이카운트 거래처 목록 조회 ─────────────────────────
  if (req.method === 'GET') {
    try {
      // AccountBasic/GetBasicCustList - 기본 거래처 목록 조회
      const ecountRes = await ecountPost('AccountBasic/GetBasicCustList', {
        Conditions: { USE_YN: 'Y' },
      });

      if (String(ecountRes.Status) !== '200') {
        const msg = ecountRes.Error?.Message || ecountRes.Message || '조회 실패';
        return res.status(400).json({ success: false, error: msg, ecountResponse: ecountRes });
      }

      const customers = ecountRes.Data?.Result || ecountRes.Data || [];
      return res.status(200).json({
        success:   true,
        customers,
        total:     Array.isArray(customers) ? customers.length : 0,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── POST: 이카운트에 거래처 등록/업데이트 ─────────────────
  // 페이지네이션 방식: offset + limit 파라미터로 한 번에 limit건씩만 처리
  // 프론트엔드가 루프를 돌며 nextOffset이 null이 될 때까지 반복 호출
  if (req.method === 'POST') {
    await ensureSyncLog();

    const { custKeys, all, offset: rawOffset, limit: rawLimit } = req.body || {};
    const offset = parseInt(rawOffset) || 0;
    const limit  = parseInt(rawLimit)  || 20;  // 기본 한 번에 20건

    let whereClause = 'WHERE c.isDeleted = 0';
    const params    = {};

    if (all) {
      // 전체 활성 거래처
    } else if (Array.isArray(custKeys) && custKeys.length > 0) {
      const keyList = custKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
      whereClause  += ` AND c.CustKey IN (${keyList})`;
    } else {
      return res.status(400).json({ success: false, error: 'custKeys 또는 all: true 가 필요합니다.' });
    }

    // 전체 카운트 조회
    const countResult = await query(
      `SELECT COUNT(*) AS cnt FROM Customer c ${whereClause}`, params
    );
    const total = countResult.recordset[0]?.cnt || 0;

    if (total === 0) {
      return res.status(200).json({ success: true, synced: 0, failed: 0, total: 0, nextOffset: null, message: '동기화할 거래처가 없습니다.' });
    }

    // offset부터 limit건만 조회
    const result = await query(
      `SELECT c.CustKey, c.CustName, c.CustArea,
              ISNULL(c.OrderCode, '') AS OrderCode
       FROM Customer c
       ${whereClause}
       ORDER BY c.CustKey
       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      params
    );

    const customers = result.recordset;
    if (customers.length === 0) {
      return res.status(200).json({ success: true, synced: 0, failed: 0, total, nextOffset: null, message: '모든 거래처 처리 완료' });
    }

    // 이카운트 거래처 등록/수정 (AccountBasic/SaveBasicCust)
    // 구조: CustList에 flat 객체 배열 (Line/BulkDatas 래퍼 없이 직접 필드)
    const CustList = customers.map(c => ({
      CUST_CD:   c.OrderCode || `NV${String(c.CustKey).padStart(5, '0')}`,
      CUST_NAME: c.CustName,
      CUST_TYPE: 'S',
      CUST_DES:  c.CustArea || '',
      USE_YN:    'Y',
    }));

    let ecountResponse;
    let totalSuccess = 0;
    let totalFail    = 0;

    try {
      ecountResponse = await ecountPost('AccountBasic/SaveBasicCust', { CustList });
    } catch (err) {
      for (const c of customers) {
        await writeSyncLog('거래처', c.CustKey, null, '실패', err.message);
      }
      totalFail = customers.length;
      const nextOffset = offset + customers.length < total ? offset + customers.length : null;
      return res.status(200).json({
        success: false, synced: 0, failed: totalFail, total, nextOffset,
        message: `이카운트 API 오류: ${err.message}`,
      });
    }

    // 디버그: 항상 전체 응답 콘솔 출력
    console.log('[customers-sync] 이카운트 응답:', JSON.stringify(ecountResponse));

    const isOk = String(ecountResponse.Status) === '200';
    const sc   = Number(ecountResponse.Data?.SuccessCnt ?? ecountResponse.Data?.successCnt ?? -1);
    const fc   = Number(ecountResponse.Data?.FailCnt    ?? ecountResponse.Data?.failCnt    ?? 0);

    // sc=-1이면 SuccessCnt 없음 → 전체 성공으로 간주
    totalSuccess = isOk ? (sc >= 0 ? sc : customers.length) : 0;
    totalFail    = isOk ? fc : customers.length;

    const errMsg = !isOk ? (
      ecountResponse.Error?.Message ||
      ecountResponse.Data?.Message ||
      ecountResponse.Message ||
      JSON.stringify(ecountResponse)
    ).slice(0, 500) : (fc > 0 ? `이카운트 실패 ${fc}건` : null);

    for (const c of customers) {
      await writeSyncLog(
        '거래처',
        c.CustKey,
        c.OrderCode || null,
        isOk ? '성공' : '실패',
        errMsg
      );
    }

    const nextOffset = offset + customers.length < total ? offset + customers.length : null;

    return res.status(200).json({
      success:        isOk,
      synced:         totalSuccess,
      failed:         totalFail,
      total,
      nextOffset,
      processed:      offset + customers.length,
      message:        `거래처 동기화 ${offset + 1}~${offset + customers.length}/${total}: 성공 ${totalSuccess}건 / 실패 ${totalFail}건`,
      ecountResponse,  // 디버그용 — 항상 전달
    });
  }

  // ── PUT: 이카운트 거래처 코드를 우리 DB로 역방향 매핑 ──────
  // 이카운트에서 거래처 목록을 가져와 이름으로 매칭 → Customer.OrderCode 업데이트
  if (req.method === 'PUT') {
    try {
      // 이카운트 거래처 목록 조회
      const ecountRes = await ecountPost('AccountBasic/GetBasicCustList', {
        Conditions: { USE_YN: 'Y' },
      });

      if (String(ecountRes.Status) !== '200') {
        return res.status(400).json({ success: false, error: '이카운트 거래처 조회 실패', ecountRes });
      }

      const ecountCusts = ecountRes.Data?.Result || ecountRes.Data || [];
      if (!Array.isArray(ecountCusts) || ecountCusts.length === 0) {
        return res.status(200).json({ success: true, mapped: 0, message: '이카운트에 거래처가 없습니다.' });
      }

      // 우리 DB 거래처 조회
      const dbResult = await query(
        `SELECT CustKey, CustName, ISNULL(OrderCode,'') AS OrderCode FROM Customer WHERE isDeleted=0 ORDER BY CustKey`
      );
      const dbCusts = dbResult.recordset;

      // 이카운트 거래처: CUST_CD, CUST_NAME 기준으로 Map 생성
      // 매핑 전략: 이름 정규화 후 정확 매칭 → 부분 매칭 순
      const normalize = s => (s || '').replace(/\s+/g, '').toLowerCase();
      const ecountMap = {};
      for (const ec of ecountCusts) {
        const cd   = ec.CUST_CD   || ec.cust_cd   || '';
        const name = ec.CUST_NAME || ec.cust_name || '';
        if (cd && name) ecountMap[normalize(name)] = cd;
      }

      let mappedCount = 0;
      const mappings  = [];
      const skipped   = [];

      for (const db of dbCusts) {
        const key = normalize(db.CustName);
        const ec  = ecountMap[key];
        if (ec && ec !== db.OrderCode) {
          // 매핑 발견 → DB 업데이트
          await query(
            `UPDATE Customer SET OrderCode=@code WHERE CustKey=@ck`,
            {
              code: { type: sql.NVarChar, value: ec },
              ck:   { type: sql.Int,      value: db.CustKey },
            }
          );
          mappings.push({ CustKey: db.CustKey, CustName: db.CustName, oldCode: db.OrderCode, newCode: ec });
          mappedCount++;
        } else if (!ec) {
          skipped.push({ CustKey: db.CustKey, CustName: db.CustName, reason: '이카운트 미등록' });
        }
      }

      return res.status(200).json({
        success:      true,
        mapped:       mappedCount,
        total:        dbCusts.length,
        ecountTotal:  ecountCusts.length,
        mappings,
        skipped:      skipped.slice(0, 20), // 처음 20건만
        message:      `이카운트 코드 매핑 완료: ${mappedCount}건 업데이트`,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}, { actionType: 'ECOUNT_SYNC', affectedTable: 'Customer+Ecount거래처', riskLevel: 'HIGH' }));
