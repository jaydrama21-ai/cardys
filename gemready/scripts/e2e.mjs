// End-to-end click-through on a phone-sized headless browser.
//   npm i -D playwright   (once)
//   npm start             (in another terminal; serves the app on :8790)
//   FRONT=front.jpg BACK=back.jpg npm run e2e
// Screens are saved to e2e-shots/ so you can eyeball every step.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8790";
const OUT = process.env.SHOTS || "e2e-shots";
mkdirSync(OUT, { recursive: true });
const errors = [];
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: process.env.SCHEME || "dark", permissions: ["camera"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|jsdelivr|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
let n = 0;
const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true }); };
let askedHelpful = false;
const click = async (sel) => {
  // The "Was this helpful?" sheet can slide up after leaving Outcomes.
  if (!sel.startsWith(".sheet") && (await page.locator('.sheet [data-v="yes"]').count())) {
    if (!askedHelpful) { askedHelpful = true; await shot("helpful"); }
    await page.locator('.sheet [data-v="yes"]').click();
  }
  await page.locator(sel).first().click();
};
const waitHash = (re) => page.waitForFunction((r) => new RegExp(r).test(location.hash), re.source, { timeout: 30000 });

await page.goto(BASE + "/");
await waitHash(/#\/age/); await shot("age");
await page.selectOption("#by", "1994"); await click("#go");
await waitHash(/#\/privacy/); await shot("privacy");
await click('[data-v="on"]');
await waitHash(/#\/tips/); await shot("tips");
await click("#go");
await waitHash(/#\/scan\//); await page.waitForTimeout(1500); await shot("scan-camera");

// Shoot the front with the (fake) camera — exercises the camera + checks path.
await click("#shutter");
await page.waitForTimeout(1200);
if (await page.locator(".sheet").count()) { await shot("retake-sheet"); await click('.sheet [data-v="retake"]'); log("fake camera frame failed photo checks (expected: it isn't a card)"); }

// Upload real-looking photos for front + back.
await page.setInputFiles("#upload", [process.env.FRONT, process.env.BACK].filter(Boolean));
await waitHash(/#\/check\//); await shot("check-photos");
await click('a.btn.primary');
await waitHash(/#\/(fix|estimate)\//);
if (/fix/.test(await page.evaluate(() => location.hash))) {
  await shot("fix-card");
  await page.fill("#q", "umbreon");
  await page.waitForSelector('[data-id="pre-umbreon-ex-sir"]');
  await click('[data-id="pre-umbreon-ex-sir"]');
  await click("#confirm");
}
await waitHash(/#\/estimate\//); await page.waitForSelector(".hero"); await shot("estimate");
const est = await page.locator(".card-box").allInnerTexts();
log("estimate:", est.join(" | ").replace(/\s+/g, " ").slice(0, 400));
await click('a.btn.primary'); // See Outcomes
await waitHash(/#\/outcomes\//); await page.waitForSelector(".out-row"); await shot("outcomes");
log("outcomes:", (await page.locator(".list-box").innerText()).replace(/\s+/g, " "));
await click('a[href^="#/costs/"]'); await waitHash(/#\/costs\//); await page.waitForSelector(".cost"); await shot("costs");
await page.goBack(); await waitHash(/#\/outcomes\//);
await click('a.link[href^="#/compare/"]'); await waitHash(/#\/compare\//); await page.waitForSelector(".grader"); await shot("compare");
await click('[data-g="TAG"]'); await waitHash(/#\/outcomes\//); await page.waitForSelector(".out-row"); await shot("outcomes-tag");
await click('a[href^="#/submit/"]'); await waitHash(/#\/submit\//); await shot("log-submission");
await page.waitForTimeout(500);
await click("#log"); await waitHash(/#\/submissions/); await shot("submissions");
await click('a[href^="#/slab/"]'); await waitHash(/#\/slab\//); await page.fill("#grade", "9"); await shot("slab-result");
await click("#save"); await waitHash(/#\/card\//); await shot("card-detail");
await click("#watch"); await page.waitForTimeout(600); await shot("card-watching");
await page.goto(BASE + "/#/collection"); await page.waitForSelector(".card-row"); await shot("collection");
await page.goto(BASE + "/#/accuracy"); await page.waitForSelector(".card-box"); await shot("accuracy");
await page.goto(BASE + "/#/gradekey"); await shot("gradekey");
await page.goto(BASE + "/#/plan"); await shot("plan");
await page.goto(BASE + "/#/settings"); await page.waitForSelector(".seg"); await shot("settings");
await click('[data-seg="appearance"][data-v="light"]'); await shot("settings-light");
await page.goto(BASE + "/#/help-train"); await shot("help-train");
await page.goto(BASE + "/#/feedback/settings"); await page.fill("#t", "E2E test feedback"); await click("#send"); await page.waitForTimeout(500);
await page.goto(BASE + "/#/delete"); await shot("delete");
await click("#del"); await click('.sheet [data-v="yes"]');
await page.waitForTimeout(1500);
await waitHash(/#\/age/); await shot("after-delete");

// Offline: outcomes for a saved card with the API unreachable.
await browser.close();
console.log(errors.length ? `\nERRORS:\n${errors.join("\n")}` : "\nNo page errors.");
process.exit(errors.length ? 1 : 0);
