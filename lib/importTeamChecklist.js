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
export function checklistEmployeeSettingsKey(year) {
  checklistVacationKey(year);
  return `checklist.settings.employees.${year}`;
}
export const SHARED_KEYS = { pending: 'checklist.pending', flights: 'checklist.flights', planting: 'checklist.planting', plantingSettings: 'checklist.settings.planting' };

// Names are historical identifiers, not mutable display labels. Only the quota
// or target is edited in place; removing a setting never rewrites its records.
function validateNamedSettings(value, field) {
  if (!Array.isArray(value) || value.length > 500) throw new Error('설정 목록은 500개 이하여야 합니다.');
  const names = new Set();
  for (const row of value) {
    const plain = row && typeof row === 'object' && !Array.isArray(row)
      && (Object.getPrototypeOf(row) === null || Object.getPrototypeOf(Object.getPrototypeOf(row)) === null);
    const allowed = ['name', field];
    if (field === 'total' && Object.hasOwn(row ?? {}, 'adjustmentReason')) allowed.push('adjustmentReason');
    if (field === 'total' && Object.hasOwn(row ?? {}, 'remainingAdjustment')) allowed.push('remainingAdjustment');
    if (!plain || Object.keys(row).sort().join(',') !== allowed.sort().join(',')) throw new Error('설정 필드를 확인하세요. 담당자 정보나 추가 필드는 허용하지 않습니다.');
    if (typeof row.name !== 'string' || !row.name || row.name.length > 80 || row.name !== row.name.trim()
      || /[\u0000-\u001f\u007f]/.test(row.name) || names.has(row.name)) throw new Error('이름은 공백 없이 고유하게 입력하세요 (최대 80자).');
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0) throw new Error('연차·목표는 유한한 0 이상의 숫자여야 합니다.');
    if (Object.hasOwn(row, 'adjustmentReason') && (typeof row.adjustmentReason !== 'string' || !row.adjustmentReason || row.adjustmentReason.length > 500
      || row.adjustmentReason !== row.adjustmentReason.trim() || /[\u0000-\u001f\u007f]/.test(row.adjustmentReason))) throw new Error('조정 사유는 공백 없이 1~500자로 입력하세요.');
    if (Object.hasOwn(row, 'remainingAdjustment')) {
      const adjustment = row.remainingAdjustment;
      if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment)
        || Object.keys(adjustment).sort().join(',') !== 'desiredRemaining,expectedVacationRevision'
        || typeof adjustment.desiredRemaining !== 'number' || !Number.isFinite(adjustment.desiredRemaining) || adjustment.desiredRemaining < 0
        || !Number.isSafeInteger(adjustment.expectedVacationRevision) || adjustment.expectedVacationRevision < 0
        || !row.adjustmentReason) throw new Error('잔여 조정값·휴가 버전·조정 사유를 확인하세요.');
    }
    names.add(row.name);
  }
  return value;
}
export function validateEmployeeSettings(value) { return validateNamedSettings(value, 'total'); }
export function validatePlantingSettings(value) { return validateNamedSettings(value, 'target'); }
export function validateEmployeeSettingsChange(before, after) {
  validateEmployeeSettings(after);
  for (const row of after) {
    const previous = before.find(item => item.name === row.name);
    if (previous && previous.total !== row.total && !row.adjustmentReason) throw new Error('연차·잔여 일수를 변경하려면 조정 사유를 입력하세요.');
  }
  return after;
}
export function adjustVacationRemaining(config, list, name, remaining, reason, expectedVacationRevision) {
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0) throw new Error('잔여 일수는 유한한 0 이상의 숫자여야 합니다.');
  if (typeof reason !== 'string') throw new Error('조정 사유는 문자열로 입력하세요.');
  if (!config.some(row => row.name === name)) throw new Error('직원 설정이 삭제되었습니다. 최신 설정을 확인하세요.');
  const used = vacationDaysUsed(list, name);
  const total = vacationAdjustedTotal(used, remaining);
  const next = config.map(row => row.name === name ? { ...row, total, adjustmentReason: reason.trim(), remainingAdjustment: { desiredRemaining: remaining, expectedVacationRevision } } : row);
  return validateEmployeeSettingsChange(config, next);
}

