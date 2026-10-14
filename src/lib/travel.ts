export type TravelMode = "drive" | "transit";
export type SourceStatus = "sourced" | "estimated" | "check";
export type StopKind = "travel" | "sight" | "meal" | "rest" | "lodging" | "return";

export type TripInput = {
  origin: string;
  destination: string;
  departureAt: string;
  returnDepartureAt: string;
  mode: TravelMode;
  partySize: number;
  budgetYuan?: number;
  interests: string;
  constraints: string;
};

export type TripStop = {
  id: string;
  kind: StopKind;
  title: string;
  place: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  travelMin: number;
  description: string;
  highlights: string[];
  photoTip: string;
  caution: string;
  sourceStatus: SourceStatus;
  sourceUrl: string;
  locked: boolean;
  priority: number;
};

export type TripDay = {
  date: string;
  title: string;
  imageUrl?: string;
  lodgingArea?: string;
  stops: TripStop[];
};

export type ActualRecord = {
  visitNotes: string;
  spentYuan?: number;
  actualDepartureAt?: string;
  actualReturnAt?: string;
  photoKeys: string[];
};

export type TripDocument = {
  id: string;
  title: string;
  input: TripInput;
  status: "planned" | "traveling" | "completed";
  days: TripDay[];
  generalTips: string[];
  coverUrl?: string;
  removedForTime: string[];
  actual: ActualRecord;
  createdAt: string;
  updatedAt: string;
};

export function chinaDate(value: string): Date {
  return new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}:00+08:00`);
}

export function formatLocal(date: Date): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

export function addMinutes(value: string, minutes: number): string {
  return formatLocal(new Date(chinaDate(value).getTime() + minutes * 60_000));
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((chinaDate(end).getTime() - chinaDate(start).getTime()) / 60_000);
}

export function validateInput(value: TripInput): string | null {
  if (!value.origin?.trim() || !value.destination?.trim()) return "请填写出发地和目的地。";
  if (!["drive", "transit"].includes(value.mode)) return "请选择出行方式。";
  if (!Number.isInteger(value.partySize) || value.partySize < 1 || value.partySize > 20) return "人数应为 1–20 人。";
  const start = chinaDate(value.departureAt);
  const end = chinaDate(value.returnDepartureAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "请填写有效的出发和返程时间。";
  if (end <= start) return "返程出发时间应晚于出发时间。";
  if (Date.parse(value.returnDepartureAt.slice(0,10))-Date.parse(value.departureAt.slice(0,10)) >= 14 * 86_400_000) return "单次攻略最多规划 14 个自然日。";
  if (value.budgetYuan !== undefined && (!Number.isFinite(value.budgetYuan) || value.budgetYuan < 0)) return "预算不能为负数。";
  return null;
}

export function newBlankTrip(input: TripInput): TripDocument {
  const now = new Date().toISOString();
  const dates:string[]=[];
  for(let at=Date.parse(`${input.departureAt.slice(0,10)}T00:00:00Z`);at<=Date.parse(`${input.returnDepartureAt.slice(0,10)}T00:00:00Z`);at+=86_400_000) dates.push(new Date(at).toISOString().slice(0,10));
  return {
    id: crypto.randomUUID(),
    title: `${input.destination}游玩攻略`,
    input,
    status: "planned",
    days: dates.map((date,i)=>({ date, title: `第${i+1}天`, stops: i===dates.length-1?[seedStop(crypto.randomUUID(),"return","开始返程",input.origin,input.returnDepartureAt,input.returnDepartureAt,"按指定时间从目的地出发。",[])]:[] })),
    generalTips: ["出行前请核对目的地开放安排和天气。"],
    removedForTime: [],
    actual: { visitNotes: "", photoKeys: [] },
    createdAt: now,
    updatedAt: now,
  };
}

function seedStop(id: string, kind: StopKind, title: string, place: string, startAt: string, endAt: string, description: string, highlights: string[], photoTip = "", caution = "", priority = 3): TripStop {
  return { id, kind, title, place, startAt, endAt, durationMin: minutesBetween(startAt, endAt), travelMin: 0, description, highlights, photoTip, caution, sourceStatus: "check", sourceUrl: "", locked: false, priority };
}

export const HEBEI_SEED: TripDocument = {
  id: "hebei-art",
  title: "河北美院 · 2026 年国庆历史行程示例",
  input: {
    origin: "石家庄",
    destination: "河北美术学院",
    departureAt: "2026-10-06T12:30",
    returnDepartureAt: "2026-10-06T20:30",
    mode: "drive",
    partySize: 1,
    interests: "建筑、美术展、城堡湖景、拍照",
    constraints: "先逛鸡鸣城，再到城堡区；傍晚留足拍照时间",
  },
  status: "planned",
  days: [{
    date: "2026-10-06",
    title: "中式古城与湖畔城堡",
    imageUrl: "/hebei-day.png",
    stops: [
      seedStop("seed-1", "travel", "从石家庄出发", "河北美术学院鸡鸣城北门", "2026-10-06T12:30", "2026-10-06T13:40", "按自驾约一小时安排，实际拥堵和停车时间以高德为准。2026 年国庆公开游览信息指定鸡鸣城北门为入口。", ["出发前确认停车点", "从鸡鸣城北门进入"], "", "路程与停车时间为估算；到达前再核对当天现场指引。", 5),
      seedStop("seed-2", "sight", "鸡鸣城：从城门慢慢走入古街", "河北美术学院鸡鸣城", "2026-10-06T13:40", "2026-10-06T14:30", "先看城门与街巷的层次，再沿院落和门洞走一圈，留意中式建筑细节。", ["城门纵深", "巷道与院落", "门洞框景"], "站在门洞内向外取景，留出建筑纵深。", "入校方式和可进入区域请以学校现场安排为准。", 4),
      seedStop("seed-3", "travel", "前往城堡区域", "河北美术学院南区", "2026-10-06T14:30", "2026-10-06T15:00", "沿校内允许的路线前往南区，途中可以看雕塑，但把主要时间留给城堡和展览。", ["沿路雕塑"], "", "校内通行路线可能调整，听从现场指引。", 3),
      seedStop("seed-4", "sight", "城堡湖畔：先看全景再走近", "河北美术学院城堡区", "2026-10-06T15:00", "2026-10-06T16:00", "先在湖对岸看塔楼与建筑整体，再沿湖岸走近，依次看连桥、门洞和立面细节。", ["湖对岸全景", "尖塔", "连桥与门洞"], "湖面平静时试拍城堡倒影；近景用尖塔做竖构图。", "临水区域注意安全。", 5),
      seedStop("seed-5", "sight", "美术馆：看大学生美术作品展", "河北美术学院南区美术馆", "2026-10-06T16:00", "2026-10-06T16:50", "中国美术家协会报道，该馆已于 2026 年 9 月 30 日开幕“绽放——第三届全国大学生美术作品展览进京展巡展”。按现场开放展厅选择一至两个重点观看。", ["青年作品", "喜欢的作品"], "", "当日入馆时间、展厅和参观规则仍须现场核对。", 4),
      seedStop("seed-6", "sight", "回到湖边：看傍晚光线", "河北美术学院城堡湖畔", "2026-10-06T16:50", "2026-10-06T18:20", "沿湖边换不同角度拍城堡，日光变柔后再拍全景；如现场允许，稍等灯光亮起。", ["湖边散步", "傍晚建筑", "夜幕全景"], "人像可用拱门或树木作前景，不必在人多的固定机位久等。", "夜景开放及亮灯安排请现场确认。", 5),
      seedStop("seed-7", "meal", "晚饭：先看附近再决定", "河北美术学院周边或新乐市区", "2026-10-06T18:30", "2026-10-06T19:30", "可尝试当地风味，也可去新乐市区找适合的一顿正餐；具体店铺营业情况在高德核对。", ["缸炉烧饼", "扒糕", "当地家常菜"], "", "节日期间排队与营业安排可能变化。", 2),
      seedStop("seed-8", "return", "开始返程", "石家庄", "2026-10-06T20:30", "2026-10-06T20:30", "出发前在高德重新查看路况。", [], "", "", 5),
    ],
  }],
  generalTips: ["这是一份 2026 年 10 月 6 日的历史行程示例，并不表示已经出行；开放政策、展览、路线和商家均须按实际旅行日期重新核对。", "2026 年 10 月 1—7 日当时的公开信息称免费开放、从鸡鸣城北门进入；这一安排不代表其他日期仍适用。", "穿舒适的鞋，备饮水；温差请以出行当天预报为准。"],
  coverUrl: "/hebei-cover.png",
  removedForTime: [],
  actual: { visitNotes: "", photoKeys: [] },
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};

const hebeiOpenSource = "https://finance.sina.com.cn/wm/2026-09-23/doc-inisvqct5919174.shtml";
for (const index of [0,1,2,3,5]) { HEBEI_SEED.days[0].stops[index].sourceStatus = index===0 ? "estimated" : "sourced"; HEBEI_SEED.days[0].stops[index].sourceUrl = hebeiOpenSource; }
HEBEI_SEED.days[0].stops[4].sourceStatus = "sourced";
HEBEI_SEED.days[0].stops[4].sourceUrl = "https://www.caanet.org.cn/newsdetail.mx?id=10399";
HEBEI_SEED.days[0].stops[7].sourceStatus = "estimated";

export function amapSearchUrl(place: string, city?: string): string {
  const query = new URLSearchParams({ keyword: place, view: "list", callnative: "1", src: "travel-notebook" });
  if (city) query.set("city", city);
  return `https://uri.amap.com/search?${query.toString()}`;
}

