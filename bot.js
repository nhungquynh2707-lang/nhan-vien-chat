// Nhân viên chat AI cho fanpage Facebook Messenger, dùng Claude Haiku 5.5.
// Chạy: node --env-file=.env bot.js
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const {
  PAGE_ACCESS_TOKEN,
  APP_SECRET,
  VERIFY_TOKEN,
  PORT = "3000",
  MODEL = "claude-haiku-5-5",
  SHIP_FEE = "20000",
  FREE_SHIP_FROM = "180000",
  PAUSE_HOURS = "12",
  GRAPH_VERSION = "v21.0",
} = process.env;

for (const [k, v] of Object.entries({ VERIFY_TOKEN, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY })) {
  if (!v) { console.error(`Thiếu biến ${k} (đặt trong Variables của Railway hoặc file .env)`); process.exit(1); }
}
if (!PAGE_ACCESS_TOKEN || !APP_SECRET) console.warn("Chưa có PAGE_ACCESS_TOKEN / APP_SECRET: chưa nhận tin từ fanpage, chỉ dùng được trang /thu");

const client = new Anthropic();
const SHOP_INFO = fs.readFileSync(new URL("./shop.txt", import.meta.url), "utf8");
// Railway tự đặt RAILWAY_VOLUME_MOUNT_PATH khi gắn Volume: lưu ở đó để không mất khi cập nhật bot
const VOL = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const STATE_FILE = VOL ? `${VOL}/state.json` : new URL("./state.json", import.meta.url);
const BOT_TAG = "ai-bot"; // gắn vào tin AI gửi để phân biệt với tin người thật gửi
const DEBOUNCE_MS = 2500; // gom các tin khách gửi liên tiếp thành một lượt
const IDLE_RESET_MS = 24 * 3600 * 1000; // khách quay lại sau 24h thì bắt đầu cuộc chat mới
const PAUSE_MS = Number(PAUSE_HOURS) * 3600 * 1000;

// ---------- Lưu trạng thái từng khách (lịch sử chat, tạm dừng AI) ----------
let state = { users: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 1000);
}
function user(id) {
  return (state.users[id] ??= { history: [], pausedUntil: 0, lastActive: 0 });
}
function pause(id, reason) {
  const u = user(id);
  u.pausedUntil = Date.now() + PAUSE_MS;
  u.history = []; // khi AI quay lại sẽ bắt đầu cuộc chat mới
  saveState();
  console.log(`[tạm dừng AI] khách ${id}: ${reason}`);
}