export function checklistSettingsOptions(list, config, reference) {
  const rows = config.map(row => ({ ...row, configured: true }));
  const names = new Set(rows.map(row => row.name));
  for (const entry of list) {
    const name = entry[reference];
    if (typeof name === 'string' && name && !names.has(name)) {
      rows.push({ name, configured: false });
      names.add(name);
    }
  }
  return rows;
}
export function weekdayForDate(date) {
  checklistDayKey(date);
  return DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}
export function weekDates(date) {
  const weekday = weekdayForDate(date);
  const monday = Date.parse(`${date}T00:00:00Z`) - DAYS.findIndex(day => day.id === weekday.id) * DAY_MS;
  return DAYS.map((day, index) => ({ ...day, date: new Date(monday + index * DAY_MS).toISOString().slice(0, 10) }));
}
export function checklistTemplateKey(weekday) {
  if (!DAYS.some(day => day.id === weekday)) throw new Error('유효한 요일을 선택하세요.');
  return `checklist.templates.${weekday}`;
}
export function defaultWeekdayTemplate(weekday) {
  checklistTemplateKey(weekday);
  return { tasks: Object.entries(TASKS[weekday]).flatMap(([country, texts]) => texts.map((text, index) => ({ id: `${country}::${index}`, country, text }))) };
}
export function validateWeekdayTemplate(weekday, value) {
  const originals = new Set(defaultWeekdayTemplate(weekday).tasks.map(task => task.id));
  const plain = item => item && typeof item === 'object' && !Array.isArray(item)
    && (Object.getPrototypeOf(item) === null || Object.getPrototypeOf(Object.getPrototypeOf(item)) === null);
  const validText = (text, max) => typeof text === 'string' && text.length > 0 && text.length <= max
    && text === text.trim() && !/[\u0000-\u001f\u007f]/.test(text);
  if (!plain(value) || Object.keys(value).length !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 500) throw new Error('요일 업무 목록 형식을 확인하세요.');
  const ids = new Set();
  for (const task of value.tasks) {
    if (!plain(task) || Object.keys(task).sort().join(',') !== 'country,id,text'
      || typeof task.id !== 'string' || !(originals.has(task.id) || /^task::[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task.id))
      || ids.has(task.id) || !validText(task.country, 80) || !validText(task.text, 1000)) throw new Error('업무 ID·국가·내용을 확인하세요. 중복 ID나 추가 필드는 허용하지 않습니다.');
    ids.add(task.id);
  }
  return value;
}
export function dailyTasks(date, template = defaultWeekdayTemplate(weekdayForDate(date).id)) {
  const groups = new Map();
  for (const { id, country, text } of template.tasks) {
    if (!groups.has(country)) groups.set(country, { country, tasks: [] });
    groups.get(country).tasks.push({ key: id, text });
  }
  return [...groups.values()];
}
export function checklistProgress(date, state = {}, template) {
  const keys = dailyTasks(date, template).flatMap(group => group.tasks.map(task => task.key));
  const done = keys.filter(key => state[key] === true).length;
  return { done, total: keys.length, percent: keys.length ? Math.round(done / keys.length * 100) : 0 };
}
export function monthlyTaskKey(task, index) { return `day${task.day}_${index}`; }

