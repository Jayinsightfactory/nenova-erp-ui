// Canonical task text/options from Import_Team_Checklist_Diario_2.html.
// Web-only team records: no ERP, browser storage, or network dependencies.
export const TASKS = {
  lunes: {
    Netherlands: [
      'Comprobar Lista de Empaquetado de Netherlands y que esté en el Drive',
      'Comprobar precios de todas las variedades de EZ y Holex que estemos pidiendo',
      'Comprobar orden del Miércoles en la página web de Holex/EZ si tienen ETA Miércoles',
      'Preguntar si tienen pedido de Netherlands para el Miércoles si no lo han hecho',
    ],
    Tailandia: ['Comprobar Lista de Empaquetado de Tailandia y que esté en el Drive', 'Preguntar disponibilidad de variedades de Tailandia', 'Hacer 원가자료 de Tailandia'],
    Australia: ['Hacer 원가자료 de Australia', 'Si hay pedido de Australia: pedir documentos, subirlos al Drive, mandarlos por email, subir horarios en Kakao'],
    Colombia: ['Packing List (1차) — comprobar invoices con packing (cantidad y precios)', 'Subir packings también de los AWB', 'Fitos — en los claveles siempre debe figurar NON LMO', 'Mandar correos (백상 y 선율)', 'Subir documentos al Drive', 'Revisar aviones del fin de semana', 'Excel de % confirmados del 차주 pasado', '원가자료', '발주 1차 + 2차 (수국 no)'],
    China: ['9:00 — Comprobar estado de vuelo del pedido con llegada Domingo', '9:00 — Comprobar documentos: AWB, Phyto, CO, CI (cantidades, nº invoice, fecha, items)', '9:30 — Crear packing list y subir al ERP (revisar total)', '9:30 — Enviar PL del proveedor a nenova e Import cost', '10:30 — Mandar documentos revisados (AWB, CI, Phyto, CO, PL CL) y subir al Drive', 'Enviar claims', 'Revisar incrementos de precios, claims y tarifas de vuelo'],
    General: ['Comprobar Unipass para que todo esté en 반입 완료', 'Comprobar si hay quejas que hayan mandado en el fin de semana', '불량차감 확인하고 차장님에게 드리기'],
  },
  martes: {
    Netherlands: ['Comprobar pedido de Netherlands si hay para ETA Miércoles', 'Comprobar que no haya problemas con el pedido del Miércoles', 'Comprobar Proforma si hay pedido del Miércoles y hacer 원가자료'],
    Tailandia: ['Hacer pedido de Tailandia y mandar orden al grupo de Importación'],
    Vietnam: ['Hacer pedido de Vietnam si lo hay', 'Si hay pedido hecho: mandar papeles, subir al Drive y mandar horarios'],
    Australia: ['Hacer pedido de Australia si lo hay', 'Preguntar si tienen pedido de Australia y mandar orden al grupo de Importación', 'Si hay pedido de Australia para el Martes: comprobar 반입 완료'],
    Colombia: ['Comprobar aviones si hay', '원가자료 — rellenarlo con el packing list y subirlo a 수입방', 'Revisar excel de Karen', 'Hacer el 지출결의서 que manda 선율', 'Revisar informes de calidad'],
    General: ['Meeting Importación — 수입부 회의', 'Estar atento a additions y cancelaciones'],
  },
  miercoles: {
    Netherlands: ['Mandar documentos de Netherlands y subir lista de empaquetado si hay pedido del Miércoles', 'Mandar horario del vuelo en los tres grupos', 'Hacer pedido de Netherlands, dividiendo por EZ y Holex'],
    Vietnam: ['Pedir factura de Vietnam y preparar el pago'],
    Australia: ['Si hay pedido de Australia y ha llegado el día anterior: comprobar 반입 완료'],
    Colombia: ['Comprobar aviones', 'Revisar excel de Karen', 'Organizar defectuosos', 'Subir 2차 수국'],
    China: ['9:00 — Comprobar estado de vuelo del pedido con llegada hoy', '9:00 — Comprobar documentos: AWB, Phyto, CO, CI (cantidades, nº invoice, fecha, items)', '9:30 — Crear packing list y subir al ERP', '9:30 — Enviar PL del proveedor a nenova e Import cost', '10:30 — Mandar documentos revisados y subir al Drive', 'Enviar pedido a Melody 00-2 (Arrival Domingo)', 'Revisar incrementos de precios, claims y tarifas de vuelo'],
    Ecuador: ['9:00 — Revisar y enviar a Seonyul documentos de Ecuador (AWB, Customs Invoice, Phyto) y subir al Drive', '9:30 — Crear packing list y subir al ERP (revisar total)', '10:30 — Revisar total del pedido', 'Enviar claims', 'Enviar pedido Ecuador (Arrival próximo Viernes)'],
    General: ['Reunión particular por empleado — 직원별 개별 면담'],
  },
  jueves: {
    Netherlands: ['Comprobar que toda la orden de Netherlands esté correcta, ver si hay agregados'],
    Tailandia: ['Comprobar que toda la orden de Tailandia esté correcta, ver si hay agregados'],
    Colombia: ['Packing List (2차) — subir packing list 2차 콜카장', 'Subir packing list aviones 코카장 콜수국 2차', '지출결의서 que manda 선율', 'Meeting Ventas — reunión con el equipo de ventas', 'Revisar excel de Karen', 'Informar issues 2차 — Rosas', 'Informar issues 2차 — Carnation', 'Informar issues 2차 — Alstromeria', 'Informar issues 2차 — Ruscus', 'Informar issues 2차 — Hortensias'],
    China: ['Crear pedido China 00-1 (Arrival próximo Miércoles)', 'Cloud compare precios y ordenar mejor deal de las farms', 'Enviar claims', 'Estar atento a additions y cancelaciones'],
    General: ['Actualizar excel de quejas y comprobar que las hayan mandado todas', 'Comprobar Unipass para que todo esté en 반입 완료'],
  },
  viernes: {
    Netherlands: ['Comprobar Proforma Netherlands, hacer 원가자료', 'Preparar email fin de semana'],
    Tailandia: ['Confirmación de Tailandia y fotos de las variedades', 'Preparar email fin de semana'],
    'Holex / EZ': ['Comprobar orden del Domingo en la página web de Holex/EZ'],
    Colombia: ['운임비 y mandarlo a 명훈님', '발주 2차 de 수국', 'Correos 2차', 'Excel de 입고량 → mandar a 이사님', 'Subir al Drive 2차', 'Revisar excel de Karen', '⭐ 신라 확인하기 — 수국 2차 발주', 'Informar issues — Rosas', 'Informar issues — Carnation', 'Informar issues — Alstromeria', 'Informar issues — Ruscus', 'Informar issues — Hortensias'],
    Ecuador: ['9:00 — Comprobar estado de vuelo del pedido con llegada Viernes (Ecuador)', 'Enviar claims'],
    China: ['Cloud compare prices, ordenar mejor deal de farms, confirmar cantidades y reorder', 'Añadir items a Melody si no encuentras las flores ordenadas'],
    General: ['Hacer lista de Problemas y preparar excel de porcentaje de confirmaciones', '주말 스케쥴 공유', 'Estar atento a additions y cancelaciones'],
  },
  sabado: { 'China / Ecuador': ['Estar atento a additions y cancelaciones'], General: ['Comprobar papeles de Tailandia y Netherlands'] },
  domingo: { 'China / Ecuador': ['Revisar total del pedido', 'Estar atento a additions y cancelaciones'], General: ['Comprobar papeles de Tailandia y Netherlands'] },
};

