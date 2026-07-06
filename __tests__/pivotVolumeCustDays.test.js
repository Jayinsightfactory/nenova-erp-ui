import { extractDays, pickDataDay } from '../lib/pivotVolumeCustDays.js';

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`  ok ${name}`);
}

console.log('=== pivotVolumeCustDays ===');

const cust = (descr) => ({ custDescr: descr, custName: '테스트업체' });

assert('카네이션 카-월', extractDays(cust('상사/카-월'), '카네이션').join('') === '월');
assert('네덜란드 네-월', extractDays(cust('랜드상사/네-월'), '네덜란드').join('') === '월');
assert('네덜란드 네.화', extractDays(cust('네.화,금'), '네덜란드').join('') === '금화');
assert('중국 中-수', extractDays(cust('中-수'), '중국').join('') === '수');
assert('중국 중-월 (거래처 비고)', extractDays(cust('일신/카-일/중-월/CL52'), '중국').join('') === '월');
assert('중국 중-일', extractDays(cust('주광/중-일/태-월'), '중국').join('') === '일');
assert('중국 중-화', extractDays(cust('신라/중-화/네-화'), '중국').join('') === '화');
assert('중국 / 중-일 (공백)', extractDays(cust('수연/ 중-일/수-화'), '중국').join('') === '일');
assert('미등록 품종', extractDays(cust('카-월'), '호주').length === 0);

assert('pickDataDay 일 우선', pickDataDay(['월', '일']) === '일');
assert('pickDataDay 첫 요일', pickDataDay(['월', '화']) === '월');

console.log('all passed');
