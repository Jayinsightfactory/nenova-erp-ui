// lib/pmUnresolved.js — /pm "PM이 스스로 해결 못 한 일" 목록 순수함수(표시 전용, 원본 피드는 건드리지 않는다).
// 데이터: pm-office 피드의 tasks = [{ key, state, days, msg, decision, owner }]
// 판정 기준(2026-11-13 사장님 지시): ①PM이 조사했지만 끝내지 못해 올린 건(escalated)
//   ②승인·사람 손이 필요한 건(needs-approval) ③3일 넘게 안 풀린 건(days >= 3).
// 조사 중·검증 중·예정인 건은 PM이 아직 스스로 처리하는 중이라 넣지 않는다.
// 제목은 내부 이름(staff-decode-fresh, auto-erpgap 등)을 빼고 "어느 PC/어느 일이 멈췄는지"로 쓴다.

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// "아드리아나(마지막 없음), 박성수(10:13)" → "아드리아나·박성수"
const names = (s) => str(s).replace(/\([^)]*\)/g, '').split(/[,·/]/).map((x) => x.trim()).filter(Boolean).join('·');

export function isUnresolved(t) {
  if (!t || typeof t !== 'object') return false;
  const s = str(t.state);
  return /escalat/i.test(s) || /approv|승인/i.test(s) || num(t.days) >= 3;
}

// 한 건 → { group, title, todo }. group 이 같으면 한 줄로 묶는다(같은 종류가 여러 줄로 도배되지 않게).
export function plainTitle(t) {
  const key = str(t.key); const msg = str(t.msg); let m;
  if (key === 'staff-decode-fresh') {
    m = msg.match(/해독\s*(\d+)\s*시간\+?\s*멈춤\s*[:：]\s*(.+)$/);
    return { title: m ? `${names(m[2])} PC 화면 해독이 ${m[1]}시간 넘게 멈춤` : 'PC 화면 해독이 멈춤' };
  }
  if (key === 'staff-silent') {
    m = msg.match(/(\d+)\s*분\+?\s*무응답\s*[:：]\s*(.+)$/);
    return { title: m ? `${names(m[2])} PC가 ${m[1]}분 넘게 응답 없음` : '응답 없는 PC가 있음' };
  }
  if ((m = key.match(/^auto-erpgap-(.+)$/))) {
    const who = m[1]; const c = msg.match(/저장\s*(\d+)\s*건 중 일치\s*(\d+)\s*건/);
    return { title: c ? `${who} PC 전산 대조: ${c[1]}건 중 ${Math.max(0, c[1] - c[2])}건 안 맞음` : `${who} PC 전산 대조가 안 맞음` };
  }
  if (key === 'kakao-report') {
    m = msg.match(/마지막 발송\s*\d{4}-(\d{2})-(\d{2})/);
    return { title: m ? `카톡 일일 보고가 ${Number(m[1])}/${Number(m[2])} 이후 안 나감` : '카톡 일일 보고가 안 나감', todo: '다시 보낼지 결정' };
  }
  if (key === 'radar-pilot-stale') {
    m = msg.match(/미완\s*(\d+)\s*건/);
    return { title: `기술 시험 ${m ? `${m[1]}건이` : '일부가'} 7일 넘게 시작 못 함` };
  }
  if (/^radar-pilot-/.test(key)) {
    m = msg.match(/\[기술 파일럿\]\s*(\S+)\s*시험 완료\s*[—-]\s*(\d+)\s*점/);
    const repo = m ? m[1].split('/').pop() : key.replace(/^radar-pilot-/, '');
    return { title: `기술 시험 끝남: ${repo}${m ? ` (${m[2]}점)` : ''}`, todo: '쓸지 말지 결정' };
  }
  if (/vision-decode-verify/.test(key)) return { group: 'vision-verify', title: '야간 화면 해독 개선 효과 확인이 안 끝남' };
  if (/^auto-todo-/.test(key)) return { group: 'todo', title: '프로그램에 미완성으로 남은 곳', unit: '곳' };
  if (/^auto-ci-/.test(key)) return { group: 'ci', title: 'Orbit 자동 검사 실패', unit: '건' };
  // 직원 자리별 기록 근거 하락·부족은 자리마다 한 줄씩 올라와 목록을 덮으므로 한 줄로 묶는다.
  if (/^데이터 병목\(/.test(msg)) return { group: 'data-gap', title: '기록 근거가 줄거나 부족한 직원 자리', unit: '곳' };
  // 모르는 종류: 앞의 [표시]와 내부 이름을 떼고 첫 구절만.
  const clean = msg.replace(/^\s*\[[^\]]*\]\s*/, '').split(/\s[—-]\s|[.。]\s/)[0].trim();
  return { title: clean ? (clean.length > 44 ? `${clean.slice(0, 43)}…` : clean) : '확인이 필요한 일' };
}

export function pmUnresolved(tasks) {
  const out = []; const byGroup = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!isUnresolved(t)) continue;
    const p = plainTitle(t); const days = num(t.days);
    const approval = /approv|승인/i.test(str(t.state));
    const todo = p.todo || (approval ? '사장님 승인 필요' : /escalat/i.test(str(t.state)) ? '사장님 확인 필요' : '');
    if (p.group && byGroup.has(p.group)) {
      const g = byGroup.get(p.group); g.count += 1; g.days = Math.max(g.days, days); continue;
    }
    const row = { id: p.group || str(t.key) || `row-${out.length}`, base: p.title, unit: p.unit || '', count: 1, days, approval, todo };
    if (p.group) byGroup.set(p.group, row);
    out.push(row);
  }
  return out
    .sort((a, b) => (b.approval - a.approval) || (b.days - a.days))
    .map((r) => ({
      id: r.id,
      title: r.unit ? `${r.base} ${r.count}${r.unit}` : r.base,
      since: r.days >= 1 ? `${r.days}일째` : '',
      todo: r.todo,
    }));
}

// 관리자 알림 창(데스크톱앱)용 카드. pmUnresolved 의 쉬운 제목에 "무슨 내용인지(detail)·사장님이 정할 것(decision)"을 붙인다.
// 여러 건을 한 줄로 묶은 항목은 상세가 건마다 달라 붙이지 않는다. sig 는 같은 알림을 두 번 띄우지 않기 위한 표식.
export function pmAlertCards(tasks) {
  const list = Array.isArray(tasks) ? tasks.filter(isUnresolved) : [];
  const cut = (v, n) => { const s = str(v).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  return pmUnresolved(tasks).map((row) => {
    const src = list.filter((t) => str(t.key) === row.id);
    const one = src.length === 1 ? src[0] : null;
    const approval = one ? /approv|승인/i.test(str(one.state)) : row.todo === '사장님 승인 필요';
    return {
      id: row.id, sig: `${row.id}|${approval ? 'approval' : 'check'}`, title: row.title, since: row.since, todo: row.todo, approval,
      detail: one ? cut(str(one.msg).replace(/^\s*\[[^\]]*\]\s*/, ''), 400) : '',
      decision: one ? cut(one.decision, 240) : '',
    };
  });
}
