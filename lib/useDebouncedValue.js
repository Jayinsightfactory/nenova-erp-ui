// lib/useDebouncedValue.js
// 품목·거래처 검색처럼 한 번의 계산이 무거운 입력에서 타이핑 중간 계산을 건너뛴다.
// 값만 늦게 반영하므로 최종 결과는 디바운스 없이 계산한 것과 같다.

import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return undefined;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
    // debounced를 의존성에 넣으면 반영 직후 타이머가 다시 걸린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay]);

  return debounced;
}
