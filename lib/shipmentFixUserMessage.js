/**
 * 출고 확정/확정취소의 사용자용 설명.
 *
 * 서버 코드·프로시저 메시지는 감사용 원문으로 보존하되, 화면 기본 문구는
 * 사용자가 "무엇이 문제인지 / 데이터가 바뀌었는지 / 다음에 무엇을 할지"
 * 바로 판단할 수 있는 한국어로 바꾼다. 이 모듈은 표시만 담당하며 ERP 쓰기
 * 정책이나 확정 범위를 변경하지 않는다.
 */

const list = (values = []) => values.map((value) => String(value || '').trim()).filter(Boolean);
const rows = (values = []) => Array.isArray(values) ? values.filter(Boolean) : [];
const number = (value) => Number(value || 0).toLocaleString();

function humanizeParityWarning(value) {
  const text = String(value || '');
  if (/Master\/Detail 불일치/.test(text)) {
    const count = text.match(/(\d+)건/)?.[1];
    return `출고 전체상태와 품목별 확정상태가 서로 다른 항목${count ? ` ${count}건` : ''}`;
  }
  if (/Product\.Stock 음수/.test(text)) {
    const count = text.match(/(\d+)품목/)?.[1];
    return `현재 재고가 음수인 품목${count ? ` ${count}개` : ''}`;
  }
  if (/부분 확정/.test(text)) return '아직 확정되지 않은 품종이 남음';
  return text;
}

function weekLabel(week, data = {}) {
  return String(week || data.orderWeek || data.week || '').replace(/^\d{4}-/, '') || '선택 차수';
}

function failedCategoryLabels(data = {}) {
  return rows(data.errors).map((row) => row.countryFlower || row.category || row.label).filter(Boolean);
}

