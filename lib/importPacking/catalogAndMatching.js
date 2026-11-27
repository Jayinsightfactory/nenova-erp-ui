// Pure catalog parsing, tokenization, scoring, alias XLSX I/O, and product resolver
import { chinaStemLength, chinaInvoiceDescription } from '../importChinaInvoice.js';
import { isStructuredChinaInvoice } from '../importChinaInvoiceFormat.js';
import { needsInvoiceAllocation } from '../invoiceProductAllocation.js';
import { ALL_SEED_ALIASES } from './seedAliases.js';

const KR_COUNTRY_TO_CODE = {
  '네덜란드': 'NL', '콜롬비아': 'CO', '중국': 'CN', '에콰도르': 'EC',
  '에티오피아': 'ET', '태국': 'TH', '일본': 'JP', '국내': 'KR',
  '뉴질랜드': 'NZ', '호주': 'AU', '베트남': 'VN', '이스라엘': 'IL', '미국': 'US',
};

// Parse the uploaded catalog xlsx and return the JSON we'll persist
function parseCatalog(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // header: A=품목번호 B=품목코드 C=품목명 D=꽃 E=국가 F=출고단가 G=출고단위 H=견적단위 I=비고
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[2]) continue;
    const name = (r[2] || '').toString().trim();
    items.push({
      code: r[1] || '',
      name: name,
      flowerKr: r[3] || '',
      countryKr: r[4] || '',
      country: KR_COUNTRY_TO_CODE[r[4]] || '?',
      family: familyForCatalog(name),
    });
  }
  return { items, savedAt: new Date().toISOString() };
}

// Normalize string for matching: uppercase, collapse whitespace, strip diacritics
function normalize(s) {
  if (!s) return '';
  return s.toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Family detection — both invoice descriptions and catalog names
const FAMILY_PATTERNS = [
  ['SPRAY_ROSE',  ['SPRAY ROSE', 'SPRAY ROSES', 'SPRAYROSES', 'SPRAYROSE']],
  ['GARDEN_ROSE', ['GARDEN ROSE', 'GARDEN ROSES']],
  ['MINI_CARN',   ['MINI CARNATION', 'MINICARNATION']],
  ['SPRAY_CARN',  ['SPRAY CARNATION', 'SPARY CARNATION']],
  ['CARNATION',   ['CARNATION', 'CAR ']],
  ['ROSE',        ['ROSE', 'ROSES', 'ROSA', 'ROSAS']],
  ['ALSTRO',      ['ALSTROEMERIA', 'ALSTROMERIA']],
  ['RUSCUS',      ['RUSCUS']],
  ['HYDRANGEA',   ['HYDRANGEA', 'HYD ']],
];
function detectFamily(s) {
  if (!s) return null;
  const n = ' ' + (s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()) + ' ';
  for (const [fam, pats] of FAMILY_PATTERNS) {
    for (const p of pats) {
      if (n.indexOf(' ' + p + ' ') >= 0 || n.indexOf(' ' + p) === 0 || n.endsWith(' ' + p + ' ')) return fam;
    }
  }
  return null;
}
function familyForCatalog(name) {
  if (!name) return null;
  const n = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.startsWith('SPRAY ROSE')) return 'SPRAY_ROSE';
  if (n.indexOf('GARDEN ROSES') >= 0 || n.startsWith('GARDEN ROSE')) return 'GARDEN_ROSE';
  if (n.startsWith('MINICARNATION') || n.startsWith('MINI CARNATION') || n.indexOf('MINICARNATION') >= 0) return 'MINI_CARN';
  if (n.startsWith('SPARY CARNATION') || n.startsWith('SPRAY CARNATION')) return 'SPRAY_CARN';
  if (n.startsWith('CARNATION')) return 'CARNATION';
  if (n.startsWith('ROSE')) return 'ROSE';
  if (n.indexOf('ALSTROMERIA') >= 0 || n.indexOf('ALSTROEMERIA') >= 0) return 'ALSTRO';
  if (n.startsWith('RUSCUS')) return 'RUSCUS';
  if (n.indexOf('HYDRANGEA') >= 0) return 'HYDRANGEA';
  return null;
}

