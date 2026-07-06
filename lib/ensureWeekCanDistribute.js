import { apiGet } from './useApi';
import { formatWeekDisplay } from './useWeekInput';

function shortWeekLabel(week) {
  const m = String(week || '').match(/^(\d{4}-)?(\d{2}-\d{2})$/);
  return m ? m[2] : String(week || '');
}

/** 확정 차수/품목군이면 출고분배·주문등록+분배 차단 (paste.js 와 동일) */
export async function ensureWeekCanDistribute(targetWeek, prodKeys = []) {
  if (!targetWeek) {
    alert('차수를 선택하세요.');
    return false;
  }
  try {
    const targetProdKeys = [...new Set((prodKeys || []).map(Number).filter(Boolean))];
    if (targetProdKeys.length > 0) {
      const d = await apiGet('/api/shipment/adjust', {
        type: 'fixCheck',
        week: targetWeek,
        prodKeys: targetProdKeys.join(','),
      });
      if (!d.success) throw new Error(d.error || '품목군 확정 상태 조회 실패');
      if (d.blocked) {
        const scopes = (d.blockedScopes || []).map(s => s.scopeName).filter(Boolean).join(', ') || '선택 품목군';
        alert(`${formatWeekDisplay(targetWeek)} ${scopes}은(는) 확정 상태입니다.\n확정된 품목군은 출고분배/분배조정을 할 수 없습니다.\n해당 품목군 확정취소 후 다시 진행하세요.`);
        return false;
      }
      return true;
    }

    const d = await apiGet('/api/shipment/fix-status', { fromWeek: targetWeek, toWeek: targetWeek });
    if (!d.success) throw new Error(d.error || '확정 상태 조회 실패');
    const targetShort = shortWeekLabel(targetWeek);
    const fixedInfo = (d.weeks || []).find(w => shortWeekLabel(`${w.OrderYear}-${w.OrderWeek}`) === targetShort) || (d.weeks || [])[0];
    const blocked = fixedInfo && (
      fixedInfo.status === 'FIXED'
      || fixedInfo.status === 'PARTIAL'
      || Number(fixedInfo.stockFixed || 0) > 0
      || Number(fixedInfo.fixedMasterCount || 0) > 0
      || Number(fixedInfo.fixedDetailCount || 0) > 0
    );
    if (blocked) {
      const statusText = fixedInfo.status === 'PARTIAL' ? '일부 확정' : '확정';
      alert(`${formatWeekDisplay(targetWeek)} 차수는 ${statusText} 상태입니다.\n확정된 차수는 출고분배/분배조정을 할 수 없습니다.\n먼저 차수 확정취소 후 다시 진행하세요.`);
      return false;
    }
    return true;
  } catch (e) {
    alert(`차수 확정 상태를 확인하지 못했습니다.\n출고분배를 진행하지 않습니다.\n\n${e.message}`);
    return false;
  }
}
