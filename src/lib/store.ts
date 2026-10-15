import { isSafeImageUrl, parseTripDocument } from "./validation";
import { HEBEI_SEED, type TripDocument } from "./travel";

export type TripRevision = { id: string; kind: string; createdAt: string; document: TripDocument };
export type Revision = TripRevision;
export type TripRecord = { trip: TripDocument; revisions: TripRevision[] };
type StoredRecord = TripRecord & { id: string };
export type ImportResult = { imported: number; ids: string[] };

export const BACKUP_SCHEMA_VERSION = 2;
const DB_SCHEMA_VERSION = 1;
let DB_NAME = "travel-pages";
export function setStorageScope(userId?: string): void { DB_NAME = userId ? `travel-private-${userId.replace(/[^a-zA-Z0-9-]/g, '')}` : "travel-pages"; }
const STORE = "trips";
const META = "meta";
const MAX_REVISIONS = 40;
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;

function storageError(error?: unknown): Error {
  const detail = error instanceof Error ? error.message : "";
  return new Error(`本机行程存储不可用或空间不足，请检查浏览器站点存储权限和剩余空间。${detail ? ` ${detail}` : ""}`);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(storageError());
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_SCHEMA_VERSION); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        const seed = structuredClone(HEBEI_SEED);
        if(DB_NAME === "travel-pages") store.put({ id: seed.id, trip: seed, revisions: [{
          id: crypto.randomUUID(), kind: "historical-example", createdAt: seed.createdAt, document: structuredClone(seed),
        }] });
      }
      if (!db.objectStoreNames.contains(META)) {
        const meta = db.createObjectStore(META, { keyPath: "key" });
        meta.put({ key: "initialized", value: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error("本机行程数据库正在其他页面使用，请关闭其他标签页后重试。"));
  });
}

async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  try { return await run(db); }
  finally { db.close(); }
}

function readRequest<T>(request: IDBRequest<T>, tx: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    tx.onabort = () => reject(storageError(tx.error));
  });
}

function copyRecord(value: StoredRecord): TripRecord {
  return { trip: value.trip, revisions: value.revisions };
}

function validateRecord(value: unknown): TripRecord {
  const object = value as Partial<TripRecord> | null;
  if (!object || typeof object !== "object") throw new Error("导入记录格式错误。");
  const trip = parseTripDocument(object.trip);
  const rawRevisions = object.revisions ?? [];
  if (!Array.isArray(rawRevisions) || rawRevisions.length > MAX_REVISIONS) throw new Error("修订记录格式错误或数量过多。");
  const revisions = rawRevisions.map((item: unknown): TripRevision => {
    const revision = item as Partial<TripRevision> | null;
    if (!revision || typeof revision.id !== "string" || !revision.id || typeof revision.kind !== "string" ||
        revision.kind.length > 100 || typeof revision.createdAt !== "string" ||
        !Number.isFinite(Date.parse(revision.createdAt))) throw new Error("修订记录格式错误。");
    const document = parseTripDocument(revision.document);
    if (document.id !== trip.id) throw new Error("修订记录与攻略编号不一致。");
    return { id: revision.id, kind: revision.kind, createdAt: revision.createdAt, document };
  });
  return { trip, revisions };
}

export function parseJsonText(text: string): unknown {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error("导入文件超过 128 MiB，请减少照片后重试。");
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  try { return JSON.parse(fenced ? fenced[1] : trimmed) as unknown; }
  catch { throw new Error("JSON 格式无效，请复制完整攻略或备份内容。"); }
}

export async function listRecords(): Promise<TripRecord[]> {
  return withDb(async db => {
    const tx = db.transaction(STORE, "readonly");
    const values = await readRequest<StoredRecord[]>(tx.objectStore(STORE).getAll(), tx);
    return values.map(copyRecord).sort((a, b) => b.trip.updatedAt.localeCompare(a.trip.updatedAt));
  });
}

export async function cacheRecord(record: TripRecord): Promise<void> {
  const checked = validateRecord(record);
  return withDb(db => new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({id:checked.trip.id,...checked});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(storageError(tx.error));tx.onabort=()=>reject(storageError(tx.error));}));
}

export async function listTrips(): Promise<TripDocument[]> {
  return (await listRecords()).map(record => record.trip);
}

export async function getTrip(id: string): Promise<TripRecord | undefined> {
  return withDb(async db => {
    const tx = db.transaction(STORE, "readonly");
    const value = await readRequest<StoredRecord | undefined>(tx.objectStore(STORE).get(id), tx);
    return value ? copyRecord(value) : undefined;
  });
}

export async function saveTrip(document: TripDocument, kind = "edit"): Promise<TripRecord> {
  const trip = parseTripDocument(document);
  if (typeof kind !== "string" || !kind.trim() || kind.length > 100) throw new Error("修订类型无效。");
  return withDb(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let result: TripRecord | undefined;
    const get = store.get(trip.id) as IDBRequest<StoredRecord | undefined>;
    get.onsuccess = () => {
      try {
        const prior = get.result;
        const next: TripDocument = { ...trip, createdAt: prior?.trip.createdAt || trip.createdAt, updatedAt: new Date().toISOString() };
        const revision: TripRevision = { id: crypto.randomUUID(), kind: prior ? kind : "create", createdAt: next.updatedAt, document: structuredClone(next) };
        result = { trip: next, revisions: [...(prior?.revisions || []), revision].slice(-MAX_REVISIONS) };
        store.put({ id: next.id, ...result });
      } catch (error) { tx.abort(); reject(error); }
    };
    get.onerror = () => reject(storageError(get.error));
    tx.oncomplete = () => result ? resolve(result) : reject(storageError());
    tx.onabort = () => reject(storageError(tx.error));
    tx.onerror = () => reject(storageError(tx.error));
  }));
}

