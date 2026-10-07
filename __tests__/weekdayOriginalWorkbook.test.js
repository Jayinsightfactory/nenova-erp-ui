import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { patchOriginalWorkbook as patch } from '../lib/weekdayOriginalWorkbook.js';
const zip = new JSZip();
zip.file('xl/workbook.xml', `<x:workbook xmlns:x="main" xmlns:r="rels"><x:sheets><x:sheet r:id='s1' name='Flower &amp; More' sheetId='1'/><x:sheet sheetId="2" name="Other" r:id="s2"/></x:sheets></x:workbook>`);
zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Target="worksheets/../worksheets/sheet1.xml" Id="s1"/><Relationship Id='s2' Target='/xl/worksheets/sheet2.xml'/></Relationships>`);
const worksheet = `<x:worksheet xmlns:x='main'><x:cols><x:col width='35' min='1' max='1'/></x:cols><x:sheetData><x:row r='1'><x:c s='12' r='A1' t='n'><x:v>3</x:v></x:c><x:c r='B1' s='4'><x:f>A1*2</x:f><x:v>6</x:v></x:c><x:c r='C1' s='8'/></x:row><x:row r='2'><x:c r='A2'><x:v>0</x:v></x:c></x:row></x:sheetData><x:mergeCells><x:mergeCell ref='A2:B2'/></x:mergeCells><x:legacyDrawing r:id='vml'/></x:worksheet>`;
zip.file('xl/worksheets/sheet1.xml', worksheet);
zip.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`);
zip.file('xl/styles.xml', '<styles custom="unchanged"/>');
zip.file('xl/drawings/vmlDrawing1.vml', '<vml>legacy control</vml>');
zip.file('xl/media/image1.png', new Uint8Array([
    0,
    255,
    34,
    80,
    12
]));
zip.file('custom/unknown.bin', new Uint8Array([
    3,
    99,
    1
]));
const bytes = await zip.generateAsync({
    type: 'uint8array'
});
assert.equal(await patch(bytes, []), bytes, 'no-op returns exact original bytes');
assert.equal(await patch(bytes, [], {
    filename: 'legacy.xls'
}), bytes);
const updated = await JSZip.loadAsync(await patch(bytes, [
    {
        sheetName: 'Flower & More',
        address: 'A1',
        value: 5
    },
    {
        sheetName: 'Flower & More',
        address: 'C1',
        value: 0
    },
    {
        sheetName: 'Other',
        address: 'A1',
        value: 9
    }
]));
const first = await updated.file('xl/worksheets/sheet1.xml').async('string');
assert.match(first, /<x:c s='12' r='A1'><x:v>5<\/x:v><\/x:c>/);
assert.match(first, /<x:c r='C1' s='8'><x:v>0<\/x:v><\/x:c>/);
assert.ok(first.includes("<x:c r='B1' s='4'><x:f>A1*2</x:f><x:v>6</x:v></x:c>"));
assert.equal(first, worksheet.replace("<x:c s='12' r='A1' t='n'><x:v>3</x:v></x:c>", "<x:c s='12' r='A1'><x:v>5</x:v></x:c>").replace("<x:c r='C1' s='8'/>", "<x:c r='C1' s='8'><x:v>0</x:v></x:c>"), 'only targeted cell values/type changed');
for (const path of Object.keys(zip.files).filter((path)=>!path.endsWith('/') && ![
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml'
    ].includes(path)))assert.deepEqual(await updated.file(path).async('uint8array'), await zip.file(path).async('uint8array'), `untouched entry contents remain exact: ${path}`);
for (const update of [
    {
        address: 'B1',
        value: 2
    },
    {
        address: 'B2',
        value: 2
    },
    {
        address: 'Z9',
        value: 2
    },
    {
        address: 'A1',
        value: -1
    },
    {
        address: 'A1',
        value: NaN
    },
    {
        address: 'A1',
        value: '2'
    },
    {
        address: 'XFE1',
        value: 2
    }
])await assert.rejects(patch(bytes, [
    {
        sheetName: 'Flower & More',
        ...update
    }
]));
await assert.rejects(patch(bytes, [
    {
        sheetName: 'Flower & More',
        address: 'A1',
        value: 1
    },
    {
        sheetName: 'Flower & More',
        address: 'A1',
        value: 2
    }
]), /충돌/);
await assert.rejects(patch(bytes, [
    {
        sheetName: 'Flower & More',
        address: 'A1',
        value: 1
    }
], {
    filename: 'legacy.xls'
}), /XLSX/);
console.log('Original workbook preservation: explicit numeric XML patches, namespace/escaped sheet mapping, relative/absolute relationships, exact untouched entries, styles/image/VML/unknown parts, formula/merge/address/conflict guards passed');
const changedWorkbook = await updated.file('xl/workbook.xml').async('string');
assert.equal(changedWorkbook, (await zip.file('xl/workbook.xml').async('string')).replace('</x:workbook>', '<x:calcPr fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/></x:workbook>'), 'workbook sheet names and attributes remain exact except calculation marker');
for (const tail of [
    'oleSize',
    'customWorkbookViews',
    'pivotCaches',
    'extLst'
]){
    const variant = new JSZip();
    for (const [path, file] of Object.entries(zip.files))if (!file.dir) variant.file(path, await file.async('uint8array'));
    variant.file('xl/workbook.xml', `<workbook><sheets><sheet name="Flower &amp; More" r:id="s1"/></sheets><${tail}/></workbook>`);
    const result = await JSZip.loadAsync(await patch(await variant.generateAsync({
        type: 'uint8array'
    }), [
        {
            sheetName: 'Flower & More',
            address: 'A1',
            value: 2
        }
    ]));
    assert.match(await result.file('xl/workbook.xml').async('string'), new RegExp('calcMode="auto"/><' + tail), 'new calculation marker follows workbook schema order');
}
const configured = new JSZip();
for (const [path, file] of Object.entries(zip.files))if (!file.dir) configured.file(path, await file.async('uint8array'));
configured.file('xl/workbook.xml', (await zip.file('xl/workbook.xml').async('string')).replace('</x:workbook>', "<x:calcPr calcId='123' fullCalcOnLoad='0' forceFullCalc='0' calcMode='manual' concurrentCalc='0'/></x:workbook>"));
configured.file('xl/calcChain.xml', '<calcChain><c r="B1" i="1"/></calcChain>');
const recalculated = await JSZip.loadAsync(await patch(await configured.generateAsync({
    type: 'uint8array'
}), [
    {
        sheetName: 'Flower & More',
        address: 'A1',
        value: 2
    }
]));
assert.match(await recalculated.file('xl/workbook.xml').async('string'), /x:calcPr calcId='123' fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto" concurrentCalc='0'/);
assert.equal(await recalculated.file('xl/calcChain.xml').async('string'), '<calcChain><c r="B1" i="1"/></calcChain>', 'original formula chain remains untouched');
console.log('Dependent formula recalculation marker, existing calc attributes and schema insertion preservation passed');
