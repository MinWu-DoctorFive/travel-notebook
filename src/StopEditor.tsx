import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addMinutes, minutesBetween, type TripStop } from "./lib/travel";

export const KIND_LABEL: Record<TripStop["kind"], string> = {
  travel: "交通", sight: "游玩", meal: "用餐", rest: "休息", lodging: "住宿区域", return: "返程",
};

export function ModalFrame({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]") || []).filter(node => !node.hidden);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="modal-card" ref={panel}>
      <div className="modal-title"><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭编辑窗口">✕</button></div>
      {children}
    </div>
  </div>;
}

export default function StopEditor({ stop, dayDate, returnDepartureAt, busy, onCancel, onSave, onRemove, isNew = false }: {
  stop: TripStop; dayDate: string; returnDepartureAt: string; busy: boolean; isNew?: boolean;
  onCancel: () => void; onSave: (stop: TripStop, shiftLater: boolean) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(stop));
  const [highlights, setHighlights] = useState(stop.highlights.join("\n"));
  const [shiftLater, setShiftLater] = useState(true);
  const [error, setError] = useState("");
  const fixedReturn = stop.kind === "return";
  const edit = <K extends keyof TripStop>(key: K, value: TripStop[K]) => setDraft(old => ({ ...old, [key]: value }));
  const setStart = (value: string) => {
    setDraft(old => {
      try { return { ...old, startAt: value, endAt: addMinutes(value, old.durationMin) }; }
      catch { return { ...old, startAt: value }; }
    });
  };
  const setDuration = (value: number) => {
    setDraft(old => {
      try { return { ...old, durationMin: value, endAt: addMinutes(old.startAt, value) }; }
      catch { return { ...old, durationMin: value }; }
    });
  };
  async function submit() {
    setError("");
    try {
      if (!draft.title.trim()) throw new Error("请给这一站填写标题。");
      const duration = minutesBetween(draft.startAt, draft.endAt);
      if (!Number.isFinite(duration) || duration < 0 || (!fixedReturn && duration === 0)) throw new Error("请填写有效的起止时间和停留时长。");
      if (draft.startAt.slice(0, 10) !== dayDate || draft.endAt.slice(0, 10) !== dayDate) throw new Error("这一站的起止时间须属于当天。");
      if (draft.sourceStatus === "sourced" && !draft.sourceUrl.trim()) throw new Error("标记为有来源时，请填写核对链接。");
      if (draft.sourceUrl && !/^https:\/\//i.test(draft.sourceUrl.trim())) throw new Error("核对链接请使用 https:// 开头的网址。");
      const next = { ...draft, title: draft.title.trim(), place: draft.place.trim(), sourceUrl: draft.sourceUrl.trim(), durationMin: duration, highlights: highlights.split("\n").map(value => value.trim()).filter(Boolean) };
      if (fixedReturn) Object.assign(next, { kind: "return", startAt: returnDepartureAt, endAt: returnDepartureAt, durationMin: 0, travelMin: 0, locked: true, priority: 5 });
      await onSave(next, !fixedReturn && shiftLater);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "未保存，请检查填写内容。"); }
  }
  return <ModalFrame title={isNew ? "添加这一站" : "编辑这一站"} onClose={onCancel} busy={busy}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {fixedReturn && <p className="notice-box">返程节点固定为 {returnDepartureAt.replace("T", " ")} 从目的地出发，保留此节点可帮助检查时间上限。</p>}
      <label>标题<input autoComplete="off" maxLength={150} required value={draft.title} disabled={busy} onChange={event => edit("title", event.target.value)} /></label>
      <label>地点<input autoComplete="off" maxLength={300} value={draft.place} disabled={busy} onChange={event => edit("place", event.target.value)} placeholder="填写高德可以搜索的地点名称" /></label>
      <label>节点类型<select value={draft.kind} disabled={busy || fixedReturn} onChange={event => edit("kind", event.target.value as TripStop["kind"])}>
        {Object.entries(KIND_LABEL).filter(([kind]) => kind !== "return" || fixedReturn).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <div className="field-grid">
        <label>开始时间<input type="datetime-local" required value={draft.startAt} min={`${dayDate}T00:00`} max={`${dayDate}T23:59`} disabled={busy || fixedReturn} onChange={event => setStart(event.target.value)} /></label>
        <label>停留时长（分钟）<input type="number" min={fixedReturn ? 0 : 1} max="1440" required value={draft.durationMin} disabled={busy || fixedReturn} onChange={event => setDuration(Number(event.target.value))} /></label>
      </div>
      <label>结束时间<input type="datetime-local" required value={draft.endAt} min={`${dayDate}T00:00`} max={`${dayDate}T23:59`} disabled={busy || fixedReturn} onChange={event => {
        const endAt = event.target.value; const duration = minutesBetween(draft.startAt, endAt);
        setDraft(old => ({ ...old, endAt, durationMin: Number.isFinite(duration) ? duration : old.durationMin }));
      }} /></label>
      {!fixedReturn && <>
        <label>上一站到这里的移动时间（分钟）<input type="number" min="0" max="720" required value={draft.travelMin} disabled={busy} onChange={event => edit("travelMin", Number(event.target.value))} /></label>
        <label className="form-note"><input type="checkbox" checked={shiftLater} disabled={busy} onChange={event => setShiftLater(event.target.checked)} /> 保存后按移动和停留时间顺延后续节点，返程时刻固定</label>
      </>}
      <label>这一站怎么玩<textarea maxLength={3000} value={draft.description} disabled={busy} onChange={event => edit("description", event.target.value)} placeholder="从哪个入口进，依次看什么，哪里可以休息" /></label>
      <label>景区内游览顺序（每行一个看点）<textarea value={highlights} disabled={busy} onChange={event => setHighlights(event.target.value)} placeholder={"城门与古街\n院落和门洞\n湖畔观景点"} /></label>
      <label>拍照位置与建议<textarea maxLength={1000} value={draft.photoTip} disabled={busy} onChange={event => edit("photoTip", event.target.value)} /></label>
      <label>注意事项<textarea maxLength={1000} value={draft.caution} disabled={busy} onChange={event => edit("caution", event.target.value)} /></label>
      <div className="field-grid">
        <label>来源状态<select value={draft.sourceStatus} disabled={busy} onChange={event => edit("sourceStatus", event.target.value as TripStop["sourceStatus"])}><option value="check">待核验</option><option value="estimated">估算</option><option value="sourced">有来源</option></select></label>
        <label>优先级<select value={draft.priority} disabled={busy || fixedReturn} onChange={event => edit("priority", Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} · {value === 5 ? "必须保留" : value === 1 ? "可删减" : "普通看点"}</option>)}</select></label>
      </div>
      <label>核对链接<input type="url" value={draft.sourceUrl} disabled={busy} onChange={event => edit("sourceUrl", event.target.value)} placeholder="https://..." /></label>
      {!fixedReturn && <label className="form-note"><input type="checkbox" checked={draft.locked} disabled={busy} onChange={event => edit("locked", event.target.checked)} /> 锁定必去看点，移除前需先解锁</label>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="form-actions">
        {!isNew && !fixedReturn && onRemove && <button type="button" className="button-plain" disabled={busy || stop.locked} onClick={() => { setError(""); void onRemove().catch(cause => setError(cause instanceof Error ? cause.message : "移除失败")); }}>移除此站</button>}
        <button type="button" className="button-plain" disabled={busy} onClick={onCancel}>取消</button>
        <button type="submit" className="button-primary" disabled={busy}>{busy ? "正在保存…" : "保存这一站"}</button>
      </div>
      {stop.locked && !fixedReturn && <p className="form-note">此站已锁定。需要移除时，先取消锁定并保存，再打开编辑。</p>}
    </form>
  </ModalFrame>;
}
