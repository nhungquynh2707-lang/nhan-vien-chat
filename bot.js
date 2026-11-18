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
// SHOP_FILE: dùng chung code cho page khác (mỗi page một service Railway). Page khác không có ảnh sâu nên bỏ gui_anh.
const SHOP_FILE = process.env.SHOP_FILE || "shop.txt";
const SHOP_INFO = fs.readFileSync(new URL("./" + SHOP_FILE, import.meta.url), "utf8");
// Ảnh sản phẩm của shop thuê: ANH_FILE=anh/<shop>/anh.json dạng {"loai": {"mo_ta": "...", "anh": ["<shop>/a.jpg"]}} (đường dẫn trong anh/)
// CHOT_TU_VIET=1: khi chốt đơn bot tự viết câu tổng đơn theo kịch bản shop (thay câu chốt cố định)
const CHOT_TU_VIET = !!process.env.CHOT_TU_VIET;
const ANH_SHOP = process.env.ANH_FILE ? JSON.parse(fs.readFileSync(new URL("./" + process.env.ANH_FILE, import.meta.url), "utf8")) : null;
// Railway tự đặt RAILWAY_VOLUME_MOUNT_PATH khi gắn Volume: lưu ở đó để không mất khi cập nhật bot
const VOL = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const STATE_FILE = VOL ? `${VOL}/state.json` : new URL("./state.json", import.meta.url);
const BOT_TAG = "ai-bot"; // gắn vào tin AI gửi để phân biệt với tin người thật gửi
const DEBOUNCE_MS = 10000; // gom các tin khách gửi liên tiếp thành một lượt
const IDLE_RESET_MS = 24 * 3600 * 1000; // khách quay lại sau 24h thì bắt đầu cuộc chat mới
const PAUSE_MS = Number(PAUSE_HOURS) * 3600 * 1000;
// Chuyển nhân viên (khiếu nại, đổi hàng...) dừng lâu hơn nếu đặt HANDOFF_HOURS; không đặt thì như PAUSE_HOURS
const HANDOFF_MS = Number(process.env.HANDOFF_HOURS || PAUSE_HOURS) * 3600 * 1000;
// NHUONG_NHAN_VIEN=1: nhân viên tự trả lời khách CHƯA có đơn thì bot không dừng PAUSE_HOURS;
// mỗi lượt tin của khách chưa có đơn bot chờ NHUONG_GIAY (mặc định 60 giây), nhân viên chưa trả lời thì bot trả lời
const NHUONG_NV = !!process.env.NHUONG_NHAN_VIEN;
const NHUONG_MS = (Number(process.env.NHUONG_GIAY) || 60) * 1000;
const CO_DON = /SPXVN|Xác nhận đơn|giao thành công|chuẩn bị và gửi/i;

// ---------- Lưu trạng thái từng khách (lịch sử chat, tạm dừng AI) ----------
let state = { users: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
// Đặt biến XOA_TAM_DUNG=1 trên Railway để bỏ mọi lệnh tạm dừng (dùng khi thử nghiệm), rồi xóa biến đi
if (process.env.XOA_TAM_DUNG) for (const u of Object.values(state.users)) u.pausedUntil = 0;
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 1000);
}
function user(id) {
  return (state.users[id] ??= { history: [], pausedUntil: 0, lastActive: 0 });
}
// Người thật (hoặc ứng dụng khác) vừa nhắn khách
function nvTraLoi(id, reason, text = "") {
  const u = user(id);
  if (CO_DON.test(text)) u.coDon = true;
  if (NHUONG_NV && !u.khach && !u.coDon) {
    u.nvLuc = Date.now();
    u.history = []; // lượt sau đọc lại lịch sử Facebook để biết nhân viên đã nói gì
    saveState();
    return console.log(`[nhân viên trả lời] khách ${id} chưa có đơn: bot không dừng, chờ tin sau`);
  }
  pause(id, reason);
}
function pause(id, reason, ms = PAUSE_MS) {
  const u = user(id);
  u.pausedUntil = Math.max(u.pausedUntil || 0, Date.now() + ms); // không rút ngắn lệnh dừng dài hơn đang có
  u.history = []; // khi AI quay lại sẽ bắt đầu cuộc chat mới
  saveState();
  console.log(`[tạm dừng AI] khách ${id}: ${reason}`);
}

