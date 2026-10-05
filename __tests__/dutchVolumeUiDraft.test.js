import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDutchPreviewEntries, dutchSourceIdentity, editDutchDraftEntry, isDutchPreviewCurrent, isDutchValidationCurrent, newDutchDraftEntry, readDutchDraft, writeDutchDraft } from '../lib/dutchVolumeDraft.js';
import { dutchPriceKey, isDutchIndividualPriceCustomer } from '../lib/dutchVolumePrice.js';

const entry = { id: 'sheet!D4', product: '품목', color: '빨강', customer: '업체', quantity: 5, unit: '' };
const key = row => `uniform:${row.product}`;
const memory = new Map();
const storage = { getItem: name => memory.get(name), setItem: (name, value) => memory.set(name, value) };

assert.deepEqual(buildDutchPreviewEntries([entry], {}, key)[0], { id: entry.id, product: '품목', color: '빨강', customer: '업체', quantity: 5, unit: '' });
assert.equal(buildDutchPreviewEntries([entry], { 'uniform:품목': 0 }, key)[0].unitPrice, 0, '명시 0원은 보존 의미가 아니다');
assert.equal(buildDutchPreviewEntries([entry], { 'uniform:품목': '' }, key)[0].unitPrice, undefined);
assert.throws(() => buildDutchPreviewEntries([{ ...entry, quantity: '' }], {}, key), /수량/);
assert.throws(() => buildDutchPreviewEntries([entry], { 'uniform:품목': -1 }, key), /단가/);

const identity = 'workbook.xlsx:10:123';
storage.setItem(`nenova.dutch-volume-prices.v1:${identity}`, JSON.stringify({ currency: 'EUR', prices: { 'uniform:품목': 999 } }));
assert.deepEqual(readDutchDraft(storage, identity, [entry], (_, value) => value).prices, {}, 'EUR 저장값을 원화로 재해석하지 않는다');
storage.setItem(`nenova.dutch-volume-prices.v1:${identity}`, JSON.stringify({ currency: 'KRW', prices: { 'uniform:품목': 123 } }));
assert.equal(readDutchDraft(storage, identity, [entry], (_, value) => value).prices['uniform:품목'], 123);
writeDutchDraft(storage, identity, [{ ...entry, quantity: 0 }, { ...entry, id: 'manual:1', added: true }], { 'uniform:품목': 0 });
const restored = readDutchDraft(storage, identity, [entry], (_, value) => value);
assert.equal(restored.entries[0].quantity, 0);
assert.equal(restored.entries[1].id, 'manual:1');
assert.equal(restored.prices['uniform:품목'], 0);
assert.notEqual(dutchSourceIdentity(identity,[entry],2026,'40-02'), dutchSourceIdentity(identity,[entry],2025,'40-02'));
assert.notEqual(dutchSourceIdentity(identity,[entry],2026,'40-02'), dutchSourceIdentity(identity,[{...entry,color:'새 품목'}],2026,'40-02'));
assert.notEqual(dutchSourceIdentity(identity,[entry],2026,'40-02'), dutchSourceIdentity(identity,[{...entry,quantity:6}],2026,'40-02'));
const v3Identity = dutchSourceIdentity('old',[entry],2026,'40-02');
storage.setItem('nenova.dutch-volume-krw.v2:old',JSON.stringify({version:2,currency:'KRW',entries:[{...entry,prodKey:999}],prices:{x:12}}));
const resetDraft=readDutchDraft(storage,v3Identity,[entry],(_,value)=>value);
assert.equal(resetDraft.draftReset,true);
assert.equal(resetDraft.entries[0].prodKey,undefined);
assert.deepEqual(resetDraft.prices,{});
writeDutchDraft(storage,'immutable',[{...entry,sourceItem:'stale',color:'stale',quantity:0}],{});
const immutable=readDutchDraft(storage,'immutable',[{...entry,sourceItem:'fresh'}],(_,value)=>value);
assert.equal(immutable.entries[0].sourceItem,'fresh');
assert.equal(immutable.entries[0].color,entry.color);
assert.equal(immutable.entries[0].quantity,0);

