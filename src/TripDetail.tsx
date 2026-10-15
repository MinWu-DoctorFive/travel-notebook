import { useEffect, useState, type ChangeEvent } from "react";
import { addMinutes, amapSearchUrl, minutesBetween, type ActualRecord, type TripDocument, type TripInput, type TripStop } from "./lib/travel";
import { reorderStops } from "./lib/planning";
import { getPrompt, importPlan } from "./lib/import";
import { assetUrl } from "./lib/assets";
import type { Revision } from "./lib/store";
import StopEditor, { KIND_LABEL } from "./StopEditor";

type Props = {
  trip: TripDocument; revisions: Revision[];
  onSave: (trip: TripDocument, kind: string) => Promise<void>;
  onBack: () => void; onImportRevision: (trip: TripDocument) => void; notify: (message: string) => void;
};
type Selection = { day: number; index: number; stop: TripStop; isNew: boolean };
const SOURCE_LABEL = { sourced: "有来源", estimated: "估算", check: "待核验" };
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const lines = (value: string) => value.split("\n").map(item => item.trim()).filter(Boolean);
const imageLabel = (url: string) => url.startsWith("data:") ? "自选图片" : "AI 示意图";
const readableTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(date) : value;
};
function imageData(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return Promise.reject(new Error("请选择 JPG、PNG 或 WebP 图片。"));
  if (file.size > MAX_IMAGE_BYTES) return Promise.reject(new Error("单张图片须小于 3 MB，建议先在手机里压缩。"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

export default function TripDetail({ trip, revisions, onSave, onBack, onImportRevision, notify }: Props) {
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [editor, setEditor] = useState<Selection | null>(null);
  const [actual, setActual] = useState<ActualRecord>(() => structuredClone(trip.actual));
  const [metadata, setMetadata] = useState(() => ({ title: trip.title, status: trip.status, input: structuredClone(trip.input), tips: trip.generalTips.join("\n"), days: trip.days.map(day => ({ title: day.title, lodgingArea: day.lodgingArea || "" })) }));
  const [metadataError, setMetadataError] = useState("");
  const [change, setChange] = useState("");
  const [prompt, setPrompt] = useState("");
  const [json, setJson] = useState("");
  const [importError, setImportError] = useState("");
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    setActual(structuredClone(trip.actual));
    setMetadata({ title: trip.title, status: trip.status, input: structuredClone(trip.input), tips: trip.generalTips.join("\n"), days: trip.days.map(day => ({ title: day.title, lodgingArea: day.lodgingArea || "" })) });
    setMetadataError("");
  }, [trip]);

  async function persist(next: TripDocument, kind: string, message = "已保存在这台设备，并保留历史版本。") {
    setBusy(true);
    try { await onSave(next, kind); notify(message); }
    catch (error) { notify(error instanceof Error ? error.message : "保存失败，请重试。"); throw error; }
    finally { setBusy(false); }
  }
  const saveQuietly = (next: TripDocument, kind: string, message?: string) => { void persist(next, kind, message).catch(() => {}); };
  function openStop(day: number, index: number) { setEditor({ day, index, stop: structuredClone(trip.days[day].stops[index]), isNew: false }); }
  function addStop(day: number) {
    const value = trip.days[day];
    if (value.stops.length >= 60) { notify("这一天的节点较多，建议合并部分看点后再添加。"); return; }
    const index = value.stops.findIndex(stop => stop.kind === "return");
    const insertAt = index < 0 ? value.stops.length : index;
    const previous = value.stops[insertAt - 1];
    const startAt = previous?.endAt || (day === 0 ? trip.input.departureAt : `${value.date}T09:00`);
    const deadline = day === trip.days.length - 1 ? trip.input.returnDepartureAt : `${value.date}T23:59`;
    const available = minutesBetween(startAt, deadline);
    if (!Number.isFinite(available) || available < 1) { notify("这一天没有空余时段，请先缩短或调整已有节点。"); return; }
    const durationMin = Math.min(45, available);
    setEditor({ day, index: insertAt, isNew: true, stop: { id: crypto.randomUUID(), kind: "sight", title: "", place: trip.input.destination, startAt, endAt: addMinutes(startAt, durationMin), durationMin, travelMin: 0, description: "", highlights: [], photoTip: "", caution: "", sourceStatus: "check", sourceUrl: "", locked: false, priority: 3 } });
  }
  async function saveStop(stop: TripStop, shiftLater: boolean) {
    if (!editor) return;
    const next = structuredClone(trip), stops = next.days[editor.day].stops;
    if (editor.isNew) stops.splice(editor.index, 0, stop); else stops[editor.index] = stop;
    if (shiftLater) {
      let cursor = stop.endAt;
      for (const following of stops.slice(editor.index + 1)) {
        if (following.kind === "return") break;
        following.startAt = addMinutes(cursor, following.travelMin);
        following.endAt = addMinutes(following.startAt, following.durationMin);
        cursor = following.endAt;
      }
    }
    await persist(next, editor.isNew ? "add-stop" : "edit-stop"); setEditor(null);
  }
  async function removeStop() {
    if (!editor) return;
    const next = structuredClone(trip), stop = next.days[editor.day].stops[editor.index];
    if (stop.locked || stop.kind === "return") throw new Error("锁定看点和返程节点不能移除，请先解锁看点。");
    next.days[editor.day].stops.splice(editor.index, 1);
    await persist(next, "remove-stop"); setEditor(null);
  }
  function moveStop(day: number, from: number, to: number) {
    try { saveQuietly(reorderStops(trip, day, from, to), "reorder"); }
    catch (error) { notify(error instanceof Error ? error.message : "顺序调整失败。"); }
  }
  function toggleLock(day: number, index: number) {
    const next = structuredClone(trip), stop = next.days[day].stops[index];
    if (stop.kind === "return") return;
    stop.locked = !stop.locked; saveQuietly(next, "lock-stop", stop.locked ? "已锁定这个必去看点。" : "已取消锁定。");
  }
  const editInput = <K extends keyof TripInput>(key: K, value: TripInput[K]) => setMetadata(old => ({ ...old, input: { ...old.input, [key]: value } }));
  async function saveMetadata() {
    setMetadataError("");
    try {
      if (metadata.input.departureAt.slice(0, 10) !== trip.input.departureAt.slice(0, 10) || metadata.input.returnDepartureAt.slice(0, 10) !== trip.input.returnDepartureAt.slice(0, 10)) {
        throw new Error("这里可修改原旅行日期内的时间。需要更换出发或返程日期时，请新建一份计划，重新安排逐日行程。");
      }
      const next = structuredClone(trip); next.title = metadata.title.trim(); next.status = metadata.status; next.input = structuredClone(metadata.input); next.generalTips = lines(metadata.tips);
      next.days.forEach((day, index) => {
        day.title = metadata.days[index].title.trim(); day.lodgingArea = index === next.days.length - 1 ? undefined : metadata.days[index].lodgingArea.trim() || undefined;
        for (const stop of day.stops) if (stop.kind === "return") Object.assign(stop, { startAt: next.input.returnDepartureAt, endAt: next.input.returnDepartureAt, durationMin: 0, travelMin: 0, locked: true, priority: 5, place: next.input.returnLocation || next.input.origin });
      });
      await persist(next, "trip-info");
    } catch (error) { setMetadataError(error instanceof Error ? error.message : "保存失败，请检查时间与游玩安排。"); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>, purpose: "cover" | "actual") {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (purpose === "actual" && actual.photoKeys.length >= 12) { notify("最多保存 12 张游后照片，建议只选最值得记住的几张。"); return; }
    setBusy(true);
    try {
      const url = await imageData(file), next = structuredClone(trip);
      if (purpose === "cover") next.coverUrl = url;
      else next.actual = { ...actual, photoKeys: [...actual.photoKeys, url] };
      await onSave(next, purpose === "cover" ? "cover" : "actual-photo");
      notify(purpose === "cover" ? "封面已保存。" : "照片与记录已保存。建议定期导出备份。");
    } catch (error) { notify(error instanceof Error ? error.message : "图片未保存，请重试。"); }
    finally { setBusy(false); }
  }
  async function copyPrompt() {
    const text = getPrompt(trip.input, trip, change.trim()); setPrompt(text);
    try { await navigator.clipboard.writeText(text); notify("调整提示词已复制。到你常用的 AI 对话中粘贴并生成 JSON。"); }
    catch { notify("可在下方长按提示词全选复制。"); }
  }
  function importAdjusted() {
    setImportError("");
    try {
      onImportRevision(importPlan(json, trip.input, trip));
    } catch (error) { setImportError(error instanceof Error ? error.message : "请粘贴 AI 返回的完整 JSON 攻略。"); }
  }

  return <div className="trip-page">
    <div className="trip-hero">
      {trip.coverUrl && <img src={assetUrl(trip.coverUrl)} alt={`${trip.input.destination}旅程封面`} />}
      <div className="trip-hero-shade" />
      <div className="trip-hero-content">
        <button type="button" className="hero-back" disabled={busy} onClick={onBack}>← 我的攻略</button>
        <div className="hero-tags"><span>{trip.days.length} 日游</span><span>{trip.input.mode === "drive" ? "自驾" : "公共交通"}</span><span>{trip.status === "completed" ? "已完成" : trip.status === "traveling" ? "旅行中" : "计划中"}</span></div>
        <h1>{trip.title}</h1><p>{trip.input.destination} · {trip.input.departureAt.slice(0, 10)} 出发</p>
        {trip.coverUrl && <small>{imageLabel(trip.coverUrl)}</small>}
      </div>
    </div>
    <div className="trip-body">
      {!online && <div className="notice-box">当前离线：可以继续阅读和修改，保存到这台设备。使用 AI 对话与高德查地点时需要联网。</div>}
      <div className="trip-intro"><p>从 {trip.input.origin} 出发</p><strong>{trip.input.departureAt.replace("T", " ")} → {trip.input.returnDepartureAt.replace("T", " ")}</strong><p className="form-note">返程时间指从目的地出发。交通耗时为估算；高德按钮打开关键词搜索，选中地点后查看路线。</p></div>
      {trip.removedForTime.length > 0 && <div className="notice-box"><strong>已采纳的时间取舍</strong><p>{trip.removedForTime.join("、")}</p></div>}

      <details className="work-section"><summary>编辑行程信息与封面</summary>
        <label>攻略标题<input value={metadata.title} maxLength={200} disabled={busy} onChange={event => setMetadata(old => ({ ...old, title: event.target.value }))} /></label>
        <label>行程状态<select value={metadata.status} disabled={busy} onChange={event => setMetadata(old => ({ ...old, status: event.target.value as TripDocument["status"] }))}><option value="planned">计划中</option><option value="traveling">旅行中</option><option value="completed">已完成</option></select></label>
        <div className="field-grid">
          <label>出发地址<input value={metadata.input.origin} maxLength={300} disabled={busy} autoComplete="off" onChange={event => editInput("origin", event.target.value)} /></label>
          <label>目的地<input value={metadata.input.destination} maxLength={300} disabled={busy} onChange={event => editInput("destination", event.target.value)} /></label>
          <label>出发时间<input type="datetime-local" value={metadata.input.departureAt} disabled={busy} onChange={event => editInput("departureAt", event.target.value)} /></label>
          <label>从目的地开始返程的时间<input type="datetime-local" value={metadata.input.returnDepartureAt} disabled={busy} onChange={event => editInput("returnDepartureAt", event.target.value)} /></label>
          <label>出行方式<select value={metadata.input.mode} disabled={busy} onChange={event => editInput("mode", event.target.value as TripInput["mode"])}><option value="drive">自驾</option><option value="transit">公共交通</option></select></label>
          <label>同行人数<input type="number" min="1" max="20" value={metadata.input.partySize} disabled={busy} onChange={event => editInput("partySize", Number(event.target.value))} /></label>
        </div>
        <label>总预算（元，选填）<input type="number" min="0" value={metadata.input.budgetYuan ?? ""} disabled={busy} onChange={event => editInput("budgetYuan", event.target.value ? Number(event.target.value) : undefined)} /></label>
        <label>兴趣与偏好<textarea value={metadata.input.interests} maxLength={1500} disabled={busy} onChange={event => editInput("interests", event.target.value)} /></label>
        <label>必去地点与其他限制<textarea value={metadata.input.constraints} maxLength={1500} disabled={busy} onChange={event => editInput("constraints", event.target.value)} /></label>
        <p className="form-note">可以修改原旅行日期内的出发与返程时间，固定返程节点会同步更新。已有游玩时段保留；若发生冲突，先调整节点或通过下方 AI 流程重排。更换日期请新建计划。修改目的地或交通方式后，也请核对已有看点和移动时间。</p>
        {metadata.days.map((day, index) => <div key={trip.days[index].date}>
          <label>第 {index + 1} 天标题<input value={day.title} disabled={busy} maxLength={200} onChange={event => setMetadata(old => ({ ...old, days: old.days.map((value, i) => i === index ? { ...value, title: event.target.value } : value) }))} /></label>
          {index < metadata.days.length - 1 && <label>第 {index + 1} 晚住宿区域建议<textarea value={day.lodgingArea} maxLength={1000} disabled={busy} onChange={event => setMetadata(old => ({ ...old, days: old.days.map((value, i) => i === index ? { ...value, lodgingArea: event.target.value } : value) }))} placeholder="写下住宿区域、选择理由、交通便利性" /></label>}
        </div>)}
        <label>出行提醒（每行一条）<textarea value={metadata.tips} disabled={busy} onChange={event => setMetadata(old => ({ ...old, tips: event.target.value }))} /></label>
        {metadataError && <p className="error-box" role="alert">{metadataError}</p>}
        <div className="form-actions"><button type="button" className="button-primary" disabled={busy || !metadata.title.trim()} onClick={() => { void saveMetadata(); }}>保存行程信息</button></div>
        <label className="photo-upload">选择本机图片作为封面<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { void upload(event, "cover"); }} /></label>
        <p className="form-note">JPG、PNG 或 WebP，单张不超过 3 MB。登录私人空间后，封面与照片会保存到你的私人云端。</p>
        {trip.coverUrl && <button type="button" className="button-plain" disabled={busy} onClick={() => { const next = structuredClone(trip); delete next.coverUrl; saveQuietly(next, "remove-cover"); }}>移除封面</button>}
      </details>

      {trip.days.map((day, dayIndex) => <section className="day-section" key={day.date}>
        <div className="day-heading"><span>DAY {String(dayIndex + 1).padStart(2, "0")}</span><h2>{day.title}</h2><p>{day.date}</p></div>
        <button type="button" className="button-plain add-stop" disabled={busy} onClick={() => addStop(dayIndex)}>＋ 添加游玩点</button>
        {day.imageUrl && <figure className="day-image"><img loading="lazy" src={assetUrl(day.imageUrl)} alt={`${day.title}插画`} /><figcaption>{imageLabel(day.imageUrl)}</figcaption></figure>}
        <div className="timeline">{day.stops.map((stop, index) => <article className="stop" key={stop.id}>
          <div className="time-col"><strong>{stop.startAt.slice(11, 16)}</strong><span>{stop.endAt.slice(11, 16)}</span></div><div className="rail"><span /></div>
          <div className="stop-card"><div className="stop-top"><span className={`kind kind-${stop.kind}`}>{KIND_LABEL[stop.kind]}</span><span className={`source source-${stop.sourceStatus}`}>{SOURCE_LABEL[stop.sourceStatus]}</span></div>
            <h3>{stop.title}</h3><p className="stop-place">{stop.place} · {stop.kind === "return" ? "固定返程时刻" : `停留 ${stop.durationMin} 分钟`}{stop.travelMin > 0 ? ` · 移动约 ${stop.travelMin} 分钟` : ""}</p>
            <p>{stop.description}</p>{stop.highlights.length > 0 && <div className="highlight-list">{stop.highlights.map((value, i) => <span key={i}>{i + 1}. {value}</span>)}</div>}
            {stop.photoTip && <p className="tip-line">📷 {stop.photoTip}</p>}{stop.caution && <p className="tip-line">◎ {stop.caution}</p>}
            <div className="stop-actions"><a href={amapSearchUrl(stop.place)} target="_blank" rel="noopener noreferrer">高德查地点 ↗</a>{stop.sourceUrl && <a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 ↗</a>}
              <button type="button" disabled={busy} onClick={() => openStop(dayIndex, index)}>编辑</button>
              {stop.kind !== "return" && <><button type="button" disabled={busy} onClick={() => toggleLock(dayIndex, index)}>{stop.locked ? "已锁定 ★" : "锁定必去 ☆"}</button><button type="button" disabled={busy || index === 0} onClick={() => moveStop(dayIndex, index, index - 1)} aria-label={`上移${stop.title}`}>↑ 上移</button><button type="button" disabled={busy || index === day.stops.length - 1 || day.stops[index + 1]?.kind === "return"} onClick={() => moveStop(dayIndex, index, index + 1)} aria-label={`下移${stop.title}`}>↓ 下移</button></>}
            </div>
          </div>
        </article>)}</div>
        {day.lodgingArea && <div className="lodging-note"><strong>今晚住哪里</strong><p>{day.lodgingArea}</p><span>区域建议 · 具体酒店、价格和退改规则请核验</span></div>}
      </section>)}
      <section className="notes-section"><h2>出行提醒</h2>{trip.generalTips.length ? trip.generalTips.map((value, index) => <p key={index}>✳ {value}</p>) : <p>可在行程信息里补充提醒。</p>}</section>

      <section className="work-section legacy-ai-import"><h2>途中改计划</h2><p>写下变化，复制到你常用的 AI 对话中生成调整方案，再把返回的完整 JSON 粘贴回来。导入后先看差异，确认才保存。</p>
        <label>发生了什么变化<textarea value={change} maxLength={1500} onChange={event => setChange(event.target.value)} placeholder="例如：晚出发一小时，保留城堡湖畔，仍在原定时刻开始返程" /></label>
        <button type="button" className="button-primary" disabled={busy || change.trim().length < 2} onClick={() => { void copyPrompt(); }}>复制调整提示词</button>
        {prompt && <details><summary>查看或手动复制提示词</summary><textarea readOnly value={prompt} rows={9} onFocus={event => event.target.select()} aria-label="调整提示词" /></details>}
        <label>粘贴 AI 返回的调整 JSON<textarea value={json} onChange={event => setJson(event.target.value)} rows={7} placeholder="粘贴完整 JSON，包括 input、days 和每站的时间" spellCheck={false} /></label>
        {importError && <p className="error-box" role="alert">{importError}</p>}
        <button type="button" className="button-plain" disabled={busy || !json.trim()} onClick={importAdjusted}>预览调整差异</button>
      </section>

      <section className="work-section"><h2>游后记录</h2><p>记录实际经历，和计划分开保存。资料保存在这台设备的浏览器里。</p>
        <div className="field-grid"><label>实际出发时间<input type="datetime-local" disabled={busy} value={actual.actualDepartureAt || ""} onChange={event => setActual(old => ({ ...old, actualDepartureAt: event.target.value }))} /></label><label>实际开始返程时间<input type="datetime-local" disabled={busy} value={actual.actualReturnAt || ""} onChange={event => setActual(old => ({ ...old, actualReturnAt: event.target.value }))} /></label></div>
        <label>实际花费（元）<input type="number" min="0" step="0.01" disabled={busy} value={actual.spentYuan ?? ""} onChange={event => setActual(old => ({ ...old, spentYuan: event.target.value ? Number(event.target.value) : undefined }))} /></label>
        <label>游玩笔记<textarea value={actual.visitNotes} maxLength={10000} disabled={busy} onChange={event => setActual(old => ({ ...old, visitNotes: event.target.value }))} placeholder="最喜欢哪里？实际走了多久？下次想怎么逛？" /></label>
        <label className="photo-upload">添加游后照片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || actual.photoKeys.length >= 12} onChange={event => { void upload(event, "actual"); }} /></label>
        <p className="form-note">每张不超过 3 MB，最多 12 张。建议只留少量照片，并定期导出备份；浏览器存储空间不足会提示保存失败。</p>
        {actual.photoKeys.length > 0 && <div className="actual-photos">{actual.photoKeys.map((url, index) => <figure key={`${index}-${url.slice(-30)}`}><img loading="lazy" src={assetUrl(url)} alt={`旅途记录照片 ${index + 1}`} /><button type="button" className="button-plain" disabled={busy} onClick={() => { const next = structuredClone(trip); next.actual = { ...actual, photoKeys: actual.photoKeys.filter((_, i) => i !== index) }; saveQuietly(next, "remove-photo"); }}>移除照片 {index + 1}</button></figure>)}</div>}
        <div className="form-actions"><button type="button" className="button-primary" disabled={busy} onClick={() => { const next = structuredClone(trip); next.actual = actual; saveQuietly(next, "actual"); }}>保存实际记录</button><button type="button" className="button-plain" disabled={busy || trip.status === "completed"} onClick={() => { const next = structuredClone(trip); next.actual = actual; next.status = "completed"; saveQuietly(next, "completed"); }}>保存并标记已完成</button></div>
      </section>

      <section className="work-section"><h2>版本回看</h2><p>展开查看以前的安排。恢复时先预览差异，当前内容会继续保留为历史版本。</p>
        {!revisions.length && <p className="form-note">每次保存后，上一版本会出现在这里。</p>}
        <div className="revision-list">{revisions.map(revision => <details key={revision.id}><summary>{readableTime(revision.createdAt)} · {revision.kind}</summary><h3>{revision.document.title}</h3>{revision.document.days.map(day => <div key={day.date}><strong>{day.date} · {day.title}</strong><p>{day.stops.map(stop => `${stop.startAt.slice(11, 16)} ${stop.title}`).join(" → ")}</p></div>)}<p className="form-note">此版包含 {revision.document.actual.photoKeys.length} 张游后照片{revision.document.actual.visitNotes ? "及游玩笔记" : ""}。</p><button type="button" className="button-plain" disabled={busy} onClick={() => { try { onImportRevision(structuredClone(revision.document)); } catch (error) { notify(error instanceof Error ? error.message : "此版本暂不能恢复。"); } }}>预览并恢复此版</button></details>)}</div>
      </section>
    </div>
    {editor && <StopEditor key={`${editor.stop.id}-${editor.isNew}`} stop={editor.stop} dayDate={trip.days[editor.day].date} returnDepartureAt={trip.input.returnDepartureAt} busy={busy} isNew={editor.isNew} onCancel={() => setEditor(null)} onSave={saveStop} onRemove={editor.isNew ? undefined : removeStop} />}
  </div>;
}
