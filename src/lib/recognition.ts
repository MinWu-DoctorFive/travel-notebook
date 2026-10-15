import type { TripInput } from './travel';
import { formatLocal } from './travel';
export type Recognized = Partial<TripInput>;
export const FIELD_NAMES:Record<keyof TripInput,string>={origin:'出发地点',destination:'目的地',departureAt:'出发时间',returnDepartureAt:'开始返程',mode:'出行方式',partySize:'同行人数',budgetYuan:'总预算',interests:'兴趣偏好',constraints:'其他限制',returnLocation:'返回地点',returnOrigin:'返程出发地',arriveBy:'最晚到达',lodging:'住宿要求',walking:'步行偏好'};

/** Conservative local recognition handles explicit common phrases without an API charge. */
export function recognizeLocal(text:string,now=new Date()):Recognized {
  const result:Recognized={};let date=formatLocal(now).slice(0,10);
  const explicit=/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/.exec(text);
  if(explicit)date=`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;
  else if(/后天|明天|今天/.test(text)){const d=new Date(`${date}T12:00:00+08:00`);d.setTime(d.getTime()+(/后天/.test(text)?2:/明天/.test(text)?1:0)*86400000);date=formatLocal(d).slice(0,10);}
  if(/自驾|开车/.test(text))result.mode='drive';else if(/公交|地铁|公共交通|高铁|火车/.test(text))result.mode='transit';
  const party=/(\d{1,2}|一|两|二|三|四|五|六|七|八|九|十)\s*(?:个)?人/.exec(text);if(party){const n:Record<string,number>={一:1,两:2,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};result.partySize=n[party[1]]||Number(party[1]);}
  const budget=/(?:总预算|预算)\s*(\d+(?:\.\d+)?)\s*元?/.exec(text);if(budget)result.budgetYuan=Number(budget[1]);
  const origin=/从\s*([^，。,；;\n]{1,40}?)(?:出发|前往|去)/.exec(text);if(origin)result.origin=origin[1].trim();
  const destination=/(?:去|前往|目的地[是为：:]?)\s*([^，。,；;\n]{1,40})/.exec(text);if(destination)result.destination=destination[1].replace(/(?:游玩|玩一.*|旅行|旅游)$/,'').trim();
  const timePattern=/(上午|下午|晚上|早上|中午)?\s*(\d{1,2})(?:点|[:：])(?:(\d{1,2})(?:分)?)?[^，。,；;\n\d]{0,35}?(出发|返程|返回|回程)/g;
  for(const match of text.matchAll(timePattern)){let hour=Number(match[2]);if(/下午|晚上/.test(match[1]||'')&&hour<12)hour+=12;if(match[1]==='中午'&&hour<11)hour+=12;const minute=Number(match[3]||0);if(hour>23||minute>59)continue;const value=`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;if(match[4]==='出发')result.departureAt=value;else result.returnDepartureAt=value;}
  if(/不住宿|当天往返/.test(text))result.lodging='不住宿';else if(/住一晚/.test(text))result.lodging='住宿一晚';
  if(/少走|别太赶|轻松/.test(text))result.walking='easy';else if(/多走|徒步/.test(text))result.walking='active';
  return result;
}
export function mergeRecognized(current:TripInput,patch:Recognized,protectedKeys:Set<keyof TripInput>,allowOverwrite=false):TripInput {
  return {...current,...Object.fromEntries(Object.entries(patch).filter(([key,value])=>value!==undefined&&(allowOverwrite||!protectedKeys.has(key as keyof TripInput))))};
}