// Reapply only this draft's edits; unrelated concurrent checks must survive review.
export function rebaseChecklistDraft(draft, latest, revision) {
  const value = { ...latest };
  for (const key of new Set([...Object.keys(draft.base), ...Object.keys(draft.value)])) {
    if (draft.base[key] !== draft.value[key]) {
      if (Object.hasOwn(draft.value, key)) value[key] = draft.value[key];
      else delete value[key];
    }
  }
  return { value, base: { ...latest }, revision };
}
export function checkedActorLabel(checked, actor) {
  if (!checked) return '';
  if (!actor?.userId || !actor.at || actor.checked !== true || !Number.isFinite(Date.parse(actor.at))) return '체크 담당자: 알 수 없음 (기존 기록)';
  return `체크 담당자: ${actor.userName || actor.userId} (${actor.userId}) · ${new Date(actor.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`;
}

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

const MAX_RECORD_ENTRIES = 10000;
const plainRecord = row => row && typeof row === 'object' && !Array.isArray(row)
  && (Object.getPrototypeOf(row) === null || Object.getPrototypeOf(Object.getPrototypeOf(row)) === null);
const validRecordId = id => typeof id === 'number' ? Number.isFinite(id) && id > 0 && id <= Number.MAX_SAFE_INTEGER
  : typeof id === 'string' && id === id.trim() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
const validRecordName = name => typeof name === 'string' && !!name && name === name.trim() && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name);
const validRecordNote = note => typeof note === 'string' && note.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note);
function validateEntryList(value, shape, validateRow) {
  if (!Array.isArray(value) || value.length > MAX_RECORD_ENTRIES) throw new Error('업무 내역은 10,000개 이하의 목록이어야 합니다.');
  const ids = new Set();
  for (const row of value) {
    if (!plainRecord(row) || Object.keys(row).sort().join(',') !== shape) throw new Error('업무 내역 필드를 확인하세요. 추가 필드나 담당자 정보는 입력할 수 없습니다.');
    if (!validRecordId(row.id) || ids.has(String(row.id))) throw new Error('업무 ID가 유효하지 않거나 중복되었습니다.');
    ids.add(String(row.id));
    validateRow(row);
  }
  return value;
}
export function validateVacationEntries(value, year) {
  checklistVacationKey(year);
  // Source always saves all six fields, including end: end || start.
  // Historical employee names remain valid even after removing their config.
  return validateEntryList(value, 'days,employee,end,id,note,start', row => {
    if (!validRecordName(row.employee) || !validRecordNote(row.note)) throw new Error('직원 이름은 80자, 휴가 메모는 2,000자 이하여야 합니다.');
    if (!isDate(row.start) || !isDate(row.end) || row.end < row.start || Number(row.start.slice(0, 4)) !== Number(year)) throw new Error('휴가 날짜·시작 연도를 확인하세요.');
    if (typeof row.days !== 'number' || !Number.isFinite(row.days) || row.days <= 0 || row.days > 366) throw new Error('휴가 일수는 0 초과 366 이하의 유한한 숫자여야 합니다.');
  });
}
export function validatePlantingEntries(value) {
  return validateEntryList(value, 'boxes,createdAt,farm,id,note,price,variety', row => {
    if (!validRecordName(row.variety) || typeof row.farm !== 'string' || !row.farm.trim() || row.farm !== row.farm.trim()
      || row.farm.length > 200 || /[\u0000-\u001f\u007f]/.test(row.farm) || !validRecordNote(row.note)) throw new Error('품종·농장명·재배 메모를 확인하세요.');
    if (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || typeof row.boxes !== 'number' || !Number.isFinite(row.boxes) || row.boxes <= 0 || row.boxes > 1e9
      || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0 || row.price > 1e9) throw new Error('재배 수량·단가·등록 시각을 확인하세요. 수량과 단가는 10억 이하여야 합니다.');
  });
}
export function vacationDaysUsed(list, employee) {
  if (!Array.isArray(list) || list.length > MAX_RECORD_ENTRIES) throw new Error('휴가 사용량 목록을 확인하세요.');
  let used = 0;
  for (const row of list) {
    if (!row || typeof row.employee !== 'string' || typeof row.days !== 'number' || !Number.isFinite(row.days) || row.days <= 0 || row.days > 366) throw new Error('휴가 사용량에 유효하지 않은 일수가 있습니다.');
    if (row.employee === employee) used += row.days;
    if (!Number.isFinite(used)) throw new Error('휴가 사용량 합계가 너무 큽니다.');
  }
  return used;
}
export function vacationAdjustedTotal(used, remaining) {
  const total = used + remaining;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || !Number.isFinite(total)) throw new Error('사용량·잔여량·연간 연차 합계는 유한한 0 이상의 숫자여야 합니다.');
  return total;
}

