// 수입 비행기 편별 진행 단계와 놓치기 쉬운 지점 점검. 순수 함수(DB·네트워크·fs 없음).

// 선율방 2026-10-21 글 '오전검역 신청은 오전 9시까지' 기준(교육 녹음의 8시는 '내가 알기로')
export const QUARANTINE_RULES = {
  applyDeadlineHour: 9,          // 오전 검역 신청 마감 09:00
  sameDayArrivalCutoffHour: 9,   // 그날 09:00 이전 도착 예정이면 당일 오전 검역 가능
  noQuarantineWeekdays: [6, 0],  // 토·일 검역 없음
  mondayExcluded: ['중국', '미국'],     // 월요일 검역 없음 → 화요일
  mondayAfternoonOnly: ['콜롬비아'],    // 월요일은 오후 검역
  mondayAfternoonDeadlineHour: 12,      // 월요일 오후 검역 신청 마감 12:00
};

export const ARRIVAL_DAY_PRINCIPLES = {
  중국: { must: [0], label: '중국은 일요일 도착 원칙' },
  콜롬비아: { weekendMust: 6, label: '콜롬비아 주말 도착분은 토요일 도착 원칙' },
};

const SEON = '네노바&선율방';
const AWB_ROOM = '빌번호방';
const HOUR = 3600 * 1000;
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const kst = (ms) => new Date(ms + 9 * HOUR);

