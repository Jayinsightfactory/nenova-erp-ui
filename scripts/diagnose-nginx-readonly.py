# Read-only aggregate of nginx access logs. Never output clients, URLs, query strings or raw lines.
import gzip,glob,re,datetime,collections,json,os
now=datetime.datetime.now(datetime.timezone.utc); since=now-datetime.timedelta(days=7)
status=collections.Counter();hours=collections.Counter();uploads=collections.Counter();groups=collections.Counter();activityMethods=collections.Counter();total=0;files=0
pattern=re.compile(r'\[(\d\d/\w+/\d{4}:\d\d:\d\d:\d\d [+-]\d{4})\].*?"(?:GET|POST|PUT|PATCH|DELETE) ([^ ?"]+)[^"]*" (\d{3}) ')
paths={'/api/shipment/distribute-import-apply':'distribution','/api/sales/hotel-miu-parse':'hotel_parse','/api/sales/hotel-order-images':'hotel_image','/api/orders':'orders','/api/sales/hotel-order-drafts':'hotel_draft'}
incident=collections.defaultdict(collections.Counter)
lo=datetime.datetime(2026,11,13,4,42,tzinfo=datetime.timezone.utc)
hi=lo+datetime.timedelta(minutes=17)
def incident_line(at,uri,code):
 if not lo<=at<hi:return
 key=at.strftime('%H:%M')
 route={'/api/desktop/home-workspace':'notes','/api/work/drive-ingest':'ingest','/api/auth/me':'auth','/api/desktop/bootstrap':'bootstrap','/api/work/drive':'drive_list'}.get(uri,'other')
 incident[key][route+'_'+code]+=1
for file in glob.glob('/var/log/nginx/*access*.log*'):
 try:
  with (gzip.open(file,'rt',errors='replace') if file.endswith('.gz') else open(file,errors='replace')) as f:
   files+=1
   for line in f:
    m=pattern.search(line)
    if not m:continue
    try:dt=datetime.datetime.strptime(m[1],'%d/%b/%Y:%H:%M:%S %z')
    except ValueError:continue
    incident_line(dt.astimezone(datetime.timezone.utc),m[2],m[3])
    if dt<since:continue
    total+=1;code=m[3];status[code[0]+'xx']+=1;hour=dt.strftime('%Y-%m-%dT%H:00%z');hours[hour]+=1
    parts=m[2].split('/')
    group=('api/'+parts[2]) if len(parts)>2 and parts[1]=='api' and re.fullmatch(r'[a-z-]{1,30}',parts[2]) else 'other'
    if group in ('api/work','api/moyi') and len(parts)>3 and re.fullmatch(r'[a-z-]{1,40}',parts[3]):group+='/'+parts[3]
    groups[(hour,group,code[0]+'xx')]+=1
    if m[2]=='/api/work/activity':
     method='POST' if '"POST /api/work/activity' in line else 'ME_GET' if '"GET /api/work/activity?me=1' in line else 'GET' if '"GET /api/work/activity' in line else 'OTHER'
     activityMethods[(hour,method)]+=1
    route=paths.get(m[2]);
    if route:uploads[(hour,route,code)]+=1
 except (OSError,EOFError):continue
print(json.dumps({'section':'nginx_7d','files':files,'total':total,'status':dict(status),'busiestHours':hours.most_common(20),'targetRoutes':[[*k,v] for k,v in uploads.most_common(80)],'topApiGroups':[[*k,v] for k,v in groups.most_common(60)],'errorGroups':[[*k,v] for k,v in groups.most_common() if k[2]=='5xx'][:40],'activityMethods':[[*k,v] for k,v in activityMethods.most_common(40)],'activityTotals':dict(collections.Counter({method:sum(v for (hour,m),v in activityMethods.items() if m==method) for method in ['POST','GET','ME_GET','OTHER']}))},ensure_ascii=False))

print(json.dumps({'section':'incident_minute_utc','minutes':incident},sort_keys=True))
