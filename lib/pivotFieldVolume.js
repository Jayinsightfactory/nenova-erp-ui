import { customerExportName } from './customerExportName.js';
import { productColorLabel } from './productColor.js';
import { pivotCustomerQuantity } from './pivotCustomerQuantity.js';

const customerDisplayLabel = customer => String(customer?.custName || '').trim();
import { DAY_ORDER, extractDays, pickDataDay } from './pivotVolumeCustDays.js';
import { isNetherlandsVolume, pivotVolumeFlowerLabel } from './pivotVolumeNetherlands.js';
import { volumeProdLabel } from './pivotVolumeProductLabel.js';
import { sumIncomingQty, sumOrderQty } from './pivotVolumeRows.js';
import { renderFieldVolumeWorkbook } from './shipmentFieldVolume.js';
import volumeColors from './pivotVolumeColors.cjs';

const FIELD_PALLET_FAMILIES = new Set([
  'carnation',
  'minicarnation',
  'rose',
  'hydrangea',
  'ruscus',
  'alstroemeria',
]);

const FIELD_DAY_PALETTE = Object.fromEntries(
  Object.entries(volumeColors.DAY_COLORS)
    .filter(([k]) => k !== '미지정')
    .map(([k, v]) => [k, v.fill])
);

const FIELD_DAY_ORDER = ['목', '금', '토', '일', '화', '수', '월', '미지정'];