// Colombia — stems-per-bunch reglas fijas por familia.  El modelo extrae
// `bunch_st` del PDF pero a menudo es inconsistente: ponen 1, lo omiten, o
// reportan el packing del importador en lugar del estándar de la finca.  Para
// los packing lists de Colombia forzamos siempre el ratio correcto por familia
// para que la columna G (BCH/ST) y la fórmula I=J/G salgan congruentes con la
// realidad.  J (TOTAL STEAM) y K (precio) no se tocan, así que el total del
// invoice no cambia ni un céntimo — solo cambia la lectura de "bunches".
// Familias no listadas (RUSCUS, etc.) conservan lo que venga del PDF.
const STEMS_PER_BUNCH_CO = {
  ROSE:        10,
  SPRAY_ROSE:  10,
  GARDEN_ROSE: 10,
  CARNATION:   20,
  MINI_CARN:   10,
  SPRAY_CARN:  20,   // misma proporción que claveles estándar
  ALSTRO:      10,
  HYDRANGEA:   1,
  RUSCUS:      25,   // 25 stems/bunch (25단 por caja también, pero H se respeta del PDF)
  // Familias no listadas → no se sobreescribe (usa fallback del PDF)
};
function stemsPerBunchCO(matchedName, fallback) {
  const fam = detectFamily(matchedName || '');
  if (fam && Object.prototype.hasOwnProperty.call(STEMS_PER_BUNCH_CO, fam)) {
    return STEMS_PER_BUNCH_CO[fam];
  }
  return fallback;
}

// =============================================================================
// STEMS_PER_BOX_CO — stems/caja (columna H) correctos por finca+familia (CO)
// =============================================================================
// El PDF reporta a veces MAL los stems-per-box de ciertas combinaciones
// finca+familia, lo que rompe la columna H y descuadra el total contra el
// invoice (bloqueando la descarga).  Aquí forzamos el valor correcto — igual
// que STEMS_PER_BUNCH_CO fuerza el bunch (columna G).
//   clave '*'      = aplica a CUALQUIER finca
//   clave '<ABBR>' = aplica solo a esa finca (gana sobre '*')
// OJO: esto SÍ cambia J (=F*H) y L (=K*J).  Si el valor forzado no fuese el
// real, el descuadre contra invoice_total seguirá avisando y bloqueando.
const STEMS_PER_BOX_CO = {
  '*':  { ALSTRO: 160 },     // alstroemeria: SIEMPRE 160/caja en cualquier finca
  TEU:  { CARNATION: 300 },  // Teucali: clavel estándar 300/caja
};
function stemsPerBoxCO(farmAbbr, matchedName, fallback) {
  const fam = detectFamily(matchedName || '');
  if (!fam) return fallback;
  const byFarm = STEMS_PER_BOX_CO[farmAbbr];
  if (byFarm && Object.prototype.hasOwnProperty.call(byFarm, fam)) return byFarm[fam];
  const any = STEMS_PER_BOX_CO['*'];
  if (any && Object.prototype.hasOwnProperty.call(any, fam)) return any[fam];
  return fallback;
}

// Tokenization with compound word splitting
const COMPOUND_SPLITS = {
  QUICKSAND: 'QUICK SAND', SNOWFLAKE: 'SNOW FLAKE', OCEANSONG: 'OCEAN SONG',
  MOONLIGHT: 'MOON LIGHT', PLAYABLANCA: 'PLAYA BLANCA', CORALREEF: 'CORAL REEF',
  YUKARICHERRY: 'YUKARI CHERRY', YUKARIOSCURO: 'YUKARI OSCURO',
  CAROLINEGOLD: 'CAROLINE GOLD', DONPEDRO: 'DON PEDRO', CLEARWATER: 'CLEAR WATER',
  APPLETEA: 'APPLE TEA', PRADOMINT: 'PRADO MINT', PRADOGREEN: 'PRADO GREEN',
  BESWEET: 'BE SWEET', PINKFLOYD: 'PINK FLOYD', COUNTRYBLUES: 'COUNTRY BLUES',
  DEEPSILVER: 'DEEP SILVER', PINKOHARA: 'PINK OHARA', CHOCOBLOOM: 'CHOCO BLOOM',
  LIPSSTICK: 'LIPSSTIC', MOONLIGTH: 'MOON LIGHT',  // common typos
};
const NOISE_WORDS = new Set([
  'SELECT','SEL','SE','SL','HB','QB','FB','OB','PB','HALF','QUARTER','FULL','OCTAVE',
  'CO','US','USD','EUR','THE','OF','AND','OR','X10','X20','X25','X30','X50','X100',
  'STEM','STEMS','BUNCH','BUNCHES','PIECE','PIECES','BOX','BOXES','BCH','PC','GR','HG',
  'GRADE','PREMIUM','REGULAR','STANDARD','CMS','CM','SF','PRO','MAYRA','MC',
  'ROSE','ROSES','ROSA','ROSAS','SPRAY','GARDEN','CARNATION','CAR','MINI','MINICARNATION','SPARY',
  'ALSTROEMERIA','ALSTROMERIA','ALS','RUSCUS','RUS','HYDRANGEA','HYD',
]);

