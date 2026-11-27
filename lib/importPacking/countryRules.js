// Country-specific NL master/mapping rules, CO farm detection, and filename week parser
import { packingNlCandidateNames } from '../packingNlCandidates.js';
import { aliasKey, packingSourceKey } from './catalogAndMatching.js';

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

// Same resolution for the preview and generated workbook. Never hide a stale
// saved mapping by silently choosing another product.
function resolveProductNL(description, items, aliases = {}) {
  const names = new Set(items.map(item => item.name));
  const sourceKey = packingSourceKey(description);
  if (Object.prototype.hasOwnProperty.call(aliases, sourceKey)) {
    const name = aliases[sourceKey];
    return { matchedName: names.has(name) ? name : description, unmatched: !names.has(name), viaAlias: names.has(name) };
  }
  const legacy = aliases[aliasKey(description)];
  if (legacy && names.has(legacy)) return { matchedName: legacy, viaAlias: true, unmatched: false };
  const mapped = mapProductNL(description);
  if (names.has(mapped)) return { matchedName: mapped, unmatched: false };
  const ranked = packingNlCandidateNames(description, [...names]);
  if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
    return { matchedName: ranked[0].name, unmatched: false, suggested: true };
  }
  return { matchedName: description, unmatched: true };
}

export { resolveProductNL };
const BUNCH_ST_NL = {
  TULIPA: 10, TULIP: 10, HIPPEASTRUM: 1, HYACINTHUS: 5, ZANTEDESCHIA: 1, ERYNGIUM: 1,
  ASTILBE: 1, AGAPANTHUS: 1, ALLIUM: 1, SKIMMIA: 3, ANTHURIUM: 1,
  SANGUISORBA: 1, CORDYLINE: 1, POLYGONATUM: 1, EUCALYPTUS: 3, GOSSYPIUM: 10,
};
function familyNL(desc) {
  return String(desc || '').toUpperCase().replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim().split(/[\s/]+/)[0] || '';
}

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
  { match: /elite|flora\s*concept/i, abbr: 'ELI', name: 'The Elite Flowers', short: 'ELITE' },
  { match: /esperance/i, abbr: 'ESP', name: 'Esperance Roses', short: 'ESPERANCE' },
  { match: /fillco/i, abbr: 'FIL', name: 'Fillco', short: 'FILLCO' },
  { match: /serrezuela|superior\s*blooms/i, abbr: 'SER', name: 'Superior Blooms', short: 'SUPERIOR' },
  { match: /colibri|colibr[íi]/i, abbr: 'COL', name: 'Colibri', short: 'COLIBRI' },
  { match: /prisma/i, abbr: 'PRI', name: 'Prisma', short: 'PRISMA' },
  { match: /monika/i, abbr: 'MON', name: 'Monika Farms', short: 'MONIKA' },
  { match: /matina|aguaclara|agua\s*clara|zelecta/i, abbr: 'MAT', name: 'Matina', short: 'MATINA' },
  { match: /prestige/i, abbr: 'PRE', name: 'Prestige Roses', short: 'PRESTIGE' },
  { match: /aposentos/i, abbr: 'APO', name: 'Flores de Aposentos', short: 'APOSENTOS' },
  { match: /invos/i, abbr: 'INV', name: 'Invos Flowers', short: 'INVOS' },
  { match: /kumanday/i, abbr: 'KUM', name: 'Plantas Kumanday', short: 'KUMANDAY' },
  { match: /construn[oó]rte|construnote|cosntrunorte/i, abbr: 'CON', name: 'Construnorte', short: 'CONSTRUNORTE' },
  { match: /aguata/i, abbr: 'AGT', name: 'Flores de Aguata', short: 'AGUATA' },
  { match: /balverde/i, abbr: 'BAL', name: 'C.I Flores Balverde S.A.S', short: 'BALVERDE' },
  { match: /florentina/i, abbr: 'FLO', name: 'Florentina Export S.A.S', short: 'FLORENTINA' },
  { match: /antioquia\s*floral/i, abbr: 'ANT', name: 'Antioquia Floral S.A.S', short: 'ANTIOQUIA F' },
  { match: /green\s*land/i, abbr: 'GRL', name: 'Green Land Flowers S.A.S', short: 'GREEN LAND' },
  { match: /pietrasanta/i, abbr: 'PIE', name: 'Pietrasanta Flores y Follajes S.A.S', short: 'PIETRASANTA' },
  { match: /valores\s*en\s*acci[óo]n|grupo\s*valores/i, abbr: 'VAL', name: 'Grupo Valores en Accion', short: 'VALORES' },
  { match: /princess\s*farms/i, abbr: 'PNS', name: 'Princess Farms S.A.S', short: 'PRINCESS' },
  { match: /lorzate/i, abbr: 'LOR', name: 'Lorzate Flowers S.A.S', short: 'LORZATE' },
  { match: /dawn\s*flowers/i, abbr: 'DAW', name: 'DAWN FLOWERS S.A.S', short: 'DAWN' },
  { match: /surandina/i, abbr: 'SUR', name: 'C.I SURANDINA DE FLORES S.A.S', short: 'SURANDINA' },
  { match: /chaquiro/i, abbr: 'CHA', name: 'CHAQUIRO COLOMBIAN FLOWERS SAS', short: 'CHAQUIRO' },
];
function detectCOFarm(name, farmMatches = null) {
  if (!name) return { abbr: 'UNK', name: 'Unknown', short: 'UNK' };
  const entries = Array.isArray(farmMatches?.entries) ? farmMatches.entries : [];
  if (entries.length) {
    const rawKey = packingSourceKey(name);
    const saved = entries.find(entry => entry.country === 'CO' && entry.supplierKey === rawKey && entry.packingAbbr && entry.packingAbbr !== 'UNK');
    if (saved) {
      return {
        abbr: saved.packingAbbr,
        name: saved.farmName || name,
        short: (saved.packingShort || saved.farmName || name).toUpperCase(),
        coRegion: saved.coRegion || null,
      };
    }
  }
  for (const f of CO_FARMS) if (f.match.test(name)) return f;
  return { abbr: 'UNK', name: name, short: name.toUpperCase() };
}

// Antioquia farms (hortensias) keep using the legacy hardcoded mapping for now
// The 8 hortensia farms that use the 19-2 fixed-template layout (A1:L58, etc.)
// IMPORTANT: each entry MUST match the `abbr` field in CO_FARMS — otherwise
// detectCOFarm returns an abbr that's not in this set and the file silently
// falls through to the Bogotá branch.  Verified entries: BAL, FLO, ANT, GRL,
// PIE, VAL, PNS, LOR.
const ANTIOQUIA_FARMS = new Set(['BAL','FLO','ANT','GRL','PIE','VAL','PNS','LOR','DAW','SUR','CHA']);

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

export {
  NL_MASTER,
  NL_MASTER_IDX,
  NL_MAP,
  mapProductNL,
  BUNCH_ST_NL,
  familyNL,
  formatAwbNL,
  CO_FARMS,
  detectCOFarm,
  ANTIOQUIA_FARMS,
  parseWeekFromFilename,
};
