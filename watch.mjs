// 警視庁 学科試験 cancellation watcher
// Polls the same JSON endpoint the 空き状況カレンダー uses and alerts when a slot opens.
//
//   node watch.mjs                       # watch until "until" in me.json, every ~1 min
//   node watch.mjs --until 2026-11-30    # override the deadline (inclusive)
//   node watch.mjs --once                # single check, print table, exit
//   node watch.mjs --book                # auto-book the earliest new slot (details from me.json), then exit
//
// Optional phone push: set NTFY_TOPIC=<some-random-name> and install the ntfy app,
// subscribe to the same topic.

import { exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { book } from "./book.mjs";

// calgetres (month calendar) is a cached snapshot that lags ~5 min; getres (per day) is live.
// Use the calendar only to learn which dates exist, and getres for the actual counts.
const API_BASE = "https://license-test-tokyo-prd-police-pref-api.tokyo-madoguchi-yoyaku.com";
const BOOKING_URL = "https://license-test.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/index.html?lang=ja";

// 教習所卒業等 (typeDetailChoice=11) + 免許証のみ (newLicenseChoice=1) → coursecode 11
const COURSE_CODE = "11";
const PLACES = { "270": "府中", "280": "鮫洲", "250": "江東" };

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
// Deadline (inclusive): --until beats "until" in me.json
const meUntil = (() => {
  try { return JSON.parse(readFileSync(new URL("./me.json", import.meta.url), "utf8")).until; } catch { return undefined; }
})();
const UNTIL = String(argVal("--until", meUntil) ?? "").replaceAll("-", ""); // YYYYMMDD
if (!/^\d{8}$/.test(UNTIL)) {
  console.error('Set a deadline: "until": "YYYY-MM-DD" in me.json, or --until YYYY-MM-DD');
  process.exit(1);
}
const INTERVAL_S = Number(argVal("--interval", "60"));
const ONCE = args.includes("--once");
const AUTO_BOOK = args.includes("--book");
const NTFY_TOPIC = process.env.NTFY_TOPIC;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString("ja-JP", { hour12: false });

function jstNow() {
  // YYYYMMDD and HHMM in Japan time regardless of machine timezone
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour}${p.minute}` };
}

function monthsBetween(fromYmd, toYmd) {
  const out = [];
  let y = +fromYmd.slice(0, 4), m = +fromYmd.slice(4, 6);
  const ey = +toYmd.slice(0, 4), em = +toYmd.slice(4, 6);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const HEADERS = {
  // API gateway returns 403 without these
  "Content-Type": "application/json; charset=UTF-8",
  Origin: "https://license-test.tokyo-madoguchi-yoyaku.com",
  Referer: "https://license-test.tokyo-madoguchi-yoyaku.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

async function api(what, url, init = {}) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000), ...init });
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== "A0001") throw new Error(`${what}: code ${j.code}`);
  return j.body ?? [];
}

const fetchMonth = (place, yyyymm) =>
  api(`${PLACES[place]} ${yyyymm}`, `${API_BASE}/calgetres?${new URLSearchParams({ date: yyyymm, coursecode: COURSE_CODE, placecode: place, user: "pub" })}`);

const fetchDay = (place, yyyymmdd) =>
  api(`${PLACES[place]} ${yyyymmdd}`, `${API_BASE}/getres`, {
    method: "POST",
    body: JSON.stringify({ date: yyyymmdd, coursecode: COURSE_CODE, placecode: place }),
  });

// Which dates each place has sessions on (from the cached calendar); refreshed every 30 min
let dateCache = { at: 0, dates: {} };
async function sessionDates(now) {
  if (Date.now() - dateCache.at < 30 * 60_000) return dateCache.dates;
  const dates = {};
  for (const place of Object.keys(PLACES)) {
    const set = new Set();
    for (const ym of monthsBetween(now.date, UNTIL)) {
      for (const s of await fetchMonth(place, ym)) if (s.date >= now.date && s.date <= UNTIL) set.add(s.date);
      await sleep(300 + Math.random() * 500);
    }
    dates[place] = [...set].sort();
  }
  dateCache = { at: Date.now(), dates };
  return dates;
}

// Returns Map key "place|date|start" → { place, date, start, end, label, remaining }
async function snapshot() {
  const now = jstNow();
  const slots = new Map();
  const dates = await sessionDates(now);
  for (const place of Object.keys(PLACES)) {
    for (const date of dates[place]) {
      if (date < now.date) continue;
      for (const s of await fetchDay(place, date)) {
        if (s.date === now.date && s.starttime <= now.time) continue; // already started
        const remaining = Math.max(0, Number(s.capacity) - Number(s.reservation));
        slots.set(`${place}|${s.date}|${s.starttime}`, {
          place, date: s.date, start: s.starttime, end: s.endtime,
          label: s.displaytime, remaining,
        });
      }
      await sleep(200 + Math.random() * 400); // be gentle between requests
    }
  }
  return slots;
}

const fmt = (s) =>
  `${PLACES[s.place]} ${s.date.slice(4, 6)}/${s.date.slice(6)} ${s.start.slice(0, 2)}:${s.start.slice(2)} 残${s.remaining}`;

function notify(title, body) {
  console.log(`\x07[${ts()}] 🔔 ${title}\n${body}`);
  // Windows toast via PowerShell (no extra installs)
  const esc = (t) => t.replace(/'/g, "''").replace(/[<>&]/g, "");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('${esc(title)}')) > $null
$t.Item(1).AppendChild($x.CreateTextNode('${esc(body)}')) > $null
$n = [Windows.UI.Notifications.ToastNotification]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)`;
  const tmp = `${process.env.TEMP}\\menkyo-toast.ps1`;
  writeFileSync(tmp, "﻿" + ps, "utf8");
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
  if (NTFY_TOPIC) {
    fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST",
      headers: { Title: "Menkyo slot open", Priority: "urgent", Click: BOOKING_URL },
      body: `${title}\n${body}`,
    }).catch((e) => console.error("ntfy failed:", e.message));
  }
}

