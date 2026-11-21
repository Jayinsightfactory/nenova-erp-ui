import { createHash } from 'node:crypto';
import { isOrbitReportViewer } from './orbitReportAccess.js';

// Keep the desktop menu in the same order and with the same userId gate as Layout.
export function buildDesktopBootstrap(menuGroups, user, webVersion) {
  const userId = user?.userId;
  if (typeof userId !== 'string' || !userId) {
    throw new TypeError('An authenticated userId is required');
  }

  const menus = menuGroups.map(({ group, items }) => ({
    group,
    items: items
      .filter(item => !item.userIds || item.userIds.includes(userId))
      .map(({ href, labelKey, popup }) => ({ href, labelKey, popup: Boolean(popup) })),
  })).filter(group => group.items.length > 0);

  const menuVersion = createHash('sha256').update(JSON.stringify(menus)).digest('hex');
  return {
    success: true,
    schemaVersion: 1,
    user: { userId },
    webVersion,
    menuVersion,
    menus,
    // 관리자 계정에만 붙는다: 데스크톱앱이 이 표시가 있을 때만 관리자 알림을 조회한다(일반 계정은 조회 자체를 하지 않음).
    ...(isOrbitReportViewer(user) ? { adminAlerts: true } : {}),
  };
}
