const { createHash } = require('node:crypto');
const flights = [
  {key:'synthetic-colombia',weekLabel:'46-2',country:'콜롬비아',flight:'AC063',airline:'연습 항공',itemLabel:'장미',box:120,
    status:'in_flight',statusLabel:'밴쿠버 경유지 대기(예측)',phase:'layover',progress:0.45,
    origin:{name:'보고타',lat:4.7,lon:-74.15},via:{name:'밴쿠버',lat:49.19,lon:-123.18},position:{lat:49.19,lon:-123.18},
    route:[{lat:4.7,lon:-74.15},{lat:49.19,lon:-123.18},{lat:37.46,lon:126.44}],
    arriveAt:'2026-11-19T05:20:00.000Z',awb:'014-12345675',note:'연습 자료 · 경유지와 도착 예정 확인',
    departAtEstimated:'2026-11-17T22:20:00.000Z',
    actual:{scheduledAt:'2026-11-19T05:20:00.000Z',estimatedAt:'2026-11-19T06:50:00.000Z',remark:'지연',delayMinutes:90},
    contents:{source:'연습 자료',farms:2,items:[{name:'장미',box:120}]},checklist:{steps:[]},roomEvents:[],alerts:[],issues:[],links:{}},
  {key:'synthetic-netherlands',weekLabel:'46-2',country:'네덜란드',flight:'KE926',airline:'연습 항공',itemLabel:'튤립',box:80,
    status:'before_departure',statusLabel:'출발 전',phase:'before_departure',progress:0,
    origin:{name:'암스테르담',lat:52.31,lon:4.76},position:{lat:52.31,lon:4.76},route:[{lat:52.31,lon:4.76},{lat:37.46,lon:126.44}],
    arriveAt:'2026-11-20T04:00:00.000Z',awb:'180-98765432',note:'연습 자료 · 출발 전 편 확인',
    contents:{source:'연습 자료',farms:1,items:[{name:'튤립',box:80}]},checklist:{steps:[]},roomEvents:[],alerts:[],issues:[],links:{}}
].map(f=>({...f,viewId:createHash('sha256').update(f.key).digest('hex')}));
const board = {
  success:true,generatedAt:'2026-11-18T02:00:00Z',feed:{ok:true},receipts:{ok:true},sources:{},
  destination:{name:'인천',lat:37.46,lon:126.44},flights,
  todo:[
    {key:flights[0].key,label:'46-2차 콜롬비아 AC063',level:'red',text:'지연(+90분)인데 변경 공지 확인 필요'},
    ...['서류 전달 확인','검역 신청 확인','빌번호방 공지 확인','선율방 변경 공지 확인','도착 시간 재확인','경유 구간 확인'].map(text=>({key:flights[0].key,label:'46-2차 콜롬비아 AC063',level:'amber',text}))
  ],
  issues:[{key:flights[0].key,label:'46-2차 콜롬비아 AC063',text:'도착 공지와 공항 변경 시각이 다릅니다.'}],roomNews:[],
  summary:{total:2,inFlight:1,beforeDeparture:1,registered:0,arrived:0,awaitingAwb:0,red:1,amber:6}
};
module.exports = {board,flights};