// ---------- Hướng dẫn cho nhân viên AI ----------
const SYSTEM = `Bạn là nhân viên chăm sóc khách hàng của cửa hàng dưới đây, trả lời tin nhắn Facebook Messenger bằng tiếng Việt.

Làm đúng theo hướng dẫn của cửa hàng bên dưới (phong cách, câu mẫu, cách lấy thông tin đặt hàng). Không dùng markdown (không **, không #).

BẠN LÀ NHÂN VIÊN BÁN HÀNG GIỎI, không phải máy trả lời. Mỗi tin gồm 3 phần, tổng cộng 2–3 câu ngắn (dưới 50 chữ), không liệt kê, không markdown:
1. Trả lời thẳng câu khách hỏi.
2. Một điểm hay của sản phẩm hợp với nhu cầu khách (ví dụ: giàu đạm và canxi tự nhiên, sấy lạnh không chất bảo quản, giữ nguyên con nên gà/chim thích mổ). Không hứa chữa bệnh hay tăng trưởng vượt trội.
3. Một câu hỏi dẫn tới chốt đơn: hỏi khách nuôi bao nhiêu con để tư vấn số kg, hoặc gợi ý gói cụ thể (2kg trở lên được miễn ship nên có lợi hơn), hoặc hỏi lấy mấy kg.
Không hỏi lại thứ khách đã nói. Không lặp lại cùng một câu hỏi: nếu đã hỏi "nuôi con gì, mấy con" mà khách lờ đi thì lần sau hỏi thẳng "anh lấy mấy kg" hoặc gợi ý gói 2kg, không hỏi lại câu cũ.
Khách hỏi gộp nhiều gói (ví dụ 1kg với 0,5kg): coi là một đơn, gọi tinh_tong_don để báo tổng tiền cả đơn gồm ship.
Khách bực bội, chê bot trả lời không đúng: xin lỗi ngắn, hỏi lại khách đang cần biết điều gì để em trả lời đúng. Chỉ chuyển nhân viên nếu khách bực lần nữa hoặc đòi gặp người thật.

MỤC TIÊU DUY NHẤT: chốt được đơn. Dẫn khách theo lộ trình: biết khách nuôi con gì, bao nhiêu con → gợi ý một gói cụ thể → khách đồng ý thì xin số điện thoại và địa chỉ → chốt bằng câu mẫu. Mỗi tin đều phải đẩy khách tiến thêm một bước.
- Khách chọn 0,5kg hoặc 1kg: gợi ý một lần duy nhất lên gói 2kg ("1kg là 110k gồm ship, thêm 70k lấy 2kg được miễn ship, dùng lâu hơn mà lợi hơn ạ"). Khách vẫn giữ ý thì chốt theo ý khách, không nài.
- Khách đã chọn xong số kg thì không bán thêm, chỉ xin thông tin còn thiếu.
- Khách lo lắng về chất lượng hoặc sợ mua nhầm: nhấn mạnh nhận hàng kiểm tra rồi mới trả tiền (COD).
- Khách hỏi giá: báo đúng giá, rồi hỏi khách nuôi bao nhiêu con hoặc lấy mấy kg.
- Khách im lặng sau khi nghe giá rồi hỏi tiếp chuyện khác: trả lời, rồi nhẹ nhàng hỏi lại lấy mấy kg.
Khách nhắn cụt, sai chính tả hoặc nhắn tiếp theo câu trước (ví dụ "gà đá", "ăn được gì", "mấy ngày") thì hiểu theo ngữ cảnh cuộc chat.

Ví dụ cách trả lời tốt:
Khách: "gà đá ăn được không" → "Dạ được ạ, sâu canxi giàu đạm và canxi tự nhiên, nhiều anh em nuôi gà đá hay dùng bổ sung cho gà. Anh đang nuôi khoảng mấy con để em tư vấn lượng cho phù hợp ạ?"
Khách: "nuôi 10 con" → "Dạ 10 con thì anh lấy gói 2kg là vừa, 180k được miễn ship luôn ạ. Anh lấy gói này để em lên đơn nha?"
Khách: "mấy ngày nhận được" → "Dạ khoảng 2–4 ngày tùy khu vực ạ, nhận hàng rồi mới trả tiền nên anh yên tâm. Anh định lấy mấy kg để em báo giá luôn ạ?"

Ảnh: khách hỏi xem ảnh, hình thật, sâu trông thế nào, có khô không, đóng gói ra sao, hoặc còn nghi ngờ chất lượng thì gọi gui_anh (chọn loại phù hợp) kèm một câu ngắn, rồi hỏi tiếp để chốt đơn. Mỗi loại ảnh chỉ gửi một lần trong cuộc chat.

Lưu đơn: ngay khi chốt đơn (khách đã chọn số kg và có đủ số điện thoại, địa chỉ), gọi công cụ luu_don rồi mới trả lời câu chốt mẫu.
Khách quen: nếu có mục "KHÁCH QUEN" bên dưới, đây là khách đã mua. Chào thân mật như khách quen. Khách muốn mua lại hoặc nói "như cũ", "địa chỉ cũ" thì dùng luôn số điện thoại, địa chỉ và đơn cũ, chỉ hỏi xác nhận nhanh một câu (ví dụ "Dạ anh lấy 2kg như lần trước, gửi về 12 Lê Lợi Huế đúng không ạ?"), không hỏi lại từ đầu.

Tính tiền: khi khách đặt nhiều gói, gọi công cụ tinh_tong_don để tính tổng, không tự cộng nhẩm.

Chuyển cho nhân viên thật: gọi công cụ chuyen_nhan_vien khi khách muốn gặp người thật / nhân viên / chủ shop, khi khách muốn hoàn tiền hoặc đổi trả, hoặc khi khách hỏi đi hỏi lại một điều bạn không có thông tin. CHỈ những trường hợp đó. Chuyển nhân viên là mất khách, nên hạn chế tối đa.
Câu hỏi không có trong hướng dẫn: KHÔNG chuyển nhân viên ngay. Nói thật ngắn gọn ("Dạ cái này bên em chưa có ạ" hoặc "Dạ phần này em ghi lại để shop báo anh sau ạ"), nói điều liên quan mà bên em có, rồi quay lại dẫn khách chốt đơn. Không bịa. Với khiếu nại (hàng vỡ, ẩm, mùi lạ, thiếu, sai, giao chậm): xin lỗi và mời khách gửi hình ảnh theo mẫu trước, sau đó mới gọi chuyen_nhan_vien.

Bạn chỉ trả lời khi khách nhắn, không tự nhắc tin sau 30 phút.

Chỉ dùng thông tin cửa hàng dưới đây, không bịa.

THÔNG TIN CỬA HÀNG:
${SHOP_INFO}`;

