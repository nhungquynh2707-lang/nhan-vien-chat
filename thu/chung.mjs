// Phần chung cho các bài thử: chạy bot.js với khóa giả, giả Facebook (GRAPH_URL), gửi webhook có chữ ký, đọc log.
// Chạy từ thư mục gốc repo: for f in thu/thu-*.mjs; do node "$f" || break; done
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = "thu-secret";

// fb(req, body) trả { status, body } cho từng lời gọi Facebook; mặc định trả 200 {}
export async function chayBot({ port, fbPort, env = {}, fb = () => ({}) }) {
  const goi = [];
  const server = http.createServer((q, r) => {
    let b = "";
    q.on("data", (d) => (b += d));
    q.on("end", () => {
      goi.push(q.method + " " + q.url.split("?")[0]);
      const { status = 200, body = {} } = fb(q, b) || {};
      r.writeHead(status, { "content-type": "application/json" });
      r.end(JSON.stringify(body));
    });
  }).listen(fbPort);
  const bot = spawn("node", ["bot.js"], {
    env: { ...process.env, PORT: port, VERIFY_TOKEN: "thu", ANTHROPIC_API_KEY: "sk-gia", APP_SECRET: SECRET, PAGE_ACCESS_TOKEN: "gia",
      GRAPH_URL: `http://localhost:${fbPort}`, SHOP_FILE: "shop-mau.txt", RAILWAY_VOLUME_MOUNT_PATH: "", ...env },
  });
  let log = "";
  bot.stdout.on("data", (d) => (log += d));
  bot.stderr.on("data", (d) => (log += d));
  await wait(2500);
  const hook = async (key, ev) => {
    const body = JSON.stringify({ object: "page", entry: [{ id: "PAGE", [key]: [ev] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    await fetch(`http://localhost:${port}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body });
  };
  return {
    goi,
    log: () => log,
    khach: (id, text, key = "messaging") => hook(key, { sender: { id }, recipient: { id: "PAGE" }, message: { mid: id + Math.random(), text } }),
    trang: (id, text, app_id, key = "messaging") => hook(key, { sender: { id: "PAGE" }, recipient: { id }, message: { mid: "e" + Math.random(), is_echo: true, app_id, text } }),
    tat: () => { bot.kill(); server.close(); fs.rmSync("state.json", { force: true }); },
  };
}

export function ok(dung, ten) {
  console.log((dung ? "ĐẠT  " : "LỖI  ") + ten);
  if (!dung) process.exitCode = 1;
}