export function buildShipmentFixErrorView(data = {}, week, action = '확정') {
  const wk = weekLabel(week, data);
  const code = String(data.code || data.warning || '').trim();
  const remaining = list(data.remainingCategories || data.pendingUnfixedCategories || []);

  if (code === 'PARTIAL_CATEGORY_FIX_BLOCKED') {
    return {
      code,
      title: `${wk} 일부 품종이 빠져 있어 ${action}하지 않았습니다`,
      summary: remaining.length
        ? `현재 선택에서 ${remaining.join(' · ')}이(가) 빠져 있습니다. 일부만 확정하면 전산 재고가 서로 달라질 수 있어 작업 시작 전에 중단했습니다.`
        : '현재 차수의 미확정 품종 중 일부만 선택되어 있습니다. 일부만 확정하면 전산 재고가 서로 달라질 수 있어 작업 시작 전에 중단했습니다.',
      action: remaining.length
        ? `${remaining.join(' · ')}까지 함께 선택하거나, 품종 선택을 ‘전체’로 바꾼 뒤 다시 실행하세요.`
        : '확정현황에서 남은 미확정 품종을 모두 포함하거나 ‘전체’를 선택한 뒤 다시 실행하세요.',
      changed: false,
      tone: 'warning',
    };
  }

  if (code === 'LOWER_UNFIXED_EXISTS') {
    const lower = rows(data.lowerWeeks).map((row) => typeof row === 'string'
      ? row
      : `${row.OrderYear || ''}-${row.OrderWeek || ''}`.replace(/^-/, ''));
    const products = rows(data.lowerDetails).slice(0, 8).map((row) => {
      const category = row.category || '(품종 미분류)';
      const name = row.ProdName || `품목 ${row.ProdKey || ''}`;
      return `[${category}] ${name} — 출고 ${number(row.outQty)} · 미확정 ${number(row.detailCount)}행`;
    });
    return {
      code,
      title: `${wk}보다 앞선 차수가 아직 확정되지 않았습니다`,
      summary: `${lower.join(' · ') || '앞선 차수'}에 미확정 출고가 남아 있어 ${wk} ${action}을 시작하지 않았습니다.${products.length ? `\n남은 품목: ${products.join('\n')}` : ''}`,
      action: `${lower[0] || '앞선 차수'}부터 낮은 차수 순서로 확정한 뒤 다시 실행하세요.`,
      changed: false,
      tone: 'warning',
    };
  }

  if (code === 'NEGATIVE_STOCK') {
    const rows = Array.isArray(data.negative) ? data.negative : [];
    const details = rows.slice(0, 12).map((row) => {
      const category = [row.CounName, row.FlowerName].filter(Boolean).join(' · ') || '(품종 미분류)';
      const shortage = Number(row.shortage ?? Math.abs(Number(row.remain) || 0));
      return `[${category}] ${row.ProdName || `품목 ${row.ProdKey || ''}`} — 부족 ${number(shortage)} ` +
        `(전재고 ${number(row.prevStock)} + 입고·조정 ${number(row.inQty)} - 출고 ${number(row.outQty)})`;
    });
    return {
      code,
      title: `${wk} 출고 후 재고가 부족한 품목이 있어 ${action}하지 않았습니다`,
      summary: `${rows.length || '일부'}개 품목이 출고 후 음수가 됩니다.${details.length ? `\n${details.join('\n')}` : ''}`,
      action: '재고관리에서 표시된 품목의 입고·재고조정·출고수량을 확인한 뒤 다시 실행하세요.',
      changed: false,
      tone: 'danger',
    };
  }

  if (code === 'LATER_FIXED_EXISTS') {
    const next = data.nextWeek
      ? `${data.nextWeek.orderYear || ''}-${data.nextWeek.orderWeek || ''}`.replace(/^-/, '')
      : list(data.laterWeeks || []).join(' · ');
    const products = rows(data.products).map((row) => row.prodName || row.ProdName).filter(Boolean).slice(0, 10);
    return {
      code,
      title: `${wk}보다 뒤 차수가 이미 확정되어 취소하지 않았습니다`,
      summary: `${next || '뒤 차수'}의 확정 재고가 ${wk} 결과를 이어받고 있어, ${wk}만 먼저 취소하면 이후 재고가 어긋날 수 있습니다.${products.length ? `\n관련 품목: ${products.join(' · ')}` : ''}`,
      action: `${next || '뒤 차수'}부터 높은 차수 순서로 확정을 취소한 뒤 ${wk}를 처리하세요.`,
      changed: false,
      tone: 'warning',
    };
  }

  if (code === 'AUTO_STOCK_CALC_FAILED' || code === 'AUTO_STOCK_ADJUST_FAILED') {
    return {
      code,
      title: `${wk} 재고 부족분 보정을 완료하지 못해 ${action}을 시작하지 않았습니다`,
      summary: '자동으로 추가하려던 재고조정은 모두 되돌려졌고, 출고 확정상태도 바뀌지 않았습니다.',
      action: '오류에 표시된 품목의 재고조정 저장 여부를 확인한 뒤 다시 실행하세요.',
      changed: false,
      tone: 'danger',
    };
  }

  if (code === 'STOCK_CALC_FAILED') {
    return {
      code,
      title: `${wk} 확정 상태는 바뀌었지만 재고 계산을 끝내지 못했습니다`,
      summary: '같은 작업을 바로 다시 실행하면 중복 처리 여부를 판단하기 어렵습니다. 먼저 확정현황을 다시 조회해 현재 상태를 확인해야 합니다.',
      action: '확정현황을 새로 조회하세요. 이미 미확정이면 재고 계산·정합화만 다시 실행하고, 확정이면 다시 취소하지 마세요.',
      changed: true,
      tone: 'danger',
    };
  }

  if (['ORDER_YEAR_REQUIRED', 'ORDER_YEAR_MISMATCH', 'INVALID_ORDER_YEAR', 'INVALID_ORDER_WEEK'].includes(code)) {
    return {
      code,
      title: '화면의 연도·차수 정보가 서버에 올바르게 전달되지 않았습니다',
      summary: '전산 자료는 변경하지 않았습니다. 오래 열어 둔 화면이나 이전 화면 정보가 섞였을 수 있습니다.',
      action: '화면을 새로고침하고 연도와 차수를 다시 조회한 뒤 실행하세요.',
      changed: false,
      tone: 'warning',
    };
  }

  if (['STALE_DATA', 'EDIT_STALE', 'EDIT_PRESENCE_STALE', 'ERP_EDIT_CONFLICT'].includes(code)) {
    return {
      code,
      title: '조회한 뒤 다른 화면에서 같은 자료가 변경되었습니다',
      summary: '이 화면의 오래된 값으로 덮어쓰지 않도록 저장을 중단했습니다.',
      action: '입력값은 유지한 채 현재 업체·차수를 다시 조회하고, 바뀐 수량을 확인한 뒤 저장하세요.',
      changed: false,
      tone: 'warning',
    };
  }

  const failed = failedCategoryLabels(data);
  if (failed.length || Array.isArray(data.errors) && data.errors.length) {
    const successCount = Array.isArray(data.results) ? data.results.length : 0;
    return {
      code: code || 'PARTIAL_OPERATION_FAILED',
      title: `${wk} 처리 중 ${failed.length || data.errors.length}개 품종에서 멈췄습니다`,
      summary: `${successCount ? `${successCount}개 품종은 처리됐고, ` : ''}${failed.join(' · ') || '일부 품종'}은 처리되지 않았습니다. 화면 표시만 보고 전체 실패로 단정하면 안 됩니다.`,
      action: '확정현황을 다시 조회해 처리된 품종과 남은 품종을 확인한 뒤, 남은 품종만 다시 실행하세요.',
      changed: successCount > 0,
      tone: 'danger',
    };
  }

  const raw = String(data.error || data.message || '').trim();
  if (/abort|timeout|시간.*초과|응답.*지연/i.test(raw)) {
    return {
      code: code || 'REQUEST_TIMEOUT',
      title: `${wk} 작업이 끝났는지 화면에서 확인하지 못했습니다`,
      summary: '서버 응답이 늦어 화면의 기다림 시간이 끝났습니다. 서버에서는 처리가 계속됐을 수 있으므로 바로 같은 작업을 반복하면 안 됩니다.',
      action: '확정현황을 새로 조회해 현재 상태를 먼저 확인한 뒤, 미처리된 경우에만 다시 실행하세요.',
      changed: null,
      tone: 'warning',
    };
  }

  return {
    code: code || 'FIX_FAILED',
    title: `${wk} ${action}을 완료하지 못했습니다`,
    summary: raw || '서버가 처리 완료 여부를 알려주지 못했습니다.',
    action: '확정현황을 다시 조회해 현재 상태를 확인한 뒤 재시도하세요. 같은 오류가 반복되면 아래 기술 기록을 관리자에게 전달하세요.',
    changed: null,
    tone: 'danger',
  };
}