export function redactedTrip(trip: TripDocument): TripDocument {
  const origin=trip.input.origin;
  const city=origin.match(/^(.*?市)/)?.[1] || (origin.startsWith("石家庄")?"石家庄":"");
  const publicOrigin=city||"出发地已隐藏";
  const privateTokens=[origin,city?origin.slice(city.length):"",trip.input.constraints].filter(v=>v.trim().length>=2);
  const scrub=(value:string)=>privateTokens.reduce((text,token)=>text.replaceAll(token,token===origin?publicOrigin:"[私人信息已隐藏]"),value);
  const safeSource=(url:string)=>privateTokens.some(t=>url.includes(t)||url.includes(encodeURIComponent(t)))?"":url;
  const result:TripDocument = {
    ...trip,
    title:scrub(trip.title),
    input: { ...trip.input, origin: publicOrigin, constraints: "", interests:"", budgetYuan: undefined },
    days: trip.days.map(day => ({...day,title:scrub(day.title),imageUrl:day.imageUrl?.startsWith("data:")?undefined:day.imageUrl,lodgingArea:day.lodgingArea?scrub(day.lodgingArea):undefined, stops:day.stops.map(stop=>({...stop,title:scrub(stop.title),place:scrub(stop.place),description:scrub(stop.description),highlights:stop.highlights.map(scrub),photoTip:scrub(stop.photoTip),caution:scrub(stop.caution),sourceUrl:safeSource(stop.sourceUrl)}))})),
    generalTips:trip.generalTips.map(scrub),removedForTime:trip.removedForTime.map(scrub),
    coverUrl:trip.coverUrl?.startsWith("data:")?undefined:trip.coverUrl,
    actual: { visitNotes: "", photoKeys: [] },
  };
  return result;
}

