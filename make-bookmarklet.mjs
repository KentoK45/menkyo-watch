// Builds a bookmarklet that walks the 学科試験 booking flow up to the 受験場所 choice.
//
//   copy me.example.json me.json   (then edit it with your real details)
//   node make-bookmarklet.mjs      → writes bookmarklet.txt
//
// Make a new bookmark and paste the contents of bookmarklet.txt as its URL.
// Usage on the booking site:
//   1. 利用規約 page (what watch.mjs opens): click the bookmark → agrees and starts.
//   2. Next page: click the bookmark again → picks 学科試験 / 教習所卒業等 / 免許証のみ,
//      fills your details and (if autoNext) presses 次へ.
// You then choose the 試験場, date and time, and press 予約を確定 yourself.
//
// me.json fields: nameKana, birth (YYYY-MM-DD), graduationCertNo, tel, autoNext (bool).
// Note: your details end up inside the bookmark itself.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const me = JSON.parse(readFileSync(resolve(dir, process.argv[2] ?? "me.json"), "utf8"));

const [y, m, d] = me.birth.split("-").map((n) => String(Number(n)));
const data = {
  nameKana: me.nameKana,
  birthYear: y,
  birthMonth: m.padStart(2, "0"),
  birthDay: d.padStart(2, "0"),
  graduationCertNo: String(me.graduationCertNo),
  tel: String(me.tel).replace(/\D/g, ""),
  autoNext: me.autoNext !== false,
};
for (const [k, v] of Object.entries(data)) if (v === "" || v == null) throw new Error(`me.json: ${k} is empty`);

// Runs in the page. Uses the page's own jQuery so its click/change handlers fire.
function run(D) {
  const $ = window.jQuery;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); }
    return false;
  };
  const visible = (sel) => $(sel).is(":visible");
  // Pages slide in/out (nextPage: 200ms delay + 300ms hide + 300ms show); clicking mid-slide breaks it
  const settled = (sel) => visible(sel) && !$(sel).is(":animated") && $("#page01,#page02,#page03,#page04").filter(":visible").length === 1;
  const set = (sel, v) => $(sel).val(v).trigger("input").trigger("change").trigger("keyup").trigger("blur");

  if (!$) return alert("予約サイトのページで実行してください");
  $.fx.off = true; // skip the slide animations: instant page switches, no mid-animation races
  (async () => {
    // Step 0: 利用規約 page
    if ($("input[name=TermsOfServiceCheck]").length) {
      $("input[name=TermsOfServiceCheck]").prop("checked", true).trigger("change");
      $("#confirmbtn1").trigger("click");
      return;
    }
    if (!$("#page01").length) return alert("予約サイトのページで実行してください");

    // Step 1: 学科試験
    if (!visible("#page03")) {
      $("input[name=typeChoice][value=1]").trigger("click");
      if (!(await until(() => settled("#page02")))) return alert("受験項目の画面に進めませんでした");
      // Step 2: 教習所卒業等 + 免許証のみ (clicking the license type re-fires the detail choice → page03)
      $("input[name=typeDetailChoice][value=11]").trigger("click");
      await wait(200);
      $("input[name=newLicenseChoice][value=1]").trigger("click");
      if (!(await until(() => settled("#page03")))) return alert("詳細入力画面に進めませんでした");
    }

    // Step 3: 予約者の情報
    set("#strNameKana", D.nameKana);
    set("#birthYear", D.birthYear);
    set("#birthMonth", D.birthMonth); // rebuilds the day options
    await wait(100);
    set("#birthDay", D.birthDay);
    set("#strGraduationCertificateNumber", D.graduationCertNo);
    set("#strTelNumber", D.tel);
    await wait(300);

    const bad = ["#birthYear", "#birthMonth", "#birthDay"].filter((s) => $(s).val() !== { "#birthYear": D.birthYear, "#birthMonth": D.birthMonth, "#birthDay": D.birthDay }[s]);
    if (bad.length) return alert("生年月日を設定できませんでした: " + bad.join(", "));
    if (D.autoNext) $("#nextPageBtn03").trigger("click");
  })().catch((e) => alert("pre-fill error: " + e.message));
}

const code = `(${run.toString()})(${JSON.stringify(data)})`;
const bookmarklet = "javascript:" + encodeURIComponent(code);
writeFileSync(join(dir, "bookmarklet.txt"), bookmarklet);
console.log(`bookmarklet.txt written (${bookmarklet.length} chars). Paste it as a bookmark URL.`);