export async function deleteTrip(id: string): Promise<void> {
  return withDb(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(storageError(tx.error));
    tx.onerror = () => reject(storageError(tx.error));
  }));
}

const IMAGE_REF = /^@travel-image:(\d+)$/;

function transformDocumentImages(value: unknown, change: (value: string) => string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const doc = value as Record<string, unknown>;
  const actual = doc.actual && typeof doc.actual === "object" && !Array.isArray(doc.actual)
    ? doc.actual as Record<string, unknown> : null;
  return {
    ...doc,
    coverUrl: typeof doc.coverUrl === "string" ? change(doc.coverUrl) : doc.coverUrl,
    days: Array.isArray(doc.days) ? doc.days.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const day = item as Record<string, unknown>;
      return { ...day, imageUrl: typeof day.imageUrl === "string" ? change(day.imageUrl) : day.imageUrl };
    }) : doc.days,
    actual: actual ? {
      ...actual,
      photoKeys: Array.isArray(actual.photoKeys)
        ? actual.photoKeys.map(item => typeof item === "string" ? change(item) : item)
        : actual.photoKeys,
    } : doc.actual,
  };
}

function transformRecordImages(value: unknown, change: (value: string) => string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    trip: transformDocumentImages(record.trip, change),
    revisions: Array.isArray(record.revisions) ? record.revisions.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const revision = item as Record<string, unknown>;
      return { ...revision, document: transformDocumentImages(revision.document, change) };
    }) : record.revisions,
  };
}

export async function exportBackup(): Promise<string> {
  const imagePool: string[] = [];
  const seen = new Map<string, number>();
  const intern = (value: string): string => {
    if (!value.startsWith("data:")) return value;
    let index = seen.get(value);
    if (index === undefined) {
      index = imagePool.length;
      seen.set(value, index);
      imagePool.push(value);
    }
    return `@travel-image:${index}`;
  };
  const trips = (await listRecords()).map(record => transformRecordImages(record, intern));
  const text = JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), imagePool, trips });
  if (new Blob([text]).size > MAX_IMPORT_BYTES) {
    throw new Error("完整备份超过 128 MiB，请先减少照片或分批整理旅行记录后再导出。");
  }
  return text;
}

function recordsFromImport(value: unknown): TripRecord[] {
  const root = value as Record<string, unknown> | null;
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("导入内容需要是攻略或备份对象。");
  if ("schemaVersion" in root && root.schemaVersion !== 1 && root.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error("备份版本不受支持。");
  let raw = Array.isArray(root.trips) ? root.trips : ["trip" in root ? root : { trip: root }];
  if (root.schemaVersion === BACKUP_SCHEMA_VERSION) {
    if (!Array.isArray(root.imagePool) || !root.imagePool.every(value => typeof value === "string" && value.startsWith("data:") && isSafeImageUrl(value))) {
      throw new Error("备份图片池无效。");
    }
    const pool = root.imagePool as string[];
    const expand = (value: string): string => {
      const match = IMAGE_REF.exec(value);
      if (!match) return value;
      const image = pool[Number(match[1])];
      if (!image) throw new Error("备份缺少图片数据，请重新导出完整备份。");
      return image;
    };
    raw = raw.map(item => transformRecordImages(item, expand));
  }
  if (!raw.length || raw.length > 100) throw new Error("导入攻略数量需为 1–100 个。");
  const records = raw.map(item => {
    const object = item as Record<string, unknown>;
    return validateRecord("trip" in object ? object : { trip: object });
  });
  const ids = new Set(records.map(record => record.trip.id));
  if (ids.size !== records.length) throw new Error("备份中有重复的攻略编号。");
  return records;
}

export async function importBackup(input: string | unknown): Promise<ImportResult> {
  const records = recordsFromImport(typeof input === "string" ? parseJsonText(input) : input);
  return withDb(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getKeys = store.getAllKeys();
    const ids: string[] = [];
    getKeys.onsuccess = () => {
      try {
        const occupied = new Set(getKeys.result.map(String));
        for (const record of records) {
          let id = record.trip.id;
          while (occupied.has(id)) id = crypto.randomUUID();
          occupied.add(id);
          ids.push(id);
          const next: TripRecord = id === record.trip.id ? record : {
            trip: { ...record.trip, id },
            revisions: record.revisions.map(revision => ({ ...revision, id: crypto.randomUUID(), document: { ...revision.document, id } })),
          };
          store.put({ id, ...next });
        }
      } catch (error) { tx.abort(); reject(error); }
    };
    getKeys.onerror = () => reject(storageError(getKeys.error));
    tx.oncomplete = () => resolve({ imported: ids.length, ids });
    tx.onabort = () => reject(storageError(tx.error));
    tx.onerror = () => reject(storageError(tx.error));
  }));
}
