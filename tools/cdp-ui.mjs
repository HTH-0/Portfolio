// 사용: node cdp-ui.mjs <width> <height> <url> <steps.json>
// steps.json: [{ "js": "...", "wait": 300, "shot": "경로.png" }, ...]  js 결과는 출력한다.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [W, H, url, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const prof = mkdtempSync(join(tmpdir(), "cdp-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--allow-file-access-from-files",
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try { const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error("no chrome");
}
const ws = new WebSocket(await getWs());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
  if (process.env.REDUCE) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(2000);
  for (const s of steps) {
    if (s.js) {
      const r = await send("Runtime.evaluate", { expression: s.js, returnByValue: true, awaitPromise: true });
      const v = r.result?.result?.value; const ex = r.result?.exceptionDetails;
      if (ex) console.log("ERR", JSON.stringify(ex.exception?.description || ex.text));
      else if (v !== undefined) console.log(typeof v === "string" ? v : JSON.stringify(v));
    }
    await sleep(s.wait ?? 300);
    if (s.shot) { const sh = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(s.shot, Buffer.from(sh.result.data, "base64")); console.log("shot", s.shot); }
  }
} finally {
  ws.close(); proc.kill(); await sleep(500);
  try { rmSync(prof, { recursive: true, force: true }); } catch {}
}