const TOOLS = [
  {
    name: "tinh_tong_don",
    description: "Tính tạm tính, phí ship và tổng tiền của đơn hàng. Gọi mỗi khi cần báo tổng tiền cho khách.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ten", "so_luong", "don_gia"],
            properties: {
              ten: { type: "string", description: "Tên sản phẩm" },
              so_luong: { type: "integer", description: "Số lượng" },
              don_gia: { type: "integer", description: "Đơn giá đang bán (đồng), ví dụ 319000" },
            },
          },
        },
      },
    },
  },
  {
    name: "gui_anh",
    description: "Gửi ảnh thật của sản phẩm cho khách. san_pham: túi 1kg có nhãn + sâu cận cảnh. can_canh: sâu khô bẻ đôi giòn + sâu cận cảnh. dong_goi: túi zip đóng gói.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["loai"],
      properties: { loai: { type: "string", enum: ["san_pham", "can_canh", "dong_goi"] } },
    },
  },
  {
    name: "luu_don",
    description: "Lưu đơn đã chốt vào sổ khách quen để lần sau khách mua lại không phải hỏi lại. Gọi đúng một lần khi chốt đơn.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["sdt", "dia_chi", "noi_dung"],
      properties: {
        sdt: { type: "string", description: "Số điện thoại người nhận" },
        dia_chi: { type: "string", description: "Địa chỉ giao hàng đầy đủ" },
        noi_dung: { type: "string", description: "Hàng đã đặt và tổng tiền, ví dụ: 2kg, 180.000đ miễn ship" },
      },
    },
  },
  {
    name: "chuyen_nhan_vien",
    description: "Chuyển cuộc trò chuyện cho nhân viên thật. Sau khi gọi, AI ngừng trả lời khách này.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["ly_do"],
      properties: { ly_do: { type: "string", description: "Lý do chuyển, ngắn gọn" } },
    },
  },
];

const vnd = (n) => n.toLocaleString("vi-VN") + "đ";
function tinhTongDon({ items }) {
  const tamTinh = items.reduce((s, it) => s + it.so_luong * it.don_gia, 0);
  const ship = tamTinh >= Number(FREE_SHIP_FROM) ? 0 : Number(SHIP_FEE);
  return {
    chi_tiet: items.map((it) => `${it.ten} x${it.so_luong} = ${vnd(it.so_luong * it.don_gia)}`),
    tam_tinh: vnd(tamTinh),
    phi_ship: ship ? vnd(ship) : "Miễn phí",
    tong_cong: vnd(tamTinh + ship),
  };
}

// ---------- Sổ khách quen (giữ mãi, kể cả khi lịch sử chat bị xóa) ----------
function luuDon(u, { sdt, dia_chi, noi_dung }) {
  const k = (u.khach ??= { don: [] });
  Object.assign(k, { sdt, dia_chi });
  k.don.push({ ngay: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), noi_dung });
  k.don = k.don.slice(-10); // shortcut: chỉ giữ 10 đơn gần nhất, đủ cho tư vấn
  saveState();
  console.log("[đơn mới]", sdt, dia_chi, noi_dung);
  return { da_luu: true };
}
const khachQuen = (k) =>
  `KHÁCH QUEN: số điện thoại ${k.sdt}, địa chỉ ${k.dia_chi}. Các đơn đã mua: ` +
  k.don.map((d) => `${d.ngay}: ${d.noi_dung}`).join("; ") + ".";

// ---------- Ảnh sản phẩm (thư mục anh/) ----------
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
const ANH = {
  san_pham: ["nhan-1kg.jpg", "can-canh-2.jpg"],
  can_canh: ["be-doi.jpg", "can-canh-1.jpg"],
  dong_goi: ["tui-zip.jpg"],
};

// ---------- Gọi Claude ----------
const HANDOFF_TEXT = "Dạ anh/chị đợi em một chút, em chuyển nhân viên hỗ trợ mình ngay ạ.";

