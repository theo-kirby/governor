// Screenshot a viewer URL: node scripts/shot.mjs <url> <out.png> [width] [height] [actions-json]
// actions: [{"key":"="}, {"wait":300}, {"click":[x,y]}, {"hover":[x,y]}]
import { chromium } from "@playwright/test";

const [url, out, w = "1600", h = "1200", actions = "[]"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(800);
for (const a of JSON.parse(actions)) {
  if (a.key) await page.keyboard.press(a.key);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.click) await page.mouse.click(...a.click);
  if (a.hover) await page.mouse.move(...a.hover);
  if (a.wheel) {
    await page.mouse.move(a.wheel[0], a.wheel[1]);
    await page.mouse.wheel(0, a.wheel[2]);
  }
}
await page.waitForTimeout(400);
await page.screenshot({ path: out });
const data = await page.$eval("canvas", (c) => ({ ...c.dataset }));
console.log(JSON.stringify({ data, errors }));
await browser.close();