function num(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferFieldFamily(row, group) {
  if (group?.countryOnly) return String(group.country || row?.country || '').trim() || '기타';
  const text = `${row?.flower || ''} ${row?.countryFlower || ''} ${row?.prodName || ''}`.toLowerCase();
  if (/루스커스|ruscus/.test(text)) return 'ruscus';
  if (/미니\s*카네이션|mini\s*carnation|minicarnation/.test(text)) return 'minicarnation';
  if (/카네이션|carnation/.test(text)) return 'carnation';
  if (/장미|\brose\b/.test(text)) return 'rose';
  if (/수국|hydrangea/.test(text)) return 'hydrangea';
  if (/알스트로|alstro/.test(text)) return 'alstroemeria';
  return String(row?.flower || group?.flower || row?.country || '').trim() || '기타';
}

function fieldProductLabel(row) {
  const base = volumeProdLabel(row);
  if (!isNetherlandsVolume(row)) return base || String(row?.prodName || '').trim();
  const flower = pivotVolumeFlowerLabel(row);
  const color = productColorLabel(row?.productDescr);
  const parts = [];
  if (flower && !base.includes(flower)) parts.push(flower);
  if (base) parts.push(base);
  if (color && !base.includes(color)) parts.push(color);
  return parts.join(' ').trim() || String(row?.prodName || '').trim();
}

function normalizePalletFamily(family) {
  return family === 'minicarnation' ? 'carnation' : family;
}

function palletDivisor(family, prodName) {
  if (family === 'rose') return /snow\s*flake/i.test(String(prodName || '')) ? 25 : 10;
  if (family === 'alstroemeria') return 16;
  return 1;
}

export function buildPivotFieldVolumeInput({
  data,
  group,
  rows,
  customers,
  weekLabel,
} = {}) {
  const orderYear = String(data?.orderYear ?? '').trim();
  if (!/^\d{4}$/.test(orderYear)) {
    throw new Error('신형 물량표 생성에 유효한 연도(orderYear)가 필요합니다.');
  }
  const resolvedWeek = String(weekLabel || data?.weekStart || '').trim();
  if (!resolvedWeek) {
    throw new Error('신형 물량표 생성에 차수(week)가 필요합니다.');
  }
  const activeRows = Array.isArray(rows) ? rows : [];
  if (!activeRows.length) {
    throw new Error('신형 물량표로 출력할 품목이 없습니다.');
  }

  const allCustomers = Array.isArray(customers) ? customers : [];
  const activeCustomers = allCustomers
    .filter(customer => activeRows.some(row => num(pivotCustomerQuantity(row, customer)) > 0))
    .map((customer, index) => {
      const custKey = Number(customer?.custKey) > 0 ? Number(customer.custKey) : (index + 1);
      const region = String(customer?.area || '기타').replace(/_/g, '').trim() || '기타';
      const display = customerExportName({
        CustName: customer?.custName || customerDisplayLabel(customer),
        Descr: customer?.custDescr || '',
      }) || customerDisplayLabel(customer) || String(customer?.custName || '');
      const days = extractDays(customer, group?.flower || activeRows[0]?.flower || group?.country || '');
      const day = pickDataDay(days) || '미지정';
      return {
        raw: customer,
        custKey,
        region,
        name: display,
        canonicalName: String(customer?.custName || display),
        day,
      };
    });

  const labelCounts = new Map();
  for (const c of activeCustomers) {
    labelCounts.set(c.name, (labelCounts.get(c.name) || 0) + 1);
  }
  for (const c of activeCustomers) {
    if ((labelCounts.get(c.name) || 0) > 1) c.name = c.canonicalName;
  }

  const products = activeRows.map((row, index) => {
    const prodKey = Number(row?.prodKey) > 0 ? Number(row.prodKey) : (index + 1);
    const incomingVal = sumIncomingQty(row);
    return {
      row,
      product: {
        prodKey,
        label: fieldProductLabel(row),
        unit: String(row?.unit || ''),
        family: inferFieldFamily(row, group),
        bunchOf1Box: Number(row?.bunchOf1Box ?? row?.BunchOf1Box ?? 0) || 0,
        steamOf1Bunch: Number(row?.steamOf1Bunch ?? row?.SteamOf1Bunch ?? 0) || 0,
        steamOf1Box: Number(row?.steamOf1Box ?? row?.SteamOf1Box ?? 0) || 0,
        incoming: Number.isFinite(incomingVal) ? incomingVal : 0,
        stock: null,
      },
    };
  });

  const entries = [];
  const outgoingByProdKey = new Map();
  const pallets = {};
  const isNonPalletCountry = Boolean(group?.countryOnly) || products.every(({ product }) => !FIELD_PALLET_FAMILIES.has(product.family));

  for (const { row, product } of products) {
    let rowOutgoing = 0;
    const palletFamily = normalizePalletFamily(product.family);
    const trackPallet = !isNonPalletCountry && FIELD_PALLET_FAMILIES.has(product.family);

    for (const c of activeCustomers) {
      const qty = num(pivotCustomerQuantity(row, c.raw));
      if (!(qty > 0)) continue;
      rowOutgoing += qty;
      entries.push({
        date: c.day,
        region: c.region,
        custKey: c.custKey,
        customer: c.name,
        product,
        previous: 0,
        current: qty,
        details: [],
      });

      if (trackPallet) {
        const palletKey = JSON.stringify([c.day === '미정' ? '미지정' : c.day, c.region || '지역 미지정']);
        const divisor = palletDivisor(palletFamily, row?.prodName || product.label);
        if (!pallets[palletFamily]) pallets[palletFamily] = {};
        pallets[palletFamily][palletKey] = (pallets[palletFamily][palletKey] || 0) + (qty / divisor);
      }
    }

    if (!activeCustomers.length) {
      rowOutgoing = num(sumOrderQty(row));
    }
    outgoingByProdKey.set(product.prodKey, rowOutgoing);
  }

  const selectedFamilies = !isNonPalletCountry
    ? [...new Set(
      products
        .map(({ product }) => normalizePalletFamily(product.family))
        .filter(family => FIELD_PALLET_FAMILIES.has(family))
    )]
    : undefined;

  const plan = {
    kind: 'field-volume-v2',
    orderYear,
    week: resolvedWeek,
    includePrevious: false,
    uploadOnly: true,
    hasPrevious: false,
    dayOrder: [...FIELD_DAY_ORDER].sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99)),
    products: products.map(({ product }) => product),
    customers: activeCustomers.map(c => ({
      custKey: c.custKey,
      region: c.region,
      name: c.name,
    })),
    colors: { ...FIELD_DAY_PALETTE },
    ...(selectedFamilies?.length ? { selectedFamilies, pallets } : {}),
  };

  const totals = plan.products.map(product => ({
    ...product,
    outgoing: outgoingByProdKey.get(product.prodKey) ?? 0,
  }));

  const model = {
    entries,
    totals,
    farms: new Map(),
    details: new Map(),
    lines: [],
  };

  return { plan, model };
}

export async function renderPivotFieldVolumeWorkbook(input) {
  const { plan, model } = buildPivotFieldVolumeInput(input);
  return renderFieldVolumeWorkbook(plan, model);
}
