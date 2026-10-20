import { useEffect, useMemo, useState } from 'react';
import styles from '../../styles/ecount-workbench.module.css';

export function menuAncestors(menus, menuId) {
  const byId = new Map(menus.map(menu => [menu.id, menu]));
  const result = [], seen = new Set();
  let current = byId.get(menuId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);result.unshift(current);current = byId.get(current.parentId);
  }
  return result;
}

// Menu structure comes from the observed sitemap; browsing groups never queries a dataset.
export default function EcountNavigation({ menus, tab, menuId, busy, onSelect, children }) {
  const ancestors = useMemo(() => menuAncestors(menus, menuId), [menus, menuId]);
  const groups = menus.filter(menu => menu.tab === tab && menu.depth === 2);
  const selectedGroup = ancestors.find(menu => menu.depth === 2 && menu.tab === tab)?.id;
  const [browsedGroup, setBrowsedGroup] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(ancestors.map(menu => menu.id)));
  const groupId = groups.some(menu => menu.id === browsedGroup) ? browsedGroup : selectedGroup || groups[0]?.id;
  useEffect(() => {
    setBrowsedGroup(null);
    setExpanded(new Set(ancestors.map(menu => menu.id)));
  }, [tab, menuId, ancestors]);
  function toggle(id) {
    if (busy) return;
    setExpanded(previous => {const next = new Set(previous);next.has(id) ? next.delete(id) : next.add(id);return next;});
  }
  function branch(parentId, depth = 0) {
    const nodes = menus.filter(menu => menu.parentId === parentId);
    return <ul className={depth ? styles.sidebarChildren : styles.sidebarTree}>{nodes.map(menu => {
      const hasChildren = menus.some(child => child.parentId === menu.id);
      return <li key={menu.id}>
        <button type="button" disabled={busy} aria-current={menu.id === menuId ? 'page' : undefined}
          aria-expanded={hasChildren ? expanded.has(menu.id) : undefined}
          className={`${styles.sidebarLink} ${hasChildren ? styles.sidebarGroup : ''} ${ancestors.some(item => item.id === menu.id) ? styles.sidebarActive : ''}`}
          onClick={() => {if (busy) return;if (hasChildren) toggle(menu.id);else onSelect(menu.id);}}>
          {hasChildren && <span aria-hidden="true">{expanded.has(menu.id) ? '⌄' : '›'}</span>}{menu.label}
        </button>
        {hasChildren && expanded.has(menu.id) && branch(menu.id, depth + 1)}
      </li>;
    })}</ul>;
  }
  return <div className={styles.workspaceFrame}>
    {!!groups.length && <nav className={styles.groupbar} aria-label="업무 그룹">{groups.map(menu =>
      <button key={menu.id} type="button" disabled={busy} aria-pressed={menu.id === groupId}
        onClick={() => {if (!busy) setBrowsedGroup(menu.id);}}>{menu.label}</button>)}</nav>}
    <aside className={styles.sidebar} aria-label="업무 메뉴">{groupId ? branch(groupId) : branch(tab)}</aside>
    <div className={styles.workspaceBody}>{children}</div>
  </div>;
}
