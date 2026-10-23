// Books one 学科試験 slot by driving Edge through the real booking pages.
//
//   node book.mjs 270 2026-10-27 0800            # book 府中, 10/27, 08:00 session
//   node book.mjs 270 2026-10-27 0800 --dry-run  # go up to the 確認 page, don't confirm
//
// Place codes: 270 府中, 280 鮫洲, 250 江東. Details come from me.json.
// watch.mjs --book calls book() automatically when a slot opens.

import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const START_URL = "https://license-test.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/index.html?lang=ja";

function loadMe() {
  const me = JSON.parse(readFileSync(join(dir, "me.json"), "utf8"));
  const [y, m, d] = me.birth.split("-");
  return {
    nameKana: me.nameKana,
    birthYear: String(Number(y)),
    birthMonth: m.padStart(2, "0"),
    birthDay: d.padStart(2, "0"),
    graduationCertNo: String(me.graduationCertNo),
    tel: String(me.tel).replace(/\D/g, ""),
  };
}

// --- page-side helpers (run inside the site with its own jQuery) ---

async function pageFillDetails(D) {
  const $ = window.jQuery;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); }
    return false;
  };
  const only = (sel) => $(sel).is(":visible") && $("#page01,#page02,#page03,#page04").filter(":visible").length === 1;
  const set = (sel, v) => $(sel).val(v).trigger("input").trigger("change").trigger("keyup").trigger("blur");

  $.fx.off = true;
  $("input[name=typeChoice][value=1]").trigger("click");
  if (!(await until(() => only("#page02")))) throw new Error("step 2 did not open");
  $("input[name=typeDetailChoice][value=11]").trigger("click");
  await wait(200);
  $("input[name=newLicenseChoice][value=1]").trigger("click");
  if (!(await until(() => only("#page03")))) throw new Error("details step did not open");

  set("#strNameKana", D.nameKana);
  set("#birthYear", D.birthYear);
  set("#birthMonth", D.birthMonth);
  await wait(100);
  set("#birthDay", D.birthDay);
  set("#strGraduationCertificateNumber", D.graduationCertNo);
  set("#strTelNumber", D.tel);
  await wait(300);
  const errs = $("[id$=Error]").filter((i, e) => e.textContent.trim()).map((i, e) => e.textContent.trim()).get();
  if (errs.length) throw new Error("details rejected: " + errs.join(" / "));
  $("#nextPageBtn03").trigger("click");

  // reservedCheck: either the place list appears or an error (e.g. already booked)
  await until(() => $("input[name=placeChoice]").length > 0 && !$("#placeChoiceArea").hasClass("display_none") || $(".reservedCheckErrMes").is(":visible"), 30000);
  if ($(".reservedCheckErrMes").is(":visible") || !$("input[name=placeChoice]").length) {
    throw new Error("booking check failed: " + ($("#reservedErrorTitle").text() + " " + $("#reservedErrorMesssage").text()).trim());
  }
}

async function pagePickSlot({ place, date, start }) {
  const $ = window.jQuery;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); }
    return false;
  };
  const radio = $(`input[name=placeChoice]`).filter((i, e) => e.value.startsWith(place + ":"));
  if (!radio.length) throw new Error(`place ${place} not offered`);
  radio.trigger("click");
  if (!(await until(() => $("#page05").is(":visible") && $("#datepicker").hasClass("hasDatepicker")))) throw new Error("date step did not open");

  const [y, m, d] = date.split("-").map(Number);
  $("#datepicker").datepicker("setDate", new Date(y, m - 1, d)).trigger("change");
  if (!$("#visitDate").val().startsWith(date)) throw new Error("could not select date " + date);

  // Time list is fetched live (getres); full sessions are rendered without a radio
  await until(() => $("input[name=visitTime]").length > 0 || $("#visitTimeChoiceList").text().trim() && !$("#waitVisitTimeList").is(":visible"), 30000);
  const t = $("input[name=visitTime]").filter((i, e) => e.value.startsWith(start + ":"));
  if (!t.length) throw new Error(`slot ${date} ${start} no longer available: ${$("#visitTimeChoiceList").text().trim()}`);
  t.trigger("click");
  if (!(await until(() => $("#page06").is(":visible")))) throw new Error("confirm step did not open");
  return $("#page06").text().replace(/\s+/g, " ").trim();
}

async function pageConfirm() {
  const $ = window.jQuery;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  $("#senddata").trigger("click");
  // putres → getcrypto → QR. Success shows the 受付番号; failures show an error in page07
  for (let t = 0; t < 60000; t += 200) {
    const txt = $("#page07").text();
    if ($("#page07").is(":visible") && /\d{12}/.test(txt.replace(/\s/g, ""))) return { ok: true, text: txt.replace(/\s+/g, " ").trim() };
    if ($("#page07").is(":visible") && !$("#loadingqrarea").is(":visible") && txt.trim()) return { ok: false, text: txt.replace(/\s+/g, " ").trim() };
    await wait(200);
  }
  return { ok: false, text: "timed out waiting for result" };
}

// --- driver ---

export async function book(slot, { dryRun = false, keepOpen = true } = {}) {
  const me = loadMe();
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const shotsDir = join(dir, "receipts");
  mkdirSync(shotsDir, { recursive: true });
  const shot = (name) => page.screenshot({ path: join(shotsDir, `${slot.date}_${slot.place}_${slot.start}_${name}.png`), fullPage: true });

  let res = { ok: false, text: "" };
  try {
    await page.goto(START_URL);
    await page.waitForFunction(() => window.jQuery && document.querySelector("#confirmbtn1"));
    await page.evaluate(() => {
      jQuery("input[name=TermsOfServiceCheck]").prop("checked", true).trigger("change");
      jQuery("#confirmbtn1").trigger("click");
    });
    await page.waitForURL(/\/01\/html\/main\.html/);
    await page.waitForFunction(() => window.jQuery && jQuery("input[name=typeChoice]").length && jQuery._data(jQuery("input[name=typeChoice]")[0], "events")?.click);

    await page.evaluate(pageFillDetails, me);
    const summary = await page.evaluate(pagePickSlot, slot);
    await shot("confirm");
    if (dryRun) return (res = { ok: true, dryRun: true, text: summary });

    res = await page.evaluate(pageConfirm);
    await shot(res.ok ? "RECEIPT" : "failed");
    return res;
  } catch (e) {
    await shot("error").catch(() => {});
    return (res = { ok: false, text: e.message });
  } finally {
    // leave the window up after a real booking so the QR is visible; close otherwise
    if (!keepOpen || !res.ok || res.dryRun) await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [place, date, start] = process.argv.slice(2);
  if (!place || !date || !start) {
    console.log("usage: node book.mjs <270|280|250> <YYYY-MM-DD> <HHMM> [--dry-run]");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const res = await book({ place, date, start }, { dryRun, keepOpen: !dryRun });
  console.log(res.ok ? "OK" : "FAILED", res.text);
  if (dryRun || !res.ok) process.exit(res.ok ? 0 : 1);
}
