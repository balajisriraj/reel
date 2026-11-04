// Pass 1 of Reel's own film: drive the real studio through every feature and record a clip of each.
//
//   node promo/record.mjs --app http://127.0.0.1:8070 --films http://127.0.0.1:8099 --out promo/out/clips
//
// Needs the API running on the scripted director with an empty data dir, and a static server for the two reference
// films (the DebateDojo and Ashariri films, which are this author's own work).
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { arg, chrome } from "../renderer/chrome.mjs";

const APP = arg("app", "http://127.0.0.1:8070");
const FILMS = arg("films", "http://127.0.0.1:8099");
const OUT = resolve(arg("out", resolve(import.meta.dirname, "out/clips")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));

// A visible cursor and a click ripple: headless Chrome draws neither.
await page.evaluateOnNewDocument(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.6 24 L16 22.4 L12.4 15 L19 15 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", filter: "drop-shadow(0 3px 5px rgba(0,0,0,.4))", transform: "translate(-100px,-100px)" });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 3}px)`), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: "36px", height: "36px", borderRadius: "50%", background: "rgba(255,138,61,.45)", zIndex: "2147483646", pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(2.2)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 500);
    }, true);
  });
});

let mouse = { x: 720, y: 450 };
async function moveTo(x, y, steps = 24) {
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(mouse.x + (x - mouse.x) * e, mouse.y + (y - mouse.y) * e);
    await sleep(12);
  }
  mouse = { x, y };
}
async function box(target) {
  const handle = typeof target === "string" ? await page.waitForSelector(target, { visible: true, timeout: 30000 }) : target;
  await handle.evaluate((el) => el.scrollIntoView({ block: "nearest", behavior: "instant" }));
  await sleep(80);
  const b = await handle.boundingBox();
  return { handle, x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function click(target, pause = 350) {
  const { x, y } = await box(target);
  await moveTo(x, y);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(pause);
}
/** The first visible element matching sel whose text contains text. */
async function byText(sel, text) {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t) && e.offsetParent), { timeout: 60000 }, sel, text);
  return page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && e.offsetParent), sel, text);
}
async function type(sel, text, delay = 28) {
  await click(sel, 120);
  await page.keyboard.type(text, { delay });
  await sleep(250);
}
async function scrollPanelTo(text) {
  await page.evaluate((t) => {
    const h = [...document.querySelectorAll(".section > h3")].find((e) => e.textContent.includes(t));
    h?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, text);
  await sleep(900);
}
async function clip(name, fn) {
  const path = resolve(OUT, `${name}.webm`);
  rmSync(path, { force: true });
  const rec = await page.screencast({ path, fps: 30, quality: 10 });
  await sleep(400);
  await fn();
  await sleep(600);
  await rec.stop();
  console.log(`  clip ${name}`);
}

// A logo for the brand step: the Reel mark, as a transparent PNG.
const logo = resolve(OUT, "../reel-logo.png");
{
  const p = await browser.newPage();
  await p.setViewport({ width: 512, height: 512 });
  await p.goto(`${APP}/favicon.svg`);
  await p.screenshot({ path: logo, omitBackground: true });
  await p.close();
}

await page.goto(`${APP}/#/`, { waitUntil: "networkidle0" });
await click(await byText("button", "New reel"), 1200);
await page.waitForSelector(".panel-head h2");

await clip("screen-brief", async () => {
  await page.click(".topbar .name", { clickCount: 3 });
  await page.keyboard.type("Reel launch", { delay: 30 });
  await type('input[placeholder="e.g. Lumen"]', "Reel");
  await type("textarea", "Product films, directed by AI. Reel learns the look of films you love and writes the story.", 14);
  await type('input[placeholder="Busy founders"]', "Product teams");
  await type('input[placeholder="Join the beta"]', "Make your reel");
  await type('input[placeholder="e.g. Inbox zero by lunch"]', "From brief to finished film, in one place");
  await page.keyboard.press("Enter");
  await type('input[placeholder="Add another message"]', "It learns the look of films you love");
  await page.keyboard.press("Enter");
  await type('input[placeholder="Add another message"]', "Every scene written to a proven shape");
  await page.keyboard.press("Enter");
  await scrollPanelTo("Length");
  await click(await byText(".chip", "2 min"), 500);
  await click(await byText(".tile", "9:16"), 700);
  await click(await byText(".tile", "16:9"), 500);
});

await click(await byText(".nav button", "Style"), 800);
await clip("screen-style", async () => {
  await type('textarea[placeholder^="Paste links"]', `${FILMS}/debate-dojo.mp4\n${FILMS}/ashariri.mp4`, 8);
  await click(await byText("button", "Learn the style"), 400);
  await page.waitForFunction(() => document.querySelectorAll(".ref").length === 2, { timeout: 30000 });
  await sleep(1500);
  await page.waitForFunction(() => !document.querySelector(".ref .state"), { timeout: 120000 });
  await sleep(800);
  await page.evaluate(() => document.querySelector(".ref")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  await sleep(2200);
  await page.evaluate(() => document.querySelectorAll(".ref")[1]?.scrollIntoView({ block: "start", behavior: "smooth" }));
  await sleep(2000);
});

await clip("screen-mix", async () => {
  await scrollPanelTo("Mix and match");
  const pick = (row, chip) => `.mixrow:nth-of-type(${row}) .chip:nth-child(${chip})`;
  await click(pick(1, 3), 700); // pace from DebateDojo
  await click(pick(2, 4), 900); // palette from Ashariri
  await click(pick(2, 3), 900); // no: palette from DebateDojo
  await click(pick(3, 3), 600); // energy
  await click(pick(4, 2), 600); // music: a blend of both
  await click(pick(6, 4), 900); // motion from Ashariri
  await page.evaluate(() => document.querySelector(".mixrow:last-of-type")?.parentElement?.querySelector(".card")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  await sleep(1600);
});

await clip("screen-theme", async () => {
  await scrollPanelTo("Theme");
  for (const t of ["Neon", "Editorial", "Swiss", "Cinematic", "Keynote"]) await click(await byText(".theme-tile", t), 1000);
});

await click(await byText(".nav button", "Media"), 800);
await clip("screen-media", async () => {
  await type('input[placeholder="https://your-product.com"]', `${APP}/`);
  await click(await byText("button", "Capture"), 300);
  await page.waitForFunction(() => document.querySelectorAll(".media .card").length >= 1, { timeout: 90000 });
  await sleep(1200);
  await scrollPanelTo("Music");
  await sleep(600);
  await click(".switchrow .toggle", 700);
  await click(".switchrow .toggle", 900);
});

await click(await byText(".nav button", "Brand"), 800);
await clip("screen-brand", async () => {
  const input = await page.$('input[type="file"][accept="image/*"]');
  await moveTo(260, 230);
  await input.uploadFile(logo);
  await page.waitForSelector(".logo-prev img", { timeout: 30000 });
  await sleep(1400);
  await scrollPanelTo("Type");
  await click(await byText(".tile", "Rounded"), 700);
  await click(await byText(".tile", "Theme"), 600);
  await scrollPanelTo("Watermark");
  await type('input[placeholder="@yourbrand"]', "Made with Reel");
  await click(".corner button:nth-child(2)", 900);
});

await click(await byText(".nav button", "Story"), 800);
await clip("screen-story", async () => {
  await click(await byText(".tile", "Save the Cat"), 900);
  await click(await byText(".chip", "Witty"), 500);
  await click(await byText("button", "Write the script"), 300);
  await page.waitForSelector(".scene", { timeout: 60000 });
  await sleep(1000);
  await scrollPanelTo("Key message coverage");
  await sleep(1400);
  await page.evaluate(() => document.querySelector(".panel")?.scrollBy({ top: 520, behavior: "smooth" }));
  await sleep(1600);
});

await clip("screen-rewrite", async () => {
  const card = (await page.$$(".scene"))[4];
  await click(card, 700);
  const chip = await card.evaluateHandle((el) => [...el.querySelectorAll(".chip")].find((c) => c.textContent.includes("As a question")));
  await click(chip, 1400);
  const shorter = await card.evaluateHandle((el) => [...el.querySelectorAll(".chip")].find((c) => c.textContent.includes("Punchier")));
  await click(shorter, 1400);
});

await clip("screen-preview", async () => {
  await click(".play", 6500);
  await click(".play", 400);
  const s = await page.$(".scrub");
  const b = await s.boundingBox();
  await moveTo(b.x + b.width * 0.15, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 50; i++) {
    await page.mouse.move(b.x + b.width * (0.15 + 0.6 * (i / 50)), b.y + b.height / 2);
    await sleep(40);
  }
  await page.mouse.up();
  mouse = { x: b.x + b.width * 0.75, y: b.y + b.height / 2 };
  await sleep(500);
});

await click(await byText(".nav button", "Render"), 800);
await clip("screen-render", async () => {
  await click(await byText("button", "Render the reel"), 300);
  await sleep(6500);
});
await page.waitForFunction(() => document.querySelector(".render video"), { timeout: 900000 });
await sleep(800);
await clip("screen-done", async () => {
  await click(".render video", 300);
  await page.evaluate(() => document.querySelector(".render video")?.play());
  await sleep(5000);
});

await browser.close();
console.log(`clips in ${OUT}`);