async function reply(id, customerText, send = sendFb) {
  const u = user(id);
  if (Date.now() - u.lastActive > IDLE_RESET_MS) u.history = [];
  u.lastActive = Date.now();
  const messages = u.history;
  // Chụp thông tin khách quen lúc mở cuộc chat: system không được đổi giữa chừng (Claude báo lỗi chữ ký thinking)
  if (!messages.length) u.ctx = u.khach ? khachQuen(u.khach) : null;
  messages.push({ role: "user", content: customerText });

  for (let step = 0; step < 5; step++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: u.ctx ? [{ type: "text", text: SYSTEM }, { type: "text", text: u.ctx }] : SYSTEM,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

    if (res.stop_reason === "refusal") {
      await send(id, HANDOFF_TEXT);
      return pause(id, "AI từ chối trả lời");
    }
    const calls = res.content.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      saveState();
      return send(id, text || HANDOFF_TEXT);
    }
    const handoff = calls.find((c) => c.name === "chuyen_nhan_vien");
    if (handoff) {
      await send(id, text || HANDOFF_TEXT);
      return pause(id, handoff.input?.ly_do || "khách cần người thật");
    }
    if (text) await send(id, text);
    const pending = [];
    messages.push({
      role: "user",
      content: calls.map((c) => {
        try {
          if (c.name === "gui_anh") {
            pending.push(...(ANH[c.input.loai] ?? []).map((f) => ({ image: `${BASE_URL}/anh/${f}` })));
            return { type: "tool_result", tool_use_id: c.id, content: "Đã gửi ảnh cho khách." };
          }
          const out = c.name === "luu_don" ? luuDon(u, c.input) : tinhTongDon(c.input);
          return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: c.id, content: "Lỗi tính tiền: " + e.message, is_error: true };
        }
      }),
    });
    for (const img of pending) await send(id, img);
  }
  await send(id, HANDOFF_TEXT);
  pause(id, "AI không hoàn thành được câu trả lời");
}

// ---------- Facebook Messenger ----------
async function graph(body) {
  const base = process.env.GRAPH_URL || "https://graph.facebook.com"; // GRAPH_URL chỉ dùng khi chạy thử
  const r = await fetch(`${base}/${GRAPH_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error("Lỗi gửi tin Facebook:", r.status, await r.text());
}
async function sendFb(id, text) {
  if (text.image) {
    return graph({ recipient: { id }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url: text.image, is_reusable: true } }, metadata: BOT_TAG } });
  }
  for (let i = 0; i < text.length; i += 1900) {
    await graph({ recipient: { id }, messaging_type: "RESPONSE", message: { text: text.slice(i, i + 1900), metadata: BOT_TAG } });
  }
}
const typing = (id) => graph({ recipient: { id }, sender_action: "typing_on" });

// Gom tin nhắn liên tiếp và xử lý lần lượt từng khách
const buffers = new Map();
const queues = new Map();
function enqueue(id, text) {
  const b = buffers.get(id) ?? { parts: [] };
  b.parts.push(text);
  clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    buffers.delete(id);
    const joined = b.parts.join("\n");
    const prev = queues.get(id) ?? Promise.resolve();
    const next = prev.then(() => handle(id, joined));
    queues.set(id, next.catch(() => {}));
  }, DEBOUNCE_MS);
  buffers.set(id, b);
}
async function handle(id, text) {
  if (user(id).pausedUntil > Date.now()) return; // người thật đang phụ trách khách này
  try {
    await typing(id);
    await reply(id, text, sendFb);
  } catch (e) {
    console.error("Lỗi khi trả lời khách", id, e);
    user(id).history = [];
    saveState();
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) {
      await sendFb(id, "Dạ anh/chị đợi em một chút, em kiểm tra rồi trả lời mình ngay ạ.");
    }
  }
}

const app = express();
app.use("/anh", express.static(fileURLToPath(new URL("./anh", import.meta.url))));
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  if (!APP_SECRET) return res.sendStatus(503);
  const sig = req.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.sendStatus(403);
  }
  res.sendStatus(200);
  if (req.body.object !== "page") return;

  for (const entry of req.body.entry ?? []) {
    // Ghi lại loại sự kiện để dò lỗi (không ghi nội dung tin)
    console.log("[webhook] trang", entry.id, "messaging:", (entry.messaging ?? []).length, "standby:", (entry.standby ?? []).length);
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message;
      if (msg?.is_echo) {
        // Tin do fanpage gửi. Không có nhãn của AI = người thật đang trả lời khách
        if (msg.metadata !== BOT_TAG) pause(ev.recipient.id, "chủ shop tự trả lời");
        continue;
      }
      const id = ev.sender?.id;
      if (!id) continue;
      if (msg?.text) enqueue(id, msg.text);
      else if (msg?.attachments) enqueue(id, "[Khách gửi " + msg.attachments.map((a) => (a.type === "image" ? "một hình ảnh" : "một tệp")).join(", ") + "]");
      else if (ev.postback) enqueue(id, ev.postback.title || ev.postback.payload || "Bắt đầu");
    }
  }
});

// ---------- Trang kiểm tra kết nối fanpage: /kiemtra?key=<VERIFY_TOKEN> (thêm &dangky=1 để đăng ký lại) ----------
app.get("/kiemtra", async (req, res) => {
  if (!okKey(req.query.key)) return res.sendStatus(403);
  const g = (path, opts) =>
    fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}${path.includes("?") ? "&" : "?"}access_token=${PAGE_ACCESS_TOKEN}`, opts).then((r) => r.json());
  const out = {};
  if (req.query.dangky) out.dang_ky_lai = await g("me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes", { method: "POST" });
  out.trang = await g("me?fields=id");
  out.ung_dung_dang_ky = await g("me/subscribed_apps");
  res.json(out);
});

