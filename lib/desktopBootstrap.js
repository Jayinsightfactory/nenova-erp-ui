import { createHash } from 'node:crypto';

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
  };
}
