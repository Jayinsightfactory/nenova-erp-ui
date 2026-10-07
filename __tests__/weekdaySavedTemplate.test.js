import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { loadWeekdaySavedTemplate, serveWeekdaySavedTemplate, WEEKDAY_TEMPLATE_SHA256 } from '../lib/weekdaySavedTemplate.js';
const sheet = XLSX.utils.aoa_to_sheet([
 ['2026년 9월 출고 계획'],
 ['카네이션','색상','','','','(20일) 일요일 출고 예정'],
 ['','Synthetic fixture','','','',3],
]);
sheet['!merges']=[XLSX.utils.decode_range('A2:A3')];
const synthetic=XLSX.utils.book_new();XLSX.utils.book_append_sheet(synthetic,sheet,'Fixture');
const original=XLSX.write(synthetic,{type:'buffer',bookType:'xlsx'});
const expectedSha256=createHash('sha256').update(original).digest('hex').toUpperCase();
let requestedPath;
const template=await loadWeekdaySavedTemplate({read:async assetPath=>{requestedPath=assetPath;return original;},expectedSha256});
assert.match(requestedPath,/data[\\/]runtime[\\/]weekday-template[\\/]jugwang-order\.xlsx$/);
assert.equal(template.sha256,expectedSha256);
assert.equal(WEEKDAY_TEMPLATE_SHA256,'0D2BF7505BBDB792C43A116DF037BC125E4BE44F05D7519DDFE747EB7D8FDFB3','production checksum remains fixed');
assert.equal(template.custKey, 533);
assert.deepEqual(Buffer.from(template.base64, 'base64'), Buffer.from(original), 'download preserves the exact original bytes');
assert.ok(template.parsed);
const zip = await JSZip.loadAsync(Buffer.from(template.base64, 'base64'));
assert.ok(zip.file('xl/styles.xml'));
assert.ok(Object.keys(zip.files).some((name)=>name.startsWith('xl/worksheets/')));
const sheets = await Promise.all(Object.keys(zip.files).filter((name)=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map((name)=>zip.file(name).async('string')));
assert.ok(sheets.some((xml)=>xml.includes('mergeCell')), 'merged layout exists in the original template');
const response = ()=>({
        headers: {},
        setHeader (key, value) {
            this.headers[key] = value;
        },
        status (code) {
            this.code = code;
            return this;
        },
        json (value) {
            this.body = value;
            return this;
        },
        end () {
            return this;
        }
    });
let res = response();
await serveWeekdaySavedTemplate({
    method: 'GET',
    query: {
        custKey: '533'
    }
}, res, async ()=>template);
assert.equal(res.code, 200);
assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
res = response();
await serveWeekdaySavedTemplate({
    method: 'POST',
    query: {
        custKey: '533'
    }
}, res, ()=>{
    throw Error('must not read');
});
assert.equal(res.code, 405);
assert.equal(res.headers.Allow, 'GET');
for (const custKey of [
    undefined,
    '534',
    [
        '533'
    ],
    '533/../../secret'
]){
    res = response();
    await serveWeekdaySavedTemplate({
        method: 'GET',
        query: {
            custKey
        }
    }, res, ()=>{
        throw Error('must not read');
    });
    assert.equal(res.code, 400);
}
res = response();
await serveWeekdaySavedTemplate({
    method: 'GET',
    query: {
        custKey: '533',
        path: 'secret'
    }
}, res, ()=>{
    throw Error('C:/private/path/secret');
});
assert.equal(res.code, 503);
assert.ok(!JSON.stringify(res.body).includes('private/path'));
await assert.rejects(loadWeekdaySavedTemplate({
    read: async ()=>Buffer.from('changed bytes')
}), /확인/);
// Load the actual endpoint with a controlled authentication wrapper; unauthenticated
// requests must never reach the private file service.
const require = createRequire(import.meta.url);
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const swc = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const source = readFileSync(new URL('../pages/api/estimate/weekday-template.js', import.meta.url), 'utf8');
const compiled = swc.transformSync(source, false, Buffer.from(JSON.stringify({
    jsc: {
        target: 'es2020',
        parser: {
            syntax: 'ecmascript'
        }
    },
    module: {
        type: 'commonjs'
    }
}))).code;
const authSource = readFileSync(new URL('../lib/auth.js', import.meta.url), 'utf8');
const authCompiled = swc.transformSync(authSource, false, Buffer.from(JSON.stringify({
    jsc: {
        target: 'es2020',
        parser: {
            syntax: 'ecmascript'
        }
    },
    module: {
        type: 'commonjs'
    }
}))).code;
const authMod = {
    exports: {}
};
new Function('require', 'module', 'exports', authCompiled)((name)=>name === 'jsonwebtoken' ? {
        verify () {
            return {
                userId: 1
            };
        }
    } : name.includes('apiLogger') ? {
        trackApiCall () {}
    } : {
        applyEffectiveWebAccess: (value)=>value,
        effectiveAuthority: ()=>0
    }, authMod, authMod.exports);
let calls = 0;
const mod = {
    exports: {}
};
new Function('require', 'module', 'exports', compiled)((name)=>name.includes('/auth') ? authMod.exports : {
        serveWeekdaySavedTemplate: async ()=>{
            calls++;
        }
    }, mod, mod.exports);
res = response();
await mod.exports.default({
    headers: {},
    method: 'GET',
    query: {
        custKey: '533'
    }
}, res);
assert.equal(res.code, 401);
assert.equal(calls, 0);
await mod.exports.default({
    headers: {
        authorization: 'Bearer fixture'
    },
    method: 'GET',
    query: {
        custKey: '533'
    }
}, response());
assert.equal(calls, 1);
console.log('Saved private template: exact asset SHA/bytes/layout, scoped GET/real auth wrapper, no-store, 405/400/503, safe errors and hash guard passed');
