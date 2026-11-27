import { pivotCustomerQuantity } from './pivotCustomerQuantity.js';
import { DAY_ORDER, extractDays, pickDataDay } from './pivotVolumeCustDays.js';

const defaultCustomerLabel = customer => String(customer?.custName || '').trim();

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeVolumeGroupBy(value) {
  return String(value || '').trim().toLowerCase() === 'day' ? 'day' : 'region';
}

export function extractVolumeCustomerAbbr(customer, labelFn = defaultCustomerLabel) {
  const descr = String(customer?.custDescr || '').trim();
  if (descr) {
    const head = descr.split('/')[0]?.trim();
    if (head) return head;
  }
  return labelFn(customer);
}

function customerPriority(label) {
  return label === '주광' ? 0 : label === '주광여분' ? 1 : 2;
}

export function buildVolumeCustomerGroups(rows, customers, flower, groupBy = 'region', deps = {}) {
  const mode = normalizeVolumeGroupBy(groupBy);
  const qtyFn = deps.pivotCustomerQuantity || pivotCustomerQuantity;
  const extractDaysFn = deps.extractDays || extractDays;
  const pickDataDayFn = deps.pickDataDay || pickDataDay;
  const dayOrder = deps.DAY_ORDER || DAY_ORDER;
  const labelFn = deps.customerDisplayLabel || defaultCustomerLabel;

  const active = (customers || [])
    .filter(customer => (rows || []).some(row => num(qtyFn(row, customer)) > 0))
    .map(customer => {
      const days = extractDaysFn(customer, flower);
      return {
        customer,
        region: customer.area || '기타',
        label: extractVolumeCustomerAbbr(customer, labelFn) || customer.custName,
        day: pickDataDayFn(days) || '',
      };
    });

  const labelCounts = new Map();
  active.forEach(col => {
    const key = String(col.label || '').trim();
    if (key) labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  });
  active.forEach(col => {
    if ((labelCounts.get(col.label) || 0) > 1) col.label = col.customer.custName;
  });

  if (mode === 'day') {
    const regionOrder = new Map();
    active.forEach(col => {
      if (!regionOrder.has(col.region)) regionOrder.set(col.region, regionOrder.size);
    });
    const byDay = new Map();
    active.forEach(col => {
      const dayKey = col.day || '';
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey).push(col);
    });
    const sortedDays = [...byDay.keys()].sort((a, b) => (dayOrder[a] ?? 99) - (dayOrder[b] ?? 99));
    return sortedDays.map(dayKey => ({
      day: dayKey,
      dayLabel: dayKey || '미지정',
      cols: byDay.get(dayKey).sort((a, b) => {
        const ra = a.region === '경부선_주광' ? -1 : (regionOrder.get(a.region) ?? 9999);
        const rb = b.region === '경부선_주광' ? -1 : (regionOrder.get(b.region) ?? 9999);
        return (ra - rb)
          || String(a.region).localeCompare(String(b.region), 'ko')
          || (customerPriority(a.label) - customerPriority(b.label))
          || String(a.label).localeCompare(String(b.label), 'ko');
      }),
    }));
  }

  const regions = [];
  const seen = new Set();
  active.forEach(col => {
    if (!seen.has(col.region)) {
      seen.add(col.region);
      regions.push(col.region);
    }
  });
  if (regions.includes('경부선_주광')) {
    regions.splice(regions.indexOf('경부선_주광'), 1);
    regions.unshift('경부선_주광');
  }

  return regions.map(region => ({
    region,
    cols: active
      .filter(col => col.region === region)
      .sort((a, b) => customerPriority(a.label) - customerPriority(b.label)
        || (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99)
        || String(a.label).localeCompare(String(b.label))),
  }));
}

export function appendGroupedCustomerColumns(colPlan, customerGroups, groupBy = 'region') {
  const mode = normalizeVolumeGroupBy(groupBy);
  const customerColCount = customerGroups.reduce((sum, group) => sum + group.cols.length, 0);

  if (mode === 'day') {
    const half = Math.ceil(customerColCount / 2);
    let seenCustomers = 0;
    let middleInserted = false;
    customerGroups.forEach((group, groupIdx) => {
      if (
        !middleInserted
        && customerColCount > 10
        && customerGroups.length > 1
        && groupIdx > 0
        && (seenCustomers >= half || groupIdx === customerGroups.length - 1)
      ) {
        colPlan.push({ type: 'product', section: 'middle' });
        middleInserted = true;
      }
      group.cols.forEach((col, colIdx) => {
        const isDayStart = colIdx === 0;
        const isRegionStart = colIdx === 0 || group.cols[colIdx - 1].region !== col.region;
        colPlan.push({
          type: 'customer',
          group: col.region,
          dayGroup: group.dayLabel,
          isDayStart,
          isRegionStart,
          ...col,
        });
      });
      seenCustomers += group.cols.length;
    });
    return colPlan;
  }

  for (const group of customerGroups) {
    if (customerColCount > 10 && group.region === '지방' && colPlan.filter(col => col.type === 'product').length === 1) {
      colPlan.push({ type: 'product', section: 'middle' });
    }
    group.cols.forEach((col, colIdx) => {
      colPlan.push({
        type: 'customer',
        group: group.region,
        isDayStart: false,
        isRegionStart: colIdx === 0,
        ...col,
      });
    });
  }
  return colPlan;
}