export const DAYS = [
  { id: 'lunes', label: 'Lun', full: 'Lunes' }, { id: 'martes', label: 'Mar', full: 'Martes' },
  { id: 'miercoles', label: 'Mié', full: 'Miércoles' }, { id: 'jueves', label: 'Jue', full: 'Jueves' },
  { id: 'viernes', label: 'Vie', full: 'Viernes' }, { id: 'sabado', label: 'Sáb', full: 'Sábado' },
  { id: 'domingo', label: 'Dom', full: 'Domingo' },
];
export const MONTHLY_TASKS = [
  { day: 1, desc: '포딩비 결제 정리하기' }, { day: 5, desc: 'Tiba · 수입 수량 네노바/한국' },
  { day: 15, desc: 'Resto de fincas · rosas & claveles' }, { day: 25, desc: 'Hortensias' },
  { day: 30, desc: 'Empleados Colombia + 보딩업체' },
  { day: 30, desc: 'Justificar gastos tarjeta del departamento de importación' },
];
export const EMPLOYEES = [{ name: 'Gabriel', total: 15 }, { name: 'Adriana', total: 15 }, { name: 'Wonbin', total: 11 }];
export const PLANT_VARIETIES = [
  { name: 'Polimnia', target: 50 }, { name: 'Cherrio', target: 600 }, { name: 'Coroline', target: 100 },
  { name: 'Majesta', target: 200 }, { name: 'Maruchi', target: 50 }, { name: 'Ikebana', target: 50 },
];
const DAY_MS = 86400000;
const KST_OFFSET = 9 * 3600000;
export function getKstDate(now = new Date()) {
  return new Date(new Date(now).getTime() + KST_OFFSET).toISOString().slice(0, 10);
}
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function checklistDayKey(date) {
  if (!isDate(date)) throw new Error('날짜는 유효한 YYYY-MM-DD 형식이어야 합니다.');
  return `checklist.day.${date}`;
}
export function checklistMonthKey(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('유효한 YYYY-MM 월을 선택하세요.');
  return `checklist.month.${month}`;
}
export function checklistVacationKey(year) {
  if (!Number.isInteger(Number(year)) || !/^\d{4}$/.test(String(year))) throw new Error('유효한 연도를 선택하세요.');
  return `checklist.vacations.${year}`;
}
export const SHARED_KEYS = { pending: 'checklist.pending', flights: 'checklist.flights', planting: 'checklist.planting' };
export function weekdayForDate(date) {
  checklistDayKey(date);
  return DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}
