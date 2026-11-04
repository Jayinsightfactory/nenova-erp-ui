import assert from 'node:assert/strict';
import { defectCompanyChoices, defectCompanyKey, matchesDefectCompany, defectInputSource } from '../lib/defectCompanyFilter.js';
import { sortDefectDisplayRows } from '../lib/salesDefectIncomingGroup.js';
const rows = [
  { custKey: 2, customerName: '태림', orderYear: 2026, quantity: 10 },
  { custKey: 1, customerName: '주광농원', customerAlias: '주광', orderYear: 2026, quantity: 15 },
  { custKey: 2, customerName: '태림', orderYear: 2025, quantity: 20 },
  { custKey: 3, customerName: '태림', orderYear: 2026, quantity: 30 },
  { customerName: '미 매칭' },
];
assert.equal(defectCompanyChoices(rows, '주 광')[0].key, 'customer:1');
assert.equal(defectCompanyChoices(rows, '태림').length, 2, 'same names different keys remain separate');
assert.equal(defectCompanyChoices(rows, '태림').find(c=>c.custKey===2).count, 2);
assert.equal(defectCompanyChoices(rows, '없음').length, 0);
assert.equal(defectCompanyChoices(rows, '').length, 4);
assert.equal(defectCompanyKey({custKey:0,customerName:'미매칭'}),defectCompanyKey(rows[4]));
assert.equal(rows.filter(r=>matchesDefectCompany(r,'customer:2')).length,2);
assert.equal(rows.filter(r=>matchesDefectCompany(r,'customer:999')).length,0);
assert.equal(rows.filter(r=>matchesDefectCompany(r,'')).length,5);
const current = rows.filter(r=>r.orderYear===2026);
const display=sortDefectDisplayRows(current).filter(({row})=>matchesDefectCompany(row,'customer:2'));
assert.equal(display.length,1,'client filter cannot reintroduce other year');
assert.equal(display[0].row,current[0]); assert.equal(display[0].sourceIndex,0);
assert.equal(defectInputSource({sourceFileName:'kakao-defect:room'}).label,'자동수집');
assert.equal(defectInputSource({autoSourceExcluded:true,autoSourceEvidence:'HISTORY_SOURCE',note:''}).label,'자동수집');
assert.equal(defectInputSource({manualSourceConfirmed:true,sourceFileName:'kakao-defect:wrong'}).label,'직접입력');
assert.equal(defectInputSource({sourceFileName:'직원.xlsx'}).label,'파일 업로드');
assert.equal(defectInputSource({sourceFileName:'',autoSourceExcluded:false}).label,'직접입력');
assert.equal(defectInputSource({status:'MANUAL_COMPLETED',autoSourceExcluded:true}).label,'자동수집','completion is not input origin');
assert.equal(defectInputSource({note:'자동수집을 확인함',sourceFileName:''}).label,'직접입력','free text is not provenance');
console.log('defectCompanyFilter PASS');