async function main() {
  console.log(`Watching 府中/鮫洲/江東 (教習所卒業等・免許証のみ) through ${UNTIL}, every ~${INTERVAL_S}s${AUTO_BOOK ? " — AUTO-BOOK ON" : ""}`);
  let prev = null;
  let failures = 0;
  for (;;) {
    try {
      const cur = await snapshot();
      failures = 0;
      const open = [...cur.values()].filter((s) => s.remaining > 0);
      // New = open now and was full / absent last time (first run: everything open counts)
      const fresh = open.filter((s) => !prev || !(prev.get(`${s.place}|${s.date}|${s.start}`)?.remaining > 0));

      if (ONCE) {
        for (const s of cur.values()) console.log(fmt(s));
        return;
      }
      console.log(`[${ts()}] ${cur.size} slots checked, ${open.length} open${open.length ? ": " + open.map(fmt).join(", ") : ""}`);
      if (fresh.length && AUTO_BOOK) {
        // earliest date first, then earliest session; fall through to the next one if it's gone
        const queue = [...open].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        for (const s of queue) {
          const date = `${s.date.slice(0, 4)}-${s.date.slice(4, 6)}-${s.date.slice(6)}`;
          console.log(`[${ts()}] booking ${fmt(s)} ...`);
          const res = await book({ place: s.place, date, start: s.start });
          if (res.ok) {
            notify("予約完了!", `${fmt(s)}\n${res.text.slice(0, 120)}`);
            console.log(res.text);
            console.log("Receipt screenshot saved in receipts/. Leaving the Edge window open — save the QR code.");
            return;
          }
          console.log(`[${ts()}] booking failed: ${res.text}`);
          // Not a "slot gone" problem (e.g. details rejected, already booked) → stop and tell the user
          if (!/no longer available|place .* not offered/.test(res.text)) {
            notify("自動予約失敗", res.text.slice(0, 200));
            return;
          }
        }
        notify("空きを取り逃しました", fresh.map(fmt).join("\n"));
      } else if (fresh.length) {
        notify(`空き ${fresh.length}件!`, fresh.map(fmt).join("\n"));
        exec(`start "" "${BOOKING_URL}"`);
      }
      prev = cur;
    } catch (e) {
      failures++;
      console.error(`[${ts()}] error: ${e.message}`);
      if (failures === 5) notify("Menkyo watcher failing", e.message);
    }
    // jittered interval, backing off on repeated errors
    const base = INTERVAL_S * 1000 * Math.min(2 ** failures, 8);
    await sleep(base * (0.8 + Math.random() * 0.4));
  }
}

main();
