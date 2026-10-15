import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeLocal,mergeRecognized} from '../src/lib/recognition';
import {HEBEI_SEED,type TripInput} from '../src/lib/travel';
import {parseTripDocument,parseTripInput} from '../src/lib/validation';
import {redactTrip} from '../src/lib/cloud';
import {renderPoster,releasePosters,TEMPLATES} from '../src/lib/poster';
import {setStorageScope,listTrips,saveTrip} from '../src/lib/store';
import {normalizePlan,isHomewardTravel} from '../src/lib/planning';
import 'fake-indexeddb/auto';

test('natural language recognizes dates and protects manually edited choices',()=>{
  const raw='明天上午9点从石家庄出发，开车去正定，两个人，预算500元，晚上7点开始返程，不住宿，少走一点。';
  const patch=recognizeLocal(raw,new Date('2026-10-15T23:30:00+08:00'));
  assert.equal(patch.origin,'石家庄');assert.equal(patch.destination,'正定');assert.equal(patch.departureAt,'2026-10-16T09:00');assert.equal(patch.returnDepartureAt,'2026-10-16T19:00');assert.equal(patch.partySize,2);assert.equal(patch.walking,'easy');
  const input=structuredClone(HEBEI_SEED.input);input.destination='北京';
  assert.equal(mergeRecognized(input,patch,new Set(['destination'])).destination,'北京');
  assert.equal(mergeRecognized(input,patch,new Set(['destination']),true).destination,'正定');
  assert.equal(recognizeLocal('晚上7点到家').returnDepartureAt,undefined);
  assert.throws(()=>parseTripInput({...input,arriveBy:input.departureAt}));
});
test('account caches and default sample never cross user boundaries',async()=>{
  setStorageScope('account-a');assert.equal((await listTrips()).length,0);const trip=structuredClone(HEBEI_SEED);await saveTrip(trip);
  setStorageScope('account-b');assert.equal((await listTrips()).length,0);
  setStorageScope('account-a');assert.equal((await listTrips()).length,1);setStorageScope();
});
test('share redaction hides private addresses, costs, notes and geographic map',()=>{
  const trip=structuredClone(HEBEI_SEED);trip.input.origin='秘密路88号';trip.input.returnLocation='私人住宅66号';trip.input.returnOrigin='秘密路88号';trip.days[0].stops[0].description='从秘密路88号出发';trip.days[0].stops[1].sourceUrl='https://example.com/?q='+encodeURIComponent('秘密路88号');trip.actual.visitNotes='秘密笔记';trip.actual.spentYuan=999;
  const safe=redactTrip(trip),text=JSON.stringify(safe);assert(!text.includes('秘密路88号'));assert(!text.includes(encodeURIComponent('秘密路88号')));assert(!text.includes('私人住宅66号'));assert(!text.includes('秘密笔记'));assert.equal(safe.input.budgetYuan,undefined);assert.equal(safe.mapDays,undefined);parseTripDocument(safe);
});
test('all three poster templates retain timed stops, reminders and map fallback without clipping',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');const drawn:string[]=[];
  const context:any={font:'',measureText:(text:string)=>({width:[...text].length*18}),fillText:(text:string)=>drawn.push(text),fillRect(){},beginPath(){},roundRect(){},fill(){},arc(){},stroke(){},moveTo(){},lineTo(){},save(){},restore(){},clip(){},drawImage(){}};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{fonts:{ready:Promise.resolve()},createElement:()=>({width:0,height:0,getContext:()=>context,toBlob:(callback:(b:Blob)=>void)=>callback(new Blob(['PNG test'],{type:'image/png'}))})}});
  const trip=structuredClone(HEBEI_SEED);delete trip.coverUrl;trip.days.forEach(d=>delete d.imageUrl);
  try{for(const template of TEMPLATES){drawn.length=0;const pages=await renderPoster(trip,template.id);const text=drawn.join('');assert(text.includes('计划总览'));assert(text.includes('游览顺序示意'));assert(text.includes('出行提醒'));for(const stop of trip.days[0].stops){assert(text.includes(stop.title));assert(text.includes(stop.startAt.slice(11)));}assert(pages.every(p=>p.height<12200&&p.width===1080));releasePosters(pages);}
    trip.generalTips=Array.from({length:30},(_,i)=>`提醒${i}：${'完整提醒不可遗漏。'.repeat(100)}`);const pages=await renderPoster(trip,'journal');assert(pages.length>1);assert(drawn.join('').includes('提醒29'));releasePosters(pages);
  }finally{if(original)Object.defineProperty(globalThis,'document',original);else delete (globalThis as any).document;}
});

test('return departure is never an arrival deadline, and overnight sleep does not overflow a day',()=>{
 const input={...HEBEI_SEED.input,origin:'石家庄',returnLocation:'石家庄',departureAt:'2026-10-17T09:00',returnDepartureAt:'2026-10-18T17:00'};
 const trip=normalizePlan(input,{days:[{stops:[{title:'游玩',durationMin:120},{kind:'lodging',title:'办理入住与睡眠',durationMin:480,earliestStart:'21:00'}]},{stops:[{title:'游玩',durationMin:120},{kind:'travel',title:'自驾返回石家庄',durationMin:90},{kind:'meal',title:'晚餐',durationMin:60,earliestStart:'17:30',priority:3}]}]});
 assert.equal(trip.days[0].stops.at(-1)?.durationMin,60);assert.equal(trip.days[1].stops.at(-1)?.startAt,input.returnDepartureAt);assert.equal(trip.days[1].stops.length,2);assert.equal(trip.removedForTime.length,2);assert.equal(isHomewardTravel({kind:'travel',title:'返回颐和园',place:'北京'},input),false);
});
