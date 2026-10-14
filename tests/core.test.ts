import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { HEBEI_SEED, newBlankTrip, type TripInput } from "../src/lib/travel";
import { assetUrl, resolveAssetPath } from "../src/lib/assets";
import { isSafeImageUrl, parseTripDocument } from "../src/lib/validation";
import { getPrompt, importPlan } from "../src/lib/import";
import { deleteTrip, exportBackup, getTrip, importBackup, listTrips, saveTrip } from "../src/lib/store";

const input: TripInput = {
  origin: "石家庄", destination: "北京", departureAt: "2026-10-20T07:30",
  returnDepartureAt: "2026-10-21T18:00", mode: "transit", partySize: 2,
  interests: "古建、美食", constraints: "避开太晚的末班车",
};

test("historical seed is public-safe and first-open only", async () => {
  assert.equal(HEBEI_SEED.input.origin, "石家庄");
  assert.equal(HEBEI_SEED.days[0].stops.at(-1)?.place, "石家庄");
  assert.match(HEBEI_SEED.generalTips[0], /历史行程示例/);
  parseTripDocument(HEBEI_SEED);
  assert.equal(assetUrl("/hebei-cover.png"), "/hebei-cover.webp");
  assert.equal(resolveAssetPath("/hebei-cover.png", "./"), "./hebei-cover.webp");
  assert.equal(resolveAssetPath("/hebei-cover.png", "/travel-notebook/"), "/travel-notebook/hebei-cover.webp");
  assert.equal(resolveAssetPath("/travel-notebook/hebei-cover.png", "/travel-notebook/"), "/travel-notebook/hebei-cover.webp");
  assert.equal(assetUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  await assert.rejects(async () => assetUrl("/../secret.png"));
  assert.equal((await listTrips()).length, 1);
  await deleteTrip(HEBEI_SEED.id);
  assert.equal((await listTrips()).length, 0);
});

test("time, URL and embedded image validation", () => {
  const trip = newBlankTrip(input);
  assert.equal(trip.days.length, 2);
  parseTripDocument(trip);
  assert.equal(isSafeImageUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(isSafeImageUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isSafeImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeImageUrl(`data:image/png;base64,${"A".repeat(4 * 1024 * 1024 + 4)}`), false);
  const badReturn = structuredClone(trip);
  badReturn.days.at(-1)!.stops[0].startAt = "2026-10-21T17:00";
  assert.throws(() => parseTripDocument(badReturn), /返程/);
  const badImage = structuredClone(trip);
  badImage.coverUrl = "https://external.example/image.png";
  assert.throws(() => parseTripDocument(badImage), /coverUrl/);
  const later = structuredClone(trip);
  later.input.departureAt = "2026-10-20T08:30";
  const revised = importPlan(JSON.stringify(later), trip.input, trip);
  assert.equal(revised.input.departureAt, "2026-10-20T08:30");
  const movedReturn = structuredClone(trip);
  movedReturn.input.returnDepartureAt = "2026-10-21T19:00";
  movedReturn.days.at(-1)!.stops[0].startAt = "2026-10-21T19:00";
  movedReturn.days.at(-1)!.stops[0].endAt = "2026-10-21T19:00";
  assert.throws(() => importPlan(JSON.stringify(movedReturn), trip.input, trip), /返程时间/);
  const explicit = importPlan(JSON.stringify(movedReturn), movedReturn.input, trip);
  assert.equal(explicit.input.returnDepartureAt, "2026-10-21T19:00");
});

test("copyable prompt and staged import preserve return and private records", async () => {
  const compact = {
    title: "北京两日游", days: [
      { title: "第一天", lodgingArea: "前门附近，预订前核对价格", stops: [
        { kind: "travel", title: "乘火车进京", place: "北京南站", durationMin: 60, travelMin: 0 },
        { kind: "sight", title: "故宫", place: "故宫博物院", durationMin: 120, travelMin: 30 },
      ] },
      { title: "第二天", stops: [{ kind: "meal", title: "午餐", place: "前门", durationMin: 60, travelMin: 20 }] },
    ], generalTips: ["门票和车次出发前核实"],
  };
  const staged = importPlan(`\`\`\`json\n${JSON.stringify(compact)}\n\`\`\``, input);
  assert.equal(staged.days.length, 2);
  assert.equal(staged.days[1].stops.at(-1)?.kind, "return");
  assert.equal(staged.days[1].stops.at(-1)?.startAt, input.returnDepartureAt);
  staged.actual.visitNotes = "只有本地保存的私人笔记";
  staged.actual.photoKeys = ["data:image/png;base64,iVBORw0KGgo="];
  staged.days[0].stops[0].locked = true;
  const saved = await saveTrip(staged);
  assert.equal(saved.revisions.length, 1);
  assert.equal((await getTrip(staged.id))?.trip.actual.visitNotes, "只有本地保存的私人笔记");
  const prompt = getPrompt(input, staged, "把午餐换到下午");
  assert.match(prompt, /把午餐换到下午/);
  assert.match(prompt, /locked/);
  assert.doesNotMatch(prompt, /只有本地保存的私人笔记/);
  assert.doesNotMatch(prompt, /iVBORw0KGgo/);
  const edited = structuredClone(staged);
  edited.title = "修改后的北京攻略";
  edited.actual.visitNotes = "模型不应覆盖的内容";
  const revision = importPlan(JSON.stringify(edited), input, staged);
  assert.equal(revision.id, staged.id);
  assert.equal(revision.actual.visitNotes, staged.actual.visitNotes);
  assert.deepEqual(revision.actual.photoKeys, staged.actual.photoKeys);
  assert.deepEqual(revision.days[0].stops[0], staged.days[0].stops[0]);
  const savedAgain = await saveTrip(revision, "replan");
  assert.equal(savedAgain.revisions.length, 2);
  const missingLock = structuredClone(edited);
  missingLock.days[0].stops.splice(0, 1);
  assert.throws(() => importPlan(JSON.stringify(missingLock), input, staged), /锁定项目/);
});

test("backup import validates all records before writing and avoids ID overwrites", async () => {
  const before = await listTrips();
  assert.equal(before.length, 1);
  const original = await getTrip(before[0].id);
  assert(original);
  const broken = structuredClone(original);
  broken.trip.days[1].stops.at(-1)!.startAt = "2026-10-21T19:00";
  const mixed = { schemaVersion: 1, trips: [original, broken] };
  await assert.rejects(importBackup(JSON.stringify(mixed)));
  assert.equal((await listTrips()).length, before.length);
  const backup = await exportBackup();
  const restored = await importBackup(backup);
  assert.equal(restored.imported, 1);
  assert.notEqual(restored.ids[0], original.trip.id);
  assert.equal((await listTrips()).length, 2);
  assert.equal((await getTrip(restored.ids[0]))?.trip.actual.visitNotes, original.trip.actual.visitNotes);
  const plain = await importBackup(JSON.stringify(original.trip));
  assert.equal(plain.imported, 1);
  assert.notEqual(plain.ids[0], original.trip.id);
  assert.equal((await listTrips()).length, 3);
});

test("backup v2 stores repeated 3 MiB photo once and restores it", async () => {
  const trip = structuredClone((await listTrips())[0]);
  const image = `data:image/png;base64,${"A".repeat(4 * 1024 * 1024)}`;
  trip.actual.photoKeys = [image];
  await saveTrip(trip, "photo-one");
  await saveTrip(trip, "photo-two");
  const text = await exportBackup();
  const backup = JSON.parse(text) as { schemaVersion: number; imagePool: string[] };
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.imagePool.filter(value => value === image).length, 1);
  assert.equal(text.split(image).length, 2);
  assert(new Blob([text]).size < 5 * 1024 * 1024);
  const imported = await importBackup(text);
  const restored = (await Promise.all(imported.ids.map(id => getTrip(id)))).find(record => record?.trip.actual.photoKeys.length);
  assert(restored);
  assert.equal(restored.trip.actual.photoKeys[0], image);
});

test("an overfull day proposes cuts, retains necessary travel and rejects impossible must-go plans", () => {
  const oneDay={...input,returnDepartureAt:'2026-10-20T10:30'};
  const compact={days:[{stops:[
    {kind:'travel',title:'必要交通',durationMin:60,priority:5},
    {kind:'sight',title:'必去古建',durationMin:60,priority:5,sourceUrl:'https://example.com/notice'},
    {kind:'sight',title:'可选散步',durationMin:90,priority:1},
  ]}]};
  const proposed=importPlan(JSON.stringify(compact),oneDay);
  assert(proposed.removedForTime.length>0);
  assert.equal(proposed.days[0].stops[0].title,'必要交通');
  assert.equal(proposed.days[0].stops[1].title,'必去古建');
  assert.equal(proposed.days[0].stops[1].sourceUrl,'https://example.com/notice');
  assert.equal(proposed.days[0].stops[1].sourceStatus,'check');
  assert.equal(proposed.days[0].stops.at(-1)?.startAt,oneDay.returnDepartureAt);
  assert.throws(()=>importPlan(JSON.stringify(compact),{...oneDay,returnDepartureAt:'2026-10-20T08:00'}),/必要交通/);
});
