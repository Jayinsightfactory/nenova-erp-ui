import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import {
  buildKstDayBounds,
  buildPurchaseOrderSheetModel,
  matchRowToStaff,
  resolveOrderRowAttribution,
  resolveStaffOrderAccess,
} from '../../../lib/dailyStaffPurchaseOrder';
import { DAILY_STAFF_PURCHASE_ORDER_SQL } from '../../../lib/dailyStaffPurchaseOrderSql';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  let access;
  let bounds;
  try {
    access = resolveStaffOrderAccess(req.user);
    bounds = buildKstDayBounds(req.query.date ? String(req.query.date) : new Date());
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  const requestedStaffKey = String(req.query.staffKey || '').trim();
  const requestedScope = req.query.scope === 'direct' ? 'direct' : 'all';

  // 일반 직원은 타인 staffKey 조회 차단 (본인 로그인 계정만 허용)
  if (!access.isAdmin && requestedStaffKey) {
    const reqNorm = requestedStaffKey.toLowerCase();
    const isSelf =
      reqNorm === access.userId.toLowerCase() ||
      requestedStaffKey === access.userName;
    if (!isSelf) {
      return res.status(403).json({
        success: false,
        error: '일반 계정은 본인 당일 주문등록 내역만 조회할 수 있습니다.',
      });
    }
  }

  try {
    const result = await query(DAILY_STAFF_PURCHASE_ORDER_SQL, {
      startDtm: { type: sql.NVarChar, value: bounds.startDtm },
      endDtm: { type: sql.NVarChar, value: bounds.endDtm },
    });
    const allRows = result.recordset || [];

    if (!access.isAdmin) {
      const matchedEntries = allRows
        .map(row => ({ row, match: matchRowToStaff(row, access) }))
        .filter(entry => entry.match.matched);
      const directEntries = matchedEntries.filter(entry => entry.match.kind === 'direct');
      const scopedRows = (requestedScope === 'direct' ? directEntries : matchedEntries).map(entry => entry.row);
      const staffLabel = access.userName || access.userId;
      const sheet = buildPurchaseOrderSheetModel(scopedRows, {
        staffName: staffLabel,
        dateText: bounds.dateText,
      });

      return res.status(200).json({
        success: true,
        date: bounds.dateText,
        isAdmin: false,
        hasOrders: matchedEntries.length > 0,
        totalMatchCount: matchedEntries.length,
        directMatchCount: directEntries.length,
        selectedScope: requestedScope,
        selectedStaffKey: access.userId || access.userName,
        selectedStaffName: staffLabel,
        staffOptions: [],
        sheet,
      });
    }

    // 관리자(대표/admin) 모드: 당일 전체 담당자별 집계 + 본인 우선 또는 최다 등록 담당자 기본 선택
    const staffBuckets = new Map();
    const ensureBucket = (key, name, userId = '') => {
      if (!staffBuckets.has(key)) {
        staffBuckets.set(key, { key, name, userId, rows: [] });
      }
      return staffBuckets.get(key);
    };

    for (const row of allRows) {
      const attr = resolveOrderRowAttribution(row);
      const ownerKey = (attr.ownerName || attr.ownerId || '미지정').trim();
      ensureBucket(ownerKey, attr.ownerName || ownerKey, attr.ownerId || '').rows.push(row);

      // 직접 등록자가 담당자와 다를 경우(예: 영업지원 등록분) 관리자 점검용 등록자 항목도 함께 확인 가능하도록 추가
      if (attr.actorUserName && attr.actorUserName !== attr.ownerName) {
        const actorKey = `actor:${attr.actorUserId || attr.actorUserName}`;
        ensureBucket(actorKey, `${attr.actorUserName} (직접입력)`, attr.actorUserId).rows.push(row);
      }
    }

    const selfMatched = allRows.filter(row => matchRowToStaff(row, access).matched);
    const orderedBuckets = [...staffBuckets.values()]
      .filter(b => b.rows.length > 0)
      .sort((a, b) => {
        const aIsMain = !a.key.startsWith('actor:');
        const bIsMain = !b.key.startsWith('actor:');
        if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
        return b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'ko');
      });

    const staffOptions = [
      ...(orderedBuckets.map(b => ({
        key: b.key,
        name: b.name,
        count: b.rows.length,
      }))),
      ...(allRows.length > 0 ? [{ key: 'ALL', name: '전체 담당자 통합', count: allRows.length }] : []),
    ];

    let activeKey = requestedStaffKey;
    if (!activeKey || (activeKey !== 'ALL' && !staffBuckets.has(activeKey))) {
      const selfBucket = orderedBuckets.find(
        b => b.name === access.userName || (b.userId && b.userId.toLowerCase() === access.userId.toLowerCase()),
      );
      activeKey = (selfMatched.length > 0 && selfBucket?.key) || orderedBuckets[0]?.key || 'ALL';
    }

    const selectedRows = activeKey === 'ALL'
      ? allRows
      : (staffBuckets.get(activeKey)?.rows || []);
    const selectedLabel = activeKey === 'ALL'
      ? '전체담당자'
      : (staffBuckets.get(activeKey)?.name?.replace(/\s*\(직접입력\)$/, '') || access.userName || '관리자');

    const sheet = buildPurchaseOrderSheetModel(selectedRows, {
      staffName: selectedLabel,
      dateText: bounds.dateText,
    });

    return res.status(200).json({
      success: true,
      date: bounds.dateText,
      isAdmin: true,
      hasOrders: allRows.length > 0,
      totalMatchCount: allRows.length,
      directMatchCount: selfMatched.length,
      selectedScope: 'all',
      selectedStaffKey: activeKey,
      selectedStaffName: activeKey === 'ALL' ? '전체 담당자 통합' : (staffBuckets.get(activeKey)?.name || selectedLabel),
      staffOptions,
      sheet,
    });
  } catch (error) {
    console.error('daily-order-sheet read failed', error.code || error.name);
    return res.status(500).json({
      success: false,
      error: '당일 주문발주 내역서 조회에 실패했습니다. 새로고침 후 다시 확인하세요.',
    });
  }
});