export function formatShipmentFixErrorMessage(data, week, action = '확정') {
  const view = buildShipmentFixErrorView(data, week, action);
  return `${view.title}\n${view.summary}\n→ ${view.action}`;
}

export function getShipmentFixStatusPresentation(row = {}) {
  const detailCount = Number(row.detailCount || 0);
  const fixedCount = Number(row.fixedDetailCount || 0);
  const unfixedCount = Number(row.unfixedDetailCount || 0);
  const shipmentStatus = row.shipmentStatus || (detailCount <= 0
    ? 'NO_SHIPMENT'
    : unfixedCount === 0 ? 'FIXED' : fixedCount > 0 ? 'PARTIAL' : 'UNFIXED');
  const unfixedCategories = String(row.unfixedCategories || '').trim();

  if (shipmentStatus === 'NO_SHIPMENT') {
    return { key: 'NO_SHIPMENT', text: '출고없음', tone: 'neutral', summary: '확정할 출고 내역이 없습니다.' };
  }
  if (shipmentStatus === 'PARTIAL') {
    return {
      key: 'PARTIAL', text: '일부만 확정', tone: 'warning',
      summary: `출고 ${number(detailCount)}건 중 ${number(fixedCount)}건만 확정됐고 ${number(unfixedCount)}건이 남아 있습니다.${unfixedCategories ? ` 남은 품종: ${unfixedCategories}` : ''}`,
      action: '남은 미확정 품종을 모두 포함해 확정하세요.',
    };
  }
  if (shipmentStatus === 'UNFIXED') {
    return {
      key: 'UNFIXED', text: '미확정', tone: 'danger',
      summary: `출고 ${number(detailCount)}건이 아직 확정되지 않았습니다.${unfixedCategories ? ` 대상 품종: ${unfixedCategories}` : ''}`,
      action: '앞 차수부터 순서대로 확정하세요.',
    };
  }
  if (row.status === 'FIXED_PENDING_STOCK' || row.exeAligned === false) {
    const warnings = list(row.parityWarnings || []).map(humanizeParityWarning).join(' · ');
    return {
      key: 'FIXED_PENDING_STOCK', text: '출고확정·점검필요', tone: 'warning',
      summary: `출고 ${number(detailCount)}건은 모두 확정됐습니다.${warnings ? ` 다만 ${warnings} 상태를 확인해야 합니다.` : ' 다만 전산 재고 일치 여부를 한 번 확인해야 합니다.'}`,
      action: '확정을 다시 누르지 말고 음수재고 또는 출고 Master/Detail 불일치 항목만 확인하세요.',
    };
  }
  return {
    key: 'FIXED', text: '확정', tone: 'success',
    summary: `출고 ${number(detailCount)}건이 모두 확정됐습니다.`,
  };
}

