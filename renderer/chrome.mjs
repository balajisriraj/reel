// Finds a Chrome to drive. Set CHROME_PATH to use a specific one.
import { existsSync } from "node:fs";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

export function chrome() {
  const found = process.env.CHROME_PATH ?? CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome found. Install Google Chrome or set CHROME_PATH.");
  return found;
}

export const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