const preview = { planToken: 'one', revision: 5, year: 2026, week: '40-01', sourceIdentity: identity };
assert.equal(isDutchPreviewCurrent(preview, 5, 2026, '40-01', identity), true);
assert.equal(isDutchPreviewCurrent(preview, 6, 2026, '40-01', identity), false);
assert.equal(isDutchPreviewCurrent(preview, 5, 2025, '40-01', identity), false);
assert.equal(isDutchPreviewCurrent({ ...preview, planToken: null }, 5, 2026, '40-01', identity), false);
assert.equal(isDutchValidationCurrent({ ...preview, planToken: null }, 5, 2026, '40-01', identity), true, '차단된 최신 검증도 과거 검증으로 표시하지 않는다');
assert.equal(isDutchValidationCurrent(preview, 6, 2026, '40-01', identity), false);
assert.equal(isDutchValidationCurrent(preview, 5, 2025, '40-01', identity), false);
const manual = newDutchDraftEntry('manual:2');
assert.equal(manual.added, true);
assert.equal(manual.quantity, 0);
const selected = editDutchDraftEntry([entry, manual], manual.id, { custKey: 12, customer: 'ERP 업체', prodKey: 34, product: 'ERP 품목', quantity: 7 });
assert.equal(selected[0], entry, '다른 행 원본 객체 보존');
assert.equal(selected[1].custKey, 12);
assert.equal(selected[1].prodKey, 34);
assert.equal(buildDutchPreviewEntries(selected, {}, key)[1].quantity, 7);

const page = readFileSync(new URL('../pages/stats/dutch-volume-board.js', import.meta.url), 'utf8');
const pickMasterStart = page.indexOf('function pickMaster(entry, kind, item) {');
const pickMasterEnd = page.indexOf('function addRow() {', pickMasterStart);
assert.ok(pickMasterStart >= 0 && pickMasterEnd > pickMasterStart, 'real pickMaster function can be isolated for executable cancel/confirm testing');
const pickMasterSource = page.slice(pickMasterStart, pickMasterEnd);
const createPickMaster = (state, confirmResult) => {
  const windowStub = { confirm: () => { state.confirmCalls += 1; return confirmResult; } };
  const workBusyRef = { current: !!state.workBusy };
  const applyingRef = { current: !!state.applying };
  const setPrices = updater => {
    state.priceSetterCalls += 1;
    state.prices = typeof updater === 'function' ? updater(state.prices) : updater;
  };
  const setRematchNotice = message => { state.noticeCalls += 1; state.notices.push(message); };
  const updateEntry = (id, change) => {
    state.updateCalls += 1;
    state.invalidateCalls += 1;
    state.entries = editDutchDraftEntry(state.entries, id, change);
  };
  const factory = new Function('window', 'prices', 'entries', 'dutchPriceKey', 'isDutchIndividualPriceCustomer', 'setPrices', 'setRematchNotice', 'updateEntry', 'workBusyRef', 'applyingRef', `${pickMasterSource}\nreturn pickMaster;`);
  return factory(windowStub, state.prices, state.entries, dutchPriceKey, isDutchIndividualPriceCustomer, setPrices, setRematchNotice, updateEntry, workBusyRef, applyingRef);
};
const individualEntry = { id: 'ju-1', customer: '주광거래처', custKey: 533, product: 'ARAN Azima', color: '', prodKey: 3441, quantity: 1, unit: '송이' };
const uniformKey = `uniform:prod:${individualEntry.prodKey}`;
const initialPickerState = () => ({
  entries: [individualEntry], prices: { [individualEntry.id]: 100, [uniformKey]: 200 },
  confirmCalls: 0, priceSetterCalls: 0, noticeCalls: 0, notices: [], updateCalls: 0, invalidateCalls: 0,
});
const cancelledPickState = initialPickerState();
const cancelledPrices = { ...cancelledPickState.prices };
createPickMaster(cancelledPickState, false)(individualEntry, 'customer', { CustKey: 534, CustName: '일반업체' });
assert.equal(cancelledPickState.confirmCalls, 1, 'conflicting target uniform price requires confirmation');
assert.equal(cancelledPickState.priceSetterCalls, 0, 'cancelled overwrite must not call any price setter');
assert.equal(cancelledPickState.noticeCalls, 0, 'cancelled overwrite must not alter the matching notice');
assert.equal(cancelledPickState.updateCalls, 0, 'cancelled overwrite must not update the entry');
assert.deepEqual(cancelledPickState.prices, cancelledPrices, 'cancel leaves the original individual and target uniform prices untouched');

const acceptedPickState = initialPickerState();
createPickMaster(acceptedPickState, true)(individualEntry, 'customer', { CustKey: 534, CustName: '일반업체' });
assert.equal(acceptedPickState.confirmCalls, 1);
assert(acceptedPickState.priceSetterCalls > 0, 'accepted overwrite runs the matching price setters');
assert.equal(acceptedPickState.prices[individualEntry.id], undefined, 'accepted move from 주광 clears its old per-row individual price');
assert.equal(acceptedPickState.prices[uniformKey], 200, 'accepted rematch keeps the already-existing target uniform price');
assert.equal(acceptedPickState.updateCalls, 1, 'accepted selection updates the row');
assert.equal(acceptedPickState.invalidateCalls, 1, 'accepted selection invalidates stale preview via updateEntry');
assert.equal(acceptedPickState.entries[0].customer, '일반업체');