function splitCompounds(s) {
  // Normalize Ecuador Rosaleda dye codes ("AS 73", "AS033", "AS 047", "AS154") -> "AS73", "AS33", "AS47", "AS154"
  const n = (s || '').toUpperCase().replace(/\bAS\s*0*(\d{1,4})\b/g, 'AS$1');
  const out = [];
  for (const tok of n.split(/[^A-Z0-9]+/)) {
    if (!tok) continue;
    if (COMPOUND_SPLITS[tok]) out.push(...COMPOUND_SPLITS[tok].split(' '));
    else out.push(tok);
  }
  return out.join(' ');
}
function tokenize(s) {
  const expanded = splitCompounds(s);
  const out = [];
  for (const w of expanded.split(/[^A-Z0-9]+/)) {
    if (!w || w.length < 2 || NOISE_WORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}
function extractSize(s) {
  const n = (s || '').toUpperCase();
  const candidates = [];
  const re = /(?:^|[\s\-])(\d{2,3})\s?(?:CM|CMS)?(?=\s|$|[^A-Z0-9])/g;
  let m;
  while ((m = re.exec(n)) !== null) {
    const v = parseInt(m[1]);
    if ([40, 50, 60, 70, 80, 90, 100].indexOf(v) >= 0) candidates.push(v);
  }
  return candidates[0] || null;
}

// Score with family-awareness and meaningful tokens
const SAMPLE_SIGNAL_RE = /\b(?:muestras?|samples?)\b|샘플/i;

function scoreMatch(invoiceDesc, catalogItem, invFamily) {
  const catFamily = catalogItem.family;
  if (invFamily && catFamily && invFamily !== catFamily) {
    // GARDEN_ROSE invoice → ROSE catalog allowed as fallback
    if (!(invFamily === 'GARDEN_ROSE' && catFamily === 'ROSE')) return 0;
  }
  const invIsSample = SAMPLE_SIGNAL_RE.test(invoiceDesc || '');
  const catIsSample = SAMPLE_SIGNAL_RE.test(catalogItem?.name || '');
  if (invIsSample && catIsSample) {
    return (invFamily && catFamily && invFamily === catFamily) ? 0.96 : 0.9;
  }
  const invToks = tokenize(invoiceDesc).filter(t => t.length >= 3);
  const catToks = tokenize(catalogItem.name).filter(t => t.length >= 3);
  if (invToks.length === 0 || catToks.length === 0) return 0;
  const invSet = new Set(invToks), catSet = new Set(catToks);
  let overlap = 0;
  for (const t of invSet) if (catSet.has(t)) overlap++;
  if (overlap === 0) return 0;
  const recall = overlap / invSet.size;
  const precision = overlap / catSet.size;
  // F1-like score weighted toward recall
  const f1 = recall * precision === 0 ? 0 : 2 * recall * precision / (recall + precision);
  let bonus = 0;
  const invSize = extractSize(invoiceDesc);
  const catSize = extractSize(catalogItem.name);
  if (invSize && catSize) {
    if (invSize !== catSize) return 0;
    bonus += 0.15;
  } else if (!invSize && !catSize) bonus += 0.05;
  else bonus -= 0.1;
  if (invFamily && catFamily && invFamily === catFamily) bonus += 0.05;
  let total = Math.max(0, Math.min(1, f1 + bonus));
  if (invIsSample && !catIsSample) total *= 0.65;
  else if (!invIsSample && catIsSample) total *= 0.5;
  return total;
}

function findBestMatch(invoiceDesc, catalogItems) {
  if (!catalogItems || catalogItems.length === 0) return { item: null, score: 0, candidates: [] };
  const invFam = detectFamily(invoiceDesc);
  const scored = catalogItems
    .map(item => ({ item, score: scoreMatch(invoiceDesc, item, invFam) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { item: null, score: 0, candidates: [] };
  return { item: scored[0].item, score: scored[0].score, candidates: scored.slice(0, 8) };
}

// Decide whether a match is "confident enough" to auto-apply
// - Best score >= 0.85 AND clearly better than #2 (gap >= 0.10)
// - OR best score == 1.0 AND #2 < 0.95
function isConfidentMatch(matchResult) {
  if (!matchResult || !matchResult.item) return false;
  const cs = matchResult.candidates;
  if (cs.length === 0) return false;
  const top = cs[0].score;
  const second = cs.length > 1 ? cs[1].score : 0;
  if (top >= 0.85 && (top - second) >= 0.10) return true;
  if (top === 1.0 && second < 0.95) return true;
  return false;
}

// Normalize an invoice description to use as alias key
// Persistent ERP identity must preserve Korean/Chinese and length qualifiers.
export function packingSourceKey(value) {
  return 'erp:' + String(value ?? '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
}
function aliasKey(s) {
  // Normalize to UPPERCASE, collapse whitespace, trim.  Also strip any CJK
  // (Chinese / Japanese / Korean) characters and the parentheses around them
  // so an invoice description like "Luo shen (洛神)" hashes to the same key
  // as a SEED entry of "LUO SHEN".  The CJK ranges covered:
  //   U+3000-303F   CJK symbols and punctuation
  //   U+3400-4DBF   CJK Extension A
  //   U+4E00-9FFF   CJK Unified Ideographs
  //   U+AC00-D7AF   Hangul syllables
  //   U+3040-30FF   Hiragana / Katakana
  return (s || '')
    .toUpperCase()
    .replace(/[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/\(\s*\)/g, '')        // empty parens left after CJK strip
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// MATCHES (aliases) como Excel visible y editable  — añadido para uso local
// =============================================================================
// El "seed" que gestiona el usuario es el conjunto de matches
// (descripcion del invoice -> nombre del catalogo). Aqui lo leemos/escribimos
// como un .xlsx real que se puede abrir y editar en Excel.
// Columnas: A=Descripcion del invoice, B=Nombre en catalogo, C=Origen.
function parseAliasesXlsx(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map = {};
  for (let i = 1; i < rows.length; i++) {        // fila 0 = cabeceras
    const r = rows[i];
    if (!r) continue;
    const desc = (r[0] == null ? '' : String(r[0])).trim();
    const name = (r[1] == null ? '' : String(r[1])).trim();
    if (!desc || !name) continue;
    const key = aliasKey(desc);
    if (!key) throw new Error('Empty normalized match at row ' + (i + 1));
    if (Object.prototype.hasOwnProperty.call(map, key) && map[key] !== name) {
      throw new Error('Conflicting matches at row ' + (i + 1) + ': ' + desc);
    }
    map[key] = name;
  }
  return map;
}

function exportAliasesXlsx(XLSX, aliasesObj) {
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1A1A1A' } },
    alignment: { vertical: 'center' },
  };
  const aoa = [['Descripcion del invoice (proveedor)', 'Nombre en catalogo (Nenova)', 'Origen']];
  const keys = Object.keys(aliasesObj).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = aliasesObj[k];
    const origin = (typeof ALL_SEED_ALIASES !== 'undefined' && ALL_SEED_ALIASES[k] === v) ? 'base' : 'aprendido';
    aoa.push([k, v, origin]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 52 }, { wch: 40 }, { wch: 12 }];
  for (let c = 0; c < 3; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) ws[ref].s = headerStyle;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'matches');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'matches_nenova.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =============================================================================
// PRODUCT RESOLVER — the SINGLE point that decides what name lands in the Excel
// =============================================================================
// Hard guarantee:  the only way a name can end up as `matchedName` is if it
// EXACTLY MATCHES a name in the country's catalog.  Anything else is forced
// into the pending panel and the description is tagged `unmatched`, so the
// caller can render it differently and the user must confirm before download.
//
// This protects against three failure modes:
//   1. An alias whose target was removed/renamed in the catalog (stale seed).
//   2. A bug in scoring that returns an item not actually in the catalog list.
//   3. The fallback path that used to copy `p.description` into matchedName.
//
// Deduplication: a `seenKeys` Map is shared across all calls within the same
// invoice run.  If the same aliasKey appears twice, the second occurrence
// reuses the first decision (matched OR pending) instead of asking again.
// =============================================================================
function chinaInvoiceMatch(p, items, aliases) {
  const key = aliasKey(p.description);
  // The fully family/length-qualified key is an explicit manual decision. Unqualified
  // seeds must never silently map a rose to an unlabelled/default grade.
  if (Object.prototype.hasOwnProperty.call(aliases, key)) {
    return { alias: aliases[key], manual: true, candidates: [] };
  }
  const raw = p.source_description || p.description;
  const english = [...raw.matchAll(/\(([^()]*[a-z][^()]*)\)/gi)].map(m => aliasKey(m[1]));
  const keys = [...new Set([aliasKey(raw), ...english])];
  const rose = ['ROSE', 'SPRAY_ROSE', 'GARDEN_ROSE'].includes(p.family);
  const length = chinaStemLength(p.stem_length);
  const clean = name => aliasKey(name).replace(/\[[^\]]*\]/g, '').replace(/\bCHINA\b/g, '').replace(/\s+/g, ' ').trim();
  const catalogLength = name => {
    const grades = [...name.matchAll(/\d{2,3}\s*(?:cm)?\s*[-–]\s*\d{2,3}\s*cm|\d{2,3}\s*cm/gi)].map(m => m[0]);
    return chinaStemLength(grades.join(' / '));
  };
  const varietyTokens = name => [...new Set(tokenize(clean(name).replace(/\d{2,3}\s*(?:CM)?\s*[-–]\s*\d{2,3}\s*CM|\d{2,3}\s*CM/gi, '')))].sort().join(' ');
  const candidates = items.map(item => {
    const family = item.family || detectFamily(item.name);
    if (p.family && family && p.family !== family) return null;
    const catEnglish = [...item.name.matchAll(/\(([^()]*[a-z][^()]*)\)/gi)].map(m => aliasKey(m[1]));
    const exact = english.some(e => catEnglish.includes(e)
      || (varietyTokens(e) && varietyTokens(e) === varietyTokens(item.name)));
    let score = exact ? 1 : scoreMatch(clean(raw), { ...item, name: clean(item.name), family }, p.family);
    if (rose) {
      const grade = catalogLength(item.name);
      // Retain useful review candidates, but never promote uncertain grades.
      if (length.exact && grade.exact && length.exact !== grade.exact) return null;
      if (length.key === grade.key && length.key !== 'UNKNOWN') score += 0.05;
    }
    return score > 0 ? { item, score: Math.min(1, score) } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
  const autoCandidates = rose
    ? candidates.filter(c => length.key !== 'UNKNOWN' && catalogLength(c.item.name).key === length.key)
    : candidates;
  // Raw aliases/seed spellings remain available for non-rose XLSX products.
  const rawAlias = !rose && keys.find(k => Object.prototype.hasOwnProperty.call(aliases, k));
  if (rawAlias) return { alias: aliases[rawAlias], candidates };
  const best = { item: autoCandidates[0]?.item || null, score: autoCandidates[0]?.score || 0, candidates: autoCandidates };
  return { ...best, candidates, confident: isConfidentMatch(best),
    reason: rose && !autoCandidates.length ? 'CHINA_ROSE_LENGTH_REQUIRES_REVIEW' : 'CHINA_MATCH_REQUIRES_REVIEW' };
}

function makeProductResolver(country, catalog, aliases, ctx) {
  // ctx: { farm, farmAbbr, invoice, pending, noMatches }
  // Build a fast catalog-name lookup set for the country.
  const items = (catalog && catalog.byCountry && catalog.byCountry[country]) || [];
  const catalogNameSet = new Set(items.map(it => it.name));
  const seenKeys = new Map();   // aliasKey → { matchedName, unmatched, viaAlias, matchScore }

  return function resolve(p, lineIdx) {
    if (needsInvoiceAllocation(country, p.source_description || p.description)) {
      return { ...p, matchedName:p.description, unmatched:true, allocationRequired:true };
    }
    if (country === 'CN' && isStructuredChinaInvoice(p.source_format)) {
      // Qualify BEFORE alias/cache lookup, including caller-constructed products
      // that did not pass through the workbook parser. Do not mutate the input.
      const raw = p.source_description || p.description.replace(/\s*\[(?:family|length):[^\]]*\]/gi, '').trim();
      const family = p.family || detectFamily(raw);
      const stemLength = p.stem_length ?? p.length?.raw ?? p.description.match(/\[length:([^\]]*)\]/i)?.[1] ?? '';
      p = { ...p, source_description: raw, family, stem_length: stemLength,
        description: chinaInvoiceDescription(p.description, family, stemLength) };
    }
    const out = { ...p };
    const aKey = aliasKey(p.description);
    const sourceKey = packingSourceKey(p.description);

    // Dedup: same description already resolved in this invoice
    if (seenKeys.has(sourceKey)) {
      const cached = seenKeys.get(sourceKey);
      Object.assign(out, cached);
      return out;
    }

    // Helper: finalize a result, validate against catalog, and remember.
    const finalize = (decision) => {
      // HARD VALIDATION: the matchedName must exist in the catalog.
      // If not (stale alias / scoring bug / etc.) we force to pending.
      if (!decision.unmatched && !catalogNameSet.has(decision.matchedName)) {
        decision = {
          matchedName: p.description,        // keep the raw for display
          unmatched: true,
          staleAlias: true,                  // diagnostic flag
        };
        // Also push into the pending panel so the user fixes it.
        const m = findBestMatch(p.description, items);
        if (m.candidates && m.candidates.length > 0) {
          ctx.pending.push({
            farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
            lineIdx, description: p.description, candidates: m.candidates,
          });
        } else {
          ctx.noMatches.push({
            farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
            lineIdx, description: p.description, candidates: [],
          });
        }
      }
      seenKeys.set(sourceKey, decision);
      Object.assign(out, decision);
      return out;
    };

    // Without a catalog we cannot resolve — everything is unmatched.
    if (items.length === 0) {
      ctx.noMatches.push({ farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
        lineIdx, description: p.description, candidates: [] });
      return finalize({ matchedName: p.description, unmatched: true });
    }

    if (Object.prototype.hasOwnProperty.call(aliases, sourceKey)) {
      return finalize({ matchedName: aliases[sourceKey], viaAlias: true });
    }

    if (country === 'CN' && isStructuredChinaInvoice(p.source_format)) {
      const match = chinaInvoiceMatch(p, items, aliases);
      if (match.alias && catalogNameSet.has(match.alias)) {
        return finalize({ matchedName: match.alias, viaAlias: true });
      }
      if (!match.alias && match.confident) {
        return finalize({ matchedName: match.item.name, matchScore: match.score });
      }
      const review = { farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
        lineIdx, description: p.description, source_row: p.source_row,
        stem_length: p.stem_length, reason: match.reason || 'STALE_ALIAS', candidates: match.candidates };
      (match.candidates.length ? ctx.pending : ctx.noMatches).push(review);
      return finalize({ matchedName: p.description, unmatched: true,
        staleAlias: Boolean(match.alias), matchReason: review.reason });
    }

    // 1) Alias hit (seed or learned)
    if (aliases[aKey]) {
      return finalize({ matchedName: aliases[aKey], viaAlias: true });
    }

    // 2) Automatic match
    const m = findBestMatch(p.description, items);
    if (m.item && isConfidentMatch(m)) {
      return finalize({ matchedName: m.item.name, matchScore: m.score });
    }

    // 3) Not confident → pending decision
    if (m.candidates && m.candidates.length > 0) {
      ctx.pending.push({
        farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
        lineIdx, description: p.description, candidates: m.candidates,
      });
    } else {
      ctx.noMatches.push({
        farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
        lineIdx, description: p.description, candidates: [],
      });
    }
    return finalize({ matchedName: p.description, unmatched: true });
  };
}

export {
  KR_COUNTRY_TO_CODE,
  parseCatalog,
  normalize,
  FAMILY_PATTERNS,
  detectFamily,
  familyForCatalog,
  STEMS_PER_BUNCH_CO,
  stemsPerBunchCO,
  STEMS_PER_BOX_CO,
  stemsPerBoxCO,
  COMPOUND_SPLITS,
  NOISE_WORDS,
  splitCompounds,
  tokenize,
  extractSize,
  scoreMatch,
  findBestMatch,
  isConfidentMatch,
  aliasKey,
  parseAliasesXlsx,
  exportAliasesXlsx,
  makeProductResolver,
};