// ---------- Hướng dẫn cho nhân viên AI ----------
const SYSTEM = `Bạn là nhân viên chăm sóc khách hàng của cửa hàng dưới đây, trả lời tin nhắn Facebook Messenger bằng tiếng Việt.

Làm đúng theo hướng dẫn của cửa hàng bên dưới (phong cách, câu mẫu, cách lấy thông tin đặt hàng). Không dùng markdown (không **, không #).

BẠN LÀ NHÂN VIÊN BÁN HÀNG GIỎI, không phải máy trả lời. Mỗi tin TỐI ĐA 2 câu ngắn, dưới 30 chữ, nói như nhắn tin điện thoại, không liệt kê, không markdown. Chỉ thêm phần 2 khi khách còn phân vân; khi khách đã chọn số kg hoặc đang cho thông tin thì bỏ phần 2, chỉ trả lời và hỏi đúng thứ còn thiếu:
KẾT THÚC: nếu shop vừa cảm ơn hoặc vừa nói câu chốt mà khách chỉ gửi lại 👍, like, nhãn dán, "ok", "cảm ơn" (không hỏi gì) thì trả lời đúng chữ [KHÔNG TRẢ LỜI] để không nhắn thêm.
ĐƠN ĐANG GIAO: nếu LỊCH SỬ CHAT có tin "mã vận đơn ... đã được vận chuyển" mà CHƯA có tin "đã được giao thành công" sau đó, thì đơn trước còn đang trên đường. Khách nhắn lại tên gói, giá, tin quảng cáo (ví dụ "*2kg Sâu Canxi #180k miễn ship"), hỏi đơn, hay nhắn chung chung: KHÔNG lên đơn mới, KHÔNG hỏi địa chỉ, chỉ trả lời "Dạ đơn của anh/chị đang được vận chuyển rồi ạ, mình đợi giúp em nhé." Chỉ coi là đơn MỚI khi khách nói rõ muốn mua thêm (ví dụ "gửi thêm", "lấy thêm", "đặt nữa", "5kg nữa").
Khách chọn mua mà CHƯA nói "địa chỉ cũ"/"như cũ" và chưa gửi SĐT, địa chỉ trong cuộc chat này: nếu LỊCH SỬ CHAT hoặc KHÁCH QUEN có địa chỉ cũ thì KHÔNG được chốt ngay, KHÔNG gọi luu_don; hỏi xác nhận một câu, ví dụ "Dạ em gửi 2kg (180k miễn ship) về địa chỉ cũ Thôn Phú Hòa, Yên Hòa, Cẩm Xuyên, Hà Tĩnh đúng không ạ?". Khách đồng ý (ừ, đúng, ok, like…) thì mới gọi luu_don và nói câu chốt; khách đổi địa chỉ thì xin địa chỉ mới.
KHÔNG BAO GIỜ nói shop sẽ gọi điện, không dặn khách "chú ý điện thoại", "để ý máy" (shop không gọi khách). Khách cảm ơn, like hoặc gửi nhãn dán sau khi đã chốt đơn: chỉ trả lời "Dạ em cảm ơn anh/chị ạ!".
Khách nói "địa chỉ cũ", "như cũ", "như lần trước", "gửi như lần trước", hoặc nhắc là đã mua/đã cho thông tin rồi ("mua rồi mà", "mua 2 lần rồi", "bạn còn địa chỉ chứ", "có số rồi mà"): nếu LỊCH SỬ CHAT hoặc KHÁCH QUEN có số điện thoại và địa chỉ thì gọi luu_don với thông tin đó trước; dù có hay không, trả lời đúng câu "Dạ! Để em chuẩn bị và gửi luôn ạ." rồi dừng, KHÔNG hỏi lại số điện thoại hay địa chỉ (nhân viên tự tra thông tin cũ).
1. Trả lời thẳng câu khách hỏi.
2. Một điểm hay của sản phẩm hợp với nhu cầu khách (ví dụ: giàu đạm và canxi tự nhiên, sấy lạnh không chất bảo quản, giữ nguyên con nên gà/chim thích mổ). Không hứa chữa bệnh hay tăng trưởng vượt trội.
3. Một câu hỏi dẫn tới chốt đơn: hỏi khách nuôi bao nhiêu con để tư vấn số kg, hoặc gợi ý gói cụ thể (2kg trở lên được miễn ship nên có lợi hơn), hoặc hỏi lấy mấy kg.
Không hỏi lại thứ khách đã nói. Không lặp lại cùng một câu hỏi: nếu đã hỏi "nuôi con gì, mấy con" mà khách lờ đi thì lần sau hỏi thẳng "anh lấy mấy kg" hoặc gợi ý gói 2kg, không hỏi lại câu cũ.
Khách hỏi gộp nhiều gói (ví dụ 1kg với 0,5kg): coi là một đơn, gọi tinh_tong_don để báo tổng tiền cả đơn gồm ship.
Khách bực bội, chê bot trả lời không đúng: xin lỗi ngắn, hỏi lại khách đang cần biết điều gì để em trả lời đúng. Chỉ chuyển nhân viên nếu khách bực lần nữa hoặc đòi gặp người thật.

MỤC TIÊU DUY NHẤT: chốt được đơn. Dẫn khách theo lộ trình: biết khách nuôi con gì, bao nhiêu con → gợi ý một gói cụ thể → khách đồng ý thì xin số điện thoại và địa chỉ → chốt bằng câu mẫu. Mỗi tin đều phải đẩy khách tiến thêm một bước.
- Khách đã nói lấy bao nhiêu kg (kể cả 0,5kg, 1kg) thì bán đúng số đó, KHÔNG gợi ý lên gói khác. Chỉ báo giá gồm ship (ví dụ "Dạ 1kg là 90k + 20k ship, tổng 110k ạ.") rồi xin số điện thoại và địa chỉ.
- Khách đã chọn xong số kg thì không bán thêm, chỉ xin thông tin còn thiếu.
- Khách lo lắng về chất lượng hoặc sợ mua nhầm: nhấn mạnh nhận hàng kiểm tra rồi mới trả tiền (COD).
- Khách hỏi giá: báo đúng giá, rồi hỏi khách nuôi bao nhiêu con hoặc lấy mấy kg.
- Khách nhắn tên gói kèm giá (tin quảng cáo, ví dụ "*2kg Sâu Canxi #160k miễn ship") mà giá khác bảng giá: KHÔNG gọi chuyen_nhan_vien. Coi như khách muốn mua gói đó, báo đúng giá trong bảng giá (ví dụ "Dạ 2kg Sâu Canxi bên em là 180k miễn ship ạ.") rồi xin số điện thoại và địa chỉ (hoặc hỏi xác nhận địa chỉ cũ nếu có).
- Khách nói giá khác với giá vừa báo, thường là thấp hơn (ví dụ "sao để 350 mà", "hôm trước 350", "quảng cáo ghi 350", "sao đắt thế", "giá cũ rẻ hơn"): KHÔNG gọi chuyen_nhan_vien, không mặc cả. Trả lời "Dạ nay bên em giá mới rồi anh/chị nhé," kèm đúng giá trong bảng giá cho số kg đó (ví dụ "Dạ nay bên em giá mới rồi anh nhé, 5kg là 390k miễn ship ạ."), rồi hỏi chốt "Anh lấy 5kg để em lên đơn nha?".
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
    description: "Gửi ảnh thật của sản phẩm cho khách. " + (ANH_SHOP
      ? Object.entries(ANH_SHOP).map(([k, v]) => `${k}: ${v.mo_ta}`).join(". ")
      : "san_pham: 2 ảnh sâu khô bốc trên tay. can_canh: sâu khô bẻ đôi giòn + sâu cận cảnh. dong_goi: túi zip đóng gói."),
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["loai"],
      properties: { loai: { type: "string", enum: ANH_SHOP ? Object.keys(ANH_SHOP) : ["san_pham", "can_canh", "dong_goi"] } },
    },
  },
  {
    name: "gui_video",
    description: "Gửi video hướng dẫn cách đeo sụn nâng mũi (dùng kẹp đưa sụn vào mũi) cho khách.",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "luu_don",
    description: "Lưu đơn đã chốt vào sổ khách quen để lần sau khách mua lại không phải hỏi lại. Gọi đúng một lần khi chốt đơn.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["sdt", "dia_chi", "noi_dung", ...(CHOT_TU_VIET ? ["loi_chot"] : [])],
      properties: {
        sdt: { type: "string", description: "Số điện thoại người nhận" },
        dia_chi: { type: "string", description: "Địa chỉ giao hàng đầy đủ" },
        noi_dung: { type: "string", description: "Hàng đã đặt và tổng tiền, ví dụ: 2kg, 180.000đ miễn ship" },
        ...(CHOT_TU_VIET ? { loi_chot: { type: "string", description: "Tin nhắn chốt đơn gửi khách: câu TỔNG ĐƠN theo đúng mẫu trong kịch bản shop (số chiếc, size/loại, tổng tiền). KHÔNG dùng câu \"Dạ! Để em chuẩn bị và gửi luôn ạ.\"" } } : {}),
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
].filter((t) => (t.name === "gui_anh" ? SHOP_FILE === "shop.txt" || !!ANH_SHOP : t.name === "gui_video" ? SHOP_FILE === "shop-huyenchau.txt" : true));

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
// Tin có số điện thoại hoặc chữ địa chỉ
const THONG_TIN = /0\d[\d .]{7,11}\d|xã|phường|huyện|quận|tỉnh|thôn|xóm|khu phố|thị trấn|số nhà|(^|\s)ấp\s/i;
// Đọc ~20 tin gần nhất giữa khách và fanpage (gồm tin nhân viên/AI khác) để bot nối tiếp được
async function lichSuChat(id) {
  if (!PAGE_ACCESS_TOKEN) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/conversations?platform=messenger&user_id=${id}&fields=messages.limit(100){message,from,created_time}&access_token=${PAGE_ACCESS_TOKEN}`).then((x) => x.json());
    if (r.error) { console.log("[lịch sử chat] không đọc được:", r.error.message); return null; }
    // Facebook có thể trả ít hơn 100 tin một lần: đọc tiếp trang sau cho đủ
    let trang = r.data?.[0]?.messages;
    const raw = [...(trang?.data ?? [])];
    while (trang?.paging?.next && raw.length < 100) {
      trang = await fetch(trang.paging.next).then((x) => x.json());
      raw.push(...(trang.data ?? []));
    }
    const all = raw.filter((m) => m.message).reverse();
    // Khách quen: SĐT, địa chỉ thường nằm ở đơn cũ, xa hơn 20 tin gần nhất, nên nhặt riêng các tin đó
    const cu = all.slice(0, -20).filter((m) => m.from?.id === id && THONG_TIN.test(m.message)).slice(-6);
    const msgs = [...cu, ...all.slice(-20)];
    console.log("[lịch sử chat] đọc được", all.length, "tin của khách", id, cu.length ? `(+${cu.length} tin SĐT/địa chỉ cũ)` : "");
    if (!msgs.length) return null;
    const dong = msgs.map((m) => `${m.created_time.slice(0, 10)} ${m.from?.id === id ? "Khách" : "Shop"}: ${m.message}`);
    return "LỊCH SỬ CHAT TRƯỚC ĐÓ với khách này (cũ đến mới, tin cuối có thể là tin khách vừa gửi; vài tin đầu có thể là SĐT, địa chỉ khách để lại ở đơn cũ). Đọc để nối tiếp, không hỏi lại điều đã có, không chào lại nếu đang dở chuyện:\n" + dong.join("\n");
  } catch (e) { console.log("[lịch sử chat] lỗi:", e.message); return null; }
}
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`;
const ANH = ANH_SHOP ? Object.fromEntries(Object.entries(ANH_SHOP).map(([k, v]) => [k, v.anh])) : {
  san_pham: ["tren-tay-1.jpg", "tren-tay-2.jpg"],
  can_canh: ["be-doi.jpg", "can-canh-1.jpg"],
  dong_goi: ["tui-zip.jpg"],
};

// ---------- Gọi Claude ----------
const CHOT_TEXT = "Dạ! Để em chuẩn bị và gửi luôn ạ.";
const HANDOFF_TEXT = process.env.HANDOFF_TEXT || "Dạ anh/chị đợi em một chút, em chuyển nhân viên hỗ trợ mình ngay ạ.";
// HANDOFF_SILENT=1: chuyển nhân viên mà không nhắn gì cho khách
const baoChuyen = (send, id, text) => (process.env.HANDOFF_SILENT ? undefined : send(id, text || HANDOFF_TEXT));

// Ảnh khách gửi: đưa link ảnh cho Claude tự xem (đọc được SĐT, địa chỉ viết tay, ảnh hàng lỗi)
const ANH_KHACH = /\[Khách gửi ảnh: (\S+)\]/g;
async function noiDungClaude(text) {
  const urls = [...text.matchAll(ANH_KHACH)].map((m) => m[1]);
  if (!urls.length) return text;
  // Bot tự tải ảnh từ Facebook rồi đưa cho Claude (Claude không chắc tải được link Facebook)
  const anh = [];
  for (const url of urls.slice(0, 4)) {
    try {
      const r = await fetch(url);
      const type = (r.headers.get("content-type") || "").split(";")[0];
      if (!r.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) throw new Error(r.status + " " + type);
      anh.push({ type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await r.arrayBuffer()).toString("base64") } });
    } catch (e) { console.log("[ảnh] không tải được:", e.message); }
  }
  const chu = text.replace(ANH_KHACH, anh.length
    ? "[Khách gửi một hình ảnh, xem ảnh bên dưới. Nếu ảnh có số điện thoại hoặc địa chỉ thì dùng như khách gõ chữ]"
    : "[Khách gửi một hình ảnh nhưng em không mở được]");
  return [{ type: "text", text: chu }, ...anh];
}

// ---------- Google Sheet cho chủ shop tự sửa: SHEET_URL = link Sheet (chia sẻ "Bất kỳ ai có đường liên kết" được xem) ----------
// Cột A = mục, cột B = nội dung (trống thì bỏ qua), cột C = hướng dẫn cho chủ shop (bot bỏ qua). Dòng "Bật bot" = Không thì bot im. Các dòng khác thêm vào đầu mỗi cuộc chat mới.
let sheet = { bat: true, text: "" };
function docCsv(s) {
  const rows = [[""]];
  for (let i = 0, q = false; i < s.length; i++) {
    const c = s[i], r = rows.at(-1);
    if (q) { if (c === '"' && s[i + 1] === '"') { r[r.length - 1] += '"'; i++; } else if (c === '"') q = false; else r[r.length - 1] += c; }
    else if (c === '"') q = true;
    else if (c === ",") r.push("");
    else if (c === "\n") rows.push([""]);
    else if (c !== "\r") r[r.length - 1] += c;
  }
  return rows;
}
function docSheetCsv(csv) {
  const rows = docCsv(csv).map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean) && !/^(mục|muc)$/i.test(r[0]));
  const bat = rows.find((r) => /^bật bot|^bat bot/i.test(r[0]));
  return {
    bat: !bat || !/^(không|khong|tắt|tat|no|0)$/i.test(bat[1] || ""),
    text: rows.filter((r) => r !== bat && r[1]).map((r) => `- ${r[0]}: ${r[1]}`).join("\n"), // chỉ cột A, B; cột C trở đi là hướng dẫn cho chủ shop
  };
}
async function capNhatSheet() {
  const id = process.env.SHEET_URL?.match(/\/d\/([\w-]+)/)?.[1];
  if (!id) return;
  const gid = process.env.SHEET_URL.match(/gid=(\d+)/)?.[1] || "0";
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
    if (!r.ok) throw new Error("HTTP " + r.status + " (Sheet đã chia sẻ cho 'Bất kỳ ai có đường liên kết' chưa?)");
    const moi = docSheetCsv(await r.text());
    if (moi.text !== sheet.text || moi.bat !== sheet.bat) console.log("[google sheet] cập nhật:", moi.bat ? "bot bật" : "bot TẮT", "|", moi.text.length, "ký tự");
    sheet = moi;
  } catch (e) { console.error("[google sheet] lỗi đọc, giữ bản cũ:", e.message); }
}
if (process.env.SHEET_URL) { capNhatSheet(); setInterval(capNhatSheet, 2 * 60000); }

async function reply(id, customerText, send = sendFb) {
  const u = user(id);
  if (Date.now() - u.lastActive > IDLE_RESET_MS) u.history = [];
  u.lastActive = Date.now();
  const messages = u.history;
  // Chụp thông tin khách quen lúc mở cuộc chat: system không được đổi giữa chừng (Claude báo lỗi chữ ký thinking)
  if (!messages.length) {
    const ls = send === sendFb ? await lichSuChat(id) : null;
    const capNhat = sheet.text && "CẬP NHẬT CỦA CHỦ SHOP (ưu tiên cao nhất, khác kịch bản ở trên thì làm theo phần này). Tự trả lời khách theo các cập nhật này, KHÔNG gọi chuyen_nhan_vien chỉ vì một cập nhật (ví dụ hết hàng thì báo khách, gợi ý loại khác hoặc nhận đặt trước)." +
      " Mục \"Tin chào đầu tiên\" (nếu có) là TIN ĐẦU TIÊN: gửi NGUYÊN VĂN (giữ xuống dòng) thay cho đoạn chào trong kịch bản; riêng khi khách đã gửi đủ SĐT và địa chỉ thì KHÔNG gửi tin chào, chốt đơn luôn theo kịch bản." +
      " Mục \"Câu chốt đơn\" (nếu có) là mẫu loi_chot khi chốt đơn: giữ nguyên câu chữ, chỉ thay số lượng, loại/size, tổng tiền cho đúng đơn." +
      " Các mục về cách nói chuyện (xưng hô, cách trả lời, không được nói) thì làm đúng như vậy:\n" + sheet.text;
    u.ctx = [capNhat, u.khach && khachQuen(u.khach), ls].filter(Boolean).join("\n\n") || null;
  }
  messages.push({ role: "user", content: await noiDungClaude(customerText) });

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
      await baoChuyen(send, id);
      return pause(id, "AI từ chối trả lời");
    }
    const calls = res.content.filter((b) => b.type === "tool_use");
    // Đã có đủ SĐT + địa chỉ (lưu đơn) hoặc bot đã nói câu chốt: gửi câu chốt rồi nhường Sapo/nhân viên lên đơn
    const luu = calls.find((c) => c.name === "luu_don");
    // CHOT_TU_VIET: bot lỡ viết câu chốt cố định mà không gọi luu_don → nhắc lại để có câu tổng đơn (chưa gửi gì cho khách)
    const coDinh = (s) => s.includes(CHOT_TEXT.slice(4, 20));
    const loiChot = luu?.input?.loi_chot?.trim() || "";
    if (CHOT_TU_VIET && step < 4 && ((!calls.length && coDinh(text)) || (luu && (!loiChot || coDinh(loiChot))))) {
      const nhac = "(Hệ thống, khách không thấy tin này) Shop này không dùng câu chốt cố định. Đủ SĐT và địa chỉ thì gọi luu_don với loi_chot là câu tổng đơn theo kịch bản; còn thiếu thì chỉ hỏi đúng phần thiếu.";
      messages.push({ role: "user", content: calls.length
        ? [...calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "Chưa lưu: loi_chot phải là câu tổng đơn theo kịch bản.", is_error: true })), { type: "text", text: nhac }]
        : nhac });
      continue;
    }
    if (luu ||(!calls.length && text.includes(CHOT_TEXT.slice(4, 20)))) {
      if (luu) try { luuDon(u, luu.input); } catch (e) { console.error("Lỗi lưu đơn:", e.message); }
      const chotText = (CHOT_TU_VIET && luu?.input?.loi_chot?.trim()) || CHOT_TEXT;
      await send(id, chotText);
      // Ghi kết quả công cụ + câu chốt vào lịch sử: tránh lỗi 400 ở tin sau và để bot biết đơn đã lưu, không lưu lại
      if (calls.length) {
        messages.push({ role: "user", content: calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: c === luu ? "Đã lưu đơn. Không gọi luu_don nữa trừ khi khách đổi thông tin." : "Bỏ qua." })) });
        messages.push({ role: "assistant", content: chotText });
      }
      u.chotLuc = Date.now(); // bot vẫn trả lời thêm 30 phút rồi mới nhường Sapo
      saveState();
      return console.log("[chốt đơn] khách", id);
    }
    if (!calls.length) {
      saveState();
      if (text.includes("[KHÔNG TRẢ LỜI]")) return console.log("[im lặng] khách", id, "chỉ cảm ơn/like");
      return text ? send(id, text) : baoChuyen(send, id);
    }
    const handoff = calls.find((c) => c.name === "chuyen_nhan_vien");
    if (handoff) {
      await baoChuyen(send, id, text);
      // Dừng lâu (HANDOFF_HOURS) chỉ với khách đã mua: bot từng lưu đơn, hoặc lịch sử chat có đơn/vận đơn
      const daMua = !!u.khach || /SPXVN|Xác nhận đơn|giao thành công|chuẩn bị và gửi/i.test(u.ctx || "");
      return pause(id, (handoff.input?.ly_do || "khách cần người thật") + (daMua ? " (khách đã mua)" : ""), daMua ? HANDOFF_MS : PAUSE_MS);
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
          if (c.name === "gui_video") {
            pending.push({ video: `${BASE_URL}/anh/hc-cach-deo.mp4` });
            return { type: "tool_result", tool_use_id: c.id, content: "Đã gửi video cho khách. Không gửi lại video này nữa." };
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
  await baoChuyen(send, id);
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
  else if (body.message) console.log("[đã gửi] tin cho khách", body.recipient.id);
}
async function sendFb(id, text) {
  if (text.image || text.video) {
    const type = text.video ? "video" : "image";
    return graph({ recipient: { id }, messaging_type: "RESPONSE", message: { attachment: { type, payload: { url: text[type], is_reusable: true } }, metadata: BOT_TAG } });
  }
  for (let i = 0; i < text.length; i += 1900) {
    await graph({ recipient: { id }, messaging_type: "RESPONSE", message: { text: text.slice(i, i + 1900), metadata: BOT_TAG } });
  }
}
const typing = (id) => graph({ recipient: { id }, sender_action: "typing_on" });

// Gom tin nhắn liên tiếp và xử lý lần lượt từng khách
const buffers = new Map();
const queues = new Map();
function enqueue(id, text, layQuyenSau = false) {
  const b = buffers.get(id) ?? { parts: [], tu: Date.now() };
  b.parts.push(text);
  if (layQuyenSau) b.layQuyen = true;
  clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    buffers.delete(id);
    const joined = b.parts.join("\n");
    const prev = queues.get(id) ?? Promise.resolve();
    // Chỉ trả hội thoại cho Sapo khi khách không còn tin nào đang chờ, kẻo tin sau gửi không đi
    const tail = prev.then(async () => {
      if (NHUONG_NV && (user(id).nvLuc || 0) > b.tu) return console.log(`[nhường] nhân viên đã trả lời khách ${id}, bot không trả lời lượt này`);
      if (b.layQuyen && !(await layQuyen(id))) return;
      return handle(id, joined);
    })
      .finally(() => { if (!buffers.has(id) && queues.get(id) === tail) return giveBack(id); })
      .catch(() => {});
    queues.set(id, tail);
  }, NHUONG_NV && !user(id).khach && !user(id).coDon ? NHUONG_MS : DEBOUNCE_MS);
  buffers.set(id, b);
}
async function handle(id, text) {
  if (user(id).pausedUntil > Date.now()) return; // người thật đang phụ trách khách này
  if (!sheet.bat) return; // chủ shop tắt bot trong Google Sheet
  // Chốt đơn quá 30 phút: nhường Sapo/nhân viên (trong ngày). Sang hôm sau bot trả lời lại như khách mới.
  const sauChot = Date.now() - (user(id).chotLuc || 0);
  if (sauChot > 30 * 60000 && sauChot < IDLE_RESET_MS) { user(id).chotLuc = 0; return pause(id, "đã chốt đơn quá 30 phút, nhường Sapo"); }
  if (text.includes(GHI_AM)) return pause(id, "khách gửi ghi âm, nhân viên nghe");
  if (/x[oó]a\s+d[uữ]\s*li[eệ]u/i.test(text)) {
    // Đúng như trang /xoa-du-lieu hứa: xóa mọi thứ đã lưu về khách này
    delete state.users[id];
    saveState();
    console.log("[xóa dữ liệu] khách", id);
    return sendFb(id, "Dạ em đã xóa toàn bộ dữ liệu bên em lưu về anh/chị (lịch sử trò chuyện, số điện thoại, địa chỉ) ạ.");
  }
  try {
    await typing(id);
    try {
      await reply(id, text, sendFb);
    } catch (e) {
      // Hướng dẫn bot vừa được cập nhật giữa cuộc chat: Claude không nhận lịch sử cũ. Bỏ lịch sử, đọc lại từ Facebook và trả lời lại.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.log("[thử lại] khách", id, e.message.slice(0, 80));
      user(id).history = [];
      await reply(id, text, sendFb);
    }
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
// Ảnh sản phẩm công khai; cho phép trang khác tải về (CORS) để dùng làm biểu tượng ứng dụng
app.use("/anh", (_req, res, next) => { res.set("Access-Control-Allow-Origin", "*"); next(); }, express.static(fileURLToPath(new URL("./anh", import.meta.url))));
// Trang chính sách cho Meta xét duyệt: /chinh-sach-rieng-tu và /xoa-du-lieu.
// Shop thuê: đặt SHOP_NAME (tùy chọn SHOP_LIEN_HE) trên Railway; không đặt thì giữ nội dung BBF.
function trangShop(html, ten = process.env.SHOP_NAME, lh = process.env.SHOP_LIEN_HE) {
  if (!ten) return html;
  return html
    .replace(/Sâu Sấy Canxi BBF . Lô [^<]*/, `${ten} – ${lh || "nhắn tin cho fanpage trên Messenger"}.`)
    .replace(/Sâu Sấy Canxi BBF . Lot [^<]*/, `${ten} – ${lh || "message the Page on Messenger"}.`)
    .replace(/\r?\n<li>[^\n]*(0327729823|327 729 823)[^\n]*<\/li>/g, "") // bỏ cách "gọi Zalo BBF" ở trang xóa dữ liệu
    .replace("làm một trong hai cách:", "làm như sau:").replace("), either:", "):").replace(" Facebook Page, or</li>", " Facebook Page.</li>")
    .replaceAll("Sâu Sấy Canxi BBF", ten);
}
for (const [duong, file] of [["/chinh-sach-rieng-tu", "chinh-sach.html"], ["/xoa-du-lieu", "xoa-du-lieu.html"]])
  app.get(duong, (_req, res) => res.type("html").send(trangShop(fs.readFileSync(new URL("./trang/" + file, import.meta.url), "utf8"))));
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
    console.log("[webhook] trang", entry.id, "messaging:", (entry.messaging ?? []).length, "standby:", (entry.standby ?? []).length, "changes:", (entry.changes ?? []).length);
    for (const ch of entry.changes ?? []) {
      if (ch.field === "feed" && process.env.BINH_LUAN) binhLuan(entry.id, ch.value).catch((e) => console.error("[bình luận] lỗi:", e.message));
    }
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message;
      if (msg?.is_echo) {
        // Tin do fanpage gửi. Không có nhãn của AI = người thật đang trả lời khách
        if (msg.metadata !== BOT_TAG && nguoiThat(ev.recipient.id, msg.app_id)) nvTraLoi(ev.recipient.id, "chủ shop tự trả lời", msg.text);
        continue;
      }
      const id = ev.sender?.id;
      if (!id) continue;
      user(id).khachNhanLuc = Date.now();
      if (msg?.text || msg?.attachments) enqueue(id, noiDung(msg));
      else if (ev.postback) enqueue(id, ev.postback.title || ev.postback.payload || "Bắt đầu");
    }
    // Tin "dự bị": ứng dụng khác đang giữ quyền nhận tin chính. Giành quyền rồi mới trả lời.
    for (const ev of entry.standby ?? []) {
      const msg = ev.message;
      if (!msg) continue;
      // Nhân viên trả lời qua Sapo (tin do trang gửi, không có nhãn AI): AI nhường khách này
      if (msg.is_echo) { if (msg.metadata !== BOT_TAG && nguoiThat(ev.recipient.id, msg.app_id)) nvTraLoi(ev.recipient.id, `ứng dụng ${msg.app_id} trả lời khách`, msg.text); continue; }
      // Chỉ giành khi bật GIANH_QUYEN=1, để khách thường vẫn do Sapo trả lời
      if (ev.sender?.id) user(ev.sender.id).khachNhanLuc = Date.now();
      if (!process.env.GIANH_QUYEN || !ev.sender?.id || user(ev.sender.id).pausedUntil > Date.now()) continue;
      takeThread(ev.sender.id, noiDung(msg));
    }
  }
});

// Tin trang gửi ra có phải người thật gõ không. Máy tự trả lời (lời chào quảng cáo, trả lời tự động)
// gửi ngay trong vài giây sau tin khách, hoặc gửi trước khi khách nhắn gì (mở đầu cuộc chat từ quảng cáo).
function nguoiThat(id, app) {
  const t = Date.now() - (user(id).khachNhanLuc || 0);
  const ok = t > 3000 && t < IDLE_RESET_MS; // lời chào quảng cáo đến cùng lúc; AI khác (Sapo, Meta) mất ~4s trở lên
  if (!ok) console.log("[bỏ qua] tin tự động của trang gửi khách", id, app ? "từ ứng dụng " + app : "");
  return ok;
}

// Vẫy tay, like, nhãn dán đến dưới dạng ảnh có sticker_id: coi là lời chào
const GHI_AM = "[Khách gửi tin nhắn thoại]";
function noiDung(msg) {
  if (msg.text) return msg.text;
  return (msg.attachments ?? []).map((a) =>
    a.payload?.sticker_id ? "[Khách gửi nhãn dán/vẫy tay chào – coi như khách chào hoặc đồng ý]"
    : a.type === "image" && a.payload?.url ? `[Khách gửi ảnh: ${a.payload.url}]`
    : a.type === "audio" ? GHI_AM : "[Khách gửi một tệp]").join("\n") || "[Khách gửi tin không có chữ]";
}

// Giành hội thoại để trả lời, trả lời xong thì trả lại cho ứng dụng cũ (Sapo) để nhân viên vẫn nhắn được
const fbApi = (path, method, body) =>
  fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}${path.includes("?") ? "&" : "?"}access_token=${PAGE_ACCESS_TOKEN}`, {
    method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ error: e.message }));