const busyPickState = { ...initialPickerState(), workBusy: true };
createPickMaster(busyPickState, true)(individualEntry, 'customer', { CustKey: 534, CustName: '일반업체' });
assert.equal(busyPickState.confirmCalls, 0, 'busy work blocks manual matching');
assert.equal(busyPickState.updateCalls, 0, 'busy work leaves entries untouched');
const applyingPickState = { ...initialPickerState(), applying: true };
createPickMaster(applyingPickState, true)(individualEntry, 'customer', { CustKey: 534, CustName: '일반업체' });
assert.equal(applyingPickState.confirmCalls, 0, 'ERP apply blocks manual matching');
assert.equal(applyingPickState.updateCalls, 0, 'ERP apply leaves entries untouched');

assert.match(page, /sourceModeRef\.current !== 'UPLOAD'/);
assert.match(page, /request !== loadRequestRef\.current/);
assert.match(page, /request !== previewRequestRef\.current/);
assert.match(page, /setMatchCache\(Object\.fromEntries/);
assert.match(page, /setCustomerOptions\(data\.customerOptions/);
assert.match(page, /updateEntry\(entry\.id, next\)/, 'ERP 업체·품목 수동 선택은 초안을 갱신한다');
assert.match(page, /function updateEntry\(id, change\) \{ if \(workBusyRef\.current \|\| applyingRef\.current\) return; invalidate\(\)/, '선택·수량 편집은 이전 계획을 무효화한다');
assert.match(page, /function updatePrice\(entry, value\) \{\s*if \(workBusyRef\.current \|\| applyingRef\.current\) return;\s*invalidate\(\)/, '단가 편집은 이전 계획을 무효화한다');
assert.match(page, /setEntries\(previous => \[\.\.\.previous, newDutchDraftEntry/, '기존 ERP 마스터 선택용 수동행을 추가한다');
assert.match(page, /planToken: preview\.planToken, jobId, ackQtyWarnings/);
assert.match(page, /recoverJob\(jobId\)/);
assert.match(page, /ERP적용초안/);
assert.match(page, /missingFromExcel/);
assert.match(page, /row\.estUnit/);
assert.match(page, /function changeWeek\(value\) \{ if \(workBusyRef\.current \|\| applyingRef\.current\) return; invalidate\(\); clearLiveSource\(\)/, '차수 변경은 과거 LIVE 초안을 비운다');
assert.match(page, /function changeYear\(value\) \{ if \(workBusyRef\.current \|\| applyingRef\.current\) return; invalidate\(\); clearLiveSource\(\)/, '연도 변경은 과거 LIVE 초안을 비운다');
assert.match(page, /delete updated\[entry\.id\]/, '주광 재매칭은 이전 개별단가를 제거한다');
assert.match(page, /const \[activeTab, setActiveTab\] = useState\('sheet'\)/, 'the original workbook tab remains the default');
assert.match(page, /priceKey=\{dutchPriceKey\}/, 'the workbook tab uses the shared price key');
assert.match(page, /value=\{prices\[dutchPriceKey\(row\)\] \?\? ''\}/, 'the editor tab reads the same shared price key');
assert.match(page, /initialQuery=\{row\.sourceItem \|\| row\.color \|\| row\.product\}/, 'the picker starts from the uploaded actual item name');
const tabButtons = page.slice(page.indexOf('<div className="sheet-tabs"'), page.indexOf("      {activeTab === 'sheet'"));
assert.match(tabButtons, /setActiveTab\('sheet'\)/);
assert.match(tabButtons, /setActiveTab\('edit'\)/);
assert.doesNotMatch(tabButtons, /fetch\(|\/api\/shipment\/dutch-volume-apply|applyDutchVolume/, 'switching tabs never applies ERP data');
assert.match(page, /preview\.blockers\.join/, '서버 적용 차단 사유를 표시한다');
assert.match(page, /crypto\.randomUUID\(\)/, '작업 ID를 예측 불가능하게 만든다');
assert.doesNotMatch(page, /unit:\s*item\.outUnit/, '명시 입력단위를 품목 재매칭이 덮지 않는다');
const uploadSource = page.slice(page.indexOf('async function upload(file)'), page.indexOf('function updateEntry'));
assert.match(uploadSource, /setLoading\(true\)/, '파일 업로드가 진행 상태를 인수한다');
assert.match(uploadSource, /finally \{ if \(request === loadRequestRef\.current\) setLoading\(false\); \}/, 'LIVE 조회 도중 업로드해도 최신 업로드가 진행 상태를 해제한다');
assert.doesNotMatch(page, /<option>EUR<\/option>|setCurrency\(/);
console.log('dutch volume UI draft tests passed');
