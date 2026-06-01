const FARM_KOREAN_NAMES = {
  'Antioquia Floral S.A.S': 'AN',
  'C.I Flores Balverde S.A.S': 'BA',
  'C.I SURANDINA DE FLORES S.A.S': 'SURANDINA',
  'CHAQUIRO COLOMBIAN FLOWERS SAS': 'CHAQIRO',
  'Cloudland': '클라우드랜드',
  'Colibri': '콜리브리',
  'Construnorte': '콘스트루노르테',
  'Daflor': '다플로르',
  'Don Eusebio': '돈유세비오',
  'El Cactus': '칵투스',
  'El Milagro': '밀라그로',
  'El Redil': '레딜',
  'Esperance Roses': '에스페란스',
  'EXCEL': '엑셀',
  'Fillco': '필코',
  'Florentina Export S.A.S': '플로렌티나',
  'Flores de Aposentos': '아포센토스',
  'Flores De Funza': '펀자',
  'Flores El Zorro': '엘조로',
  'FLORES GAMBUR SAS': '감부르',
  'FLORES LA LINDA S.A.S': '라린다',
  'Flores Tiba': '티바',
  'FREIGHTWISE': '운송료',
  'Freightwise Ecuador': '에콰도르운송료',
  'Green Land Flowers S.A.S': 'GR',
  'Grupo Valores en Accion': 'VA',
  'INVERPALMAS SAS': '인베르팔마',
  'Krung': '크룽',
  'La Gaitana': '가이타나',
  'La Rosaleda': '로살레다',
  'Lorzate Flowers S.A.S': '로자르테',
  'Matina': '마티나',
  'Maxiflores': '나투',
  'Monika Farms': '모니카',
  'Pietrasanta Flores y Follajes S.A.S': 'Piet',
  'PRESH TECH S A S': '프레시테크',
  'Princess Farms S.A.S': 'PRincess',
  'Prisma': '프리즈마',
  'Royal Base': '로얄베이스',
  'SUNSET VALLEY SAS': '선셋밸리',
  'Super Fresh': '슈퍼프레시',
  'Superior Blooms': '슈페리오블룸스',
  'Teucali': '튜칼리',
  'The Elite Flowers': '엘리테',
  'The Green Genie': '그린진',
  'Turflor': '터플러',
  'Unique Flowers': '유니크',
  'Varietta': '바리에타',
  'VUELVEN S.A.S.': '뷸벤',
  'Yunnan Melody': '멜로디',
  'Ayura': '아유라',
  'Circasia': '시르카시아',
};

function normalizeFarmName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const FARM_KOREAN_INDEX = Object.entries(FARM_KOREAN_NAMES).reduce((acc, [key, value]) => {
  acc[normalizeFarmName(key)] = value;
  return acc;
}, {});

export function getFarmDisplayName(name) {
  const raw = String(name || '').trim();
  return FARM_KOREAN_NAMES[raw] || FARM_KOREAN_INDEX[normalizeFarmName(raw)] || raw;
}

export default FARM_KOREAN_NAMES;
