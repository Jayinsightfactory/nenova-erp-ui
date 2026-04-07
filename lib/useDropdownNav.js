// lib/useDropdownNav.js
// 드롭다운 키보드 탐색 공통 훅
// ↓↑ 화살표로 항목 이동, Enter 선택, Escape 닫기

import { useState, useCallback } from 'react';

/**
 * @param {Array}    list      - 드롭다운 항목 배열
 * @param {Function} onSelect  - 선택 시 콜백 (item) => void
 * @param {Function} onClose   - 닫기 시 콜백 () => void
 */
export function useDropdownNav(list, onSelect, onClose) {
  const [idx, setIdx] = useState(-1);

  const reset = useCallback(() => setIdx(-1), []);

  const onKeyDown = useCallback((e) => {
    if (!list || list.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = idx >= 0 ? list[idx] : list[0];
      if (target) {
        onSelect(target);
        onClose && onClose();
        setIdx(-1);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose && onClose();
      setIdx(-1);
    }
  }, [list, idx, onSelect, onClose]);

  return { idx, setIdx, reset, onKeyDown };
}
