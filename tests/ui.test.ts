import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";

test("legacy manual import keeps confirmation and restorable backups", { timeout: 30_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://travel.example/#/new", pretendToBeVisual: true,
  });
  const previous: Record<string, PropertyDescriptor | undefined> = {};
  const globals = ["window", "document", "navigator", "location", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"] as const;
  for (const key of globals) previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const replacements: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.scrollTo = () => {};
  Object.defineProperty(dom.window.navigator, "serviceWorker", { value: { register: async () => ({}) }, configurable: true });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalTimeout = globalThis.setTimeout;
  const longTimers: ReturnType<typeof setTimeout>[] = [];
  globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
    const timer = originalTimeout(callback, delay, ...args);
    if ((delay || 0) >= 1_000) longTimers.push(timer);
    return timer;
  }) as typeof setTimeout;
  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  let downloaded: Blob | undefined;
  URL.createObjectURL = (blob: Blob | MediaSource) => { downloaded = blob as Blob; return "blob:travel-test"; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {
    if (this.download) return;
    originalClick.call(this);
  };

  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: App } = await import("../src/Legacy");
  const { listTrips, getTrip } = await import("../src/lib/store");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 15));
  const settle = async () => { await act(async () => { await tick(); }); };
  const button = (text: string): HTMLButtonElement => {
    const found = [...dom.window.document.querySelectorAll("button")].find(item => item.textContent?.trim().includes(text));
    assert(found, `Missing button: ${text}`);
    return found;
  };
  const change = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
    assert(descriptor?.set);
    await act(async () => {
      descriptor.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  const click = async (element: HTMLElement) => { await act(async () => { element.click(); await tick(); }); };
  const field = (name: string): HTMLInputElement => {
    const label = [...dom.window.document.querySelectorAll("label")].find(item => item.textContent?.trim().startsWith(name));
    const input = label?.querySelector("input");
    assert(input, `Missing input: ${name}`);
    return input;
  };

  try {
    await act(async () => { root.render(createElement(App)); await tick(); });
    await settle();
    assert.match(dom.window.document.body.textContent || "", /准备下一次出发/);
    await change(field("出发地址"), "石家庄");
    await change(field("目的地"), "北京");
    await change(field("出发时间"), "2026-10-20T07:30");
    await change(field("从目的地开始返程的时间"), "2026-10-20T19:00");
    await click(button("生成攻略请求"));
    const prompt = dom.window.document.querySelector<HTMLTextAreaElement>("textarea.prompt-text");
    assert(prompt?.value.includes("2026-10-20T19:00"));
    await click(button("我有结果，导入攻略"));
    await settle();
    assert.match(dom.window.document.body.textContent || "", /导入这段旅行的攻略/);

    const compact = {
      title: "北京城中漫步", days: [{ title: "北京一日", stops: [
        { kind: "travel", title: "抵达北京", place: "北京南站", durationMin: 60, travelMin: 0 },
        { kind: "sight", title: "故宫", place: "故宫博物院", durationMin: 120, travelMin: 30 },
      ] }], generalTips: ["提前核验门票"],
    };
    const importBox = dom.window.document.querySelector<HTMLTextAreaElement>("textarea.import-text");
    assert(importBox);
    await change(importBox, JSON.stringify(compact));
    await click(button("校验并预览攻略"));
    assert.match(dom.window.document.body.textContent || "", /确认这份攻略/);
    assert.equal((await listTrips()).length, 1, "preview must not write a trip");
    await click(button("确认保存新版本"));
    await settle();
    let trip = (await listTrips()).find(item => item.title === "北京城中漫步");
    assert(trip, "confirmed trip should exist");
    assert.match(dom.window.document.body.textContent || "", /故宫/);
    assert.equal(trip.days[0].stops.at(-1)?.startAt, "2026-10-20T19:00");

    const revised = structuredClone(trip);
    revised.title = "北京城中慢游";
    const adjustBox = dom.window.document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="粘贴完整 JSON"]');
    assert(adjustBox);
    await change(adjustBox, JSON.stringify(revised));
    await click(button("预览调整差异"));
    assert.match(dom.window.document.body.textContent || "", /北京城中慢游/);
    assert.equal((await getTrip(trip.id))?.trip.title, "北京城中漫步", "replan preview must not overwrite saved trip");
    await click(button("确认保存新版本"));
    await settle();
    trip = (await getTrip(trip.id))?.trip;
    assert.equal(trip?.title, "北京城中慢游");

    await click(dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="导出完整备份"]')!);
    assert(downloaded);
    const exported = JSON.parse(await downloaded.text()) as { schemaVersion: number; trips: Array<{ trip: { title: string } }> };
    assert.equal(exported.schemaVersion, 2);
    assert(exported.trips.some(item => item.trip.title === "北京城中慢游"));
  } finally {
    await act(async () => { root.unmount(); });
    for (const timer of longTimers) clearTimeout(timer);
    globalThis.setTimeout = originalTimeout;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.HTMLAnchorElement.prototype.click = originalClick;
    for (const key of globals) {
      if (!previous[key]) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, previous[key]);
    }
    dom.window.close();
  }
});