export function fmtKst(v) {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return '';
  const d = kst(ms);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function quarantineDeadline(country, arriveAtIso, rules = QUARANTINE_RULES) {
  const ms = Date.parse(arriveAtIso);
  if (!Number.isFinite(ms)) return null;
  const k = kst(ms);
  let dayMs = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (minutes >= rules.sameDayArrivalCutoffHour * 60) dayMs += 24 * HOUR;
  for (let i = 0; i < 14; i++, dayMs += 24 * HOUR) {
    const d = new Date(dayMs);
    const dow = d.getUTCDay();
    if (rules.noQuarantineWeekdays.includes(dow)) continue;
    if (dow === 1 && rules.mondayExcluded.includes(country)) continue;
    const afternoon = dow === 1 && rules.mondayAfternoonOnly.includes(country);
    const hour = afternoon ? (rules.mondayAfternoonDeadlineHour ?? 12) : rules.applyDeadlineHour;
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { deadlineAt: `${date}T${pad(hour)}:00:00+09:00`, quarantineDate: date, slot: afternoon ? '오후' : '오전', assumed: true };
  }
  return null;
}

export function buildChecklist(flight, ctx = {}) {
  const f = flight || {};
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const icn = ctx.icn || null;
  const customsOk = !!(ctx.customs && ctx.customs.found !== false);
  const c = customsOk ? ctx.customs : {};
  const docsSent = ctx.docsSent || null;
  const rooms = f.rooms || [];
  const changeRooms = f.changeRooms || [];
  const hasAwb = !!f.awb;
  const evMs = (e) => Date.parse(e.at);
  const roomEvs = (Array.isArray(ctx.roomEvents) ? ctx.roomEvents : []).filter((e) => e && Number.isFinite(evMs(e))).sort((a, b) => evMs(a) - evMs(b));
  const lastOf = (...keys) => { const l = roomEvs.filter((e) => keys.includes(e.type)); return l[l.length - 1] || null; };
  const qLast = lastOf('quarantine_pass', 'quarantine_fail');

  const noticeMs = Date.parse(f.arriveAt);
  const estIso = icn && (icn.estimatedAt || icn.scheduledAt);
  const effMs = !f.timeAssumed && estIso ? Date.parse(estIso) : noticeMs; // 공항 시각이 있으면 그 기준
  const arriveMs = Number.isFinite(effMs) ? effMs : noticeMs;
  const q = Number.isFinite(arriveMs) ? quarantineDeadline(f.country, new Date(arriveMs).toISOString()) : null;
  const qMs = q ? Date.parse(q.deadlineAt) : NaN;

  const delayMinutes = icn && icn.estimatedAt && Number.isFinite(noticeMs)
    ? Math.round((Date.parse(icn.estimatedAt) - noticeMs) / 60000) : null;
  const actualArrival = icn ? { scheduledAt: icn.scheduledAt || null, estimatedAt: icn.estimatedAt || null, remark: icn.remark || null, delayMinutes } : null;

  const step = (key, label, state, at = null, note = '') => ({ key, label, state, at: at || null, note });
  const wait = (key, label) => step(key, label, 'wait');
  const steps = [];

  steps.push(hasAwb ? step('awb', '빌번호', 'done') : step('awb', '빌번호', 'wait', null, '아직 없음'));

  const hasSeon = rooms.includes(SEON);
  steps.push(hasSeon
    ? step('notice', '도착 공지', 'done', f.lastPostedAt, `3방 중 ${rooms.length}방`)
    : step('notice', '도착 공지', 'late', null, `선율방 공지 없음(3방 중 ${rooms.length}방)`));

  // docs
  let docs;
  if (!hasAwb) docs = wait('docs', '서류 전달');
  else if (docsSent) docs = step('docs', '서류 전달', 'done', docsSent.at, docsSent.by ? `${docsSent.by} 표시` : '');
  else if (c.declaredAt || c.inspectionSetAt) docs = step('docs', '서류 전달', 'done', c.inspectionSetAt || c.declaredAt, '통관 진행으로 확인');
  else if (Number.isFinite(qMs) && qMs - now <= 2 * HOUR) docs = step('docs', '서류 전달', 'late', null, qMs < now ? '검역 신청 마감 지남' : '검역 신청 마감 임박');
  else if (Number.isFinite(qMs) && qMs - now <= 24 * HOUR) docs = step('docs', '서류 전달', 'due', null, '검역 신청 마감 24시간 이내');
  else docs = wait('docs', '서류 전달');
  const docsDeadlineLate = docs.state === 'late';
  // 선율이 서류를 요청했는데, 그 뒤에 서류 전달 표시·검역 합격·검역 진행 글이 없으면 늦음
  const docsSentMs = docsSent ? Date.parse(docsSent.at) : NaN;
  const docsReq = lastOf('docs_request');
  const docsReqOpen = docsReq && !((Number.isFinite(docsSentMs) && docsSentMs > evMs(docsReq))
    || roomEvs.some((e) => evMs(e) >= evMs(docsReq) && (e.type === 'quarantine_pass' || (e.type === 'quarantine_plan' && /진행\s*(했|됩니다|하겠)/.test(e.text || ''))))) ? docsReq : null;
  if (docsReqOpen && docs.note !== '통관 진행으로 확인') docs = step('docs', '서류 전달', 'late', docsReqOpen.at, '선율이 서류를 요청함');
  steps.push(docs);

  const gone = ['in_flight', 'arrived', 'registered'].includes(f.status) || (icn && icn.remark === '도착');
  steps.push(hasAwb ? (gone ? step('departed', '출발', 'done', null, icn && icn.remark === '도착' ? '공항 자료 기준' : '예측 기준') : step('departed', '출발', 'wait', null, '예측 기준')) : wait('departed', '출발'));

  let arrived;
  if (!hasAwb) arrived = wait('arrived', '도착');
  else if ((icn && icn.remark === '도착') || c.arrivedAt) arrived = step('arrived', '도착', 'done', c.arrivedAt || (icn && icn.estimatedAt), '');
  else if (icn && (icn.remark === '결항' || icn.remark === '회항')) arrived = step('arrived', '도착', 'late', null, `공항 자료: ${icn.remark}`);
  else {
    const e = [...roomEvs].reverse().find((x) => x.room === AWB_ROOM && (x.type === 'warehoused' || x.type === 'manifest_qty') && /도착|입항|반입|물건 확인/.test(x.text || ''));
    arrived = e && Number.isFinite(arriveMs) && arriveMs < now ? step('arrived', '도착', 'done', e.at, '빌번호방 글 기준') : wait('arrived', '도착');
  }
  steps.push(arrived);

  let manifest = wait('manifest', '적하');
  let quarantine = wait('quarantine', '검역');
  let cleared = wait('cleared', '수입신고 수리');
  let released = wait('released', '반출');
  if (hasAwb) {
    const manifestEv = [...roomEvs].reverse().find((x) => x.room === AWB_ROOM && x.type === 'manifest_qty');
    if (c.manifestAt) manifest = step('manifest', '적하', 'done', c.manifestAt);
    else if (manifestEv) manifest = step('manifest', '적하', 'done', manifestEv.at, '빌번호방 수량 확인');
    else if (Number.isFinite(arriveMs) && arriveMs - now <= 3 * HOUR) manifest = step('manifest', '적하', 'due', null, '도착 예정 3시간 이내');

    if (c.quarantinePassedAt) quarantine = step('quarantine', '검역', 'done', c.quarantinePassedAt, c.inspectionType || '');
    else if (c.quarantineFailed) quarantine = step('quarantine', '검역', 'late', null, '불합격');
    else if (qLast && qLast.type === 'quarantine_fail') quarantine = step('quarantine', '검역', 'late', qLast.at, '불합격·폐기 글');
    else if (qLast) quarantine = step('quarantine', '검역', 'done', qLast.at, `선율방 글 기준${qLast.guessed ? ' (추정 연결)' : ''}`);
    else if (c.inspectionSetAt) quarantine = step('quarantine', '검역', 'due', c.inspectionSetAt, '검사 진행 중');
    else if (customsOk && Number.isFinite(qMs) && now > qMs) quarantine = step('quarantine', '검역', 'late', null, '검역 신청 마감이 지남');

    if (c.clearedAt) cleared = step('cleared', '수입신고 수리', 'done', c.clearedAt);
    else if (c.declaredAt) cleared = step('cleared', '수입신고 수리', 'due', c.declaredAt, '신고 진행 중');

    if (c.releasedAt) released = step('released', '반출', 'done', c.releasedAt);
  }
  steps.push(manifest, quarantine, cleared, released);

  let receipt = wait('receipt', '입고 등록');
  if (hasAwb) {
    if (f.receipt) receipt = step('receipt', '입고 등록', 'done', f.receipt.registeredAt);
    else if (c.releasedAt && now - Date.parse(c.releasedAt) > 24 * HOUR) receipt = step('receipt', '입고 등록', 'late', null, '반출 뒤 24시간 넘게 등록 없음');
  }
  steps.push(receipt);

  // 경고
  const alerts = [];
  const past = released.state === 'done' || (f.status === 'registered' && Number.isFinite(arriveMs) && arriveMs < now);
  if (!past) {
    const add = (level, text) => alerts.push({ level, text });
    if (!hasSeon) add('red', '도착 공지가 선율방에 없음 — 검역 신청이 빠질 수 있음');
    else if (hasAwb && !rooms.includes(AWB_ROOM)) add('amber', '도착 공지가 빌번호방(백상)에 없음');

    if (delayMinutes != null && !f.timeAssumed && Math.abs(delayMinutes) >= 30) {
      add('amber', `공항 예정 시각이 공지와 다름: 공지 ${fmtKst(noticeMs)} → 공항 ${fmtKst(icn.estimatedAt)}`);
      if (delayMinutes >= 60 && !changeRooms.includes(SEON)) add('red', `지연(+${delayMinutes}분)인데 선율방에 변경 공지 없음`);
    }
    if (icn && (icn.remark === '결항' || icn.remark === '회항')) add('red', `공항 자료: ${icn.remark}`);
    if (f.isChangeNotice && !changeRooms.includes(SEON)) add('red', '스케줄 변경 공지가 선율방에 없음');
    if (ctx.siblings >= 1) add('amber', `같은 차수·나라에 비행기가 ${ctx.siblings + 1}편 — 서류·공지를 편마다 따로 보냈는지 확인`);
    if (docsDeadlineLate) add('red', `검역 신청 마감(${fmtKst(qMs)} 예상)이 ${qMs < now ? '지남' : '임박'} — 서류 전달 표시 없음`);
    if (quarantine.state === 'late' && quarantine.note !== '불합격·폐기 글') add('red', quarantine.note === '불합격' ? '검역 불합격' : '검역 신청 마감이 지났는데 검사 접수가 안 보임');

    // 카톡 방 글에서 읽은 사건 — 48시간 안의 것만, 뒤 글로 풀린 것은 제외
    const recent = (e) => !!e && now - evMs(e) <= 48 * HOUR;
    const when = (e) => fmtKst(e.at);
    const guess = (e) => (e.guessed ? ' · 추정 연결' : '');
    const t60 = (e) => String(e.text || '').slice(0, 60);
    const passAfter = (e) => roomEvs.some((x) => x.type === 'quarantine_pass' && evMs(x) >= evMs(e));
    if (docsReqOpen && recent(docsReqOpen)) add('red', `선율이 서류를 요청함 (${when(docsReqOpen)}): ${t60(docsReqOpen)}${guess(docsReqOpen)}`);
    let e = lastOf('qty_mismatch');
    if (recent(e)) add('red', `선율: 검역증과 인보이스 수량이 다르다고 함 (${when(e)})${guess(e)}`);
    e = lastOf('lmo');
    if (recent(e)) add('red', `선율: LMO 부기·검사 건 (${when(e)})${guess(e)}`);
    e = lastOf('partial_arrival');
    if (recent(e)) add('red', `일부만 입항·잔량 있음 (${when(e)}): ${t60(e)}${guess(e)}`);
    e = lastOf('quarantine_fail');
    if (recent(e) && !passAfter(e)) add('red', `검역 불합격·폐기 글 (${when(e)})${guess(e)}`);
    e = lastOf('customs_inspection');
    if (recent(e)) add('amber', `세관 검사 걸림 (${when(e)})${guess(e)}`);
    e = lastOf('arrival_late');
    if (recent(e)) add('amber', `입항·입고가 늦어진다는 글 (${when(e)})${guess(e)}`);
    e = lastOf('docs_pending_staff');
    if (recent(e) && !passAfter(e) && !(Number.isFinite(docsSentMs) && docsSentMs > evMs(e))) add('amber', `서류를 아직 못 받았다는 글이 있음 (${when(e)})${guess(e)}`);

    if (Number.isFinite(arriveMs)) {
      const dow = kst(arriveMs).getUTCDay();
      const p = ARRIVAL_DAY_PRINCIPLES;
      if (f.country === '중국' && !p.중국.must.includes(dow)) add('amber', `중국은 일요일 도착 원칙 — ${DAY_NAMES[dow]}요일 도착 예정`);
      if (f.country === '콜롬비아' && dow === 0) add('amber', '콜롬비아 주말 도착분은 토요일 원칙 — 일요일 도착 예정');
    }
  }

  return { steps, alerts, quarantine: q, actualArrival, customsAvailable: customsOk };
}
