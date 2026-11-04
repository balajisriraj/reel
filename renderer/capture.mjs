// Captures screens of a web page for a reel: the top of the page and a few scrolled views, at 2x for crisp zooms.
// Prints "shot <file> <label>" for each one.
//
//   node capture.mjs --url https://example.com --out <dir> [--mobile 1]
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { arg, chrome } from "./chrome.mjs";

const url = arg("url");
const out = resolve(arg("out", "."));
const mobile = arg("mobile", "0") === "1";
if (!url) throw new Error("--url is required");

const view = mobile ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 2 };
const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
try {
  const page = await browser.newPage();
  await page.setViewport(view);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  const title = (await page.title()).replace(/\s+/g, " ").trim().slice(0, 60) || new URL(url).hostname;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const stops = Math.min(4, Math.max(1, Math.ceil(height / view.height)));
  const stamp = Date.now();
  for (let i = 0; i < stops; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * view.height * 0.9);
    await new Promise((r) => setTimeout(r, 400));
    const file = `capture-${stamp}-${i}.png`;
    await page.screenshot({ path: resolve(out, file) });
    console.log(`shot ${file} ${title}${i ? ` (${i + 1})` : ""}${mobile ? " mobile" : ""}`);
  }
} finally {
  await browser.close();
}
