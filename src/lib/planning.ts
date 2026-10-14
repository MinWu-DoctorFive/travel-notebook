import { addMinutes, newBlankTrip, minutesBetween, type StopKind, type TripDocument, type TripInput, type TripStop } from "./travel";
import { parseTripDocument } from "./validation";

type AiStop={kind?:string;title?:string;place?:string;durationMin?:number;travelMin?:number;description?:string;highlights?:string[];photoTip?:string;caution?:string;priority?:number;sourceUrl?:string;earliestStart?:string};
type AiDay={title?:string;lodgingArea?:string;stops?:AiStop[]};
type AiPlan={title?:string;days?:AiDay[];generalTips?:string[]};
const bounded=(v:unknown,fallback:number,min:number,max:number)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Math.round(Number(v)))):fallback;

export function normalizePlan(input:TripInput,raw:unknown):TripDocument {
  const ai=raw as AiPlan;
  if(!ai||!Array.isArray(ai.days))throw new Error("模型没有返回逐日攻略。");
  const trip=newBlankTrip(input);trip.title=String(ai.title||`${input.destination}游玩攻略`).slice(0,150);
  if(ai.days.length<trip.days.length)throw new Error("模型遗漏旅行日期，请重新生成。");
  trip.days=trip.days.map((day,index)=>{
    const source=ai.days![index];if(!source||!Array.isArray(source.stops)||!source.stops.length)throw new Error("模型返回了空白行程。");
    const isLast=index===trip.days.length-1;
    const begin=index===0?input.departureAt:`${day.date}T${isLast&&input.returnDepartureAt.slice(11)<"09:00"?"06:00":"09:00"}`;
    const deadline=isLast?input.returnDepartureAt:`${day.date}T23:30`;
    const capacity=minutesBetween(begin,deadline);
    const stops:TripStop[]=source.stops.slice(0,40).map(value=>{
      const kind=(["travel","sight","meal","rest","lodging"] as string[]).includes(String(value.kind))?value.kind as StopKind:"sight";
      return {id:crypto.randomUUID(),kind,title:String(value.title||"游玩点").slice(0,150),place:String(value.place||value.title||input.destination).slice(0,300),startAt:begin,endAt:begin,durationMin:bounded(value.durationMin,45,10,600),travelMin:bounded(value.travelMin,0,0,600),description:String(value.description||"").slice(0,3000),highlights:Array.isArray(value.highlights)?value.highlights.slice(0,12).map(v=>String(v).slice(0,300)):[],photoTip:String(value.photoTip||"").slice(0,1000),caution:String(value.caution||"").slice(0,1000),priority:bounded(value.priority,3,1,5),locked:false,sourceStatus:kind==="travel"?"estimated":"check",sourceUrl:typeof value.sourceUrl==="string"?value.sourceUrl.trim():""};
    });
    const earliest=new Map(stops.map((stop,i)=>{const rawTime=source.stops![i].earliestStart;const time=typeof rawTime==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime)?rawTime:stop.kind==="meal"&&/午/.test(stop.title)?"11:30":stop.kind==="meal"&&/晚/.test(stop.title)?"17:30":"";return [stop.id,time?`${day.date}T${time}`:""]}));
    const total=()=>{let cursor=begin;for(const stop of stops){cursor=addMinutes(cursor,stop.travelMin);const preferred=earliest.get(stop.id);if(preferred&&preferred>cursor)cursor=preferred;cursor=addMinutes(cursor,stop.durationMin);}return minutesBetween(begin,cursor);};
    // Preserve travel, meals and accommodation. Trim flexible sights/rests first.
    for(const item of [...stops].sort((a,b)=>a.priority-b.priority)){
      if(total()<=capacity)break;
      if(item.priority>=5||!["sight","rest"].includes(item.kind))continue;
      const minimum=item.kind==="rest"?10:20;
      const reduction=Math.min(Math.max(0,item.durationMin-minimum),total()-capacity);
      if(reduction>0){item.durationMin-=reduction;trip.removedForTime.push(`缩短：${item.title}（${reduction} 分钟）`);}
    }
    while(total()>capacity){const candidates=stops.filter(s=>s.priority<5&&["sight","rest"].includes(s.kind)).sort((a,b)=>a.priority-b.priority);const item=candidates[0];if(!item)throw new Error("必去看点与必要交通无法在指定时段内完成，请延长时间或减少目的地。");stops.splice(stops.indexOf(item),1);trip.removedForTime.push(`移除：${item.title}`);}
    let cursor=begin;for(const stop of stops){cursor=addMinutes(cursor,stop.travelMin);const preferred=earliest.get(stop.id);if(preferred&&preferred>cursor)cursor=preferred;stop.startAt=cursor;cursor=addMinutes(cursor,stop.durationMin);stop.endAt=cursor;}
    if(isLast)stops.push({id:crypto.randomUUID(),kind:"return",title:"开始返程",place:input.origin,startAt:input.returnDepartureAt,endAt:input.returnDepartureAt,durationMin:0,travelMin:0,description:"按指定时刻从目的地出发。出发前在高德核对当前路线或换乘安排。",highlights:[],photoTip:"",caution:"",sourceStatus:"estimated",sourceUrl:"",locked:true,priority:5});
    return {...day,title:String(source.title||day.title).slice(0,200),lodgingArea:isLast?undefined:String(source.lodgingArea||"建议选择次日首站附近、便于公共交通到达的住宿区域，预订前核对评价与退改规则。").slice(0,1000),stops};
  });
  trip.generalTips=Array.isArray(ai.generalTips)?ai.generalTips.slice(0,25).map(t=>String(t).slice(0,1500)):[];
  return parseTripDocument(trip);
}

export function reorderStops(trip:TripDocument,dayIndex:number,from:number,to:number):TripDocument {
  const next=structuredClone(trip);const day=next.days[dayIndex];const begin=day.stops[0]?.startAt;
  if(!begin||!day.stops[from]||!day.stops[to]||day.stops[from].kind==="return"||day.stops[to].kind==="return")return next;
  const firstMove=day.stops[0].travelMin;
  [day.stops[from],day.stops[to]]=[day.stops[to],day.stops[from]];
  let cursor=addMinutes(begin,-firstMove);
  for(const stop of day.stops){if(stop.kind==="return")break;cursor=addMinutes(cursor,stop.travelMin);stop.startAt=cursor;cursor=addMinutes(cursor,stop.durationMin);stop.endAt=cursor;}
  return parseTripDocument(next);
}
