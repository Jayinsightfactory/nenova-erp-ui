"""Build public-holiday reference data; never runs on employee requests.
pip install -r scripts/requirements-calendar.txt
python scripts/generate-calendar-holidays.py
Python holidays is MIT licensed: https://github.com/vacanza/holidays
"""
import datetime as dt
import json
import pathlib
import warnings
import holidays

ROOT = pathlib.Path(__file__).resolve().parents[1]
COUNTRIES = [('KR','한국'),('CO','콜롬비아'),('CN','중국'),('NL','네덜란드'),('IT','이탈리아'),('TH','태국'),('VN','베트남'),('JP','일본'),('US','미국'),('EC','에콰도르'),('ET','에티오피아'),('AU','호주')]
NAMES = dict([
 ('New Year\'s Day','신정'),('Christmas Day','성탄절'),('Epiphany','주현절'),('Good Friday','성금요일'),('Maundy Thursday','성목요일'),('Easter Sunday','부활절'),('Easter Monday','부활절 월요일'),('Ascension Day','예수 승천일'),('Pentecost','성령강림절'),('Pentecost Monday','성령강림절 월요일'),('Second Day of Christmas','성탄절 다음날'),('Boxing Day','박싱데이'),('Labor Day','노동절'),('International Labor Day','노동절'),('International Workers\' Day','노동절'),('National Labor Day','노동절'),('National Day','국경일'),('Independence Day','독립기념일'),('All Saints\' Day','모든 성인의 날'),('All Souls\' Day','위령의 날'),('Immaculate Conception','성모 무염시태 축일'),('Assumption Day','성모 승천일'),('Assumption Of Mary Day','성모 승천일'),('Saint Joseph\'s Day','성 요셉의 날'),('Saint Peter and Saint Paul\'s Day','성 베드로와 성 바오로의 날'),('Sacred Heart','예수 성심 대축일'),('Corpus Christi','성체 축일'),('Battle of Boyacá','보야카 전투 기념일'),('Independence of Cartagena','카르타헤나 독립기념일'),('Columbus Day','콜럼버스의 날'),('Day of Our Lady of the Rosary of Chiquinquirá','치킨키라 성모의 날'),
 ('King\'s Day','국왕의 날'),('Liberation Day','해방기념일'),('Republic Day','공화국의 날'),('National Unity Day','국가 통일의 날'),('Saint Stephen\'s Day','성 스테파노의 날'),('Saint Francis of Assisi, Patron Saint of Italy','성 프란치스코의 날'),
 ('Chinese New Year (Spring Festival)','춘절'),('Chinese New Year\'s Eve','춘절 전날'),('Tomb-Sweeping Day','청명절'),('Dragon Boat Festival','단오절'),('Mid-Autumn Festival','중추절'),('Bridge Public Holiday','임시 공휴일'),('Substitute Holiday','대체 공휴일'),
 ('Chakri Memorial Day','차크리 왕조 기념일'),('Coronation Day','대관식 기념일'),('Songkran Festival','송끄란'),('Makha Bucha','만불절'),('Visakha Bucha','불탄절'),('Asarnha Bucha','삼보절'),('Buddhist Lent Day','입안거일'),('HM Queen Suthida\'s Birthday','수티다 왕비 탄신일'),('HM King Maha Vajiralongkorn\'s Birthday','국왕 탄신일'),('HM King Bhumibol Adulyadej Memorial Day','푸미폰 국왕 추모일'),('HM King Chulalongkorn Memorial Day','출라롱꼰 국왕 기념일'),('HM King Bhumibol Adulyadej the Great\'s Birthday','푸미폰 국왕 탄신일'),('HM Queen Sirikit The Queen Mother\'s Birthday','시리킷 왕대비 탄신일'),('National Mother\'s Day','어머니의 날'),('National Father\'s Day','아버지의 날'),('Constitution Day','헌법기념일'),('New Year\'s Eve','연말 휴일'),
 ('Lunar New Year','설날(뗏)'),('Lunar New Year\'s Eve','설날 전날'),('Second Day of Lunar New Year','설날 둘째 날'),('Third Day of Lunar New Year','설날 셋째 날'),('Fourth Day of Lunar New Year','설날 넷째 날'),('Hung Kings\' Commemoration Day','흥왕 기념일'),('Liberation Day/Reunification Day','해방·통일기념일'),('Vietnam Cultural Day','베트남 문화의 날'),
 ('Coming of Age Day','성인의 날'),('Foundation Day','건국기념일'),('Emperor\'s Birthday','천황 탄생일'),('Vernal Equinox Day','춘분의 날'),('Autumnal Equinox Day','추분의 날'),('Showa Day','쇼와의 날'),('Greenery Day','녹색의 날'),('Children\'s Day','어린이날'),('Marine Day','바다의 날'),('Mountain Day','산의 날'),('Respect for the Aged Day','경로의 날'),('Sports Day','스포츠의 날'),('Culture Day','문화의 날'),('Labor Thanksgiving Day','근로감사의 날'),('National Holiday','국민의 휴일'),
 ('Martin Luther King Jr. Day','마틴 루서 킹의 날'),('Washington\'s Birthday','대통령의 날'),('Memorial Day','메모리얼 데이'),('Juneteenth National Independence Day','준틴스'),('Veterans Day','재향군인의 날'),('Thanksgiving Day','추수감사절'),('Carnival','카니발'),('The Battle of Pichincha','피친차 전투 기념일'),('Declaration of Independence of Quito','키토 독립선언일'),('Independence of Guayaquil','과야킬 독립기념일'),('Independence of Cuenca','쿠엥카 독립기념일'),
 ('Adwa Victory Day','아드와 전승일'),('Ethiopian Patriots\' Victory Day','애국자 전승일'),('Ethiopian New Year','에티오피아 신년'),('Finding of True Cross','메스켈'),('Eid al-Fitr','이드 알피트르'),('Eid al-Adha','이드 알아드하'),('Prophet\'s Birthday','마울리드'),('ANZAC Day','앤잭 데이'),('Australia Day','호주의 날')])
