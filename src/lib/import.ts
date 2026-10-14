import { normalizePlan } from "./planning";
import { parseTripDocument, parseTripInput } from "./validation";
import { parseJsonText } from "./store";
import type { TripDocument, TripInput, TripStop } from "./travel";

function checkedSourceUrl(value: string): void {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname) return;
  } catch { /* handled below */ }
  throw new Error("来源链接只能是 HTTPS 网页地址。");
}

function demoteUnverifiedSources(trip: TripDocument): TripDocument {
  for (const day of trip.days) for (const stop of day.stops) {
    checkedSourceUrl(stop.sourceUrl);
    if (stop.sourceStatus === "sourced") stop.sourceStatus = "check";
  }
  return trip;
}

function preserveCurrent(proposed: TripDocument, current: TripDocument, allowReturnChange = false): TripDocument {
  const next = structuredClone(proposed);
  next.id = current.id;
  next.createdAt = current.createdAt;
  next.status = current.status;
  next.actual = structuredClone(current.actual);
  next.coverUrl ||= current.coverUrl;
  for (const oldDay of current.days) {
    const day = next.days.find(item => item.date === oldDay.date);
    const locked = oldDay.stops.filter(stop => stop.locked && !(allowReturnChange && stop.kind === "return"));
    if (!day && locked.length) throw new Error("修改后的日期遗漏了锁定项目，请保留或先解锁。");
    if (!day) continue;
    day.imageUrl ||= oldDay.imageUrl;
    for (const stop of locked) {
      const index = day.stops.findIndex(candidate => candidate.id === stop.id ||
        (candidate.kind === stop.kind && candidate.title === stop.title && candidate.place === stop.place));
      if (index < 0) throw new Error(`修改后的攻略遗漏锁定项目「${stop.title}」，请让模型原样保留。`);
      day.stops[index] = structuredClone(stop);
    }
  }
  return parseTripDocument(next);
}

/** Parse pasted ChatGPT JSON for preview. This function never writes to IndexedDB. */
export function importPlan(text: string, input?: TripInput, currentTrip?: TripDocument): TripDocument {
  const parsed = parseJsonText(text);
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("请粘贴一份 JSON 攻略对象。");
  const value = (root.trip && typeof root.trip === "object" ? root.trip : root) as Record<string, unknown>;
  const desiredInput = input ? parseTripInput(input) : currentTrip?.input;
  const explicitInputChange = !!input && !!currentTrip && JSON.stringify(input) !== JSON.stringify(currentTrip.input);
  const allowReturnChange = explicitInputChange && input.returnDepartureAt !== currentTrip!.input.returnDepartureAt;
  let proposal: TripDocument;
  if ("input" in value && "actual" in value) {
    const raw = structuredClone(value) as unknown as TripDocument;
    // A caller usually passes the current input for context. Keep explicit changes
    // present in a complete AI reply, including a later departure time.
    if (currentTrip && !explicitInputChange && raw.input?.returnDepartureAt !== currentTrip.input.returnDepartureAt) {
      throw new Error("AI 调整不能自行更改返程时间；请先明确修改旅行条件，再重新导入。");
    }
    if (desiredInput && (!currentTrip || explicitInputChange)) raw.input = desiredInput;
    proposal = parseTripDocument(raw);
  } else {
    if (!desiredInput) throw new Error("精简攻略需要先填写出发地、目的地和时间。");
    proposal = normalizePlan(desiredInput, value);
  }
  proposal = demoteUnverifiedSources(proposal);
  if (currentTrip) return preserveCurrent(proposal, parseTripDocument(currentTrip), allowReturnChange);
  // Pasting the same full document twice must not overwrite an existing local trip.
  const now = new Date().toISOString();
  proposal.id = crypto.randomUUID();
  proposal.createdAt = now;
  proposal.updatedAt = now;
  return parseTripDocument(proposal);
}