export function weekDates(date) {
  const weekday = weekdayForDate(date);
  const monday = Date.parse(`${date}T00:00:00Z`) - DAYS.findIndex(day => day.id === weekday.id) * DAY_MS;
  return DAYS.map((day, index) => ({ ...day, date: new Date(monday + index * DAY_MS).toISOString().slice(0, 10) }));
}
export function dailyTasks(date) {
  return Object.entries(TASKS[weekdayForDate(date).id]).map(([country, texts]) => ({ country, tasks: texts.map((text, index) => ({ key: `${country}::${index}`, text })) }));
}
export function checklistProgress(date, state = {}) {
  const keys = dailyTasks(date).flatMap(group => group.tasks.map(task => task.key));
  const done = keys.filter(key => state[key] === true).length;
  return { done, total: keys.length, percent: keys.length ? Math.round(done / keys.length * 100) : 0 };
}
export function monthlyTaskKey(task, index) { return `day${task.day}_${index}`; }

// Original 60-day rollover rule, made deterministic and independent of browser timezone.
export function parseFlightDate(text, now = new Date()) {
  const match = String(text ?? '').match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:[^\d]*?(\d{1,2})\s*:\s*(\d{2}))?/);
  if (!match) return Infinity;
  const month = Number(match[1]), day = Number(match[2]), hour = Number(match[3] ?? 0), minute = Number(match[4] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return Infinity;
  const reference = new Date(now).getTime();
  let year = Number(getKstDate(now).slice(0, 4));
  const candidateFor = y => Date.UTC(y, month - 1, day, hour, minute) - KST_OFFSET;
  if (reference - candidateFor(year) > 60 * DAY_MS) year += 1;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isDate(iso) ? candidateFor(year) : Infinity;
}
export function sortFlights(list, now = new Date()) {
  return [...list].sort((a, b) => {
    const left = parseFlightDate(a.text, now), right = parseFlightDate(b.text, now);
    return left === right ? 0 : left < right ? -1 : 1;
  });
}
export function upsertEntry(list, entry) {
  if (entry.id === undefined || entry.id === null) throw new Error('업무 항목 ID가 필요합니다.');
  return list.some(row => row.id === entry.id) ? list.map(row => row.id === entry.id ? { ...row, ...entry } : row) : [...list, entry];
}
export function deleteEntry(list, id) { return list.filter(row => row.id !== id); }
export function validateVacation(draft, year) {
  if (!EMPLOYEES.some(employee => employee.name === draft.employee)) throw new Error('직원을 선택하세요.');
  if (!isDate(draft.start)) throw new Error('Introduce al menos la fecha de inicio.');
  const end = draft.end || draft.start;
  if (!isDate(end) || end < draft.start) throw new Error('종료일은 시작일 이후여야 합니다.');
  if (Number(draft.start.slice(0, 4)) !== Number(year)) throw new Error('시작일의 연도를 선택한 뒤 저장하세요. 초안은 유지됩니다.');
  const days = Number(draft.days);
  if (!Number.isFinite(days) || days <= 0) throw new Error('Introduce el número de días (mayor que 0).');
  return { employee: draft.employee, start: draft.start, end, days, note: String(draft.note ?? '').trim() };
}
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function vacationSummary(list) {
  return EMPLOYEES.map(employee => {
    const used = list.filter(row => row.employee === employee.name).reduce((sum, row) => sum + numeric(row.days), 0);
    const remaining = employee.total - used;
    return { ...employee, used, remaining, percent: Math.max(0, Math.min(100, remaining / employee.total * 100)), status: remaining <= 0 ? 'danger' : remaining <= employee.total * 0.3 ? 'warning' : 'normal' };
  });
}
export function validatePlanting(draft) {
  if (!PLANT_VARIETIES.some(variety => variety.name === draft.variety)) throw new Error('품종을 선택하세요.');
  const farm = String(draft.farm ?? '').trim(), boxes = Number(draft.boxes), price = Number(draft.price);
  if (!farm) throw new Error('Escribe el nombre de la finca.');
  if (!Number.isFinite(boxes) || boxes <= 0) throw new Error('Introduce el número de cajas (mayor que 0).');
  if (String(draft.price ?? '').trim() === '' || !Number.isFinite(price) || price < 0) throw new Error('Introduce un precio válido en USD.');
  return { variety: draft.variety, farm, boxes, price, note: String(draft.note ?? '').trim() };
}
export function plantingSummary(list) {
  return PLANT_VARIETIES.map(variety => {
    const assigned = list.filter(row => row.variety === variety.name).reduce((sum, row) => sum + numeric(row.boxes), 0);
    return { ...variety, assigned, remaining: variety.target - assigned, percent: Math.max(0, Math.min(100, assigned / variety.target * 100)), status: assigned > variety.target ? 'over' : assigned === variety.target ? 'complete' : 'normal' };
  });
}
export function groupPlanting(list, view = 'farm') {
  const groups = new Map();
  for (const row of list) {
    const key = view === 'all' ? 'Todas las asignaciones' : row[view] || '(sin nombre)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const rank = name => { const index = PLANT_VARIETIES.findIndex(row => row.name === name); return index < 0 ? 999 : index; };
  return [...groups].sort(([a], [b]) => view === 'variety' ? rank(a) - rank(b) : a.localeCompare(b, 'es')).map(([name, rows]) => ({ name, boxes: rows.reduce((sum, row) => sum + numeric(row.boxes), 0), entries: [...rows].sort((a, b) => numeric(b.createdAt) - numeric(a.createdAt)) }));
}
// The source price is USD per stem, not per box; it has no stems-per-box multiplier.
// Do not invent a boxes * price monetary total.
export function fmtUSD(value) { return '$' + numeric(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }

export function checklistErrorMessage(error) {
  const message = typeof error === 'string' ? error : error?.message || '공동 상태 저장/조회에 실패했습니다.';
  const conflict = error?.status === 409 || error?.statusCode === 409 || /conflict|revision|409|충돌|먼저 수정|다른 직원의 저장/i.test(`${error?.code ?? ''} ${message}`);
  return conflict ? `${message} — 다른 팀원이 수정했습니다. 최신 상태를 불러온 뒤 초안과 비교하여 다시 저장하세요.` : message;
}
// Shared by the UI and executable tests: never acknowledge/reset a draft before success.
export async function saveChecklistDraft(save, nextValue, onSuccess) {
  await save(nextValue);
  if (onSuccess) onSuccess();
}
