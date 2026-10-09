import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLoginId, loginIdCookie } from '../lib/rememberedLoginId.js';

test('remembered username survives cookie round trip without becoming authentication', () => {
  for (const id of ['employee01', '직원+02@example.test', ' a;=b ']) {
    const preference = loginIdCookie(id);
    assert.equal(readLoginId(`other=x; ${preference.split(';')[0]}; next=y`), id);
    assert.match(preference, /Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
    assert(!preference.includes('Domain='));
  }
  assert(!loginIdCookie('employee', false).includes('Secure'));
});

test('missing, malformed, oversized and control-character preferences are ignored', () => {
  for (const cookies of ['', 'nenovaLoginId=%E0%A4', `nenovaLoginId=${'x'.repeat(129)}`, 'nenovaLoginId=%0Aemployee', 'nenovaLoginIdOther=employee']) assert.equal(readLoginId(cookies), '');
  for (const id of ['', null, {}, 'x'.repeat(129), 'a\r\nb', '\uD800']) assert.equal(loginIdCookie(id), '');
});