def korean(name):
    if name.startswith('Day off (substituted from '): return '조정 휴일'
    text=name.replace(' (observed)','').replace(' (in lieu)','').replace(' (estimated)','')
    text=' · '.join(NAMES.get(part,part) for part in text.split('; '))
    if '(observed)' in name or '(in lieu)' in name: text+=' (대체 휴일)'
    if '(estimated)' in name: text+=' (예정)'
    return text

CN_SOURCES={2026:'https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html',2027:'https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml'}
CN_RANGES={
 2026:[('01-01','01-03','신정'),('02-15','02-23','춘절'),('04-04','04-06','청명절'),('05-01','05-05','노동절'),('06-19','06-21','단오절'),('09-25','09-27','중추절'),('10-01','10-07','국경절')],
 2027:[('01-01','01-03','신정'),('02-05','02-13','춘절'),('04-03','04-05','청명절'),('05-01','05-05','노동절'),('06-09','06-09','단오절'),('09-15','09-15','중추절'),('10-01','10-07','국경절')]
}
CN_WORK={2026:['01-04','02-14','02-28','05-09','09-20','10-10'],2027:['01-31','02-14','05-08','09-26','10-09']}
years={}
with warnings.catch_warnings():
 warnings.simplefilter('ignore')
 for year in range(2000,2101):
  rows=[]
  for code,_ in COUNTRIES:
   ref=holidays.country_holidays(code,years=year,language='ko' if code=='KR' else 'en_US')
   if code=='NL': ref[dt.date(year,5,5)]='Liberation Day'
   for date,name in sorted(ref.items()):
    if date.year!=year or code=='CN' and year in CN_RANGES or code=='TH' and name=='National Children\'s Day': continue
    rows.append({'date':date.isoformat(),'country':code,'name':korean(name),'originalName':name,'kind':'holiday','estimated':'(estimated)' in name})
   if code=='CN' and year in CN_RANGES:
    for start,end,name in CN_RANGES[year]:
     at=dt.date.fromisoformat(f'{year}-{start}');stop=dt.date.fromisoformat(f'{year}-{end}')
     while at<=stop:
      rows.append({'date':at.isoformat(),'country':code,'name':name,'originalName':name,'kind':'holiday','estimated':False,'source':CN_SOURCES[year]});at+=dt.timedelta(days=1)
    rows.extend({'date':f'{year}-{day}','country':code,'name':'대체근무일','originalName':'대체근무일','kind':'workday','estimated':False,'source':CN_SOURCES[year]} for day in CN_WORK[year])
  years[str(year)]=sorted(rows,key=lambda r:(r['date'],r['country'],r['name']))
output={'schemaVersion':1,'provider':f'python-holidays {holidays.__version__}','source':'https://github.com/vacanza/holidays','reviewedAt':'2026-11-18','countries':[{'code':a,'name':b} for a,b in COUNTRIES],'years':years}
target=ROOT/'data/calendar-holidays.json'
target.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')
print(f'Generated {len(years)} years, {sum(map(len,years.values()))} entries, {target.stat().st_size} bytes')
