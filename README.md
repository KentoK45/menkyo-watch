# menkyo-watch

A bot that watches the 警視庁 運転免許手続予約サイト for **学科試験 cancellations** at 府中・鮫洲・江東. It checks every minute, and when a slot opens it books it for you.

> It only covers **教習所卒業等** (you have a 卒業証明書) with **免許証のみ** (a normal license card, not マイナ免許証). Windows only.

---

## Setup (one time)

### 1. Install Node.js
- Go to **https://nodejs.org** and download the **LTS** version.
- Run the installer and click **Next** through everything with the default settings.

You also need **Microsoft Edge**. It comes with Windows, so you almost certainly have it.

### 2. Download this bot
- At the top of this page, click the green **Code** button, then **Download ZIP**.
- Right-click the downloaded zip, choose **Extract All…**, then **Extract**.
- Move the extracted folder somewhere easy to find, like your Desktop.

### 3. Open a command window in that folder
- Open the folder in File Explorer. You should see files like `watch.mjs` and `README.md`.
- Click the **address bar** at the top (where the folder path is shown), type `cmd` and press **Enter**.
- A black window opens. This is where you type the commands below.

### 4. Install the bot
In the black window, type this and press **Enter**:
```
npm install
```
Wait until the blinking cursor comes back. If it mentions "vulnerabilities", that's normal and safe to ignore.

### 5. Fill in your details
- In the folder, right-click `me.example.json`, choose **Open with**, then **Notepad**.
- Replace the example values with your own. Keep the quote marks `" "` around each value:

| field | what to put | example |
|---|---|---|
| `nameKana` | your name in katakana | `"ヤマダタロウ"` |
| `birth` | your birthday | `"2000-04-01"` |
| `graduationCertNo` | the number on your 卒業証明書 | `"12345678"` |
| `tel` | your phone number, digits only | `"09012345678"` |
| `until` | latest exam date you'd accept | `"2026-10-30"` |

- Click **File**, then **Save As…**
  - At the bottom, change **Save as type** to **All Files**.
  - Set the file name to `me.json`.
  - Click **Save**.

### 6. Check it works
In the black window, type:
```
node watch.mjs --once
```
It should list dates and sessions with 残0, 残1 and so on, then stop. If you see that, everything is set up.

---

## Running the bot

```
node watch.mjs --book
```

- Leave the black window open. It prints a line every minute.
- When it finds a slot, an Edge window opens and books it by itself. **Don't touch that Edge window while it's working.**
- When it succeeds, you get a Windows notification saying **予約完了**, and the Edge window stays on the QR code page. **Take a screenshot of the QR code.** You scan it at the 受付機 on exam day. A copy is also saved in the `receipts` folder.
- After a successful booking the bot stops by itself. **Don't run the `--book` command again after that**, or it might try to book a second time.

If you'd rather just get notified and book yourself, run `node watch.mjs` (without `--book`).

### Good to know
- **To stop the bot:** click the black window and press **Ctrl + C**.
- **After restarting your PC:** repeat step 3 (open the folder, type `cmd` in the address bar), then run the command above.
- **Your PC has to stay on and awake.** Go to Settings > System > Power and set Sleep to "Never" while it's running.
- **If it says 空きを取り逃しました:** someone else got that slot first. That's normal, and the bot keeps watching.
- **Never share your `me.json`.** It contains your personal details.
- **If you see `HTTP 403` errors:** the site is temporarily blocking you for checking too often. Press Ctrl + C, wait about 30 minutes, then start it again. Don't lower `--interval`.

---

## Extra options

- `--until 2026-11-30`: overrides the deadline in `me.json`
- `--interval 60`: seconds between checks (default 60; please don't go much lower)
- `--live-days 7`: how many days ahead get checked live (default 7). Later dates use the site's calendar, which can be up to ~5 minutes behind. Raising this a lot can get you blocked (HTTP 403).
- Phone alerts: install the **ntfy** app and subscribe to a random topic name. Then start the bot with `set NTFY_TOPIC=your-topic && node watch.mjs --book`.
- Test the booking steps without booking: `node book.mjs 270 2026-10-27 0800 --dry-run`. Place codes are 270 府中, 280 鮫洲, 250 江東. It stops before 予約を確定 and saves a screenshot.
- Manual pre-fill bookmarklet: `node make-bookmarklet.mjs` writes `bookmarklet.txt`. Paste its contents as a bookmark's URL. On the booking site, click it on the 利用規約 page, then again on the next page, and it fills in your details. The bookmark contains your details, so don't share it.