export function describeShipmentFixLog(log = {}) {
  const step = String(log.Step || log.step || '').trim();
  const detail = String(log.Detail || log.detail || '').trim();
  const weekMatch = detail.match(/(\d{4})[\/-](\d{2}-\d{2})/);
  const wk = weekMatch ? weekMatch[2] : '해당 차수';

  if (step === 'partial_category_fix_block') {
    const remaining = detail.match(/remaining=(.*)$/)?.[1]?.split(',').map((v) => v.trim()).filter(Boolean) || [];
    return buildShipmentFixErrorView({ code: 'PARTIAL_CATEGORY_FIX_BLOCKED', remainingCategories: remaining }, wk, '확정');
  }
  if (step === 'lower_unfixed_block') {
    const lower = detail.match(/blocked by (.*?) \(/)?.[1]?.split(',').map((v) => v.trim()) || [];
    return buildShipmentFixErrorView({ code: 'LOWER_UNFIXED_EXISTS', lowerWeeks: lower }, wk, '확정');
  }
  if (step === 'unfix_exception' || step === 'fix_exception') {
    return buildShipmentFixErrorView({ error: detail }, wk, step.startsWith('unfix') ? '확정취소' : '확정');
  }
  if (step.includes('stock_calc_error') || step === 'reconcile_exception') {
    return buildShipmentFixErrorView({ code: 'STOCK_CALC_FAILED', error: detail }, wk, '확정 처리');
  }
  if (step === 'fix_sp_error' || step === 'unfix_sp_error') {
    const category = detail.match(/\d{4}[\/-]\d{2}-\d{2}\s+(.+?)\s+code=/)?.[1];
    return {
      code: step,
      title: `${wk} ${category ? `${category} ` : ''}${step.startsWith('unfix') ? '확정취소' : '확정'} 처리 실패`,
      summary: '전산 확정 처리 함수가 완료 결과를 반환하지 않았습니다.',
      action: '확정현황을 다시 조회해 현재 상태를 먼저 확인하고, 처리되지 않은 품종만 다시 실행하세요.',
      changed: null,
      tone: 'danger',
    };
  }
  if (step === 'reconcile_done' && /exeAligned=0/.test(detail)) {
    return {
      code: step,
      title: `${wk} 출고확정은 끝났고 재고 일치 여부를 확인해야 합니다`,
      summary: '출고 확정 자체가 실패한 것은 아닙니다. 음수재고 또는 출고 Master/Detail 불일치가 남아 점검 상태로 기록됐습니다.',
      action: '확정을 다시 누르지 말고 확정현황의 점검 필요 사유를 확인하세요.',
      changed: true,
      tone: 'warning',
    };
  }
  if (step === 'fix_done' || step === 'unfix_done') {
    const errors = Number(detail.match(/errors=(\d+)/)?.[1] || 0);
    const success = Number(detail.match(/success=(\d+)/)?.[1] || 0);
    return {
      code: step,
      title: errors ? `${wk} 일부 품종만 처리됐습니다` : `${wk} ${step === 'fix_done' ? '확정' : '확정취소'}이 완료됐습니다`,
      summary: errors ? `${success}개 품종은 처리됐고 ${errors}개 품종은 실패했습니다.` : `${success}개 품종이 정상 처리됐습니다.`,
      action: errors ? '확정현황을 다시 조회해 남은 품종만 처리하세요.' : '추가 조치가 필요하지 않습니다.',
      changed: success > 0,
      tone: errors ? 'danger' : 'success',
    };
  }

  return {
    code: step || 'APP_LOG',
    title: '작업 중 오류가 기록됐습니다',
    summary: '이 오류는 아직 쉬운 설명으로 자동 분류되지 않았습니다. 원본 오류 문구는 오른쪽 ‘기술 기록’에 보존했습니다.',
    action: '확정현황에서 현재 상태를 먼저 확인하세요. 같은 오류가 반복되면 기술 기록을 관리자에게 전달하세요.',
    changed: null,
    tone: 'danger',
  };
}
