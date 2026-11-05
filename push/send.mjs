/* يفحص قاعدة بيانات الموقع كل 5 دقائق ويرسل تنبيهات Web Push للأحداث الجديدة */
import fs from "node:fs";
const BASE = process.env.FB || "https://scouts-83903-default-rtdb.europe-west1.firebasedatabase.app";
const DRY = process.env.DRY === "1";
const PUB = process.env.VAPID_PUBLIC, PRIV = process.env.VAPID_PRIVATE;
const FIX = process.env.FIX ? JSON.parse(fs.readFileSync(process.env.FIX, "utf8")) : null;
if (!DRY && (!PUB || !PRIV)) { console.log("::notice::VAPID_PRIVATE secret is not set yet - skipping."); process.exit(0); }

async function J(path, opt) {
  if (FIX) { const k = path.replace(/\.json$/, "").replace(/^\//, ""); if (opt && opt.method) { FIX.out = FIX.out || {}; FIX.out[k + ":" + opt.method] = opt.body ? JSON.parse(opt.body) : null; return null; } return FIX[k] === undefined ? null : FIX[k]; }
  const r = await fetch(BASE + path, opt);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
const raw = (await J("/afs.json")) || {};
const S = {};
Object.keys(raw).forEach((k) => { try { S[k] = typeof raw[k] === "string" ? JSON.parse(raw[k]) : raw[k]; } catch (e) {} });
const arr = (k) => (Array.isArray(S[k]) ? S[k] : []);
const subs = (await J("/push.json")) || {};
let st = await J("/pushstate.json");
const first = !st;
st = st || {};
const maxId = (list) => list.reduce((a, x) => Math.max(a, Number(x.id) || 0), 0);
const ev = []; // {type, match(sub), title, body, url, tag}
const isRole = (s, role, uid) => s.role === role && (uid === undefined || String(s.uid) === String(uid));

/* نقاط وملاحظات: تجميع لكل كشاف */
const recs = arr("records").filter((r) => Number(r.id) > (st.rec || 0) && r.points);
const byScout = {};
recs.forEach((r) => { (byScout[r.scoutId] = byScout[r.scoutId] || []).push(r); });
Object.keys(byScout).forEach((sid) => {
  const l = byScout[sid], sum = l.reduce((a, r) => a + r.points, 0);
  const title = sum >= 0 ? "نقاط جديدة" : "ملاحظة جديدة";
  const body = l.length === 1 ? (l[0].points > 0 ? "+" : "") + l[0].points + " نقطة · " + (l[0].beh || "") : l.length + " سجلات جديدة · المجموع " + (sum > 0 ? "+" : "") + sum;
  ev.push({ type: "pts", match: (s) => isRole(s, "scout", sid), title, body, url: "./#scout", tag: "pts-" + sid });
});
arr("announcements").filter((a) => Number(a.id) > (st.ann || 0)).forEach((a) => ev.push({ type: "ann", match: () => true, title: "إعلان جديد", body: a.title, url: "./#home", tag: "ann-" + a.id }));
arr("activities").filter((a) => Number(a.id) > (st.act || 0)).forEach((a) => ev.push({ type: "ann", match: () => true, title: "نشاط جديد", body: a.title + (a.date ? " · " + a.date : ""), url: "./#activities", tag: "act-" + a.id }));
arr("stories").filter((a) => Number(a.id) > (st.sto || 0)).length && ev.push({ type: "story", match: (s) => s.role !== "admin", title: "قصة جديدة", body: "نشرت الإدارة قصة جديدة", url: "./#home", tag: "story" });
arr("requests").filter((r) => Number(r.id) > (st.req || 0)).forEach((r) => ev.push({ type: "msg", match: (s) => isRole(s, "admin"), title: "طلب انضمام جديد", body: r.name || "", url: "./#admin", tag: "req-" + r.id }));
arr("tasks").filter((t) => Number(t.id) > (st.tsk || 0)).forEach((t) => ev.push({ type: "msg", match: (s) => isRole(s, "scout", t.scoutId), title: "مهمة جديدة", body: t.text, url: "./#scout", tag: "tsk-" + t.id }));
arr("ptasks").filter((t) => Number(t.id) > (st.pt || 0)).forEach((t) => {
  const ids = arr("members").filter((m) => m.patrol === t.patrol).map((m) => String(m.id));
  ev.push({ type: "msg", match: (s) => s.role === "scout" && ids.includes(String(s.uid)), title: "مهمة جديدة لطليعتك", body: t.text, url: "./#scout", tag: "pt-" + t.id });
});
const msgNow = {};
arr("msgs").forEach((m) => {
  if (Number(m.id) > (st.msg || 0)) ev.push({ type: "msg", match: (s) => isRole(s, "admin"), title: "رسالة جديدة", body: (m.name || "") + ": " + (m.subject || ""), url: "./#admin", tag: "msg-" + m.id });
  if (m.reply) { msgNow[m.id] = 1; if (st.msgs && !st.msgs[m.id] && Number(m.id) <= (st.msg || 0)) ev.push({ type: "msg", match: (s) => isRole(s, m.role, m.uid), title: "رد من الإدارة", body: m.subject || "", url: "./#" + m.role, tag: "rep-" + m.id }); }
});
const casesNow = {};
arr("cases").forEach((c) => {
  casesNow[c.id] = c.status;
  const prev = (st.cases || {})[c.id];
  if (prev === undefined && Number(c.id) > (st.cas || 0) && c.status === "pending") ev.push({ type: "msg", match: (s) => isRole(s, "admin"), title: "مخالفة بانتظار الاعتماد", body: c.behavior || "", url: "./#admin", tag: "cas-" + c.id });
  if (prev !== undefined && prev !== c.status && c.status !== "pending") ev.push({ type: "msg", match: (s) => isRole(s, "teacher", c.teacherId), title: c.status === "returned" ? "حالة أُعيدت للمراجعة" : "تم البت في حالة", body: c.behavior || "", url: "./#teacher", tag: "cas-" + c.id + "-" + c.status });
});

const next = { rec: maxId(arr("records")), ann: maxId(arr("announcements")), act: maxId(arr("activities")), sto: maxId(arr("stories")), req: maxId(arr("requests")), tsk: maxId(arr("tasks")), pt: maxId(arr("ptasks")), msg: maxId(arr("msgs")), cas: maxId(arr("cases")), msgs: msgNow, cases: casesNow };

let sent = 0, failed = 0, removed = 0;
if (!first && ev.length) {
  let webpush = null;
  if (!DRY) { webpush = (await import("web-push")).default; webpush.setVapidDetails("https://m3naji-droid.github.io/Ahmad-alfateh-scouts/", PUB, PRIV); }
  const jobs = [];
  ev.forEach((e) => Object.keys(subs).forEach((k) => {
    const s = subs[k]; if (!s || !s.sub || !s.role || !(s.types && s.types[e.type]) || !e.match(s)) return;
    jobs.push({ k, s, e });
  }));
  if (DRY) { jobs.forEach((j) => console.log("DRY ->", j.k, j.s.role + ":" + j.s.uid, "|", j.e.title, "|", j.e.body)); sent = jobs.length; }
  else for (let i = 0; i < jobs.length; i += 15) {
    await Promise.all(jobs.slice(i, i + 15).map(async (j) => {
      try { await webpush.sendNotification(j.s.sub, JSON.stringify({ title: j.e.title, body: j.e.body, url: j.e.url, tag: j.e.tag }), { TTL: 86400 }); sent++; }
      catch (err) { if (err.statusCode === 404 || err.statusCode === 410) { removed++; await J("/push/" + j.k + ".json", { method: "DELETE" }).catch(() => {}); } else { failed++; console.log("send failed", err.statusCode || err.message); } }
    }));
  }
}
await J("/pushstate.json", { method: "PUT", body: JSON.stringify(next) });
console.log(JSON.stringify({ first, events: ev.length, subs: Object.keys(subs).length, sent, failed, removed }));
if (FIX && process.env.FIXOUT) fs.writeFileSync(process.env.FIXOUT, JSON.stringify(FIX.out || {}));