const borrowed = new Map(); // khách -> ứng dụng đang giữ hội thoại trước khi bot giành
async function takeThread(id, text) {
  if (NHUONG_NV) return enqueue(id, text, true); // chờ xem nhân viên có trả lời không rồi mới giành
  if (await layQuyen(id)) enqueue(id, text);
}
async function layQuyen(id) {
  const owner = await fbApi(`me/thread_owner?recipient=${id}`, "GET");
  console.log("[standby] chủ hội thoại hiện tại:", JSON.stringify(owner));
  const took = await fbApi("me/take_thread_control", "POST", { recipient: { id }, metadata: "ai-bot" });
  console.log("[standby] giành quyền:", JSON.stringify(took));
  if (!took.success) return false;
  const prevApp = owner.data?.[0]?.thread_owner?.app_id;
  if (prevApp) borrowed.set(id, prevApp);
  return true;
}
async function giveBack(id) {
  const app = borrowed.get(id);
  if (!app) return;
  borrowed.delete(id);
  const r = await fbApi("me/pass_thread_control", "POST", { recipient: { id }, target_app_id: app, metadata: "ai-bot" });
  console.log("[standby] trả lại hội thoại cho", app, JSON.stringify(r));
}

// ---------- Trả lời bình luận (bật bằng BINH_LUAN=1, page cần đăng ký trường "feed" và quyền pages_manage_engagement) ----------
const TOOL_BL = {
  name: "tra_loi_binh_luan",
  description: "Trả lời một bình luận của khách dưới bài viết, đúng như khi khách nhắn câu đó qua Messenger.",
  input_schema: {
    type: "object",
    properties: {
      tra_loi: { type: "string", description: "Câu bot sẽ nhắn nếu khách gửi bình luận này qua Messenger. Chuỗi rỗng nếu không nên trả lời." },
      co_sdt_dia_chi: { type: "boolean", description: "true nếu bình luận có số điện thoại hoặc địa chỉ của khách" },
    },
    required: ["tra_loi", "co_sdt_dia_chi"],
  },
};
async function soanBinhLuan(binhLuan, baiViet = "") {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    // Dùng chung hướng dẫn với Messenger để trả lời bình luận giống hệt khi khách nhắn tin
    system: `${SYSTEM}\n\nLƯỢT NÀY LÀ BÌNH LUẬN công khai dưới bài viết, không phải tin nhắn: làm theo mục TRẢ LỜI BÌNH LUẬN và gọi công cụ ${TOOL_BL.name}.`,
    tools: [TOOL_BL],
    tool_choice: { type: "tool", name: TOOL_BL.name },
    messages: [{ role: "user", content: `Bài viết: ${baiViet.slice(0, 300) || "(không rõ)"}\nBình luận của khách: ${binhLuan}` }],
  });
  const r = res.content.find((b) => b.type === "tool_use")?.input ?? {};
  // Mô hình đôi khi trả '""' hoặc [KHÔNG TRẢ LỜI] thay cho chuỗi rỗng: coi là không trả lời
  const traLoi = String(r.tra_loi || "").replace("[KHÔNG TRẢ LỜI]", "").replace(/^["'\s]+|["'\s]+$/g, "");
  return { traLoi, coThongTin: !!r.co_sdt_dia_chi };
}
const daTraLoiBL = new Set(); // shortcut: chỉ nhớ trong bộ nhớ, khởi động lại giữa lúc Facebook gửi lại sự kiện thì có thể trả lời 2 lần (hiếm)
async function binhLuan(pageId, v) {
  if (v.item !== "comment" || v.verb !== "add" || !v.message || v.from?.id === pageId || daTraLoiBL.has(v.comment_id)) return;
  daTraLoiBL.add(v.comment_id);
  const bai = await fbApi(`${v.post_id}?fields=message`, "GET");
  const { traLoi, coThongTin } = await soanBinhLuan(v.message, bai.message);
  console.log("[bình luận]", v.comment_id, traLoi ? "trả lời" : "bỏ qua", coThongTin ? "(có SĐT/địa chỉ, ẩn)" : "");
  if (!traLoi) return;
  const loi = (r, viec) => r.error && console.error(`[bình luận] lỗi ${viec}:`, JSON.stringify(r.error));
  // Có SĐT/địa chỉ: ẩn để giữ kín thông tin khách, chép thông tin vào tin nhắn riêng để nhân viên và bot Messenger thấy
  if (coThongTin) loi(await fbApi(v.comment_id, "POST", { is_hidden: true }), "ẩn");
  loi(await fbApi(`${v.comment_id}/comments`, "POST", { message: coThongTin ? "Dạ em nhắn tin cho chị rồi ạ" : traLoi }), "trả lời công khai");
  const rieng = coThongTin ? `Dạ em nhận được thông tin chị để lại: ${v.message}\n${traLoi}` : traLoi;
  loi(await fbApi("me/messages", "POST", { recipient: { comment_id: v.comment_id }, message: { text: rieng, metadata: BOT_TAG } }), "nhắn riêng");
}

// ---------- Trang kiểm tra kết nối fanpage: /kiemtra?key=<VERIFY_TOKEN> (thêm &dangky=1 để đăng ký lại) ----------
app.get("/kiemtra", async (req, res) => {
  if (!okKey(req.query.key)) return res.sendStatus(403);
  const g = (path, opts) =>
    fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}${path.includes("?") ? "&" : "?"}access_token=${PAGE_ACCESS_TOKEN}`, opts).then((r) => r.json());
  const out = {};
  if (req.query.dangky) out.dang_ky_lai = await g(`me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes,standby,messaging_handovers${process.env.BINH_LUAN ? ",feed" : ""}`, { method: "POST" });
  // debug_token cho biết mã này thuộc trang nào (profile_id) mà không cần quyền đọc trang; chỉ trả ID, không trả mã
  const d = (await g(`debug_token?input_token=${PAGE_ACCESS_TOKEN}`)).data ?? {};
  out.trang = { id_trang: d.profile_id, ung_dung: d.app_id, loai_ma: d.type, hop_le: d.is_valid, quyen: d.scopes };
  out.ung_dung_dang_ky = await g("me/subscribed_apps");
  res.json(out);
});

// ---------- Tự soạn kịch bản từ hộp thư: /hoc?key=<VERIFY_TOKEN>&chay=1[&n=40][&truoc=YYYY-MM-DD] rồi mở /hoc?key=... xem kết quả ----------
// Đọc các cuộc chat cũ của page (ưu tiên cuộc chat khách đã để SĐT/địa chỉ = đã chốt đơn), nhờ Claude viết bản nháp theo shop-mau.txt.
// truoc=: chỉ học tin trước ngày đó (bỏ tin bot tự trả lời). Bản nháp phải được người xem lại trước khi dùng.
const SDT = /0\d[\d .]{7,11}\d/g;
let hoc = { trang_thai: "chưa chạy" };
async function docHopThu(n, truoc) {
  // debug_token cho ID trang mà không cần quyền pages_read_engagement (như /kiemtra); tên trang lấy từ người tham gia cuộc chat
  const d = (await fbApi(`debug_token?input_token=${PAGE_ACCESS_TOKEN}`, "GET")).data ?? {};
  if (!d.profile_id) throw new Error("Không xác định được trang từ PAGE_ACCESS_TOKEN");
  const page = { id: d.profile_id, name: "" };
  const ds = [];
  let url = `me/conversations?platform=messenger&limit=10&fields=participants,messages.limit(30){message,from,created_time,attachments{image_data{url}}}`;
  const anhCua = (m) => (m.attachments?.data ?? []).map((a) => a.image_data?.url).filter(Boolean);
  const anh = []; // ảnh shop đã gửi khách (để chọn ảnh sản phẩm cho gui_anh)
  // shortcut: đọc tối đa 300 cuộc chat gần nhất rồi chọn n cuộc; page cần học xa hơn thì tăng giới hạn này
  for (let trang = 0; url && ds.length < 300 && trang < 30; trang++) {
    const r = await fbApi(url, "GET");
    if (r.error) throw new Error("Không đọc được hộp thư: " + r.error.message);
    for (const c of r.data ?? []) {
      page.name ||= c.participants?.data?.find((p) => p.id === page.id)?.name || "";
      const tin = (c.messages?.data ?? []).filter((m) => (m.message || anhCua(m).length) && (!truoc || m.created_time < truoc)).reverse();
      if (tin.length >= 2) ds.push(tin);
      tin.forEach((m, i) => m.from?.id === page.id && anhCua(m).forEach((url) =>
        anh.push({ url, khach_hoi: tin.slice(0, i).findLast((x) => x.from?.id !== page.id && x.message)?.message?.slice(0, 120).replace(SDT, "[SĐT]") || "" })));
    }
    url = r.paging?.next ? r.paging.next.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, "").replace(/&?access_token=[^&]*/, "") : null;
  }
  const chot = (t) => t.some((m) => m.from?.id !== page.id && THONG_TIN.test(m.message || ""));
  const chon = [...ds.filter(chot), ...ds.filter((t) => !chot(t))].slice(0, n);
  const vanBan = chon.map((t, i) => `--- Cuộc chat ${i + 1}${chot(t) ? " (khách đã để SĐT/địa chỉ)" : ""} ---\n` +
    t.map((m) => `${m.from?.id === page.id ? "Shop" : "Khách"}: ${(m.message || "").slice(0, 300).replace(SDT, "[SĐT]")}${anhCua(m).length ? ` [gửi ${anhCua(m).length} ảnh]` : ""}`).join("\n")).join("\n\n");
  return { ten: page.name, so: chon.length, soChot: chon.filter(chot).length, vanBan, anh: anh.slice(0, 60) };
}
async function soanKichBan(n, truoc) {
  const { ten, so, soChot, vanBan, anh } = await docHopThu(n, truoc);
  if (!so) throw new Error("Không có cuộc chat nào để học");
  hoc = { trang_thai: `đang soạn từ ${so} cuộc chat (${soChot} cuộc đã chốt đơn)...`, luc: new Date().toISOString(), anh };
  const mau = fs.readFileSync(new URL("./shop-mau.txt", import.meta.url), "utf8");
  const res = await client.beta.messages.stream({
    model: process.env.HOC_MODEL || "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `Bạn viết kịch bản bán hàng cho một bot trả lời tin nhắn Messenger của fanpage "${ten}". Đọc các cuộc chat thật giữa nhân viên shop và khách, rồi điền ĐÚNG theo mẫu dưới đây (giữ nguyên tiêu đề các mục, thay mọi chỗ [...]).
- Chỉ dùng điều có trong các cuộc chat: sản phẩm, giá, phí ship, hãng giao, thanh toán, đổi trả, câu khách hay hỏi. Giá có nhiều mức khác nhau thì lấy mức nhân viên báo gần đây nhất và ghi chú lại.
- Chép nguyên văn những câu nhân viên hay dùng (chào, báo giá, xin SĐT địa chỉ, chốt đơn), cách xưng hô, độ dài tin. Bot phải nhắn giống nhân viên thật.
- Mục CÂU HỎI THƯỜNG GẶP: lấy 10–20 câu khách hỏi nhiều nhất, kèm câu nhân viên đã trả lời.
- Chỗ nào các cuộc chat không cho biết hoặc mâu thuẫn: ghi [CẦN HỎI CHỦ SHOP: ...]. Không bịa.
- Tin "Shop:" có thể là tin tự động (báo đơn, quảng cáo, ưu đãi): bỏ qua khi học giọng nhân viên.
- Không chép tên, số điện thoại, địa chỉ của khách nào vào kịch bản.
- "[gửi N ảnh]" ở tin Shop là nhân viên gửi ảnh: ghi vào kịch bản khách hỏi gì thì nhân viên gửi ảnh (ví dụ hỏi mẫu, màu, size, ảnh thật) để bot cũng gửi ảnh lúc đó.
- Chỉ trả về nội dung kịch bản, không giải thích thêm.

MẪU:
${mau}`,
    messages: [{ role: "user", content: `${so} cuộc chat gần đây của page "${ten}":\n\n${vanBan}` }],
  }).finalMessage();
  if (res.stop_reason === "refusal") throw new Error("Claude từ chối soạn (" + (res.stop_details?.category || "không rõ") + ")");
  const ketQua = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (VOL) fs.writeFileSync(`${VOL}/kich-ban-nhap.txt`, ketQua);
  console.log("[học hộp thư] xong:", so, "cuộc chat,", res.usage?.input_tokens, "token vào,", res.usage?.output_tokens, "token ra");
  hoc = { trang_thai: `xong, học từ ${so} cuộc chat (${soChot} cuộc đã chốt đơn)`, luc: new Date().toISOString(), ket_qua: ketQua, anh };
}
app.get("/hoc", (req, res) => {
  if (!okKey(req.query.key)) return res.sendStatus(403);
  // &anh=1: danh sách ảnh shop đã gửi khách (link Facebook có hạn) để chọn ảnh sản phẩm cho gui_anh
  if (req.query.anh) return res.json(hoc.anh ?? []);
  if (req.query.chay && !hoc.trang_thai.startsWith("đang")) {
    const n = Math.min(Number(req.query.n) || 40, 80);
    const truoc = /^\d{4}-\d{2}-\d{2}$/.test(req.query.truoc || "") ? req.query.truoc : "";
    hoc = { trang_thai: "đang đọc hộp thư...", luc: new Date().toISOString() };
    soanKichBan(n, truoc).catch((e) => { console.error("[học hộp thư] lỗi:", e.message); hoc = { trang_thai: "lỗi: " + e.message, luc: new Date().toISOString() }; });
  }
  res.type("text/plain; charset=utf-8").send(`Trạng thái: ${hoc.trang_thai} (${hoc.luc || ""})\n\n${hoc.ket_qua || ""}`);
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
const add=(t,c)=>{const d=document.createElement("div");d.className=c;if(t.image||t.video){const i=document.createElement(t.video?"video":"img");i.src=t.image||t.video;i.controls=true;i.style.maxWidth="220px";d.appendChild(i)}else d.textContent=t;log.appendChild(d)};
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
  if (req.body.binh_luan) return res.json(await soanBinhLuan(String(text), String(req.body.bai_viet || "")).catch((e) => ({ loi: e.message })));
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
