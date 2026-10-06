// Ported from Packing List Nenova.html; country calculations and workbook styles preserved.
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
  ['ROSE',        ['ROSE', 'ROSES']],
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
  DEEPSILVER: 'DEEP SILVER', PINKOHARA: 'PINK OHARA',
  LIPSSTICK: 'LIPSSTIC', MOONLIGTH: 'MOON LIGHT',  // common typos
};
const NOISE_WORDS = new Set([
  'SELECT','SEL','SE','SL','HB','QB','FB','OB','PB','HALF','QUARTER','FULL','OCTAVE',
  'CO','US','USD','EUR','THE','OF','AND','OR','X10','X20','X25','X30','X50','X100',
  'STEM','STEMS','BUNCH','BUNCHES','PIECE','PIECES','BOX','BOXES','BCH','PC','GR','HG',
  'GRADE','PREMIUM','REGULAR','STANDARD','CMS','CM','SF','PRO','MAYRA','MC',
  'ROSE','ROSES','SPRAY','GARDEN','CARNATION','CAR','MINI','MINICARNATION','SPARY',
  'ALSTROEMERIA','ALSTROMERIA','ALS','RUSCUS','RUS','HYDRANGEA','HYD',
]);

function splitCompounds(s) {
  const n = (s || '').toUpperCase();
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
function scoreMatch(invoiceDesc, catalogItem, invFamily) {
  const catFamily = catalogItem.family;
  if (invFamily && catFamily && invFamily !== catFamily) {
    // GARDEN_ROSE invoice → ROSE catalog allowed as fallback
    if (!(invFamily === 'GARDEN_ROSE' && catFamily === 'ROSE')) return 0;
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
  return Math.max(0, Math.min(1, f1 + bonus));
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
function makeProductResolver(country, catalog, aliases, ctx) {
  // ctx: { farm, farmAbbr, invoice, pending, noMatches }
  // Build a fast catalog-name lookup set for the country.
  const items = (catalog && catalog.byCountry && catalog.byCountry[country]) || [];
  const catalogNameSet = new Set(items.map(it => it.name));
  const seenKeys = new Map();   // aliasKey → { matchedName, unmatched, viaAlias, matchScore }

  return function resolve(p, lineIdx) {
    const out = { ...p };
    const aKey = aliasKey(p.description);

    // Dedup: same description already resolved in this invoice
    if (seenKeys.has(aKey)) {
      const cached = seenKeys.get(aKey);
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
      seenKeys.set(aKey, decision);
      Object.assign(out, decision);
      return out;
    };

    // Without a catalog we cannot resolve — everything is unmatched.
    if (items.length === 0) {
      ctx.noMatches.push({ farm: ctx.farm, farmAbbr: ctx.farmAbbr, invoice: ctx.invoice,
        lineIdx, description: p.description, candidates: [] });
      return finalize({ matchedName: p.description, unmatched: true });
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

// Seed aliases — derived from reference packing lists you've already provided.
// These are pre-loaded so the app already knows these matches and won't ask you again.
const SEED_ALIASES_CO = {
  '101.A001.BLUE 50CM T 10ST MAT': 'ROSE / Tinted Blue 50cm',
  '101.A002.WHITE/BLUE 50CM T 10ST MAT': 'ROSE / Lollipop White Blue 50cm',
  '101.P002.DUSK 50CM T 10ST MAT': 'ROSE / Tinted Aurora 50cm',
  'BRIGHTON 50CM N 10ST MAT': 'ROSE / Brighton 50cm',
  'CAR MOON LIGTH X 20 STEMS (H)': 'CARNATION Moon Light',
  'CARNATION CREAM POLIMNIA SELECT': 'CARNATION Polimnia',
  'CARNATION GOBLIN GREEN SELECT': 'CARNATION Goblin',
  'CARNATION SEL PEACH NOVIA': 'CARNATION Novia',
  'CARNATION SELECT L.PINK JODIE': 'CARNATION Jodie',
  'CARNATIONCAROLINEGOLD X20 - SEL': 'CARNATION Caroline Gold',
  'CARNATIONCHEERIO X20 - SEL': 'CARNATION Cherrio',
  'CARNATIONCLEARWATER X20 - SEL': 'CARNATION Clear Water',
  'CARNATIONCRIMEA X20 - SEL': 'CARNATION Crimea',
  'CARNATIONDONCEL X20 - SEL': 'CARNATION Doncel',
  'CARNATIONGOBLIN X20 - SEL': 'CARNATION Goblin',
  'CARNATIONNOVIA - DONCEL - YUKARICHERRY - MARIPOSA - LION KING': 'CARNATION Mix box',
  'CARNATIONNOVIA X20 - SEL': 'CARNATION Novia',
  'CARNATIONORANGEHERMES X20 - SEL': 'CARNATION Hermes Orange',
  'CARNATIONRODAS X20 - SEL': 'CARNATION rodas',
  'CARNATIONROYALDAMASCUS X20 - SEL': 'CARNATION Royal damascus',
  'CORAL REEF 50CM N 10ST MAT': 'ROSE / Coral Reef 50cm',
  'MIN ATHENA X 10 STEMS (H)': 'MiniCarnation Athena (연핑크)',
  'MIN WHITE X 10 STEMS (H)': 'MiniCarnation White',
  'MOMENTUM 50CM N 10ST MAT': 'ROSE / Momentum 50cm',
  'MONDIAL - 50': 'ROSE / Mondial White 50cm',
  'MONDIAL 50CM N 10ST ACL': 'ROSE / Mondial White 50cm',
  'ROSE ASSORTED 50 CM(06.03.11.00.00)': 'ROSE / Mix Box 50cm',
  'ROSE CORAL REEF 50 CM(06.03.11.00.00)': 'ROSE / Coral Reef 50cm',
  'ROSE FREEDOM 50 CM(06.03.11.00.00)': 'ROSE / Freedom 50cm',
  'ROSE MONDIAL 50 CM(06.03.11.00.00)': 'ROSE / Mondial White 50cm',
  'ROSE MONDIAL 60 CM(06.03.11.00.00)': 'ROSE / Mondial White 60cm',
  'ROSE PINK MONDIAL 50 CM(06.03.11.00.00)': 'ROSE / Pink Mondial 50cm',
  'ROSES MONDIAL 50CM': 'ROSE / Mondial White 50cm',
  'ROSES MONDIAL 60CM': 'ROSE / Mondial White 60cm',
  'RUSCUS 70 CMS': 'Ruscus Green 70cm',
  'ALSTROEMERIA DUBAI PINK SELECT': 'ALSTROMERIA Dubai',
  'ALSTROEMERIA SELECT DUBAI': 'ALSTROMERIA Dubai',
  'ALSTROEMERIA SELECT FIFI': 'ALSTROMERIA Fifi',
  'ALSTROEMERIA SELECT GOLD': 'ALSTROMERIA Gold',
  'ALSTROEMERIA SELECT LAVENDER': 'ALSTROMERIA Lavender',
  'ALSTROEMERIA SELECT WHISTLER': 'ALSTROMERIA Whistler',
  'ALSTROEMERIA WHISTLER WHITE SELECT': 'ALSTROMERIA Whistler',
  'BE SWEET 50 CM': 'ROSE / Be Sweet 50cm',
  'BE SWEET 50CM N 10ST MAT': 'ROSE / Be Sweet 50cm',
  'BE SWEET 60CM N 10ST MAT': 'ROSE / Be Sweet 60cm',
  'BIMBA 50CM N 10ST ACL': 'ROSE / Bimba 50cm',
  'CANDLELIGHT 50CM N 10ST MAT': 'ROSE / Candlelight 50cm',
  'CANDLELIGHT ROSE 50 CM': 'ROSE / Candlelight 50cm',
  'CAR BRUT X 20 STEMS': 'CARNATION Brut',
  'CAR CHERIO X 20 STEMS': 'CARNATION Cherrio',
  'CAR CLEAR WATER X 20 STEMS': 'CARNATION Clear Water',
  'CAR CRIMEA X 20 STEMS': 'CARNATION Crimea',
  'CAR DON PEDRO X 20 STEMS': 'CARNATION Don pedro (Red)',
  'CAR DONCEL X 20 STEMS': 'CARNATION Doncel',
  'CAR ELECTRIC PURPLE X 20 STEMS': 'CARNATION Electric Purple',
  'CAR GIOGIA X 20 STEMS': 'CARNATION Giogia',
  'CAR HERMES X 20 STEMS': 'CARNATION Hermes',
  'CAR KAORI X 20 STEMS': 'CARNATION Kaori',
  'CAR LIPSSTICK X 20 STEMS': 'CARNATION Lipsstic',
  'CAR MARIPOSA X 20 STEMS': 'CARNATION Mariposa',
  'CAR MEGANE X 20 STEMS': 'CARNATION Megan',
  'CAR MOON LIGTH X 20 STEMS': 'CARNATION Moon Light',
  'CAR NESS X 20 STEMS': 'CARNATION Ness',
  'CAR NOVIA X 20 STEMS': 'CARNATION Novia',
  'CAR ORANGE HERMES X 20 STEMS': 'CARNATION Hermes Orange',
  'CAR POLIMNIA X 20 STEMS': 'CARNATION Polimnia',
  'CAR YUKARI CHERRY X 20 STEMS': 'CARNATION Yukari Cherry',
  'CAR ZURIGO X 20 STEMS': 'CARNATION Zurigo',
  'CARNATION APPLE TEA': 'CARNATION Apple Tea',
  'CARNATION APPLE TEA - SELECT': 'CARNATION Apple Tea',
  'CARNATION APPLE TEA X 20 - SEL': 'CARNATION Apple Tea',
  'CARNATION APPLE TEA X20 - SEL': 'CARNATION Apple Tea',
  'CARNATION BICOLOR CHERRIO SELECT': 'CARNATION Cherrio',
  'CARNATION BICOLOR FRONTERA SELECT': 'CARNATION Red Frontera',
  'CARNATION BICOLOR MARIPOSA SELECT': 'CARNATION Mariposa',
  'CARNATION BICOLOR YUKARI CHERRY SELECT': 'CARNATION Yukari Cherry',
  'CARNATION BRUT X 20 - SEL': 'CARNATION Brut',
  'CARNATION BRUT X20 - SEL': 'CARNATION Brut',
  'CARNATION CARAMEL X 20 - SEL': 'CARNATION Caramel',
  'CARNATION CARAMEL X20 - SEL': 'CARNATION Caramel',
  'CARNATION CAROLINE GOLD GOLD SELECT': 'CARNATION Caroline Gold',
  'CARNATION CAROLINE GOLD X 20 - SEL': 'CARNATION Caroline Gold',
  'CARNATION CAROLINE GOLD X20 - SEL': 'CARNATION Caroline Gold',
  'CARNATION CAROLINE X 20 - SEL': 'CARNATION Caroline',
  'CARNATION CAROLINE X20 - SEL': 'CARNATION Caroline',
  'CARNATION CHAMPAGNE BRUT SELECT': 'CARNATION Brut',
  'CARNATION CHEERIO': 'CARNATION Cherrio',
  'CARNATION CHEERIO BICOLOR RED SELECT': 'CARNATION Cherrio',
  'CARNATION CHEERIO X 20 - SEL': 'CARNATION Cherrio',
  'CARNATION CHEERIO X20 - SEL': 'CARNATION Cherrio',
  'CARNATION CLEARWATER SELECT': 'CARNATION Clear Water',
  'CARNATION CLEARWATER X 20 - SEL': 'CARNATION Clear Water',
  'CARNATION CLEARWATER X20 - SEL': 'CARNATION Clear Water',
  'CARNATION COSMO LILAC SELECT': 'CARNATION Cosmo lilac',
  'CARNATION CREAM RODAS SELECT': 'CARNATION rodas',
  'CARNATION CRIMEA': 'CARNATION Crimea',
  'CARNATION CRIMEA X 20 - SEL': 'CARNATION Crimea',
  'CARNATION CRIMEA X20 - SEL': 'CARNATION Crimea',
  'CARNATION DAMASCUS X20 - SEL': 'CARNATION damascus',
  'CARNATION DAMINA - SELECT': 'CARNATION Damina',
  'CARNATION DILETTA CREMA - SELECT': 'CARNATION Diletta Cream',
  'CARNATION DILETTA CREMA SELECT': 'CARNATION Diletta Cream',
  'CARNATION DOLLAR X20 - SEL': 'CARNATION dollar',
  'CARNATION DON PEDRO RED SELECT': 'CARNATION Don pedro (Red)',
  'CARNATION DON PEDRO X 20 - SEL': 'CARNATION Don pedro (Red)',
  'CARNATION DON PEDRO X20 - SEL': 'CARNATION Don pedro (Red)',
  'CARNATION DONCEL - SELECT': 'CARNATION Doncel',
  'CARNATION DONCEL LIGHT PINK SELECT': 'CARNATION Doncel',
  'CARNATION DONCEL SELECT': 'CARNATION Doncel',
  'CARNATION DONCEL X 20 - SEL': 'CARNATION Doncel',
  'CARNATION DONCEL X20 - SEL': 'CARNATION Doncel',
  'CARNATION GOBLIN X 20 - SEL': 'CARNATION Goblin',
  'CARNATION GOBLIN X20 - SEL': 'CARNATION Goblin',
  'CARNATION GOLD CAROLINE GOLD SELECT': 'CARNATION Caroline Gold',
  'CARNATION GOLD CRIMEA SELECT': 'CARNATION Crimea',
  'CARNATION GOLEM X 20 - SEL': 'CARNATION Golem',
  'CARNATION GOLEM X20 - SEL': 'CARNATION Golem',
  'CARNATION GREEN PRADO MINT SELECT': 'CARNATION Prado Mint',
  'CARNATION HERMES': 'CARNATION Hermes',
  'CARNATION HERMES ORANGE ORANGE SELECT': 'CARNATION Hermes Orange',
  'CARNATION HERMES ORANGE SELECT': 'CARNATION Hermes Orange',
  'CARNATION HERMES X 20 - SEL': 'CARNATION Hermes',
  'CARNATION HERMES X20 - SEL': 'CARNATION Hermes',
  'CARNATION HERMES YELLOW SELECT': 'CARNATION Hermes',
  'CARNATION IKEBANA PINK SELECT': 'CARNATION Ikebana',
  'CARNATION IKEBANA X 20 - SEL': 'CARNATION Ikebana',
  'CARNATION IKEBANA X20 - SEL': 'CARNATION Ikebana',
  'CARNATION INDIE SELECT': 'CARNATION Indie',
  'CARNATION LAVANDER LIGHT CLEAR WATER SELECT': 'CARNATION Clear Water',
  'CARNATION LEGE PINK X 20 - SEL': 'CARNATION Lege Pink',
  'CARNATION LEGE PINK X20 - SEL': 'CARNATION Lege Pink',
  'CARNATION LIGHT PINK DONCEL SELECT': 'CARNATION Doncel',
  'CARNATION LION KING X 20 - SEL': 'CARNATION Lion King',
  'CARNATION LION KING X20 - SEL': 'CARNATION Lion King',
  'CARNATION MANDALAY - SELECT': 'CARNATION Mandalay',
  'CARNATION MANDALAY X 20 - SEL': 'CARNATION Mandalay',
  'CARNATION MANDALAY X20 - SEL': 'CARNATION Mandalay',
  'CARNATION MARIPOSA - SELECT': 'CARNATION Mariposa',
  'CARNATION MARIPOSA X 20 - SEL': 'CARNATION Mariposa',
  'CARNATION MARIPOSA X20 - SEL': 'CARNATION Mariposa',
  'CARNATION MARUCHI X 20 - SEL': 'CARNATION Maruchi',
  'CARNATION MARUCHI X20 - SEL': 'CARNATION Maruchi',
  'CARNATION MIX BOX A': 'CARNATION MIx Box A (Doncel. Novia, Moonlight)',
  'CARNATION MIX BOX B': 'CARNATION MIx Box B (Megan. Hermes, Ikebana)',
  'CARNATION MIX BOX C': 'CARNATION MIx Box C (Crimea. Polimnia, Maruchi)',
  'CARNATION MIX BOX D': 'CARNATION MIx Box D (Mariposa. Yukari cherry, Cherrio)',
  'CARNATION MIX BOX E': 'CARNATION MIx Box E (Mandalay. Farida, Zurigo)',
  'CARNATION MOON LIGHT - SELECT': 'CARNATION Moon Light',
  'CARNATION MOON LIGHT WHITE SELECT': 'CARNATION Moon Light',
  'CARNATION MOON LIGHT X 20 - SEL': 'CARNATION Moon Light',
  'CARNATION MOON LIGHT X20 - SEL': 'CARNATION Moon Light',
  'CARNATION NOVIA - DONCEL - YUKARI CHERRY - MARIPOSA - LION KING': 'CARNATION Mix box',
  'CARNATION NOVIA PEACH SELECT': 'CARNATION Novia',
  'CARNATION NOVIA SELECT': 'CARNATION Novia',
  'CARNATION NOVIA X 20 - SEL': 'CARNATION Novia',
  'CARNATION NOVIA X20 - SEL': 'CARNATION Novia',
  'CARNATION ORANGE CAROLINE SELECT': 'CARNATION Caroline',
  'CARNATION ORANGE HERMES ORANGE SELECT': 'CARNATION Hermes Orange',
  'CARNATION ORANGE HERMES X 20 - SEL': 'CARNATION Hermes Orange',
  'CARNATION ORANGE HERMES X20 - SEL': 'CARNATION Hermes Orange',
  'CARNATION ORANGE MAJESTA SELECT': 'CARNATION Majesta',
  'CARNATION PEACH APPLE TEA SELECT': 'CARNATION Apple Tea',
  'CARNATION PEACH NOVIA SELECT': 'CARNATION Novia',
  'CARNATION PEACH PEACHY MAMBO SELECT': 'CARNATION Peach Mambo',
  'CARNATION POLIMNIA': 'CARNATION Polimnia',
  'CARNATION POLIMNIA - SELECT': 'CARNATION Polimnia',
  'CARNATION POLIMNIA X 20 - SEL': 'CARNATION Polimnia',
  'CARNATION POLIMNIA X20 - SEL': 'CARNATION Polimnia',
  'CARNATION PRADO GREEN SELECT': 'CARNATION Prado Mint',
  'CARNATION RED DON PEDRO SELECT': 'CARNATION Don pedro (Red)',
  'CARNATION RODAS SELECT': 'CARNATION rodas',
  'CARNATION RODAS X 20 - SEL': 'CARNATION rodas',
  'CARNATION RODAS X20 - SEL': 'CARNATION rodas',
  'CARNATION ROYAL DAMASCUS X 20 - SEL': 'CARNATION Royal damascus',
  'CARNATION ROYAL DAMASCUS X20 - SEL': 'CARNATION Royal damascus',
  'CARNATION SEL GOLD CAROLINE GOLD': 'CARNATION Caroline Gold',
  'CARNATION SEL LIGHT PINK DONCEL': 'CARNATION Doncel',
  'CARNATION SEL ORANGE ORANGE FLAME': 'CARNATION Orange Flame',
  'CARNATION SEL PEACH APPLE TEA': 'CARNATION Apple Tea',
  'CARNATION SEL RED DON PEDRO': 'CARNATION Don pedro (Red)',
  'CARNATION SEL WHITE MOON LIGHT': 'CARNATION Moon Light',
  'CARNATION SELECT BIC VARIOS GIOIA': 'CARNATION Giogia',
  'CARNATION SELECT BIC VARIOS YUKARI SCURO': 'CARNATION Yukari Oscuro',
  'CARNATION SELECT BICOLOR AMICO LAVANDER': 'CARNATION Amico Lavender',
  'CARNATION SELECT BICOLOR GIOIA': 'CARNATION Giogia',
  'CARNATION SELECT CAROLINE GOLD': 'CARNATION Caroline Gold',
  'CARNATION SELECT CREAM POLIMNIA': 'CARNATION Polimnia',
  'CARNATION SELECT DON PEDRO': 'CARNATION Don pedro (Red)',
  'CARNATION SELECT GOLD CRIMEA': 'CARNATION Crimea',
  'CARNATION SELECT HERMES': 'CARNATION Hermes',
  'CARNATION SELECT HERMES ORANGE': 'CARNATION Hermes Orange',
  'CARNATION SELECT IKEBANA': 'CARNATION Ikebana',
  'CARNATION SELECT KOMACHI': 'CARNATION Komachi',
  'CARNATION SELECT MARIPOSA': 'CARNATION Mariposa',
  'CARNATION SELECT MOON LIGHT': 'CARNATION Moon Light',
  'CARNATION SELECT NOVIA': 'CARNATION Novia',
  'CARNATION SELECT ORANGE HERMES ORANGE': 'CARNATION Hermes Orange',
  'CARNATION SELECT ORANGE MEGAN': 'CARNATION Megan',
  'CARNATION SELECT PINK IKEBANA': 'CARNATION Ikebana',
  'CARNATION SELECT PRADO MINT': 'CARNATION Prado Mint',
  'CARNATION SELECT RODAS': 'CARNATION rodas',
  'CARNATION SELECT VERONA': 'CARNATION Verona Pink',
  'CARNATION SELECT WHITE MOON LIGHT': 'CARNATION Moon Light',
  'CARNATION SELECT YUKARI CHERRY': 'CARNATION Yukari Cherry',
  'CARNATION SELECT ZURIGO': 'CARNATION Zurigo',
  'CARNATION SL CRIMEA': 'CARNATION Crimea',
  'CARNATION SL DILETTA': 'CARNATION Diletta (Yellow)',
  'CARNATION SL DON PEDRO': 'CARNATION Don pedro (Red)',
  'CARNATION SL DONCEL': 'CARNATION Doncel',
  'CARNATION SL ILIAS': 'CARNATION Ilias',
  'CARNATION SL JELLY': 'CARNATION Jelly',
  'CARNATION SL MARIPOSA': 'CARNATION Mariposa',
  'CARNATION SL MEGAN': 'CARNATION Megan',
  'CARNATION SL MOON LIGHT': 'CARNATION Moon Light',
  'CARNATION SL MOONLIGHT': 'CARNATION Moon Light',
  'CARNATION SL ZURIGO': 'CARNATION Zurigo',
  'CARNATION SPRITZ SPORT X20 - SEL': 'CARNATION Spritz Sport',
  'CARNATION WEDDING CREAM SELECT': 'CARNATION Wedding',
  'CARNATION WEDDING X 20 - SEL': 'CARNATION Wedding',
  'CARNATION WEDDING X20 - SEL': 'CARNATION Wedding',
  'CARNATION WHITE MOON LIGHT SELECT': 'CARNATION Moon Light',
  'CARNATION YELLOW HERMES SELECT': 'CARNATION Hermes',
  'CARNATION YUKARI CHERRY BICOLOR HOT PINK SELECT': 'CARNATION Yukari Cherry',
  'CARNATION YUKARI CHERRY X 20 - SEL': 'CARNATION Yukari Cherry',
  'CARNATION YUKARI CHERRY X20 - SEL': 'CARNATION Yukari Cherry',
  'CARNATION YUKARI OSCURO X 20 - SEL': 'CARNATION Yukari Oscuro',
  'CARNATION YUKARI OSCURO X20 - SEL': 'CARNATION Yukari Oscuro',
  'CARNATION ZURIGO X 20 - SEL': 'CARNATION Zurigo',
  'CARNATION ZURIGO X20 - SEL': 'CARNATION Zurigo',
  'CARNATIONS BERNARD NOVELTY SELECT': 'CARNATION Bernard',
  'CARNATIONS BRUT NOVELTY SELECT': 'CARNATION Brut',
  'CARNATIONS CARAMEL NOVELTY SELECT': 'CARNATION Caramel',
  'CARNATIONS CREAM POLIMIA SELECT': 'CARNATION Polimnia',
  'CARNATIONS CRIMEA GOLD SELECT': 'CARNATION Crimea',
  'CARNATIONS DAMASCUS BICO PURPLE SELECT': 'CARNATION damascus',
  'CARNATIONS DON PEDRO RED SELECT': 'CARNATION Don pedro (Red)',
  'CARNATIONS DONCELL PINK SELECT': 'CARNATION Doncel',
  'CARNATIONS GOLD CAROLINE GOLD SELECT': 'CARNATION Caroline Gold',
  'CARNATIONS ILIAS YELLOW SELECT': 'CARNATION Ilias',
  'CARNATIONS NOVIA PEACH SELECT': 'CARNATION Novia',
  'CARNATIONS ORANGE HERMES ORANGE SELECT': 'CARNATION Hermes Orange',
  'CARNATIONS PEACH NOVIA SELECT': 'CARNATION Novia',
  'CARNATIONS RODAS CREAM SELECT': 'CARNATION rodas',
  'CARNATIONS SAFARI BICOLOR RED SELECT': 'CARNATION Safari',
  'CARNATIONS SEL APPLE TEA': 'CARNATION Apple Tea',
  'CARNATIONS SEL CAROLINE': 'CARNATION Caroline',
  'CARNATIONS SEL CAROLINE GOLD': 'CARNATION Caroline Gold',
  'CARNATIONS SEL CLEAR WATER': 'CARNATION Clear Water',
  'CARNATIONS SEL HERMES': 'CARNATION Hermes',
  'CARNATIONS SEL HERMES ORANGE': 'CARNATION Hermes Orange',
  'CARNATIONS SEL KAORI': 'CARNATION Kaori',
  'CARNATIONS SEL MAJESTA': 'CARNATION Majesta',
  'CARNATIONS SEL NOVIA': 'CARNATION Novia',
  'CARNATIONS WHITE MOONLIGHT SELECT': 'CARNATION Moon Light',
  'COUNTRY BLUES 50CM N 10ST MAT': 'ROSE / Country Blues 50cm',
  'DEEP SILVER 50CM N 10ST ACL': 'ROSE / Deep Silver 50cm',
  'FREEDOM 50CM N 10ST MAT': 'ROSE / Freedom 50cm',
  'GARDEN ROSES * 10 STEMS CARPE DIEM 50 CM': 'ROSE / Carpe Diem 50cm Orange Bicolor',
  'GARDEN ROSES * 10 STEMS HEARTS 50 CM': 'ROSE / Hearts 50cm',
  'GARDEN ROSES * 10 STEMS PINK X-PRESSION 50 CM': 'ROSE / Pink xpression 50cm',
  'GARDEN ROSES PINK O\'HARA 50': 'ROSE / Pink Ohara 50cm',
  'HYDRANGEA TINTED LAVANDER': 'Hydrangea Lavender (라벤더)',
  'HYDRANGEA TINTED LAVENDER': 'Hydrangea Lavender (라벤더)',
  'HYDRANGEA TINTED HOT PINK': 'Hydrangea Dark Pink (진핑크)',
  'HYDRANGEA TINTED LIGHT PINK': 'Hydrangea P.PK (BA) (연핑크)',
  'HYDRANGEA PREMIUM WHITE': 'Hydrangea White (화이트)',
  'HYDRANGEA WHITE PREMIUM': 'Hydrangea White (화이트)',
  'HYD PREMIUM WHITE': 'Hydrangea White (화이트)',
  'HYDRANGEA PREMIUM BLUE': 'Hydrangea Blue (블루）',
  'HYDRANGEA BLUE PREMIUM': 'Hydrangea Blue (블루）',
  'HYDRANGEA PREMIUM LEMON': 'Hydrangea S/GN (연그린)',
  'HYDRANGEA PREMIUM PEACH': 'Hydrangea Peach (Florentina) 피치',
  'HYDRANGEA PREMIUM DARK GREEN': 'Hydrangea G/ Esmeral (진그린)',
  'HYDRANGEA PREMIUM EMERALD': 'Hydrangea G/ Esmeral (진그린)',
  'HYD PREMIUM ESMERALDA': 'Hydrangea G/ Esmeral (진그린)',
  'HYDRANGEA MINI MOJITO': 'Hydrangea M/ GREEN (BG) Mojito (미니 그린 베이스)',
  'HYDRANGEA PREMIUM TINTED LIGHT PINK': 'Hydrangea P.PK (BA) (연핑크)',
  'HYDRANGEA PREMIUM SAMPLE TINTED WINE': 'Hydrangea Wine (와인)',
  // The Antioquia Floral invoice consistently writes "HYDRAGEA" (typo, missing N).
  // We seed the typo'd forms so the app resolves them automatically.
  'HYDRAGEA PREMIUM TINTED LAVANDER': 'Hydrangea Lavender (라벤더)',
  'HYDRAGEA PREMIUM TINTED LIGHT PINK': 'Hydrangea P.PK (BA) (연핑크)',
  'HYDRAGEA PREMIUM TINTED WINE': 'Hydrangea Wine (와인)',
  // Florentina sometimes drops "PREMIUM SAMPLE" before TINTED WINE
  'HYDRANGEA TINTED WINE': 'Hydrangea Wine (와인)',
  'MANDALA 50CM N 10ST ACL': 'ROSE / Mandala 50cm',
  'MANDALA 50CM N 10ST MAT': 'ROSE / Mandala 50cm',
  'MIN HAMADA X 10 STEMS': 'MiniCarnation 피치(HAMADA)',
  'MIN IBIS X 10 STEMS': 'MiniCarnation Artic/Ibis(화이트)',
  'MIN MINUETTO X 10 STEMS': 'MInicarnation Minuetto',
  'MINI CARNATION ARTIC WHITE SELECT': 'MiniCarnation Artic/Ibis(화이트)',
  'MINI CARNATION ATHENA PINK SELECT': 'MiniCarnation Athena/Jane/Zagara(연핑크)',
  'MINI CARNATION CAESAR YELLOW SELECT': 'Minicarnation caesar/ILias(노랑)',
  'MINI CARNATION HAMADA PEACH SELECT': 'MiniCarnation 피치(HAMADA)',
  'MINI CARNATION MINUETTO BICOLOR RED SELECT': 'MInicarnation Minuetto',
  'MINI CARNATION PINK PIGEON PINK SELECT': 'Minicarnation Pink pigeon(핑크)',
  'MINICARNATION ARTIC X10 - SEL': 'MiniCarnation Artic/Ibis(화이트)',
  'MINICARNATION ATHENA X10 - SEL': 'MiniCarnation Athena/Jane/Zagara(연핑크)',
  'MINICARNATION HAMADA X10 - SEL': 'MiniCarnation 피치(HAMADA)',
  'MINICARNATION IBIS SELECT': 'MiniCarnation Artic/Ibis(화이트)',
  'MINICARNATION MINUETTO X10 - SEL': 'MInicarnation Minuetto',
  'MIX COLOR 50-60CM NG': 'ROSE / Sample',
  'MONDIAL 50CM N 10ST MAT': 'ROSE / Mondial White 50cm',
  'MONDIAL 60CM N 10ST ACL': 'ROSE / Mondial White 60cm',
  'MONDIAL 60CM N 10ST MAT': 'ROSE / Mondial White 60cm',
  'MONDIAL ROSE 60 CM': 'ROSE / Mondial White 60cm',
  'OCEAN SONG - 50': 'ROSE / Ocean song 50cm',
  'PINK MONDIAL 50CM N 10ST ACL': 'ROSE / Pink Mondial 50cm',
  'PINK MONDIAL 50CM N 10ST MAT': 'ROSE / Pink Mondial 50cm',
  'PINK XPRESSION 50CM N 10ST MAT': 'ROSE / Pink xpression 50cm',
  'PLAYA BLANCA 60CM N 10ST ACL': 'ROSE / Playa Blanca 60cm',
  'PLAYA BLANCA 60CM N 10ST MAT': 'ROSE / Playa Blanca 60cm',
  'QUICK SAND - 50': 'ROSE / Quick Sand 50cm',
  'RED PANTHER 50CM 10ST N PR': 'ROSE / Red Panther 50cm',
  'ROSA PINK BE SWEET 50 CM': 'ROSE / Be Sweet 50cm',
  'ROSA PINK HERMOSA': 'ROSE / Hermosa(Ossimo) 50cm',
  'ROSE ASSORTED 50 CM': 'ROSE / Mix Box 50cm',
  'ROSE BE SWEET X10 - 50': 'ROSE / Be Sweet 50cm',
  'ROSE BRIGHTON 50 CM': 'ROSE / Brighton 50cm',
  'ROSE CORAL REEF 50 CM': 'ROSE / Coral Reef 50cm',
  'ROSE DEEP SILVER X10 - 50': 'ROSE / Deep Silver 50cm',
  'ROSE FREEDOM 100CM': 'ROSE / Freedom 100cm',
  'ROSE FREEDOM 50 CM': 'ROSE / Freedom 50cm',
  'ROSE FREEDOM 60 CM': 'ROSE / Freedom 60cm',
  'ROSE LIGHT PINK PINK MONDIAL 50': 'ROSE / Pink Mondial 50cm',
  'ROSE MOMENTUM 50 CM': 'ROSE / Momentum 50cm',
  'ROSE MOMENTUM X10 - 50': 'ROSE / Momentum 50cm',
  'ROSE MONDIAL 50': 'ROSE / Mondial White 50cm',
  'ROSE MONDIAL 50 CM': 'ROSE / Mondial White 50cm',
  'ROSE MONDIAL 60 CM': 'ROSE / Mondial White 60cm',
  'ROSE MONDIAL GRADO 50': 'ROSE / Mondial White 50cm',
  'ROSE MONDIAL X10 - 50 **': 'ROSE / Mondial White mc 50cm',
  'ROSE OCEAN SONG 50': 'ROSE / Ocean song 50cm',
  'ROSE PINK MONDIAL 50 CM': 'ROSE / Pink Mondial 50cm',
  'ROSE PINK MONDIAL 60 CM': 'ROSE / Pink Mondial 60cm',
  'ROSE PLAYA BLANCA 50 CM': 'ROSE / Playa Blanca 50cm',
  'ROSE PLAYA BLANCA 60 CM': 'ROSE / Playa Blanca 60cm',
  'ROSE QUICK SAND - 50': 'ROSE / Quick Sand 50cm',
  'ROSE SHIMMER 50 CM': 'ROSE / Shimmer 50cm',
  'ROSE SHIMMER 60 CM': 'ROSE / Shimmer 60cm',
  'ROSE TINTED X10 - 50 **BLUE': 'ROSE / Tinted Blue 50cm',
  'ROSE TINTED X10 - 50 **LOLLIPOP WHITEBLUE': 'ROSE / Lollipop White Blue 50cm',
  'ROSE TINTED X10 - 50 AURORA': 'ROSE / Tinted Aurora 50cm',
  'ROSE TINTED X10 - 50 BLUE': 'ROSE / Tinted Blue 50cm',
  'ROSE TINTED X10 - 50 LOLLIPOP WHITEBLUE': 'ROSE / Lollipop White Blue 50cm',
  'ROSES * 10 STEMS CANDLELIGHT 50 CM': 'ROSE / Candlelight 50cm',
  'ROSES * 10 STEMS OCEAN SONG 50 CM': 'ROSE / Ocean song 50cm',
  'ROSES * 10 STEMS QUICKSAND 50 CM': 'ROSE / Quick Sand 50cm',
  'ROSES CANDLELIGHT 50': 'ROSE / Candlelight 50cm',
  'ROSES FREEDOM 50 CM': 'ROSE / Freedom 50cm',
  'ROSES MONDIAL 50 CM': 'ROSE / Mondial White 50cm',
  'ROSES MONDIAL 60 CM': 'ROSE / Mondial White 60cm',
  'ROSES PINK FLOYD 60 CM': 'ROSE / Pink Floyd (Hot Pink) 60cm',
  'ROSES PINK MONDIAL 50 CM': 'ROSE / Pink Mondial 50cm',
  'ROSES QUICKSAND 50': 'ROSE / Quick Sand 50cm',
  'ROSES SAGA X 10 - 50': 'ROSE / Saga 50cm',
  'ROSES SHIMMER 50 CM': 'ROSE / Shimmer 50cm',
  'RUSCUS 40 CMS': 'Ruscus Green 40cm',
  'RUSCUS 50 CMS': 'Ruscus Green 50cm',
  'RUSCUS 60 CMS': 'Ruscus Green',
  'SILANTOI 50CM N 10ST MAT': 'ROSE / Silantoi 50cm',
  'SPRAY CARNATION IBIS - SELECT': 'MiniCarnation Artic/Ibis(화이트)',
  'SPRAY CARNATION MINUETTO - SELECT': 'MInicarnation Minuetto',
  'SPRAY CARNATION ROSITA - SELECT': 'Minicarnation Rosita',
  'SPRAY ROSES SNOWFLAKE 50': 'SPRAY ROSE / Snow Flake',
};

// Seed aliases for Australia (Premium Greens). Same alias system as Colombia:
// pre-loaded matches so the app already knows these and won't ask again.
const SEED_ALIASES_AU = {
  'BARKER BUSH X 5 (5 STEMS/BUNCH)': 'Banker Bush',
  'EMU FEATHER™ (10 STEMS/BUNCH)': 'Emu Feather',
  'EMU GRASS X 10 (10 STEMS/BUNCH)': 'Emu Grass',
  'GOANNA CLAW™ (10 STEMS/BUNCH)': 'Goanna Claw',
  'KOALA FERN™ 80CM (10 STEMS/BUNCH)': 'Koala Fern',
  'LEPTOSPERMUM (10 STEMS/BUNCH)': 'Copper Glow',
  'RAINBOW FERN™ (10 STEMS/BUNCH)': 'Fern Rainbow',
  'SEA STAR FERN™ (10 STEMS/BUNCH)': 'Fern Sea Star',
  'STEEL GRASS (PREMIUM) 120CM (X50) (50 STEMS/BUNCH)': 'Steel Grass',
  'STENOCARPUS (80CM) X 10ST (10 STEMS/BUNCH)': 'Stenocarpus',
  'UMBRELLA FERN (10 STEMS/BUNCH)': 'Fern Umbrella',
  'WOOLLY BUSH (5 STEMS/BUNCH)': 'Wolly Bush Green Tip',
};

// =============================================================================
// CHINA / Yunnan Melody Dew Flora — invoice description → catalog name
// 39 entries derived from the 18-1 Melody packing list, validated against
// the loaded catalog CN (414 entries).
// =============================================================================
const SEED_ALIASES_CN = {
  // Roses (12)
  'LUO SHEN':                            '[MEL] ROSE CHINA / 루어 샨 (Luo shen)',
  'AISHA':                               '[MEL] ROSE CHINA / 에이샤 (Aisha)',
  'PLATEAU RED':                         '[MEL] ROSE CHINA / 플라터 레드 (Plateau Red)',
  'CREAM CUP':                           '[MEL] ROSE CHINA / 크림 컵 (Cream cup)',
  'CATHERINE':                           '[MEL] ROSE CHINA / 케서린 (Catherine) 65-75cm',
  'GOLE STEM':                           '[MEL] ROSE CHINA / 골렘 (Golestem)',
  'DIANA':                               '[MEL] ROSE CHINA / 다이아나 (Diana)',
  'DRIFT SAND':                          '[MEL] ROSE CHINA / 퀵샌드 (Drift Sand)',
  'PRIDE':                               '[MEL] ROSE CHINA / 프라우드 (Pride)',
  'ROMANTIC BEACH':                      '[MEL] ROSE CHINA / 로맨틱 비치(Romantic Beach)',
  'GLIMMER':                             '[MEL] ROSE CHINA / 쉬머 (Glimmer)',
  'WAKE UP':                             '[MEL] ROSE CHINA / 레바이벌 (Wake Up)',
  // Lisianthus / Eustoma (7) — variants by package weight (0.6kg vs 0.8kg)
  'EUSTOMA LIGHT PINK 0.6KG':            '[MEL] Lisianthus CHINA / 핑크 (mariachi Light pink) 600g',
  'EUSTOMA-WHITE 0.6KG':                 '[MEL] Lisianthus CHINA WHITE / 화이트 600g',
  'EUSTOMA-CHAMPAGNE 0.8KG':             '[MEL]Lisianthus CHINA / Eustoma Champagne 800g',
  'EUSTOMA-PINK 0.8KG':                  '[MEL]Lisianthus CHINA / Eustoma Pink 800g',
  'EUSTOMA-WHITE 0.8KG':                 '[MEL]Lisianthus CHINA / Eustoma White 800g',
  'WHITE AND PURPLE 0.8KG':              '[MEL]Lisianthus CHINA / Eustoma White&Purple 800g',
  'LIGHT PINK 0.8KG':                    '[MEL]Lisianthus CHINA / Light Pink 800g',
  // Limonium / Statice (2)
  'LIMONIUM WHITE':                      '[MEL] CHINA / 리모늄 시네신스 화이트 (Sinensis white) 500g',
  'STATICE WHITE':                       '[MEL]CHINA / 리모늄 스타티스 화이트 (Statice white)',
  // Other greens (3)
  'SOLIDAGO':                            '[MEL] CHINA / 솔리다고 (Solidago)',
  'GYPSONPHILA':                         '[MEL] CHINA / 안개꽃 1Kg (Gypsophila white)',
  'MULTIPLE EUCALYPTUS':                 '[MEL] CHINA Eucalyptus / 블랙잭 (베이비 블루) (대) 1Kg',
  // Pink Beauty + Spray Carnations (10)
  'PINK BEAUTY':                         '[MEL] Carnation CHINA / 핑크 뷰티 (Pink Beauty)',
  'HAMADA':                              '[MEL] Spray Carnation CHINA / 피치 (Hamada)',
  'BARBRA(RED)-MULTI':                   '[MEL] Spray Carnation CHINA / 래드 (Barbra Red-multi)',
  'SCARLETT':                            '[MEL] Spray Carnation CHINA / 스칼렛 (Scarlett)',
  'SPRAY PEARL - PINK':                  '[MEL] Spray Carnation CHINA / 펄핑크 (Pearl Pink)',
  'CHERRY PRICE':                        '[MEL] Spray Carnation CHINA / 체리 핑크 (Cherry price)',
  'BARBRA(LIGHT PINK)-MULTI':            '[MEL] Spray Carnation CHINA / 연핑크 (Barbra light pink multi)',
  'BARBRA(PEACH)-MULTI':                 '[MEL] Spray Carnation CHINA / 피치 (Barbra peach multi)',
  'PAKCHOI':                             '[MEL] Spray Carnation CHINA / 화이트, 핑크 (Pakchoi)',
  'YELLOW MULTI':                        '[MEL] Spray Carnation CHINA / 노랑 (Yellow-multiheads)',
  // Amaranthus + Asparagus preserved (5)
  'AMARANTHUS DRY WHITE':                '[MEL] Amaranthus CHINA DRY WHITE/ 줄맨드라미 프리저브드 화이트',
  'ASPARAGUS BLUE':                      '[MEL] ASPARAGUS CHINA Preserved Blue / 미디오 (연블루)',
  'ASPARAGUS DARK RED':                  '[MEL] ASPARAGUS CHINA Preserved Dark red / 미디오 (찐레드)',
  'ASPARAGUS WHITE':                     '[MEL] ASPARAGUS CHINA Preserved White / 미디오 (화이트)',
  'ASPARAGUS PINK':                      '[MEL] ASPARAGUS CHINA Preserved Pink / 미디오 (연핑크)',

  // === CLOUDLAND (Yunyan Flower Industry) — 18-1 packing list ===
  // The Cloud invoice descriptions glue the Chinese name directly to the
  // English ROSE/CLEMATIS/Eucalyptus prefix without a space, so after
  // aliasKey() strips the CJK characters we get keys like "ROSE(WHITE PROUD)"
  // (no space between the prefix and the parenthesis).  Match those exact
  // shapes here.
  // Roses (8)
  'ROSE(WHITE PROUD)':                   'ROSE CHINA / 프라우드(White proud)',
  'ROSE(BUTTER CUP)':                    'ROSE CHINA / 버터컵(Butter cup)',
  'ROSE(KATHERIN)':                      'ROSE CHINA / 안슬레이(Annesley/Katherin)',
  'ROSE (FRUTTETO)':                     'ROSE CHINA / 프루테토, 큐피트\u3000(Frutteto, Cupid)',
  'ROSE(NIGHTINGALE,PURPLE FAIRY)':      'ROSE CHINA / 나이팅게일(Nightingale, Purple Fairy)',
  'ROSE(OCEAN SONG)':                    'ROSE CHINA / 오션송(Ocean song)',
  'ROSE(JUMILIA)':                       'ROSE CHINA / 주밀리아(Jumilia)',
  'ROSE(MANDALA)':                       'ROSE CHINA / 만달라(Mandala)',
  // Greens / fillers (7)
  'CLEMATIS (ROOGUCHI SOPHIE LIGHT PURPLE)': 'CLEMATIS CHINA / 클레마티스 연보라 (Rooguchi Sophie Light purple)',
  '_EUCALYPTUS':                         'Eucalyptus CHINA / 블랙잭 (베이비 블루) (대) 1Kg',
  'EUCALYPTUS - CINEREA':                'Eucalyptus CHINA / 유칼리튭스_시네리아 (Eucalyptus - Cinerea)',
  'EUCALYPTUS POPULUS':                  'Eucalyptus CHINA / 포퓰러스 폴리 (populus) 500g',
  'SINENSIS WHITE':                      'CHINA / 리모늄 시네신스 화이트 (Sinensis white) 500g',
  'MELALEUCA GREENS':                    'Greens CHINA / 에리카 골드 (Melaleuca) 400g',
  'ALLIUM FISTULOSUM':                   'Greens CHINA / 스네이크 알륨 (Allium fistulosum) 200g',
};

// =============================================================================
// USA / Hood Canal Evergreens — invoice description → catalog name
// 2 products in catalog: "Douglas Fir", "SALAL TIPS", "Beargrass".
// Aliases include both the cleaned form (which the prompt asks for) and the
// raw invoice forms in case Claude doesn't clean perfectly.
// =============================================================================
const SEED_ALIASES_US = {
  'SALAL TIPS':                                'SALAL TIPS',
  'DOUGLAS FIR':                               'Douglas Fir',
  'BEARGRASS':                                 'Beargrass',
  // Raw invoice forms as fallback
  "SALAL TIP 25'S-GAULTHERIA SHALLON":         'SALAL TIPS',
  "DOUGLAS FIR 20'S - PSEUDOTSUGA MENZIESII":  'Douglas Fir',
  "BEARGRASS 30'S - XEROPHYLLUM TENAX":        'Beargrass',
};

// =============================================================================
// VIETNAM / Royal Base — invoice description (DESCRIPTION + COLOR + GRADE)
// → catalog name.  Catalog has 12 VN products; the active varieties from
// Royal Base are the 7F Phalaenopsis hybrids.  Note the catalog names have
// trailing whitespace which we preserve verbatim.
// =============================================================================
const SEED_ALIASES_VN = {
  'PHALAENOPSIS CUT FLOWER W 07F':             'ORCHID VIETNAM / 호접란  화이트 7-8 (Party grade White 7-8) ',
  'PHALAENOPSIS CUT FLOWER SP/PFP 07F':        'ORCHID VIETNAM / 호접란  핑크 7 (Party grade Single Sprayed 7F, Perfect Pink) ',
  'PHALAENOPSIS CUT FLOWER SP/SP 07F':         'ORCHID VIETNAM / 호접란  연핑크 7 (Party grade Single Sprayed 7F, Soft Pink) ',
};

// All seed aliases merged across countries. Keys are disjoint in practice
// THAILAND — Krung Thep Interflora and Super Fresh.
// Aliases map invoice codes/descriptions to the variety names Nenova uses in
// the master catalog (e.g. "Den. Big White (화이트) L").  These were derived
// from the reference packing lists 20-1차 Krung + Super Fresh.
const SEED_ALIASES_TH = {
  // Super Fresh codes
  'BW-L':                       'Den. Big White (화이트) L',
  'BW-XL':                      'Den. Big White (화이트) XL',
  'DEN.BIG WHITE-L':            'Den. Big White (화이트) L',
  'DEN.BIG WHITE-XL':           'Den. Big White (화이트) XL',
  'WTB-LB':                     'Den. white bom loose blooms',
  'DEN.WHITE LOOSE BLOOM':      'Den. white bom loose blooms',
  'DEN. WHITE BOM LOOSE BLOOM': 'Den. white bom loose blooms',
  'WTB-M':                      'Den. White Bom (화이트) M',
  'DEN.WHITE BOM-M':            'Den. White Bom (화이트) M',
  'DEN.WHITE BOM M':            'Den. White Bom (화이트) M',
  'JDS-L':                      'Den. Jinda Sweet (피치) L',
  'DEN.JINDA SWEET-L':          'Den. Jinda Sweet (피치) L',
  'JDS-XL':                     'Den. Jinda Sweet (피치) XL',
  'DEN.JINDA SWEET-XL':         'Den. Jinda Sweet (피치) XL',
  'CLP-XL':                     'MOK Calipso Pink XL',
  'MOK.CALIPSO PINK-XL':        'MOK Calipso Pink XL',
  'OPH-XL':                     'MOK Orange Peach XL',
  'MOK.ORANGE PEACH-XL':        'MOK Orange Peach XL',
  'OPH-L':                      'MOK Orange Peach L',
  'MOK.ORANGE PEACH-L':         'MOK Orange Peach L',
  'SLY-L':                      'MOK.Salaya Red L',
  'MOK.SALAYA RED-L':           'MOK.Salaya Red L',
  'SLY-XL':                     'MOK.Salaya Red XL',
  'MOK.SALAYA RED-XL':          'MOK.Salaya Red XL',
  // Krung Thep Interflora codes
  'BWF-L':                                 'Den. Big White (화이트) L',
  'DEN.BIG WHITE FORM LONG':               'Den. Big White (화이트) L',
  'BWF-XL':                                'Den. Big White (화이트) XL',
  'DEN.BIG WHITE FORM EXTRA LONG':         'Den. Big White (화이트) XL',
  'JRB-XL':                                'MOK Jairak Blue (보라) XL',
  'JIRAK BLUE EXTRA LONG':                 'MOK Jairak Blue (보라) XL',
  'RUBY-XL':                               'MOK Ruby Red XL',
  'RUBY RED EXTRA LONG':                   'MOK Ruby Red XL',
  'JKP-XL':                                'MOK Jubkuan Pink XL',
  "JK'P-XL":                               'MOK Jubkuan Pink XL',
  'JUB KUAN PINK EXTRA LONG':              'MOK Jubkuan Pink XL',
  'BUG-XL':                                'Den. Burana Jade (그린) XL',
  'DEN.BURANA GREEN EXTRA LONG':           'Den. Burana Jade (그린) XL',
  'SPC-L':                                 'Den. Jinda Sweet (피치) L',  // per Krung reference Excel mapping
  'DEN.SWEET PRINCESS LONG':               'Den. Jinda Sweet (피치) L',
  'SPC-XL':                                'Den. Jinda Sweet (피치) XL',
  'DEN.SWEET PRINCESS EXTRA LONG':         'Den. Jinda Sweet (피치) XL',
  'ONC-LL':                                'Oncidium',
  'ONC.GOLDEN SHOWER SUPER LONG':          'Oncidium',
};

// because invoice descriptions per country don't overlap. We use a single
// flat dict to keep the alias-confirm UI simple.
const ALL_SEED_ALIASES = { ...SEED_ALIASES_CO, ...SEED_ALIASES_AU, ...SEED_ALIASES_CN, ...SEED_ALIASES_US, ...SEED_ALIASES_VN, ...SEED_ALIASES_TH };

// =============================================================================
// NETHERLANDS / HOLEX
// =============================================================================
const NL_MASTER = [
  "Agapanthus / Eyfori Blue 70cm","Agapanthus / Eyfori light blue","Agapanthus / Eyfori White 70cm",
  "Allium / Gladiator","Allium / Mount Everest White","Allium / Schubertii",
  "Alstroemeria / Aura White","Alstroemeria / Bianca White","Alstroemeria / Fabula Pink","ALSTROMERIA Virginia",
  "Amaryllis / Mont Blanc 12st White","Amaryllis / Rilona (Salmon) 12st",
  "Anthurium Extase 15cm","Anthurium Graciosa 15cm","Anthurium nero 13cm","Anthurium Nunzia 13cm",
  "Anthurium Princess Alexia Bordeaux 11cm","Anthurium Show time",
  "Astilbe / Europa L/Pink","Astilbe / Washington White",
  "Calla / Odessa 55cm Decorum Black","Calla / Odessa 60cm Decorum Black","Calla / Odessa 65cm Decorum Black","Calla / Odessa 70cm Decorum Black",
  "Calla / Ventura white 60cm","Calla / Ventura White 65cm","Calla / Ventura white 70cm",
  "Cordyline Leaf Per Bunch Black Ti",
  "Eryngium Magnetar Questar","Eryngium Orion Blue 60cm","Eryngium Sirius Questar White",
  "Eucalyptus / Cinerea","Eucalyptus / Nicholii","Eucalyptus / Parvi","Eucalyptus / Populus",
  "Gypsophila / Million Stars White","Hippeastrum Mont Blanc",
  "Hyacinthus / China White","Hyacinthus / Fondant L/Pink","Hyacinthus / Pink Elephant/LPink","Hyacinthus/ China white","Hyacinthus/ Sky Jacket",
  "Polygonatum Multiflorum 65cm","Sanguisorba Officinalis Red Dream 80cm",
  "Skimmia / Conf Kew Ger Green","Skimmia / Jap Rubella Red",
  "Tulip / Double Galileo","Tulip / Double Katinka","Tulip / Double Kantika Lavender","Tulip / Double Orange Princess",
  "Tulip / Double Red Princess","Tulip / Double Valdivia","Tulip / Liberster White",
  "Tulip / Single Antarctica","Tulip / Single Crown Dynasty L/Pink","Tulip / Single Dynasty L/Pink",
  "Tulip / Single Ile de France","Tulip / Single Orange Juice","Tulip / Single Royal Virgen White1",
  "Tulip / Single Strong Gold Yellow","Tulip / Single Thijs Boots",
];
const NL_MASTER_IDX = NL_MASTER.reduce((acc, p, i) => { acc[p] = i; return acc; }, {});

// Map invoice description (UPPERCASE) → packing list name
const NL_MAP = {
  'HIPPEASTRUM MONT BLANC':              'Amaryllis / Mont Blanc 12st White',
  'HIPPEASTRUM RILONA':                  'Amaryllis / Rilona (Salmon) 12st',
  'ASTILBE EUROPA':                      'Astilbe / Europa L/Pink',
  'ASTILBE WASHINGTON':                  'Astilbe / Washington White',
  'ZANTEDESCHIA CAPTAIN VENTURA 60CM':   'Calla / Ventura white 60cm',
  'ZANTEDESCHIA CAPTAIN VENTURA 65CM':   'Calla / Ventura White 65cm',
  'ZANTEDESCHIA CAPTAIN VENTURA 70CM':   'Calla / Ventura white 70cm',
  'ZANTEDESCHIA ODESSA 55CM':            'Calla / Odessa 55cm Decorum Black',
  'ZANTEDESCHIA ODESSA 60CM':            'Calla / Odessa 60cm Decorum Black',
  'ZANTEDESCHIA ODESSA 65CM':            'Calla / Odessa 65cm Decorum Black',
  'ZANTEDESCHIA ODESSA 70CM':            'Calla / Odessa 70cm Decorum Black',
  'ERYNGIUM ORION QUESTAR':              'Eryngium Orion Blue 60cm',
  'ERYNGIUM MAGNETAR QSTAR':             'Eryngium Magnetar Questar',
  'ERYNGIUM SIRIUS QSTAR':               'Eryngium Sirius Questar White',
  'HYACINTHUS SKY JACKET':               'Hyacinthus/ Sky Jacket',
  'HYACINTHUS FONDANT':                  'Hyacinthus / Fondant L/Pink',
  'HYACINTHUS CHINA WHITE':              'Hyacinthus/ China white',
  'HYACINTHUS PINK ELEPHANT':            'Hyacinthus / Pink Elephant/LPink',
  'TULIPA ROYAL VIRGIN':                 'Tulip / Single Royal Virgen White1',
  'TULIPA DYNASTY':                      'Tulip / Single Dynasty L/Pink',
  'TULIPA LILY FLOWERED CROWN OF DYNASTY': 'Tulip / Single Crown Dynasty L/Pink',
  'TULIPA ORANGE JUICE':                 'Tulip / Single Orange Juice',
  'TULIPA DOUBLE KATINKA':               'Tulip / Double Kantika Lavender',
  'TULIPA THIJS BOOTS':                  'Tulip / Single Thijs Boots',
  'TULIPA DOUBLE VALDIVIA':              'Tulip / Double Valdivia',
  'TULIPA DOUBLE RED PRINCESS':          'Tulip / Double Red Princess',
  'TULIPA DOUBLE GALILEO':               'Tulip / Double Galileo',
  'TULIPA LILY FLOWERED WHITE LIBERSTAR':'Tulip / Liberster White',
  'TULIPA ANTARCTICA':                   'Tulip / Single Antarctica',
  'TULIPA ILE DE FRANCE':                'Tulip / Single Ile de France',
  'TULIPA STRONG GOLD':                  'Tulip / Single Strong Gold Yellow',
  'TULIPA DOUBLE ORANGE PRINCESS':       'Tulip / Double Orange Princess',
  'AGAPANTHUS EYFORI BLUE':              'Agapanthus / Eyfori Blue 70cm',
  'AGAPANTHUS EYFORI WHITE':             'Agapanthus / Eyfori White 70cm',
  'AGAPANTHUS EYFORI LIGHT BLUE':        'Agapanthus / Eyfori light blue',
  'ALLIUM GLADIATOR':                    'Allium / Gladiator',
  'ALLIUM MOUNT EVEREST':                'Allium / Mount Everest White',
  'ALLIUM SCHUBERTII':                   'Allium / Schubertii',
  'SKIMMIA KEW GREEN':                   'Skimmia / Conf Kew Ger Green',
  'SKIMMIA RUBELLA':                     'Skimmia / Jap Rubella Red',
  'SANGUISORBA OFFICINALIS RED DREAM':   'Sanguisorba Officinalis Red Dream 80cm',
  'ANTHURIUM EXTASE':                    'Anthurium Extase 15cm',
  'ANTHURIUM GRACIOSA':                  'Anthurium Graciosa 15cm',
  'ANTHURIUM NERO':                      'Anthurium nero 13cm',
  'ANTHURIUM NUNZIA':                    'Anthurium Nunzia 13cm',
  'ANTHURIUM PRINCESS ALEXIA BORDEAUX':  'Anthurium Princess Alexia Bordeaux 11cm',
  'ANTHURIUM SHOWTIME':                  'Anthurium Show time',
  'CORDYLINE LEAF BLACK TI':             'Cordyline Leaf Per Bunch Black Ti',
};
function mapProductNL(desc) {
  if (!desc) return desc;
  const key = desc.toUpperCase().trim();
  if (NL_MAP[key]) return NL_MAP[key];
  for (const [k, v] of Object.entries(NL_MAP)) { if (key.startsWith(k)) return v; }
  for (const [k, v] of Object.entries(NL_MAP)) { if (key.indexOf(k) >= 0) return v; }
  return desc;
}
const BUNCH_ST_NL = {
  TULIPA: 10, HIPPEASTRUM: 1, HYACINTHUS: 5, ZANTEDESCHIA: 1, ERYNGIUM: 1,
  ASTILBE: 1, AGAPANTHUS: 1, ALLIUM: 1, SKIMMIA: 3, ANTHURIUM: 1,
  SANGUISORBA: 1, CORDYLINE: 1, POLYGONATUM: 1, EUCALYPTUS: 1,
};
function familyNL(desc) { return (desc || '').toUpperCase().split(' ')[0]; }

// Format AWB: "180-5068-0206" → "180-50680206" (drop middle dash)
function formatAwbNL(awb) {
  if (!awb) return '';
  const parts = awb.split('-');
  if (parts.length >= 3) return parts[0] + '-' + parts.slice(1).join('');
  return awb;
}

// =============================================================================
// COLOMBIA FARMS
// =============================================================================
const CO_FARMS = [
  { match: /circasia/i, abbr: 'CIR', name: 'Circasia', short: 'CIRCASIA' },
  { match: /cactus/i, abbr: 'CAC', name: 'El Cactus', short: 'CACTUS' },
  { match: /tiba/i, abbr: 'TIB', name: 'Flores Tiba', short: 'TIBA' },
  { match: /daflor/i, abbr: 'DAF', name: 'Daflor', short: 'DAFLOR' },
  { match: /turflor/i, abbr: 'TUR', name: 'Turflor', short: 'TURFLOR' },
  { match: /eusebio/i, abbr: 'EUS', name: 'Don Eusebio', short: 'DON EUSEBIO' },
  { match: /milagro/i, abbr: 'MIL', name: 'El Milagro', short: 'MILAGRO' },
  { match: /unique/i, abbr: 'UNI', name: 'Unique Flowers', short: 'UNIQUE' },
  { match: /green\s*genie/i, abbr: 'GRE', name: 'The Green Genie', short: 'GREEN GENIE' },
  { match: /ayura|ayur[áa]/i, abbr: 'AYU', name: 'Ayura', short: 'AYURA' },
  { match: /varietta/i, abbr: 'VAR', name: 'Varietta', short: 'VARIETTA' },
  { match: /zorro/i, abbr: 'ZOR', name: 'Flores El Zorro', short: 'ZORRO' },
  { match: /funza/i, abbr: 'FUN', name: 'Flores De Funza', short: 'FUNZA' },
  { match: /gaitana/i, abbr: 'GAI', name: 'La Gaitana', short: 'GAITANA' },
  { match: /teucali/i, abbr: 'TEU', name: 'Teucali', short: 'TEUCALI' },
  { match: /maxiflores|maxi\s*flores/i, abbr: 'MAX', name: 'Maxiflores', short: 'MAXIFLORES' },
  { match: /redil/i, abbr: 'RED', name: 'El Redil', short: 'REDIL' },
  { match: /elite/i, abbr: 'ELI', name: 'The Elite Flowers', short: 'ELITE' },
  { match: /esperance/i, abbr: 'ESP', name: 'Esperance Roses', short: 'ESPERANCE' },
  { match: /fillco/i, abbr: 'FIL', name: 'Fillco', short: 'FILLCO' },
  { match: /serrezuela|superior\s*blooms/i, abbr: 'SER', name: 'Superior Blooms', short: 'SUPERIOR' },
  { match: /colibri|colibr[íi]/i, abbr: 'COL', name: 'Colibri', short: 'COLIBRI' },
  { match: /prisma/i, abbr: 'PRI', name: 'Prisma', short: 'PRISMA' },
  { match: /monika/i, abbr: 'MON', name: 'Monika Farms', short: 'MONIKA' },
  { match: /matina/i, abbr: 'MAT', name: 'Matina', short: 'MATINA' },
  { match: /prestige/i, abbr: 'PRE', name: 'Prestige Roses', short: 'PRESTIGE' },
  { match: /aposentos/i, abbr: 'APO', name: 'Flores de Aposentos', short: 'APOSENTOS' },
  { match: /invos/i, abbr: 'INV', name: 'Invos Flowers', short: 'INVOS' },
  { match: /kumanday/i, abbr: 'KUM', name: 'Plantas Kumanday', short: 'KUMANDAY' },
  { match: /construn[oó]rte|construnote|cosntrunorte/i, abbr: 'CON', name: 'Construnorte', short: 'CONSTRUNORTE' },
  { match: /balverde/i, abbr: 'BAL', name: 'C.I Flores Balverde S.A.S', short: 'BALVERDE' },
  { match: /florentina/i, abbr: 'FLO', name: 'Florentina Export S.A.S', short: 'FLORENTINA' },
  { match: /antioquia\s*floral/i, abbr: 'ANT', name: 'Antioquia Floral S.A.S', short: 'ANTIOQUIA F' },
  { match: /green\s*land/i, abbr: 'GRL', name: 'Green Land Flowers S.A.S', short: 'GREEN LAND' },
  { match: /pietrasanta/i, abbr: 'PIE', name: 'Pietrasanta Flores y Follajes S.A.S', short: 'PIETRASANTA' },
  { match: /valores\s*en\s*acci[óo]n|grupo\s*valores/i, abbr: 'VAL', name: 'Grupo Valores en Accion', short: 'VALORES' },
  { match: /princess\s*farms/i, abbr: 'PNS', name: 'Princess Farms S.A.S', short: 'PRINCESS' },
  { match: /lorzate/i, abbr: 'LOR', name: 'Lorzate Flowers S.A.S', short: 'LORZATE' },
];
function detectCOFarm(name) {
  if (!name) return { abbr: 'UNK', name: 'Unknown', short: 'UNK' };
  for (const f of CO_FARMS) if (f.match.test(name)) return f;
  return { abbr: 'UNK', name: name, short: name.toUpperCase() };
}

// =============================================================================
// EXCEL HELPERS
// =============================================================================
// CRITICAL: xlsx-js-style uses `numFmt` (NOT `number_format`).  Setting
// `number_format` is silently ignored — that's why earlier outputs lacked
// number formats even though the rest of the styles worked.

const FONT_HEADER_BOLD = { bold: true, sz: 8, name: 'Bookman Old Style' };
const FONT_HEADER = { sz: 8, name: 'Bookman Old Style' };
const FONT_TITLE = { bold: true, sz: 16, name: 'Bookman Old Style' };
const FONT_TABLE_BOLD = { bold: true, sz: 8, name: 'Calibri' };
const FONT_TABLE = { sz: 8, name: 'Calibri' };
const ALIGN_LEFT = { horizontal: 'left', vertical: 'center' };
const ALIGN_LEFT_TOP = { horizontal: 'left', vertical: 'top' };
const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
const ALIGN_CENTER_WRAP = { horizontal: 'center', vertical: 'center', wrapText: true };
// Border style objects — used inline by NL/CN/EC/AU generators in their
// TOTAL-row styles.  (Antioquia/Bogotá use bord(top, bot, left, right) instead,
// which builds these on the fly.)
const BORDER_THIN = { style: 'thin', color: { rgb: '000000' } };
const BORDER_MEDIUM = { style: 'medium', color: { rgb: '000000' } };
const NF_TEXT = '@';
// Number formats — using Excel's built-in Number-category formats
// (NOT the Custom/Accounting variants from the original template).
//   '0'                          → Number, 0 decimals
//   '0.00'                       → Number, 2 decimals
//   '#,##0'                      → Number, with thousands separator
//   '#,##0.00'                   → Number, 2 decimals, separator
//   '#,##0;[Red]-#,##0'          → same with red negatives
// These all show as "Number" in Excel's Format Cells dialog.
const NF_PLAIN_INT = '0';
const NF_INT       = '#,##0;[Red]-#,##0';                // BOX, BCH/ST, STEAM BOX, TOTAL BUNCH
const NF_THOUSANDS = '#,##0';                            // TOTAL STEAM (no red negatives needed)
const NF_PRICE3    = '#,##0.000;[Red]-#,##0.000';        // U.PRICE (3 decimals — Bogotá)
const NF_PRICE2    = '#,##0.00;[Red]-#,##0.00';          // U.PRICE / T.PRICE (2 decimals — Antioquia)

// Build a partial-edges border. Pass `null`/`undefined`/empty string for
// edges that should not be drawn.  Each non-empty edge is set to its style.
function bord(top, bot, left, right) {
  const out = {};
  const mk = (s) => ({ style: s, color: { rgb: '000000' } });
  if (top)   out.top    = mk(top);
  if (bot)   out.bottom = mk(bot);
  if (left)  out.left   = mk(left);
  if (right) out.right  = mk(right);
  return out;
}
// Legacy helper, used by NL/CN/EC/AU still — keeps full borders.
function bordersAll(style) {
  return bord(style, style, style, style);
}

// Cell writers — note: xlsx-js-style uses `s` for the style object whose
// properties are font / alignment / border / fill / numFmt (camelCase).
function setCell(ws, addr, v, style) {
  ws[addr] = { v: v, t: typeof v === 'number' ? 'n' : 's', s: style };
}
function setFormula(ws, addr, f, style) {
  ws[addr] = { f: f, t: 'n', s: style };
}
// Empty cell that still carries styling (used for the "blank" cells inside
// merged ranges and the empty data rows of the 19-2 template).
function setEmpty(ws, addr, style) {
  ws[addr] = { t: 's', v: '', s: style };
}

// ---------------------------------------------------------------------------
// 19-2 template helpers (Colombia / hortensias).  These reproduce the layout
// of /mnt/user-data/uploads/*PACKING_LIST_HYDRANGEAS_19-2.xlsx exactly:
//   * dim A1:L58 (always 58 rows, even with few products)
//   * 66 merges (header + B:D for every data row + A:D for TOTAL)
//   * medium border around the header rectangle (rows 2-3) and around the
//     table (row 5 top, row 58 bottom, A col left, L col right)
//   * Bookman Old Style 8pt for header, Calibri 8pt for data
//   * Number formats: NF_INT for counts, NF_THOUSANDS for stems, NF_PRICE2 for $
// ---------------------------------------------------------------------------
function writeTopHeader19_2(ws, grower, weekend, invoice, awb, date) {
  // Row 1 — title spacer.  C1 carries the title font (size 16) so the merged
  // C1:H1 range looks tall.  No borders, no value.
  setEmpty(ws, 'C1', { font: FONT_TITLE, alignment: ALIGN_CENTER, numFmt: NF_TEXT });
  setEmpty(ws, 'I1', { font: FONT_TITLE, alignment: ALIGN_CENTER, numFmt: NF_TEXT });
  setEmpty(ws, 'J1', { font: FONT_TITLE, alignment: { vertical: 'center' }, numFmt: NF_TEXT });

  // Row 2 — Grower / Weekend / Invoice
  // Each "label | value" pair has medium border on its outer edges (top, left
  // for label; top, right for value).  Inner B/D/F/H/J cells fill the merged
  // ranges with matching borders.
  setCell (ws, 'A2', 'Grower:',  { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'B2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  setCell (ws, 'C2', grower,     { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord('medium', null, null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'D2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });
  setCell (ws, 'E2', 'Weekend:', { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'F2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  setCell (ws, 'G2', weekend,    { font: FONT_HEADER,      alignment: ALIGN_LEFT_TOP, border: bord('medium', null, null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'H2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });
  setCell (ws, 'I2', 'Invoice:', { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord('medium', null, 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'J2',             { font: FONT_HEADER_BOLD, border: bord('medium', null, null, null) });
  // Invoice number — keep numeric format ('0') so it stays an integer
  setCell (ws, 'K2', invoice ? Number(invoice) || invoice : '', { font: FONT_HEADER, alignment: ALIGN_LEFT, border: bord('medium', null, null, 'medium'), numFmt: NF_PLAIN_INT });
  setEmpty(ws, 'L2',             { font: FONT_HEADER,      border: bord('medium', null, null, 'medium') });

  // Row 3 — AWB / Date / (empty I3:L3 stretch)
  setCell (ws, 'A3', 'AWB:',     { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'B3',             { font: FONT_HEADER_BOLD, border: bord(null, 'medium', null, null) });
  setCell (ws, 'C3', awb,        { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord(null, 'medium', null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'D3',             { font: FONT_HEADER,      border: bord(null, 'medium', null, 'medium') });
  setCell (ws, 'E3', 'Date:',    { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'F3',             { font: FONT_HEADER_BOLD, border: bord(null, 'medium', null, null) });
  setCell (ws, 'G3', date,       { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bord(null, 'medium', null, 'medium'), numFmt: NF_TEXT });
  setEmpty(ws, 'H3',             { font: FONT_HEADER,      border: bord(null, 'medium', null, 'medium') });
  // I3:L3 is an empty merged stretch with bottom medium border closing the rectangle
  setEmpty(ws, 'I3',             { font: FONT_HEADER, alignment: ALIGN_LEFT, border: bord(null, 'medium', 'medium', null), numFmt: NF_TEXT });
  setEmpty(ws, 'J3',             { font: FONT_HEADER, border: bord(null, 'medium', null, null) });
  setEmpty(ws, 'K3',             { font: FONT_HEADER, border: bord(null, 'medium', null, null) });
  setEmpty(ws, 'L3',             { font: FONT_HEADER, border: bord(null, 'medium', null, 'medium') });
}

function writeTableHeaders19_2(ws, bchLabel) {
  // Row 5 — table headers.  Top medium, bottom medium, left edge medium on A,
  // right edge medium on L; inner separators thin.
  setCell(ws, 'A5', 'COD',         { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'medium', 'thin'), numFmt: NF_TEXT });
  setCell(ws, 'B5', 'VARIETY NAME',{ font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', null, 'thin'),     numFmt: NF_TEXT });
  setEmpty(ws, 'C5',                { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, null) });
  setEmpty(ws, 'D5',                { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, 'thin') });
  setCell(ws, 'E5', 'SIZE',        { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'F5', 'BOX',         { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'G5', bchLabel || 'BCH/ST', { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'H5', 'STEAM BOX',   { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'I5', 'TOTAL\nBUNCH',{ font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', null) });
  setCell(ws, 'J5', 'TOTAL STEAM', { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: NF_TEXT });
  setCell(ws, 'K5', 'U.PRICE',     { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER,      border: bord('medium', 'medium', 'thin', 'thin') });
  setCell(ws, 'L5', 'T.PRICE',     { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: NF_TEXT });
}

// Build the full 66-merge set for the 19-2 template.
// All hortensia packing lists use the same layout independent of how many
// products there are.
// Build the merge set for the 19-2 template.
// Rows are dynamic: pass the actual lastDataRow and totalRow calculated from
// the product count so pseudo-rows beyond row 57 are never silently dropped.
function buildMerges19_2(lastDataRow, totalRow) {
  const m = [];
  // Title row (row 1, 0-indexed r:0): C1:H1
  m.push({ s: { r: 0, c: 2 }, e: { r: 0, c: 7 } });
  // Header row 2 (r:1): A2:B2, C2:D2, E2:F2, G2:H2, I2:J2, K2:L2
  for (const c of [0, 2, 4, 6, 8, 10]) m.push({ s: { r: 1, c }, e: { r: 1, c: c + 1 } });
  // Header row 3 (r:2): A3:B3, C3:D3, E3:F3, G3:H3, I3:L3 (note: I3:L3 spans 4)
  for (const c of [0, 2, 4, 6])  m.push({ s: { r: 2, c }, e: { r: 2, c: c + 1 } });
  m.push({ s: { r: 2, c: 8 }, e: { r: 2, c: 11 } });
  // Table header row 5 (r:4): B5:D5
  m.push({ s: { r: 4, c: 1 }, e: { r: 4, c: 3 } });
  // Data rows 6..lastDataRow: each has B:D merged
  for (let r = 5; r <= lastDataRow - 1; r++) m.push({ s: { r, c: 1 }, e: { r, c: 3 } });
  // TOTAL row: A:D merged
  m.push({ s: { r: totalRow - 1, c: 0 }, e: { r: totalRow - 1, c: 3 } });
  return m;
}

// Apply the column widths and the first-five row heights from the 19-2 template.
function applyColWidths19_2(ws) {
  ws['!cols'] = [
    { wch: 3.54 },  { wch: 7.0 },   { wch: 13.45 }, { wch: 8.45 },
    { wch: 5.45 },  { wch: 4.27 },  { wch: 4.0 },   { wch: 5.18 },
    { wch: 6.18 },  { wch: 7.0 },   { wch: 7.27 }, { wch: 9.18 },
  ];
  ws['!rows'] = [
    { hpt: 34.5 },  { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 },
  ];
}

// ---------------------------------------------------------------------------
// Legacy helpers (used by NL/CN/EC/AU generators).  Kept unchanged in semantics
// so those generators still produce the same output they did before.  Only the
// `number_format` → `numFmt` bug fix is applied here.
// ---------------------------------------------------------------------------
function writeTopHeader(ws, grower, weekend, invoice, awb, date) {
  const lblStyle = { font: FONT_HEADER_BOLD, alignment: ALIGN_LEFT, border: bordersAll('thin') };
  const valStyle = { font: FONT_HEADER,      alignment: ALIGN_LEFT, border: bordersAll('thin') };
  setCell(ws, 'A2', 'Grower:', lblStyle); setCell(ws, 'C2', grower,  valStyle);
  setCell(ws, 'E2', 'Weekend:', lblStyle); setCell(ws, 'G2', weekend, valStyle);
  setCell(ws, 'I2', 'Invoice:', lblStyle); setCell(ws, 'K2', invoice, valStyle);
  setCell(ws, 'A3', 'AWB:',     lblStyle); setCell(ws, 'C3', awb,     valStyle);
  setCell(ws, 'E3', 'Date:',    lblStyle); setCell(ws, 'G3', date,    valStyle);
}
function writeTableHeaders(ws, bchLabel) {
  const hs = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER_WRAP, border: bordersAll('thin') };
  setCell(ws, 'A5', 'COD', hs); setCell(ws, 'B5', 'VARIETY NAME', hs);
  setCell(ws, 'E5', 'SIZE', hs); setCell(ws, 'F5', 'BOX', hs);
  setCell(ws, 'G5', bchLabel || 'BCH/ST', hs); setCell(ws, 'H5', 'STEAM BOX', hs);
  setCell(ws, 'I5', 'TOTAL\nBUNCH', hs); setCell(ws, 'J5', 'TOTAL STEAM', hs);
  setCell(ws, 'K5', 'U.PRICE', hs); setCell(ws, 'L5', 'T.PRICE', hs);
}
function buildMerges(lastDataRow, totalRow, extraRows) {
  const m = [
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 7 } },
    { s: { r: 1, c: 8 }, e: { r: 1, c: 9 } },
    { s: { r: 1, c: 10 }, e: { r: 1, c: 11 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 2, c: 4 }, e: { r: 2, c: 5 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 7 } },
    { s: { r: 2, c: 8 }, e: { r: 2, c: 11 } },
  ];
  for (let r = 6; r <= lastDataRow; r++) m.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 3 } });
  extraRows.forEach((r) => m.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 3 } }));
  m.push({ s: { r: totalRow - 1, c: 0 }, e: { r: totalRow - 1, c: 3 } });
  return m;
}
function applyColWidths(ws) {
  ws['!cols'] = [{ wch: 3.5 }, { wch: 7 }, { wch: 13.5 }, { wch: 8.5 }, { wch: 5.5 }, { wch: 4.3 }, { wch: 4 }, { wch: 5.2 }, { wch: 6.2 }, { wch: 7 }, { wch: 7.3 }, { wch: 9.2 }];
  ws['!rows'] = [{ hpt: 34.5 }, { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 }];
}

// =============================================================================
// EXCEL GENERATORS
// =============================================================================

// ---------------------------------------------------------------------------
// buildSheet19_2 — write the 19-2 template layout into a worksheet.
// Used by ALL generators so every country produces the same look:
//   * dim A1:L58 (always 58 rows, even with few products)
//   * 66 merges (header rectangle + B:D for every data row + A:D for TOTAL)
//   * medium border around header rectangle (rows 2-3) and around the TOTAL row
//   * Bookman Old Style 8pt header, Calibri 8pt data
//   * empty rows beyond product count are still styled
//
// `opts` fields:
//   grower      string  — Grower name (header C2)
//   weekend     string  — e.g. '19-02'
//   invoice     string  — invoice number
//   awb         string  — air waybill
//   date        string  — invoice date
//   bchLabel    string  — header for column G (default 'BCH/ST', NL uses 'BUNCH/ST')
//   products    array   — resolved products with .matchedName, .pcs, .bunch_st,
//                         .steam_box, .u_price, .unmatched
//   priceFmt    string  — 'NF_PRICE2' (default) or 'NF_PRICE3' for U.PRICE
//   stemsAreBxBox  bool — if true (default), stems = boxes × steam_box.
//                         If false, .total_stems is taken from product directly.
// ---------------------------------------------------------------------------
// ===========================================================================
// Per-country DATA-ROW WRITERS
// Each `writeDataRow{Country}(ws, r, p, styles)` writes the 12 cells of a
// single product row using the semantics of that country's invoice.
//
// All writers MUST also return the line's contribution to the running total
// (a number) so the builder can validate against the invoice's grand total.
// Empty rows are NOT this writer's concern — the builder handles them.
// ===========================================================================

// CO ANTIOQUIA — pcs is input, bunch_st=1, steam_box=stems/box.
//   F=pcs  G=bunch_st  H=steam_box  I==J/G  J==F*H  K=u_price  L==K*J  (per stem)
function writeDataRowCOAntioquia(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const uPrice = p.u_price || 0;
  // "Retail" mode: some Colombian invoices (Esperance, Maxiflores,
  // Construnorte, El Milagro, Daflor, Redil, Tiba, Funza, etc.) sell at the
  // unit level — they have NO "Boxes" / "ST/BOX" columns, just a "Cantidad"
  // and "Precio Unitario".  In that case the model returns pcs=0 and
  // total_stems=<cantidad>.  We write the stems directly into J (TOTAL STEAM)
  // and leave F (BOX) blank, with G=1 so I=J/G renders the same value in
  // TOTAL BUNCH for visual parity.
  const isRetail = (pcs === 0) && (Number(p.total_stems) || 0) > 0;
  if (isRetail) {
    const totalStems = Number(p.total_stems) || 0;
    // Aplicamos la misma regla de stems-per-bunch por familia que en
    // wholesale.  Para familias no listadas (Ruscus, etc.) cae a 1 porque
    // en modo retail el PDF no trae bunch_st explícito.
    const bunchStRetail = stemsPerBunchCO(p.matchedName, 1);
    setCell   (ws, `F${r}`, '',          styles.F);
    setCell   (ws, `G${r}`, bunchStRetail, styles.G);
    setCell   (ws, `H${r}`, '',          styles.H);
    setFormula(ws, `I${r}`, `J${r}/G${r}`, styles.I);
    setCell   (ws, `J${r}`, totalStems,  styles.J);
    setCell   (ws, `K${r}`, uPrice,      styles.K);
    setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
    return uPrice * totalStems;
  }
  setCell   (ws, `F${r}`, pcs,        styles.F);
  // CO: sobreescribimos bunch_st por la regla fija de familia (rosa 10,
  // clavel 20, mini-carn 10, alstro 10, hydrangea 1, etc.).  Ruscus y otros
  // no listados conservan el valor del PDF.
  const bunchStCO = stemsPerBunchCO(p.matchedName, bunchSt);
  setCell   (ws, `G${r}`, bunchStCO,  styles.G);
  setCell   (ws, `H${r}`, steamBox,   styles.H);
  setFormula(ws, `I${r}`, `J${r}/G${r}`, styles.I);
  setFormula(ws, `J${r}`, `F${r}*H${r}`, styles.J);
  setCell   (ws, `K${r}`, uPrice,     styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  return uPrice * pcs * steamBox;     // per-stem total
}

// CO BOGOTÁ — same layout as Antioquia.
const writeDataRowCOBogota = writeDataRowCOAntioquia;

// NL HOLEX — pcs/colli is input, bunch_st input, steam_box per box,
//   total_bunch is INPUT (col I), total_stem = I*G (col J), per-stem price
//   F=pcs  G=bunch_st  H=steam_box  I=total_bunch  J==I*G  K=u_price  L==K*J
function writeDataRowNL(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const totalBunch = p.total_bunch || 0;
  const uPrice = p.u_price || 0;
  setCell   (ws, `F${r}`, pcs,         styles.F);
  setCell   (ws, `G${r}`, bunchSt,     styles.G);
  setCell   (ws, `H${r}`, steamBox,    styles.H);
  setCell   (ws, `I${r}`, totalBunch,  styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  return uPrice * totalBunch * bunchSt; // per-stem total
}

// CHINA — total_bunch input, per-bunch price.
//   F=pcs  G=bunch_st  H=steam_box  I=total_bunch  J==I*G  K=u_price  L==K*I  (per bunch)
function writeDataRowCN(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const totalBunch = p.total_bunch || 0;
  const uPrice = p.u_price || 0;
  setCell   (ws, `F${r}`, pcs,         styles.F);
  setCell   (ws, `G${r}`, bunchSt,     styles.G);
  setCell   (ws, `H${r}`, steamBox,    styles.H);
  setCell   (ws, `I${r}`, totalBunch,  styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*I${r}`, styles.L);
  return uPrice * totalBunch;          // per-bunch total
}

// ECUADOR — total_stems direct.
//   F=pcs  G=bunch_st  H=steam_box  I=total_bunch  J=total_stems  K=u_price  L==K*J  (per stem)
function writeDataRowEC(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const bunchSt = p.bunch_st || 1;
  const steamBox = p.steam_box || 0;
  const totalBunch = p.total_bunch || 0;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setCell(ws, `F${r}`, pcs,         styles.F);
  setCell(ws, `G${r}`, bunchSt,     styles.G);
  setCell(ws, `H${r}`, steamBox,    styles.H);
  setCell(ws, `I${r}`, totalBunch,  styles.I);
  setCell(ws, `J${r}`, totalStems,  styles.J);
  setCell(ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  return uPrice * totalStems;        // per-stem total
}

// THAILAND — matches Krung Thep Interflora and Super Fresh reference packing
// lists.  Pricing is per stem.
//   F = blank                          (BOX — not used)
//   G = stems per bunch (BUNCH/ST)     (10, 5, 100 depending on item)
//   H = blank                          (STEAM BOX — not used)
//   I = total bunches (TOTAL BUNCH)
//   J = =I*G                           (TOTAL STEAM)
//   K = u_price                        (per stem, USD)
//   L = =K*J                           (T.PRICE)
function writeDataRowTH(ws, r, p, styles) {
  const bunchSt    = p.bunch_st  || 1;
  const totalBunch = p.total_bunch || 0;
  const uPrice     = p.u_price   || 0;
  // F and H stay empty in the reference Thailand template.
  setCell   (ws, `F${r}`, '',           styles.F);
  setCell   (ws, `G${r}`, bunchSt,      styles.G);
  setCell   (ws, `H${r}`, '',           styles.H);
  setCell   (ws, `I${r}`, totalBunch,   styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  setCell   (ws, `K${r}`, uPrice,       styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  return uPrice * bunchSt * totalBunch; // per-stem total
}

// AUSTRALIA — matches the Premium Greens reference packing list exactly.
//   F = =I/H               (BOX, computed)
//   G = stems per bunch    (input — from "(N stems/bunch)" in description)
//   H = bunches per box    (input — derived as total_bunch / pcs from invoice)
//   I = total bunches      (input — from invoice "Units" column)
//   J = =I*G               (TOTAL STEAM)
//   K = u_price            (input — price per bunch)
//   L = =K*I               (T.PRICE per bunch)
function writeDataRowAU(ws, r, p, styles) {
  const stemsPerBunch = p.bunch_st || 1;
  const totalBunch = p.total_bunch || 0;
  const pcs = p.pcs || 1;
  // bunches per box.  If the invoice provided it explicitly use it; otherwise
  // derive from total_bunch / pcs (rounded — boxes are atomic).
  const bunchesPerBox = p.bunches_per_box || (pcs > 0 ? Math.round(totalBunch / pcs) : 0);
  const uPrice = p.u_price || 0;
  setFormula(ws, `F${r}`, `I${r}/H${r}`, styles.F);
  setCell   (ws, `G${r}`, stemsPerBunch, styles.G);
  setCell   (ws, `H${r}`, bunchesPerBox, styles.H);
  setCell   (ws, `I${r}`, totalBunch,    styles.I);
  setFormula(ws, `J${r}`, `I${r}*G${r}`, styles.J);
  setCell   (ws, `K${r}`, uPrice,        styles.K);
  setFormula(ws, `L${r}`, `K${r}*I${r}`, styles.L);
  return uPrice * totalBunch;            // per-bunch total
}

// USA / HOOD CANAL — per-box pricing.  The reference Hood Canal packing list
// uses simple semantics: F=Boxes (input), J=Stem Count (input from invoice),
// K=price per box, L=K*F.  Columns G/H/I are left empty for greens.
//   F=pcs (input)  G=∅  H=∅  I=∅  J=stem_count (input)  K=u_price  L==K*F  (per box)
function writeDataRowUS(ws, r, p, styles) {
  const pcs = p.pcs || 0;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setCell   (ws, `F${r}`, pcs,        styles.F);
  setEmpty  (ws, `G${r}`,             styles.G);
  setEmpty  (ws, `H${r}`,             styles.H);
  setEmpty  (ws, `I${r}`,             styles.I);
  setCell   (ws, `J${r}`, totalStems, styles.J);
  setCell   (ws, `K${r}`, uPrice,     styles.K);
  setFormula(ws, `L${r}`, `K${r}*F${r}`, styles.L);
  return uPrice * pcs;                   // per-box total
}

// VIETNAM / ROYAL BASE — orchid stems, sold per stem, packed N stems/box.
//   F==J/H  G=∅  H=stems_per_box (input)  I=∅  J=total_stems (input)
//   K=u_price  L==K*J  (per stem)
function writeDataRowVN(ws, r, p, styles) {
  const stemsPerBox = p.steam_box || 1;
  const totalStems = p.total_stems || 0;
  const uPrice = p.u_price || 0;
  setFormula(ws, `F${r}`, `J${r}/H${r}`, styles.F);
  setEmpty  (ws, `G${r}`,              styles.G);
  setCell   (ws, `H${r}`, stemsPerBox, styles.H);
  setEmpty  (ws, `I${r}`,              styles.I);
  setCell   (ws, `J${r}`, totalStems,  styles.J);
  setCell   (ws, `K${r}`, uPrice,      styles.K);
  setFormula(ws, `L${r}`, `K${r}*J${r}`, styles.L);
  return uPrice * totalStems;            // per-stem total
}

// Pseudo-row writer used for non-product rows like 운송료, Gross weight, etc.
// It writes whatever fields are non-empty in `p` and skips formulas.
function writeDataRowPseudo(ws, r, p, styles) {
  // Use named fields so each generator can place values in the right columns.
  // A field can be:
  //   - a number/string                      → setCell
  //   - { formula: 'K*I' } (pattern only)    → setFormula with row substituted
  //   - null/undefined                       → setEmpty (styled but blank)
  const cells = {
    F: p.cellF, G: p.cellG, H: p.cellH,
    I: p.cellI, J: p.cellJ, K: p.cellK, L: p.cellL,
  };
  for (const col of 'FGHIJKL') {
    const v = cells[col];
    if (v == null) {
      setEmpty(ws, `${col}${r}`, styles[col]);
    } else if (typeof v === 'object' && v.formula) {
      // Replace bare column letters in the pattern with cell refs (e.g. K → K6)
      const expanded = v.formula.replace(/([A-Z])(?![\w$])/g, (_, c) => `${c}${r}`);
      setFormula(ws, `${col}${r}`, expanded, styles[col]);
    } else {
      setCell(ws, `${col}${r}`, v, styles[col]);
    }
  }
  return Number(p.lineTotal) || 0;
}

function buildSheet19_2(ws, opts) {
  const {
    grower, weekend, invoice, awb, date,
    bchLabel = 'BCH/ST',
    products = [],
    priceFmt = NF_PRICE2,
    writeDataRow,           // (ws, r, product, styles) → number (line total)
  } = opts;

  writeTopHeader19_2(ws, grower, weekend, invoice, awb, date);
  writeTableHeaders19_2(ws, bchLabel);

  const FIRST_DATA_ROW = 6;
  // Always at least 52 data rows (the original 19-2 template size) so short
  // invoices keep the same look.  Grow dynamically when products.length
  // exceeds 52 so pseudo-rows at the end (운송료, GW, CW) are never silently
  // dropped past row 57.
  const MIN_DATA_ROWS = 52;
  const LAST_DATA_ROW = FIRST_DATA_ROW - 1 + Math.max(MIN_DATA_ROWS, products.length);
  const TOTAL_ROW = LAST_DATA_ROW + 1;

  // Per-column data-row styles (matches the 19-2 template).
  const dataRowStyles = (topMedium) => {
    const tA = topMedium ? null : 'thin';
    const tB = topMedium ? 'medium' : 'thin';
    const tInner = topMedium ? null : 'thin';
    return {
      A: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tA, 'thin', 'thin', 'thin'), numFmt: NF_TEXT },
      B: { font: FONT_TABLE, alignment: ALIGN_LEFT,   border: bord(tB, 'thin', 'thin', 'thin'), numFmt: NF_TEXT },
      C: { border: bord(tB === 'medium' ? null : 'thin', 'thin', null, null) },
      D: { border: bord(tB === 'medium' ? null : 'thin', 'thin', null, 'thin') },
      E: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      F: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      G: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      H: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: NF_INT },
      I: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: NF_INT },
      J: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: NF_THOUSANDS },
      K: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(tInner, 'thin', 'thin', 'thin'), numFmt: priceFmt },
      L: { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bord(null,   'thin', 'thin', 'thin'), numFmt: priceFmt },
    };
  };
  const unmatchedNameStyle = (topMedium) => ({
    font: { name: 'Calibri', sz: 8, color: { rgb: 'C81E1E' } },
    alignment: ALIGN_LEFT,
    border: bord(topMedium ? 'medium' : 'thin', 'thin', 'thin', 'thin'),
    numFmt: NF_TEXT,
  });

  let computedTotal = 0;

  for (let r = FIRST_DATA_ROW; r <= LAST_DATA_ROW; r++) {
    const idx = r - FIRST_DATA_ROW;
    const p = idx < products.length ? products[idx] : null;
    const isFirst = r === FIRST_DATA_ROW;
    const styles = dataRowStyles(isFirst);

    // Cols A, B, C, D, E always get written by the builder
    if (p) setCell(ws, `A${r}`, String(idx + 1), styles.A);
    else setEmpty(ws, `A${r}`, styles.A);
    if (p) {
      const bStyle = p.unmatched ? unmatchedNameStyle(isFirst) : styles.B;
      setCell(ws, `B${r}`, p.matchedName, bStyle);
    } else {
      setEmpty(ws, `B${r}`, styles.B);
    }
    setEmpty(ws, `C${r}`, styles.C);
    setEmpty(ws, `D${r}`, styles.D);
    setEmpty(ws, `E${r}`, styles.E);

    if (p) {
      // Choose writer: pseudo row (운송료 etc.) gets writeDataRowPseudo,
      // real product gets the country writer.
      const writer = p.isPseudo ? writeDataRowPseudo : writeDataRow;
      const lineTotal = writer(ws, r, p, styles);
      computedTotal += Number(lineTotal) || 0;
    } else {
      // Empty rows: NO formulas (avoids #VALUE! propagating into SUM)
      setEmpty(ws, `F${r}`, styles.F);
      setEmpty(ws, `G${r}`, styles.G);
      setEmpty(ws, `H${r}`, styles.H);
      setEmpty(ws, `I${r}`, styles.I);
      setEmpty(ws, `J${r}`, styles.J);
      setEmpty(ws, `K${r}`, styles.K);
      setEmpty(ws, `L${r}`, styles.L);
    }
  }

  // TOTAL row
  const totA          = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'medium', 'thin'),  numFmt: NF_TEXT };
  const totBcd        = { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, null) };
  const totBcd_right  = { font: FONT_TABLE_BOLD, border: bord('medium', 'medium', null, 'thin') };
  const totInt        = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'thin', 'thin'),    numFmt: NF_INT };
  const totLast       = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bord('medium', 'medium', 'thin', 'medium'), numFmt: priceFmt };
  setCell   (ws, `A${TOTAL_ROW}`, 'TOTAL', totA);
  setEmpty  (ws, `B${TOTAL_ROW}`, totBcd);
  setEmpty  (ws, `C${TOTAL_ROW}`, totBcd);
  setEmpty  (ws, `D${TOTAL_ROW}`, totBcd_right);
  setEmpty  (ws, `E${TOTAL_ROW}`, totInt);
  setFormula(ws, `F${TOTAL_ROW}`, `SUM(F${FIRST_DATA_ROW}:F${LAST_DATA_ROW})`, totInt);
  setEmpty  (ws, `G${TOTAL_ROW}`, totInt);
  setEmpty  (ws, `H${TOTAL_ROW}`, totInt);
  setFormula(ws, `I${TOTAL_ROW}`, `SUM(I${FIRST_DATA_ROW}:I${LAST_DATA_ROW})`, totInt);
  setFormula(ws, `J${TOTAL_ROW}`, `SUM(J${FIRST_DATA_ROW}:J${LAST_DATA_ROW})`, totInt);
  setEmpty  (ws, `K${TOTAL_ROW}`, { ...totInt, numFmt: priceFmt });
  setFormula(ws, `L${TOTAL_ROW}`, `SUM(L${FIRST_DATA_ROW}:L${LAST_DATA_ROW})`, totLast);

  ws['!ref']    = `A1:L${TOTAL_ROW}`;
  ws['!merges'] = buildMerges19_2(LAST_DATA_ROW, TOTAL_ROW);
  applyColWidths19_2(ws);

  return { computedTotal };
}

// Antioquia farms (hortensias) keep using the legacy hardcoded mapping for now
// The 8 hortensia farms that use the 19-2 fixed-template layout (A1:L58, etc.)
// IMPORTANT: each entry MUST match the `abbr` field in CO_FARMS — otherwise
// detectCOFarm returns an abbr that's not in this set and the file silently
// falls through to the Bogotá branch.  Verified entries: BAL, FLO, ANT, GRL,
// PIE, VAL, PNS, LOR.
const ANTIOQUIA_FARMS = new Set(['BAL','FLO','ANT','GRL','PIE','VAL','PNS','LOR']);

function genColombia(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, masterAwb = null, aliases = {} } = opts;
  const ws = {};
  const farm = detectCOFarm(inv.supplier || '');
  const isAntioquia = ANTIOQUIA_FARMS.has(farm.abbr);
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  // Use master AWB for Bogotá (single AWB for all farms in shipment)
  const awbRaw = (isAntioquia ? (inv.awb || '') : (masterAwb || inv.awb || ''));
  const awb = awbRaw.replace(/[^0-9]/g, '');

  // Match each invoice line to a catalog product
  const products = inv.products || [];
  const pending = [];   // line items needing user confirmation
  const noMatches = []; // line items with NO good candidate at all
  const resolveCO = makeProductResolver('CO', catalog, aliases, {
    farm: farm.name, farmAbbr: farm.abbr, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolvedProducts = products.map((p, i) => resolveCO(p, i));

  // Forzar stems/caja correctos por finca+familia (ver STEMS_PER_BOX_CO):
  // alstro=160 en toda CO, Teucali clavel=300, etc.  Solo wholesale (pcs>0);
  // el modo retail no usa steam_box.  Recalculamos total_stems para que el
  // resumen de pantalla coincida con el Excel (J=F*H).
  for (const p of resolvedProducts) {
    if ((p.pcs || 0) > 0) {
      const boxOverride = stemsPerBoxCO(farm.abbr, p.matchedName, null);
      if (boxOverride != null) {
        p.steam_box = boxOverride;
        p.total_stems = (p.pcs || 0) * boxOverride;
      }
    }
  }

  // ===========================================================================
  // ANTIOQUIA / hortensias — fixed A1:L58 layout matching the 19-2 template
  // ===========================================================================
  if (isAntioquia) {
    const { computedTotal } = buildSheet19_2(ws, {
      grower: farm.name,
      weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
      products: resolvedProducts,
      priceFmt: NF_PRICE2,
      writeDataRow: writeDataRowCOAntioquia,
    });
    // Use the invoice_total declared on the PDF as the authoritative anchor.
    // It's independent of the per-row extraction, so any missed or
    // duplicated row will surface as a mismatch.  Fall back to the
    // row sum only if invoice_total isn't available.
    const rowSumA = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
    const invoiceTotalA = Number(inv.invoice_total) || 0;
    const expectedTotal = invoiceTotalA > 0 ? invoiceTotalA : rowSumA;
    const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
      ? { computed: computedTotal, expected: expectedTotal, country: 'CO', invoice: inv.invoice || '' }
      : null;
    const sheetName = `CO-수국 ${farm.short}`.slice(0, 31);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    return {
      name:  `${wk}-${num}_CO_${farm.abbr}_${inv.invoice || 'PL'}.xlsx`,
      label: `${farm.name} · Invoice ${inv.invoice || ''}`,
      // Use total_stems when the model extracted it (always present for TYPE A
      // wholesale per prompt, and the ONLY source for TYPE B "retail" suppliers
      // like Esperance, Maxiflores, Natuflora, Construnorte where pcs=0).
      // Fall back to pcs×steam_box only if total_stems is missing.
      products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: (Number(p.total_stems) || 0) || ((p.pcs || 0) * (p.steam_box || 30)), unmatched: p.unmatched, viaAlias: p.viaAlias })),
      pending,
      noMatches,
      totalMismatch,
      buf,
    };
  }

  // ===========================================================================
  // BOGOTÁ — same 19-2 layout as Antioquia
  // ===========================================================================
  // Append 운송료 (freight) as a pseudo-row if present
  const adapted = [...resolvedProducts];
  const freightTotal = inv.freight_total ? Number(inv.freight_total) : 0;
  if (freightTotal > 0) {
    adapted.push({
      matchedName: '운송료',
      isPseudo: true,
      cellK: freightTotal, cellL: freightTotal,
      lineTotal: freightTotal,
    });
  }
  const { computedTotal } = buildSheet19_2(ws, {
    grower: farm.name,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products: adapted,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowCOBogota,
  });
  // CO Bogotá invoice total INCLUDES freight (PHYTO, Documents, etc.).
  // The model extracts invoice_total as the FINAL grand total printed on the
  // PDF (already includes freight/phyto), so we compare it directly against
  // computedTotal (which is also row-sum + freight row).
  // Fall back to (rowSum + freight) only when invoice_total is missing.
  const rowSumB = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const invoiceTotalB = Number(inv.invoice_total) || 0;
  const expectedTotal = invoiceTotalB > 0 ? invoiceTotalB : (rowSumB + freightTotal);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'CO', invoice: inv.invoice || '' }
    : null;
  const sheetName = 'BOG CO';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_CO_${farm.abbr}_${inv.invoice || 'PL'}.xlsx`,
    label: `${farm.name} · Invoice ${inv.invoice || ''}`,
    // Use total_stems when present (same rationale as Antioquia branch above).
    products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: (Number(p.total_stems) || 0) || ((p.pcs || 0) * (p.steam_box || 30)), unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genNL(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = formatAwbNL(inv.awb || '');

  // Process raw invoice lines: each line has {cl, description, stems, price}
  // Step 1: split CL2 vs rest, mapping name and computing bunch_st
  function process(line) {
    const fam = familyNL(line.description);
    const bunch_st = BUNCH_ST_NL[fam] || 1;
    const name = mapProductNL(line.description);
    return { ...line, name, bunch_st, fam };
  }
  // Step 2: consolidate by (name, price) within a block
  function consolidate(lines) {
    const seen = {};
    const out = [];
    for (const l of lines) {
      const key = l.name + '||' + l.price;
      if (key in seen) {
        out[seen[key]].total_bunch += l.stems / l.bunch_st;
      } else {
        seen[key] = out.length;
        out.push({ name: l.name, bunch_st: l.bunch_st, total_bunch: l.stems / l.bunch_st, u_price: l.price, originalDesc: l.description });
      }
    }
    return out;
  }
  // Step 3: sort by master list index, fallback to alphabetical
  function sortByMaster(arr) {
    arr.sort((a, b) => {
      const ia = NL_MASTER_IDX[a.name] ?? 9999;
      const ib = NL_MASTER_IDX[b.name] ?? 9999;
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }

  const lines = (inv.lines || []).map(process);
  const block1 = sortByMaster(consolidate(lines.filter(l => l.cl === 'CL2')));
  const block2 = sortByMaster(consolidate(lines.filter(l => l.cl !== 'CL2')));
  const products = [...block1, ...block2];

  // HARD VALIDATION: every product name must exist in the NL catalog.
  // mapProductNL has its own dictionary, but if a product is missing from
  // it (or maps to something not in the catalog), the description would
  // Detect supplier — defaults to Holex for backward compatibility when the
  // model doesn't return inv.supplier (older prompts didn't have that field).
  const supplierRaw = (inv.supplier || '').trim();
  const su = supplierRaw.toUpperCase();
  const supplier =
    /EZ\s*FLOWER|EZFLOWER/i.test(su) ? { name: 'EZ Flower', abbr: 'EZ',  pfx: 'NL_EZ' } :
    /HOLEX/i.test(su)                ? { name: 'Holex',     abbr: 'H',   pfx: 'NL_H'  } :
    { name: supplierRaw || 'Holex', abbr: 'H', pfx: 'NL_H' };  // safe default

  // Pending / no-match panels carry the supplier name so the UI shows it clearly.
  const pending = [];
  const noMatches = [];
  const items = (catalog && catalog.byCountry && catalog.byCountry.NL) || [];
  const catalogNameSet = new Set(items.map(it => it.name));
  for (const p of products) {
    if (!catalogNameSet.has(p.name)) {
      // If we have an alias for the original description, use it
      const aKey = aliasKey(p.originalDesc || p.name);
      if (aliases[aKey] && catalogNameSet.has(aliases[aKey])) {
        p.name = aliases[aKey];
        p.viaAlias = true;
      } else {
        // Fall through to pending
        p.unmatched = true;
        // Try to get candidates for the user
        const m = findBestMatch(p.originalDesc || p.name, items);
        const description = p.originalDesc || p.name;
        if (m.candidates && m.candidates.length > 0) {
          pending.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description, candidates: m.candidates });
        } else {
          noMatches.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description, candidates: [] });
        }
      }
    }
  }

  // Adapt to writeDataRowNL signature: F=pcs (here 0/1), G=bunch_st, H=steam_box (per box),
  // I=total_bunch, J=I*G, K=u_price, L=K*J.  We don't have steam_box from the
  // raw input so we leave it as 0 (it's mostly informational for NL).
  const adapted = (products || []).map((p) => ({
    matchedName: p.name || '',
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 1,
    bunch_st: p.bunch_st || 1,
    steam_box: 0,                      // not provided per line for Holex/EZ Flower
    total_bunch: p.total_bunch || 0,
    u_price: p.u_price || 0,
  }));
  // Pseudo rows.  vol_weight is the "Chargeable weight" — Holex labels this
  // explicitly, but EZ Flower calls it "Net Weight" in the Delivery section,
  // so we also accept inv.net_weight as a fallback in case the model used
  // that key name instead.
  const volWeight = Number(inv.vol_weight) || Number(inv.net_weight) || 0;
  if (volWeight > 0) adapted.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: volWeight, lineTotal: 0 });
  if (inv.gross_weight) adapted.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: inv.gross_weight, lineTotal: 0 });
  const fr = (inv.freight || 0) + (inv.handling || 0);
  if (fr > 0) adapted.push({ matchedName: '운송료', isPseudo: true, cellK: fr, cellL: fr, lineTotal: fr });

  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier.name,
    weekend, invoice: inv.invoice || 'PROFORMA', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products: adapted,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowNL,
  });
  // NL invoice total INCLUDES freight + handling (inv.total_value is the
  // grand total).  We compare computedTotal directly.
  const expectedTotal = Number(inv.total_value) || 0;
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'NL', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `NL-${supplier.name}`);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const safeInv = (inv.invoice || 'PROFORMA').replace(/[\\/:*?"<>|]/g, '_');
  return {
    name: `${wk}-${num}_${supplier.pfx}_${safeInv}.xlsx`,
    label: `${supplier.name} · Invoice ${inv.invoice || 'PROFORMA'}`,
    products: products.map((p) => ({ name: p.name, qty: (p.total_bunch || 0) * (p.bunch_st || 1), unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genChina(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const supplier = inv.supplier || 'Unknown';
  const isMelody = /melody/i.test(supplier);
  const pfx = isMelody ? 'MEL' : 'CLD';
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every invoice line against catalog CN.  Same hard guarantee as
  // CO/AU: no description is allowed in the Excel unless it matches a
  // catalog name.  Anything else lands in the pending panel.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveCN = makeProductResolver('CN', catalog, aliases, {
    farm: supplier, farmAbbr: pfx, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveCN(p, i));

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 1,
    bunch_st: 1,
    steam_box: 0,
    total_bunch: p.total_bunch || 0,
    u_price: p.u_price || 0,
  }));
  // 3 extra rows the China template carries after the products.  Match the
  // reference Melody packing list exactly:
  //   운송료:               F=G=H=I=J=1,  K=freight,  L==K*I
  //   Gross weigth:         F=G=H=I=1,    J=gross_weight
  //   Chargeable weigth:    F=G=H=I=1,    J=vol_weight
  // (The "weigth" typo matches the user's template.  The freight value MUST
  //  be the SUM of every non-flower charge, including negative claims/deducts.)
  if ((inv.freight || 0) !== 0) {
    products.push({
      matchedName: '운송료',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1,
      cellK: inv.freight,
      cellL: { formula: 'K*I' },        // signal the writer to put =K{r}*I{r}
      lineTotal: inv.freight,
    });
  }
  if (inv.gross_weight) {
    products.push({
      matchedName: 'Gross weigth',      // matches reference template typo
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.gross_weight,
      lineTotal: 0,
    });
  }
  if (inv.vol_weight) {
    products.push({
      matchedName: 'Chargeable weigth', // matches reference template typo
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.vol_weight,
      lineTotal: 0,
    });
  }
  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowCN,
  });
  // CN invoice total INCLUDES freight, so we compare directly against the
  // expected sum.  The expected total = sum(products.t_price) which is
  // the gross invoice total before freight; we want the GRAND total INCLUDING
  // freight, so we add inv.total_value if present, else fall back.
  const expectedTotal = (Number(inv.total_value) > 0)
    ? Number(inv.total_value)
    : ((inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0) + (Number(inv.freight) || 0));
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'CN', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CN-' + pfx);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_CN_${pfx}_${inv.invoice || 'PL'}.xlsx`,
    label: `${supplier} · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_bunch || 0, unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genEcuador(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every line against catalog EC.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveEC = makeProductResolver('EC', catalog, aliases, {
    farm: 'La Rosaleda', farmAbbr: 'ROS', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveEC(p, i));

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 1,
    bunch_st: 1,
    steam_box: 0,
    total_bunch: 0,
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));
  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'La Rosaleda',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowEC,
  });
  const expectedTotal = (Number(inv.invoice_total) > 0)
    ? Number(inv.invoice_total)
    : (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'EC', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EC-Rosaleda');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_EC_ROS_${inv.invoice || 'PL'}.xlsx`,
    label: `La Rosaleda · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// THAILAND — Krung Thep Interflora and Super Fresh.  Orchid invoices.
// One invoice per supplier per shipment.  Variety descriptions extracted
// verbatim from the invoice (no catalog matching for now).  Sheet matches
// the reference template ("Super Fresh" sheet name) used by Nenova.
function genThailand(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Detect supplier.  We only have two known suppliers; default to whatever
  // Claude returned in inv.supplier, else fall back to a generic label.
  const supplierRaw = (inv.supplier || '').trim();
  const su = supplierRaw.toUpperCase();
  const supplier =
    /KRUNG/i.test(su)        ? { name: 'Krung',       abbr: 'KRG' } :
    /SUPER\s*FRESH/i.test(su) ? { name: 'Super Fresh', abbr: 'SF'  } :
    { name: supplierRaw || 'Thailand', abbr: 'TH' };

  // For TH we don't (yet) have a translation catalog — products go in verbatim.
  // The resolver still runs so aliases the user adds later will be honored.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveTH = makeProductResolver('TH', catalog, aliases, {
    farm: supplier.name, farmAbbr: supplier.abbr, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveTH(p, i));

  // Adapt to the buildSheet19_2 product shape used by writeDataRowTH.
  //
  // Thailand orchid invoices have FIXED stems-per-bunch values that depend on
  // the variety family (the model is often unreliable here, so we override):
  //   * Mokara (MOK*)            → 5 stems / bunch
  //   * "loose blooms"           → 100 stems / bunch  (sold loose, not bunched)
  //   * Dendrobium / Oncidium    → 10 stems / bunch
  // Once bunch_st is locked we recompute total_bunch from t_price (which we
  // trust because invoice_total is validated separately), so the J=I*G,
  // L=K*J formulas produce the exact totals that appear on the invoice.
  const thBunchSt = (name) => {
    const n = (name || '').toUpperCase();
    if (/LOOSE\s*BLOOM/.test(n)) return 100;
    if (/\bMOK\b|MOKARA/.test(n))  return 5;
    return 10;  // Dendrobium, Oncidium, default
  };
  const products = resolved.map((p) => {
    const bunch_st = thBunchSt(p.matchedName || p.description);
    const uPrice   = Number(p.u_price) || 0;
    const tPrice   = Number(p.t_price) || 0;
    // Prefer recomputed total_bunch from t_price (most reliable).  Fall back
    // to the model's value only if t_price/u_price is missing.
    const total_bunch_model = Number(p.total_bunch) || 0;
    const total_bunch_calc  = (uPrice > 0 && tPrice > 0)
      ? Math.round(tPrice / (uPrice * bunch_st))
      : total_bunch_model;
    return {
      matchedName: p.matchedName,
      unmatched:   p.unmatched,
      viaAlias:    p.viaAlias,
      bunch_st,
      total_bunch: total_bunch_calc,
      u_price:     uPrice,
    };
  });

  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier.name,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowTH,
  });

  // Anchor the total to invoice_total (Claude extracts it directly from the
  // PDF) so missed/duplicated rows surface as a mismatch.  Fall back to the
  // row sum when invoice_total isn't available.
  const rowSum = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const invoiceTotalDeclared = Number(inv.invoice_total) || 0;
  const expectedTotal = invoiceTotalDeclared > 0 ? invoiceTotalDeclared : rowSum;
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'TH', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  // The reference template uses the literal sheet name 'Super Fresh' even for
  // Krung — keeping that quirk so downstream consumers (Nenova templates)
  // don't have to adjust.
  XLSX.utils.book_append_sheet(wb, ws, 'Super Fresh');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  // Sanitize the invoice number for use in the filename (Krung uses "17-Q/2026"
  // which contains a slash that would break the filesystem path).
  const safeInv = (inv.invoice || 'PL').replace(/[\\/:*?"<>|]/g, '_');
  return {
    name:  `${wk}-${num}_TH_${supplier.abbr}_${safeInv}.xlsx`,
    label: `${supplier.name} · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({
      name: p.matchedName,
      qty: (p.total_bunch || 0) * (p.bunch_st || p.bunchSt || 1),
      unmatched: p.unmatched,
      viaAlias: p.viaAlias,
    })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genAustralia(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Match each invoice line against catalog AU using aliases + auto-match.
  const products = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveAU = makeProductResolver('AU', catalog, aliases, {
    farm: 'Premium Greens', farmAbbr: 'AU', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolvedProducts = products.map((p, i) => resolveAU(p, i));

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Premium Greens',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products: resolvedProducts,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowAU,
  });
  const expectedTotal = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'AU', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '호주');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_AU_PG_${inv.invoice || 'PL'}.xlsx`,
    label: `Premium Greens · Invoice ${inv.invoice || ''}`,
    products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: (p.pcs || 0) * (p.steam_box || 0), unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// =============================================================================
// USA / HOOD CANAL EVERGREENS — simple per-box invoice (no freight, just
// boxes × price).  Pseudo rows: Gross weigth + Chargeable weigth at the end.
// =============================================================================
function genUS(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every line against catalog US.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveUS = makeProductResolver('US', catalog, aliases, {
    farm: 'Hood Canal', farmAbbr: 'HC', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveUS(p, i));

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: p.pcs || 0,
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));

  // Pseudo rows: only Gross weigth + Chargeable weigth (no freight).  Match
  // the user's reference template — the typo "weigth" is intentional.
  if (inv.gross_weight) {
    products.push({
      matchedName: 'Gross weigth',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.gross_weight,
      lineTotal: 0,
    });
  }
  if (inv.vol_weight) {
    products.push({
      matchedName: 'Chargeable weigth',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.vol_weight,
      lineTotal: 0,
    });
  }

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Hood Canal',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products,
    priceFmt: NF_PRICE2,
    writeDataRow: writeDataRowUS,
  });

  // Validate against invoice grand total
  const expectedTotal = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'US', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'US-HC');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_US_HC_${inv.invoice || 'PL'}.xlsx`,
    label: `Hood Canal · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// =============================================================================
// VIETNAM / ROYAL BASE CORPORATION — orchid (Phalaenopsis) cut flowers.
// Single farm, per-stem pricing.  No freight, no weight pseudo-rows on the
// reference packing list — just the products + TOTAL row.
// =============================================================================
function genVN(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveVN = makeProductResolver('VN', catalog, aliases, {
    farm: 'Royal Base', farmAbbr: 'RB', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveVN(p, i));

  // Default stems-per-box for orchids when invoice doesn't specify.  The
  // Royal Base reference uses 16 stems/box across all variants.
  const DEFAULT_STEMS_PER_BOX = 16;

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 0,
    bunch_st: 1,
    steam_box: p.steam_box || DEFAULT_STEMS_PER_BOX,
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Royal Base',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE2,
    writeDataRow: writeDataRowVN,
  });

  const expectedTotal = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'VN', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VN-RB');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_VN_RB_${inv.invoice || 'PL'}.xlsx`,
    label: `Royal Base · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function parseWeekFromFilename(filename) {
  if (!filename) return null;
  // Strip the file extension first so digits inside ".xlsx" / ".pdf" never match
  const base = filename.replace(/\.[a-zA-Z0-9]+$/, '');
  // Accept '-', '_', '.', or space as the week/num separator.
  // Examples that match: "19-2", "19_2", "19.2", "19 2", "19-02".
  const m = base.match(/(\d{1,2})\s*[-_.\s]\s*(\d{1,2})/);
  if (m) return { week: m[1].padStart(2, '0'), num: m[2].padStart(2, '0') };
  return null;
}

const AWB_DEFAULT_COMPANIES = ['EXCEL', 'Freightwise Ecuador', 'FREIGHTWISE', 'Apollo'];

// --- AWB packing-list writer --------------------------------------------------
// Uses the 19-2 packing-list helpers (writeTopHeader19_2 +
// writeTableHeaders19_2 + buildMerges19_2) so the file looks like the
// hand-made packing lists Nenova uses (e.g. 19-1_콜수국_AWB.xlsx) but
// trimmed to a sensible length: only 4 fixed rows + 10 spares + TOTAL.
//
// Layout:
//   * dim A1:L20
//   * sheet name 'CO-장미 (2)'
//   * column widths and row heights match the reference template
//   * header table column 'BCH/ST'
//   * Row 6: 운송료 #1  — F=1, G=1, H=1, I=CW (TOTAL BUNCH = chargeable wt),
//                          J=1 (TOTAL STEAM), K=uPrice1, L = K*I
//   * Row 7: 운송료 #2  — F=1, G=1, H=1, J=1, K blank, L=uPrice2 (hardcoded)
//   * Row 8: Gross weight — J=GW
//   * Row 9: Chargeable weight — J=CW
//   * Rows 10..19: empty data rows with J=F*H and L=K*J formulas
//   * Row 20: TOTAL with A:D merged, J=SUM(J6:J19), L=SUM(L6:L19)
function buildAWBSheet(XLSX, opts) {
  // opts: { company, weekend, invoice, awb, date, gw, cw, uPrice1, uPrice2 }
  const ws = {};

  // 1) Top header (rows 1–3) and table headers (row 5) — same as the 19-2 template
  writeTopHeader19_2(ws, opts.company, opts.weekend, opts.invoice, opts.awb, opts.date);
  writeTableHeaders19_2(ws, 'BCH/ST');

  // 2) Column widths and row heights — 19-2 template values exactly
  //    matching the reference file 19-1_콜수국_AWB.xlsx.
  ws['!cols'] = [
    { wch: 3.63 },  { wch: 7.0 },   { wch: 13.5 },  { wch: 13.5 },
    { wch: 5.37 },  { wch: 4.25 },  { wch: 4.0 },   { wch: 5.88 },
    { wch: 6.12 },  { wch: 13.0 },  { wch: 12.08 }, { wch: 13.07 },
  ];
  ws['!rows'] = [
    { hpt: 34.5 }, { hpt: 16.5 }, { hpt: 17.25 }, { hpt: 7.5 }, { hpt: 26.25 },
  ];

  // 3) Data cell styles — thin borders, Calibri 8pt
  const sBase  = { font: FONT_TABLE, alignment: ALIGN_CENTER, border: bordersAll('thin') };
  const sLeft  = { ...sBase, alignment: ALIGN_LEFT };
  const sInt   = { ...sBase, numFmt: NF_INT };
  const sStems = { ...sBase, numFmt: NF_THOUSANDS };
  const sPrice = { ...sBase, numFmt: NF_PRICE2 };

  // 4) Row 6 — 운송료 #1:  L6 = K6 * I6  (TOTAL BUNCH holds the chargeable weight)
  setCell   (ws, 'A6', '1',           { ...sBase, font: FONT_TABLE_BOLD, numFmt: NF_TEXT });
  setCell   (ws, 'B6', '운송료',      sLeft);
  setCell   (ws, 'E6', '',            sBase);
  setCell   (ws, 'F6', 1,             sInt);
  setCell   (ws, 'G6', 1,             sInt);
  setCell   (ws, 'H6', 1,             sInt);
  setCell   (ws, 'I6', opts.cw,       sStems);       // <-- CW goes into TOTAL BUNCH
  setCell   (ws, 'J6', 1,             sStems);
  setCell   (ws, 'K6', opts.uPrice1,  sPrice);
  setFormula(ws, 'L6', 'K6*I6',       sPrice);       // <-- formula uses I, not J

  // 5) Row 7 — 운송료 #2:  L7 = uPrice2 (hardcoded so the grand total matches)
  setCell   (ws, 'A7', '2',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B7', '운송료',      sLeft);
  setCell   (ws, 'E7', '',            sBase);
  setCell   (ws, 'F7', 1,             sInt);
  setCell   (ws, 'G7', 1,             sInt);
  setCell   (ws, 'H7', 1,             sInt);
  setCell   (ws, 'I7', '',            sStems);
  setCell   (ws, 'J7', 1,             sStems);
  setCell   (ws, 'K7', '',            sPrice);       // <-- K blank
  setCell   (ws, 'L7', opts.uPrice2,  sPrice);       // <-- hardcoded value

  // 6) Row 8 — Gross weight:  only J holds the GW value
  setCell   (ws, 'A8', '3',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B8', 'Gross weight', sLeft);
  setCell   (ws, 'E8', '',            sBase);
  setCell   (ws, 'F8', '',            sInt);
  setCell   (ws, 'G8', '',            sInt);
  setCell   (ws, 'H8', '',            sInt);
  setCell   (ws, 'I8', '',            sStems);
  setCell   (ws, 'J8', opts.gw,       sStems);
  setCell   (ws, 'K8', '',            sPrice);
  setFormula(ws, 'L8', 'IFERROR(K8*J8,0)', sPrice);

  // 7) Row 9 — Chargeable weight:  only J holds the CW value
  setCell   (ws, 'A9', '4',           { ...sBase, numFmt: NF_TEXT });
  setCell   (ws, 'B9', 'Chargeable weight', sLeft);
  setCell   (ws, 'E9', '',            sBase);
  setCell   (ws, 'F9', '',            sInt);
  setCell   (ws, 'G9', '',            sInt);
  setCell   (ws, 'H9', '',            sInt);
  setCell   (ws, 'I9', '',            sStems);
  setCell   (ws, 'J9', opts.cw,       sStems);
  setCell   (ws, 'K9', '',            sPrice);
  setFormula(ws, 'L9', 'IFERROR(K9*J9,0)', sPrice);

  // 8) Rows 10..19 — 10 extra empty data rows with the formula skeleton, in
  //    case the user wants to add something later.  We wrap the formulas in
  //    IFERROR so empty K/F/H cells don't produce #VALUE! errors — they just
  //    evaluate to 0, which the NF_INT format renders as "-".
  const lastDataRow = 19;
  for (let r = 10; r <= lastDataRow; r++) {
    setCell   (ws, `A${r}`, '',  sBase);
    setCell   (ws, `B${r}`, '',  sLeft);
    setCell   (ws, `E${r}`, '',  sBase);
    setCell   (ws, `F${r}`, '',  sInt);
    setCell   (ws, `G${r}`, '',  sInt);
    setCell   (ws, `H${r}`, '',  sInt);
    setCell   (ws, `I${r}`, '',  sStems);
    setFormula(ws, `J${r}`, `IFERROR(F${r}*H${r},0)`, sStems);
    setCell   (ws, `K${r}`, '',  sPrice);
    setFormula(ws, `L${r}`, `IFERROR(K${r}*J${r},0)`, sPrice);
  }

  // 9) TOTAL row (row 20) — A:D merged
  const totalRow = 20;
  const sTotalLabel = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin') };
  const sTotalStems = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin'), numFmt: NF_THOUSANDS };
  const sTotalPrice = { font: FONT_TABLE_BOLD, alignment: ALIGN_CENTER, border: bordersAll('thin'), numFmt: NF_PRICE2 };
  setCell   (ws, `A${totalRow}`, 'TOTAL', sTotalLabel);
  setCell   (ws, `E${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `F${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `G${totalRow}`, '',      sTotalLabel);
  setCell   (ws, `H${totalRow}`, '',      sTotalLabel);
  setFormula(ws, `I${totalRow}`, `SUM(I6:I${lastDataRow})`, sTotalStems);
  setFormula(ws, `J${totalRow}`, `SUM(J6:J${lastDataRow})`, sTotalStems);
  setCell   (ws, `K${totalRow}`, '',      sTotalPrice);
  setFormula(ws, `L${totalRow}`, `SUM(L6:L${lastDataRow})`, sTotalPrice);

  // 10) Merges — 19-2 template shape, with B:D merged on every row 5..150
  ws['!merges'] = buildMerges19_2(lastDataRow, totalRow);
  ws['!ref'] = `A1:L${totalRow}`;
  return ws;
}

// Write an AWB workbook to a Blob URL (one sheet — name matches reference).
function writeAWBWorkbook(XLSX, opts) {
  const ws = buildAWBSheet(XLSX, opts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CO-장미 (2)');
  // Force Excel/LibreOffice to recalculate all formulas the moment the file
  // is opened.  Without this, cells like L151 (=SUM(L6:L150)) appear empty
  // because xlsx-js-style doesn't compute formula values when writing —
  // it relies on the spreadsheet app to evaluate them on open.
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.CalcPr = {
    calcId: 999999,
    fullCalcOnLoad: true,
    calcCompleted: false,
    calcOnSave: true,
  };
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}


export { KR_COUNTRY_TO_CODE, parseCatalog, normalize, FAMILY_PATTERNS, detectFamily, familyForCatalog, STEMS_PER_BUNCH_CO, stemsPerBunchCO, STEMS_PER_BOX_CO, stemsPerBoxCO, COMPOUND_SPLITS, NOISE_WORDS, splitCompounds, tokenize, extractSize, scoreMatch, findBestMatch, isConfidentMatch, aliasKey, parseAliasesXlsx, exportAliasesXlsx, makeProductResolver, SEED_ALIASES_CO, SEED_ALIASES_AU, SEED_ALIASES_CN, SEED_ALIASES_US, SEED_ALIASES_VN, SEED_ALIASES_TH, ALL_SEED_ALIASES, NL_MASTER, NL_MASTER_IDX, NL_MAP, mapProductNL, BUNCH_ST_NL, familyNL, formatAwbNL, CO_FARMS, detectCOFarm, FONT_HEADER_BOLD, FONT_HEADER, FONT_TITLE, FONT_TABLE_BOLD, FONT_TABLE, ALIGN_LEFT, ALIGN_LEFT_TOP, ALIGN_CENTER, ALIGN_CENTER_WRAP, BORDER_THIN, BORDER_MEDIUM, NF_TEXT, NF_PLAIN_INT, NF_INT, NF_THOUSANDS, NF_PRICE3, NF_PRICE2, bord, bordersAll, setCell, setFormula, setEmpty, writeTopHeader19_2, writeTableHeaders19_2, buildMerges19_2, applyColWidths19_2, writeTopHeader, writeTableHeaders, buildMerges, applyColWidths, writeDataRowCOAntioquia, writeDataRowCOBogota, writeDataRowNL, writeDataRowCN, writeDataRowEC, writeDataRowTH, writeDataRowAU, writeDataRowUS, writeDataRowVN, writeDataRowPseudo, buildSheet19_2, ANTIOQUIA_FARMS, genColombia, genNL, genChina, genEcuador, genThailand, genAustralia, genUS, genVN, AWB_DEFAULT_COMPANIES, buildAWBSheet, writeAWBWorkbook, parseWeekFromFilename };