function promptCopy(trip: TripDocument): object {
  return {
    id: trip.id,
    title: trip.title,
    input: trip.input,
    status: trip.status,
    days: trip.days.map(day => ({
      date: day.date,
      title: day.title,
      lodgingArea: day.lodgingArea,
      stops: day.stops.map((stop: TripStop) => ({
        id: stop.id, kind: stop.kind, title: stop.title, place: stop.place,
        startAt: stop.startAt, endAt: stop.endAt, durationMin: stop.durationMin,
        travelMin: stop.travelMin, description: stop.description, highlights: stop.highlights,
        photoTip: stop.photoTip, caution: stop.caution, sourceStatus: stop.sourceStatus,
        sourceUrl: stop.sourceUrl, locked: stop.locked, priority: stop.priority,
      })),
    })),
    generalTips: trip.generalTips,
    removedForTime: trip.removedForTime,
    // Private visit notes, spending, and embedded photographs stay in this browser.
    actual: { visitNotes: "", photoKeys: [] },
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}

/** A copyable ChatGPT prompt. No model account or API key is required by this site. */
export function getPrompt(input: TripInput, currentTrip?: TripDocument, change?: string): string {
  const valid = parseTripInput(input);
  const preferences = JSON.stringify(valid, null, 2);
  const common = [
    "请用中文制定可在手机上执行的详细旅行攻略，只回复一个 JSON 对象，不要 Markdown 代码围栏、解释或额外文字。",
    "必须覆盖从出发日期到返程日期的每个自然日，并保留最后一天指定时刻的返程节点。时间使用中国北京时间 YYYY-MM-DDTHH:mm。",
    "安排具体时间、景点、交通/公交换乘建议、餐食、过夜住宿区域、拍照建议与注意事项；自驾要考虑停车，公交要考虑班次和末班风险。",
    "交通耗时、开放时间、门票、营业和酒店价格会变化：仅能核实时写 HTTPS 来源链接；无法核实则在说明中明确标记‘待核实’，不能编造实时信息或假装已经预订。",
    "每个节点 durationMin 是停留分钟，travelMin 是从上一节点到本节点的移动分钟。总时长不得与下一项重叠，不得越过返程时刻。",
    "跨午夜的交通须按自然日拆分，分别写在当天和次日；具体车次、酒店和餐厅可写进 description，但不要编造可订状态。",
    "下列旅行条件为必须遵守的输入：",
    preferences,
  ];
  if (currentTrip) {
    const safeCurrent = promptCopy(parseTripDocument(currentTrip));
    return [
      ...common,
      `修改要求：${change?.trim() || "根据条件调整行程，保留有价值的安排。"}`,
      "请输出完整 TripDocument JSON，结构与下方当前攻略相同。保持 id、createdAt、status、actual 和所有 locked=true 节点的 id、日期、起止时间及内容。不得删除锁定节点。",
      "图片字段 coverUrl、imageUrl 可省略；不要输出外部图片 URL。sourceStatus 对未核实的事实写 check，sourceUrl 可留空。",
      "当前攻略（私人游记与照片已移除）：",
      JSON.stringify(safeCurrent, null, 2),
    ].join("\n\n");
  }
  return [
    ...common,
    "请输出以下精简 JSON 结构，days 数量必须等于自然日数量，stops 每天按游玩顺序列出；程序会自动计算具体起止时间并加上返程节点：",
    JSON.stringify({
      title: "目的地游玩攻略",
      days: [{
        title: "第一天",
        lodgingArea: "过夜住宿区域、交通和预订注意点；单日行程可省略",
        stops: [{
          kind: "travel|sight|meal|rest|lodging",
          title: "节点名称", place: "具体地点", durationMin: 60, travelMin: 20,
          earliestStart: "09:00", description: "玩法、交通路线及核实提醒",
          highlights: ["重点"], photoTip: "拍照建议", caution: "注意事项", sourceUrl: "可核对的 HTTPS 来源链接，无法提供则留空字符串", priority: 3,
        }],
      }],
      generalTips: ["全程注意事项"],
    }, null, 2),
    "kind 请在 travel、sight、meal、rest、lodging 中选一个；priority 取 1–5，5 代表不可删除。",
  ].join("\n\n");
}
