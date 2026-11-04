// Renders a reel: opens the film engine's render page, writes the resolved timeline, then steps through every frame
// into ffmpeg. Prints "timeline" once the timeline is written and "progress <0..1>" as it goes.
//
//   node render.mjs --url http://127.0.0.1:8070/render.html?project=prj_x --out <dir> [--fps 30] [--scale 1]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { arg, chrome } from "./chrome.mjs";

const url = arg("url");
const out = resolve(arg("out", "."));
const fps = Number(arg("fps", 30));
const scale = Number(arg("scale", 1));
if (!url) throw new Error("--url is required");

const browser = await puppeteer.launch({
  executablePath: chrome(),
  headless: true,
  protocolTimeout: 900000,
  args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: scale });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction("window.READY !== undefined", { timeout: 60000 });
  const timeline = await page.evaluate(async () => {
    await window.READY;
    await document.fonts.ready;
    return window.TIMELINE;
  });
  if (!timeline) throw new Error(`The film didn't load: ${errors.join("; ") || "no timeline"}`);
  await page.setViewport({ width: timeline.width, height: timeline.height, deviceScaleFactor: scale });
  writeFileSync(resolve(out, "timeline.json"), JSON.stringify(timeline, null, 1));
  console.log("timeline");

  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", scale < 1 ? "22" : "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    resolve(out, "silent.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.ceil(timeline.duration * fps);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.renderAt(t), f / fps);
    const jpg = await page.screenshot({ type: "jpeg", quality: 92, optimizeForSpeed: true });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % fps === 0) console.log(`progress ${(f / frames).toFixed(4)}`);
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on("close", r));
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  if (errors.length) console.error(`page warnings: ${errors.slice(0, 3).join("; ")}`);
  console.log("progress 1");
} finally {
  await browser.close();
}