// ---------- Trang chạy thử: https://<địa-chỉ>/thu?key=<VERIFY_TOKEN> ----------
const TEST_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chạy thử nhân viên chat</title><style>body{font:15px system-ui;max-width:560px;margin:0 auto;padding:16px}
#log div{margin:6px 0;padding:8px 12px;border-radius:14px;max-width:80%;white-space:pre-wrap}.k{background:#0a6cff;color:#fff;margin-left:auto!important}
.a{background:#eceff4}.n{color:#666;font-size:13px;text-align:center}form{display:flex;gap:8px}input{flex:1;padding:10px;border-radius:20px;border:1px solid #ccc}</style>
<h3>Chạy thử nhân viên chat (Haiku thật)</h3><div id="log" style="display:flex;flex-direction:column"></div>
<form id="f"><input id="t" placeholder="Nhắn như khách…" autocomplete="off"><button>Gửi</button></form>
<p><button id="r">Cuộc chat mới</button> <button id="q">Khách cũ quay lại</button></p><script>
const key=new URLSearchParams(location.search).get("key");let id="thu-"+Date.now();
const add=(t,c)=>{const d=document.createElement("div");d.className=c;if(t.image){const i=document.createElement("img");i.src=t.image;i.style.maxWidth="220px";d.appendChild(i)}else d.textContent=t;log.appendChild(d)};
let quay=false;r.onclick=()=>{id="thu-"+Date.now();log.textContent=""};
q.onclick=()=>{quay=true;log.textContent="";add("(Cùng khách, lịch sử chat đã xóa như khi quay lại hôm sau)","n")};
f.onsubmit=async e=>{e.preventDefault();const text=t.value.trim();if(!text)return;t.value="";add(text,"k");
const res=await fetch("/thu",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key,id,text,quay})});quay=false;
const j=await res.json();(j.replies||[]).forEach(x=>add(x,"a"));if(j.note)add(j.note,"n")}</script>`;
const okKey = (k) => typeof k === "string" && k === VERIFY_TOKEN;
app.get("/thu", (req, res) => (okKey(req.query.key) ? res.send(TEST_PAGE) : res.sendStatus(403)));
app.post("/thu", async (req, res) => {
  const { key, id, text, quay } = req.body || {};
  if (!okKey(key) || !id || !text) return res.sendStatus(403);
  if (quay) Object.assign(user(id), { history: [], pausedUntil: 0 });
  if (user(id).pausedUntil > Date.now()) return res.json({ replies: [], note: "AI đang tạm dừng với khách này (đã chuyển người thật). Bấm Cuộc chat mới." });
  const replies = [];
  try {
    await reply(id, String(text), async (_id, t) => { replies.push(t); });
  } catch (e) {
    console.error(e);
    return res.json({ replies, note: "Lỗi: " + e.message });
  }
  const paused = user(id).pausedUntil > Date.now();
  res.json({ replies, note: paused ? "→ AI đã chuyển cho người thật và tạm dừng với khách này." : "" });
});

app.get("/", (_req, res) => res.send("Nhân viên chat đang chạy"));
app.listen(Number(PORT), () => console.log(`Đang chạy ở cổng ${PORT}, mô hình ${MODEL}`));
