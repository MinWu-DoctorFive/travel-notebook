import { z } from "zod";
import { chinaDate, formatLocal, minutesBetween, validateInput, type TripDocument, type TripInput } from "./travel.ts";

const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(v => Number.isFinite(chinaDate(v).getTime()) && formatLocal(chinaDate(v))===v, "时间无效");
const text = (max:number) => z.string().max(max);
const link = z.string().refine(v => v === "" || /^https:\/\//.test(v) && (()=>{try{return !!new URL(v).hostname}catch{return false}})(), "来源链接必须使用 HTTPS");
const stopSchema = z.object({
  id:text(100).min(1), kind:z.enum(["travel","sight","meal","rest","lodging","return"]),
  title:text(150).min(1),place:text(300),startAt:dateTime,endAt:dateTime,
  durationMin:z.number().finite().min(0).max(1440),travelMin:z.number().finite().min(0).max(720),
  description:text(3000),highlights:z.array(text(300)).max(20),photoTip:text(1000),caution:text(1000),
  sourceStatus:z.enum(["sourced","estimated","check"]),sourceUrl:link,locked:z.boolean(),priority:z.number().int().min(1).max(5),
  completed:z.boolean().optional(),
});
const inputSchema=z.object({origin:text(300).min(1),destination:text(300).min(1),departureAt:dateTime,returnDepartureAt:dateTime,mode:z.enum(["drive","transit"]),partySize:z.number().int().min(1).max(20),budgetYuan:z.number().finite().min(0).optional(),interests:text(1500),constraints:text(1500),returnLocation:text(300).optional(),returnOrigin:text(300).optional(),arriveBy:dateTime.or(z.literal("")).optional(),lodging:text(1000).optional(),walking:z.enum(["easy","normal","active"]).optional()});
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 64 * 1024 * 1024;
export function isSafeImageUrl(value: string): boolean {
  if (/^\/(?:[A-Za-z0-9_-]+\/)*hebei-(cover|day)\.(png|webp)$/.test(value)) return true;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= MAX_IMAGE_BYTES;
}
const imageUrl=z.string().refine(isSafeImageUrl,"图片地址无效或超过 3 MiB");
const photoKey=z.string().refine(isSafeImageUrl,"照片地址无效或超过 3 MiB");
const tripSchema=z.object({
  id:text(100).min(1),title:text(200).min(1),input:inputSchema,status:z.enum(["planned","traveling","completed"]),
  days:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),title:text(200),imageUrl:imageUrl.optional(),lodgingArea:text(1000).optional(),stops:z.array(stopSchema).max(60)})).min(1).max(14),
  generalTips:z.array(text(1500)).max(30),coverUrl:imageUrl.optional(),removedForTime:z.array(text(200)).max(100),
  actual:z.object({visitNotes:text(10000),spentYuan:z.number().finite().min(0).optional(),actualDepartureAt:dateTime.or(z.literal("")).optional(),actualReturnAt:dateTime.or(z.literal("")).optional(),photoKeys:z.array(photoKey).max(12)}),
  createdAt:text(100),updatedAt:text(100),
  template:z.enum(["practical","journal","share"]).optional(),
  mapDays:z.record(z.object({image:imageUrl.optional(),points:z.array(z.object({id:text(100),name:text(300),location:z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)})).max(60),checkedAt:text(100),warnings:z.array(text(1000)).max(30)})).optional(),
});

export function parseTripInput(value:unknown):TripInput {
  const result=inputSchema.safeParse(value);if(!result.success)throw new Error("请填写有效的地点、时间、人数和偏好。");
  const error=validateInput(result.data);if(error)throw new Error(error);return result.data;
}

export function parseTripPatch(value:unknown):Partial<TripInput> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('识别结果不是有效的条件对象。');
  const patch=Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null&&v!==undefined));
  for(const key of ['partySize','budgetYuan'])if(typeof patch[key]==='string'&&/^\d+(?:\.\d+)?$/.test((patch[key] as string).trim()))patch[key]=Number(patch[key]);
  for(const key of ['interests','constraints'])if(Array.isArray(patch[key])&&(patch[key] as unknown[]).every(v=>typeof v==='string'))patch[key]=(patch[key] as string[]).join('、');
  for(const key of ['departureAt','returnDepartureAt','arriveBy'])if(typeof patch[key]==='string')patch[key]=(patch[key] as string).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::00)?$/,'$1T$2').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):00$/,'$1');
  const result=inputSchema.partial().safeParse(patch);if(!result.success)throw new Error(`识别结果中的${result.error.issues[0].path.join('.')}无效，请核对描述或手动填写。`);return result.data;
}

export function parseTripDocument(value:unknown):TripDocument {
  if (JSON.stringify(value)?.length > MAX_DOCUMENT_CHARS) throw new Error("攻略图片或内容过大，请减少照片后重试。");
  const result=tripSchema.safeParse(value);
  if(!result.success) throw new Error(`攻略内容不完整或格式错误：${result.error.issues[0].path.join(".")}。`);
  const trip=result.data;
  const error=validateInput(trip.input);if(error)throw new Error(error);
  const ids=new Set<string>();let previousDate="";let returns=0;
  const expectedDates:string[]=[];
  for(let at=Date.parse(`${trip.input.departureAt.slice(0,10)}T00:00:00Z`);at<=Date.parse(`${trip.input.returnDepartureAt.slice(0,10)}T00:00:00Z`);at+=86_400_000)expectedDates.push(new Date(at).toISOString().slice(0,10));
  if(trip.days.length!==expectedDates.length||trip.days.some((day,index)=>day.date!==expectedDates[index]))throw new Error("攻略必须覆盖出发至返程的每个自然日。");
  for(const day of trip.days){
    if(day.date<=previousDate||day.date<trip.input.departureAt.slice(0,10)||day.date>trip.input.returnDepartureAt.slice(0,10))throw new Error("行程日期需要按顺序排列，且处于旅行日期内。");
    previousDate=day.date;let previousEnd="";
    for(const stop of day.stops){
      if(ids.has(stop.id))throw new Error("游玩节点的编号重复。");ids.add(stop.id);
      if(stop.startAt.slice(0,10)!==day.date||stop.endAt.slice(0,10)!==day.date)throw new Error("游玩节点的时间须属于当天。");
      if(stop.startAt<trip.input.departureAt||stop.endAt>trip.input.returnDepartureAt)throw new Error("游玩项目超出出发与返程时间范围。");
      const duration=minutesBetween(stop.startAt,stop.endAt);
      if(!Number.isFinite(duration)||duration<0)throw new Error("结束时间不能早于开始时间。");
      if(previousEnd && minutesBetween(previousEnd,stop.startAt)<stop.travelMin)throw new Error("行程时段重叠或未留足移动时间。");
      if(stop.sourceStatus==="sourced"&&!stop.sourceUrl)throw new Error("标为有来源的项目需要核对链接。");
      if(stop.kind==="return"){
        returns++;if(stop.startAt!==trip.input.returnDepartureAt||stop.endAt!==stop.startAt||day.stops.at(-1)!==stop)throw new Error("返程节点须位于末尾，并遵守指定返程出发时刻。");
      } else if(Math.abs(duration-stop.durationMin)>1) throw new Error("停留时长与起止时间不一致。");
      previousEnd=stop.endAt;
    }
  }
  if(returns!==1||trip.days.at(-1)?.date!==trip.input.returnDepartureAt.slice(0,10))throw new Error("攻略需要保留最后一天的返程节点。");
  return trip;
}
