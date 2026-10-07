import JSZip from 'jszip';
const decode = (value)=>value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity)=>({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&apos;': "'"
        })[entity] ?? String.fromCodePoint(entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10)));
const tags = (xml)=>[
        ...xml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?\s*>/g)
    ].filter((m)=>!/^< [!?]/.test(m[0]) && !/^<[!?]/.test(m[0])).map((m)=>({
            raw: m[0],
            start: m.index,
            end: m.index + m[0].length,
            name: m[0].match(/^<\/?([\w:.-]+)/)[1],
            close: /^<\//.test(m[0]),
            self: /\/\s*>$/.test(m[0])
        }));
const local = (tag)=>tag.name.split(':').at(-1);
const attrs = (tag)=>Object.fromEntries([
        ...tag.raw.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)
    ].map((m)=>[
            m[1],
            decode(m[3])
        ]));
const elements = (xml, name)=>{
    const tokens = tags(xml), result = [];
    for(let i = 0; i < tokens.length; i++){
        const tag = tokens[i];
        if (tag.close || local(tag) !== name) continue;
        if (tag.self) {
            result.push({
                ...tag,
                bodyStart: tag.end,
                bodyEnd: tag.end
            });
            continue;
        }
        let depth = 1;
        for(let j = i + 1; j < tokens.length; j++){
            if (tokens[j].name !== tag.name) continue;
            if (tokens[j].close) depth--;
            else if (!tokens[j].self) depth++;
            if (!depth) {
                result.push({
                    ...tag,
                    bodyStart: tag.end,
                    bodyEnd: tokens[j].start,
                    end: tokens[j].end
                });
                break;
            }
        }
    }
    return result;
};
const cellAddress = (address)=>{
    const match = String(address).toUpperCase().match(/^([A-Z]{1,3})([1-9]\d*)$/);
    if (!match) throw new Error('잘못된 셀 주소');
    const column = [
        ...match[1]
    ].reduce((n, c)=>n * 26 + c.charCodeAt(0) - 64, 0), row = Number(match[2]);
    if (column > 16384 || row > 1048576) throw new Error('셀 주소 범위 초과');
    return {
        address: match[0],
        column,
        row
    };
};
const resolvePath = (base, target)=>{
    const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/'), resolved = [];
    for (const part of parts){
        if (part === '..') {
            if (!resolved.length) throw new Error('잘못된 원본 경로');
            resolved.pop();
        } else if (part && part !== '.') resolved.push(part);
    }
    return resolved.join('/');
};
// Excel must refresh dependent formula caches after explicit quantity edits.
function requestRecalculation(xml) {
    const existing = elements(xml, 'calcPr');
    if (existing.length > 1) throw new Error('원본 계산 설정 중복');
    const settings = {
        fullCalcOnLoad: '1',
        forceFullCalc: '1',
        calcMode: 'auto'
    };
    if (existing.length) {
        const tag = existing[0];
        let opening = tag.raw;
        for (const [name, value] of Object.entries(settings)){
            const pattern = new RegExp('\\s+' + name + '\\s*=\\s*(["\']).*?\\1', 's');
            if (pattern.test(opening)) opening = opening.replace(pattern, ` ${name}="${value}"`);
            else opening = opening.replace(/(\/?>)$/, ` ${name}="${value}"$1`);
        }
        return xml.slice(0, tag.start) + opening + xml.slice(tag.start + tag.raw.length);
    }
    const workbook = elements(xml, 'workbook');
    if (workbook.length !== 1 || workbook[0].self) throw new Error('원본 통합문서 구조 확인 필요');
    const root = workbook[0];
    const prefix = root.name.includes(':') ? root.name.split(':')[0] + ':' : '';
    // CT_Workbook schema places calcPr before all these optional trailing fields.
    const afterCalcPr = new Set([
        'oleSize',
        'customWorkbookViews',
        'pivotCaches',
        'smartTagPr',
        'smartTagTypes',
        'webPublishing',
        'fileRecoveryPr',
        'webPublishObjects',
        'extLst'
    ]);
    let insertAt = root.bodyEnd;
    let depth = 0;
    for (const tag of tags(xml.slice(root.bodyStart, root.bodyEnd))){
        if (tag.close) {
            depth--;
            continue;
        }
        if (depth === 0 && afterCalcPr.has(local(tag))) {
            insertAt = root.bodyStart + tag.start;
            break;
        }
        if (!tag.self) depth++;
    }
    const marker = `<${prefix}calcPr fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>`;
    return xml.slice(0, insertAt) + marker + xml.slice(insertAt);
}
/** Preserve every untouched ZIP entry; patch only explicit existing numeric cells. */ export async function patchOriginalWorkbook(bytes, updates = [], { filename = 'original.xlsx' } = {}) {
    if (!Array.isArray(updates)) throw new Error('셀 변경 목록이 필요합니다.');
    if (!updates.length) return bytes;
    if (!/\.xlsx$/i.test(filename)) throw new Error('원본 셀 변경은 XLSX에서만 지원합니다.');
    const zip = await JSZip.loadAsync(bytes);
    const read = async (path)=>{
        const entry = zip.file(path);
        if (!entry) throw new Error(`원본 구성 누락: ${path}`);
        return entry.async('string');
    };
    const workbook = await read('xl/workbook.xml'), relationships = await read('xl/_rels/workbook.xml.rels');
    const rels = new Map(elements(relationships, 'Relationship').map((tag)=>{
        const a = attrs(tag);
        return [
            a.Id,
            a
        ];
    }));
    const sheets = new Map();
    for (const tag of elements(workbook, 'sheet')){
        const a = attrs(tag), id = Object.entries(a).find(([key])=>key.split(':').at(-1) === 'id')?.[1], rel = rels.get(id);
        if (!rel || rel.TargetMode === 'External') continue;
        sheets.set(a.name, resolvePath('xl/', rel.Target));
    }
    const grouped = new Map(), seen = new Map();
    for (const update of updates){
        const { address } = cellAddress(update.address);
        if (typeof update.value !== 'number' || !Number.isFinite(update.value) || update.value < 0) throw new Error('셀 수량은 0 이상의 유효한 숫자여야 합니다.');
        const path = sheets.get(update.sheetName);
        if (!path) throw new Error(`원본 시트를 찾을 수 없습니다: ${update.sheetName}`);
        const key = `${path}|${address}`;
        if (seen.has(key)) {
            if (seen.get(key) !== update.value) throw new Error('동일 셀 변경 수량 충돌');
            continue;
        }
        seen.set(key, update.value);
        if (!grouped.has(path)) grouped.set(path, []);
        grouped.get(path).push({
            ...update,
            address
        });
    }
    const changes = [];
    for (const [path, list] of grouped){
        const xml = await read(path), cells = elements(xml, 'c'), merges = elements(xml, 'mergeCell').map((tag)=>attrs(tag).ref);
        const patches = [];
        for (const update of list){
            const point = cellAddress(update.address);
            for (const ref of merges){
                const [first, last = first] = ref.split(':').map(cellAddress);
                if (point.column >= first.column && point.column <= last.column && point.row >= first.row && point.row <= last.row && point.address !== first.address) throw new Error('병합 셀의 시작 셀만 변경할 수 있습니다.');
            }
            const matches = cells.filter((tag)=>attrs(tag).r?.toUpperCase() === update.address);
            if (matches.length !== 1) throw new Error(`원본 셀 누락 또는 중복: ${update.address}`);
            const cell = matches[0], body = xml.slice(cell.bodyStart, cell.bodyEnd);
            if (elements(body, 'f').length) throw new Error('수식 셀을 덮어쓸 수 없습니다.');
            if (elements(body, 'is').length) throw new Error('문자열 셀을 숫자로 바꿀 수 없습니다.');
            const type = attrs(cell).t;
            if (type && type !== 'n') throw new Error('숫자 셀만 변경할 수 있습니다.');
            const values = elements(body, 'v');
            if (values.length > 1) throw new Error('원본 셀 값 중복');
            const prefix = cell.name.includes(':') ? cell.name.split(':')[0] + ':' : '';
            const value = `<${prefix}v>${String(update.value)}</${prefix}v>`;
            const nextBody = values.length ? body.slice(0, values[0].start) + value + body.slice(values[0].end) : body + value;
            let opening = cell.raw.replace(/\s+t\s*=\s*(["']).*?\1/s, '').replace(/\/\s*>$/, '>');
            patches.push({
                start: cell.start,
                end: cell.end,
                value: opening + nextBody + `</${cell.name}>`
            });
        }
        let changed = xml;
        for (const patch of patches.sort((a, b)=>b.start - a.start))changed = changed.slice(0, patch.start) + patch.value + changed.slice(patch.end);
        changes.push([
            path,
            changed
        ]);
    }
    for (const [path, xml] of changes)zip.file(path, xml);
    zip.file('xl/workbook.xml', requestRecalculation(workbook));
    return zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE'
    });
}
