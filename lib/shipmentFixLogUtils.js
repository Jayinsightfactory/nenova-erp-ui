/** 확정/확정취소 AppLog 파싱 — UI·API 공용 (JSX 없음) */

export function parseCategoryFromFixDetail(detail) {
  const text = String(detail || '').trim();
  const m = text.match(/^\d{4}\/[\d-]+\s+(.+?)(?:\s+prod=|\s+\d+\/\d+|\s+ok=|\s+pk=|$)/);
  return m ? m[1].trim() : '';
}

export function parseStockCalcProgressFromDetail(detail) {
  const text = String(detail || '');
  const ratios = [...text.matchAll(/(\d+)\/(\d+)/g)];
  const ratio = ratios.length ? ratios[ratios.length - 1] : null;
  const pk = text.match(/pk=(\d+)/);
  return {
    done: ratio ? Number(ratio[1]) : null,
    total: ratio ? Number(ratio[2]) : null,
    prodKey: pk ? Number(pk[1]) : null,
  };
}

export function parseStockCalcProgressFromLogs(logs) {
  const ordered = [...(logs || [])].sort((a, b) => {
    const ta = new Date(String(a.CreateDtm || '').replace(' ', 'T')).getTime();
    const tb = new Date(String(b.CreateDtm || '').replace(' ', 'T')).getTime();
    return ta - tb;
  });
  const last = [...ordered].reverse().find((l) => {
    const step = String(l.Step || '');
    return step.includes('stock_calc_progress')
      || step.includes('stock_calc_item_start')
      || step.includes('stock_calc_item_error');
  });
  if (!last) return null;
  const parsed = parseStockCalcProgressFromDetail(last.Detail);
  return {
    step: last.Step,
    detail: last.Detail,
    ...parsed,
    isError: Boolean(last.IsError) || String(last.Step || '').includes('_error'),
  };
}

/** 카테고리별 완료/진행/오류 집계 */
export function summarizeCategoryFixProgress(logs, action = 'unfix') {
  const spPrefix = action === 'unfix' ? 'unfix_sp_start' : 'fix_sp_start';
  const donePrefix = action === 'unfix' ? 'unfix_stock_calc_done' : 'stock_calc_done';
  const categories = new Map();

  const touch = (label, patch) => {
    if (!label) return;
    const prev = categories.get(label) || { label, status: 'pending', detail: '' };
    categories.set(label, { ...prev, ...patch });
  };

  for (const l of logs || []) {
    const step = String(l.Step || '');
    const detail = String(l.Detail || '');
    const label = parseCategoryFromFixDetail(detail);
    if (step === spPrefix) {
      touch(label, { status: 'running', detail });
    } else if (step === donePrefix) {
      touch(label, { status: 'done', detail });
    } else if (step.includes('stock_calc_item_error')) {
      touch(label || parseCategoryFromFixDetail(detail), { status: 'error', detail, isError: true });
    } else if (step.includes('stock_calc_progress') && label) {
      touch(label, { status: 'running', detail });
    }
  }

  return [...categories.values()];
}