export function validateVacation(draft, year, employees = EMPLOYEES) {
  if (!employees.some(employee => employee.name === draft.employee)) throw new Error('직원을 선택하세요.');
  if (!isDate(draft.start)) throw new Error('Introduce al menos la fecha de inicio.');
  const end = draft.end || draft.start;
  if (!isDate(end) || end < draft.start) throw new Error('종료일은 시작일 이후여야 합니다.');
  if (Number(draft.start.slice(0, 4)) !== Number(year)) throw new Error('시작일의 연도를 선택한 뒤 저장하세요. 초안은 유지됩니다.');
  const days = Number(draft.days);
  if (!Number.isFinite(days) || days <= 0 || days > 366) throw new Error('휴가 일수는 0 초과 366 이하로 입력하세요.');
  const note = String(draft.note ?? '').trim();
  if (!validRecordNote(note)) throw new Error('휴가 메모는 2,000자 이하여야 합니다.');
  return { employee: draft.employee, start: draft.start, end, days, note };
}
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function vacationSummary(list, employees = EMPLOYEES) {
  return checklistSettingsOptions(list, employees, 'employee').map(employee => {
    const used = vacationDaysUsed(list, employee.name);
    const remaining = employee.configured ? employee.total - used : null;
    return { ...employee, used, remaining, percent: !employee.total ? 0 : Math.max(0, Math.min(100, remaining / employee.total * 100)), status: !employee.configured ? 'unconfigured' : remaining <= 0 ? 'danger' : remaining <= employee.total * 0.3 ? 'warning' : 'normal' };
  });
}
export function validatePlanting(draft, varieties = PLANT_VARIETIES) {
  if (!varieties.some(variety => variety.name === draft.variety)) throw new Error('품종을 선택하세요.');
  const farm = String(draft.farm ?? '').trim(), boxes = Number(draft.boxes), price = Number(draft.price);
  if (!farm) throw new Error('Escribe el nombre de la finca.');
  if (!Number.isFinite(boxes) || boxes <= 0) throw new Error('Introduce el número de cajas (mayor que 0).');
  if (boxes > 1e9 || price > 1e9) throw new Error('재배 수량과 단가는 10억 이하여야 합니다.');
  if (String(draft.price ?? '').trim() === '' || !Number.isFinite(price) || price < 0) throw new Error('Introduce un precio válido en USD.');
  return { variety: draft.variety, farm, boxes, price, note: String(draft.note ?? '').trim() };
}
export function plantingSummary(list, varieties = PLANT_VARIETIES) {
  return checklistSettingsOptions(list, varieties, 'variety').map(variety => {
    const assigned = list.filter(row => row.variety === variety.name).reduce((sum, row) => sum + numeric(row.boxes), 0);
    return { ...variety, assigned, remaining: variety.configured ? variety.target - assigned : null, percent: !variety.target ? (assigned > 0 ? 100 : 0) : Math.max(0, Math.min(100, assigned / variety.target * 100)), status: !variety.configured ? 'unconfigured' : assigned > variety.target ? 'over' : assigned === variety.target ? 'complete' : 'normal' };
  });
}
export function groupPlanting(list, view = 'farm', varieties = PLANT_VARIETIES) {
  const groups = new Map();
  for (const row of list) {
    const key = view === 'all' ? 'Todas las asignaciones' : row[view] || '(sin nombre)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const rank = name => { const index = varieties.findIndex(row => row.name === name); return index < 0 ? 999 : index; };
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
