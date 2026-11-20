// NHAC_LAI_PHUT: khách hỏi rồi im thì bot nhắc đúng 1 lần; khách nói để sau, đã chốt, nhân viên đã nhắn thì không nhắc.
// /phan-tich: đếm cuộc chat có/không thành đơn rồi trả báo cáo. Giả cả Facebook lẫn Claude (ANTHROPIC_BASE_URL).
import { chayBot, wait, ok } from "./chung.mjs";

const tra = (text) => ({ body: { id: "msg_1", type: "message", role: "assistant", model: "gia", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`;
const sse = (text) => ev("message_start", { message: { id: "msg_2", type: "message", role: "assistant", model: "gia", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
  ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
let claudePhanTich = "";
const tin = (from, message, phut) => ({ from: { id: from }, message, created_time: new Date(Date.now() - phut * 60000).toISOString() });
const b = await chayBot({
  port: 3995, fbPort: 3985,
  env: { NHAC_LAI_PHUT: "0.1", ANTHROPIC_BASE_URL: "http://localhost:3985" },
  fb: (q, body) => {
    if (q.url.startsWith("/v1/messages")) {
      if (body.includes('"stream":true')) { claudePhanTich = body; return { sse: sse("BÁO CÁO GIẢ") }; }
      if (body.includes("Khách đã im lặng")) return tra(body.includes("thôi để sau nhé") ? "[KHÔNG NHẮC]" : "Dạ hộp 99k miễn ship, chị để lại SĐT và địa chỉ em gửi luôn nha.");
      return tra(body.includes("0912345678") ? "Dạ! Để em chuẩn bị và gửi luôn ạ." : "Dạ 99k miễn ship ạ.");
    }
    if (q.url.includes("debug_token")) return { body: { data: { profile_id: "PAGE" } } };
    if (q.url.includes("/me/conversations")) return { body: { data: [
      { updated_time: new Date().toISOString(), messages: { data: [tin("PAGE", "Dạ để em chuẩn bị và gửi luôn ạ", 5), tin("K1", "0987654321 Hà Nội", 6)] } },
      { updated_time: new Date().toISOString(), messages: { data: [tin("PAGE", "Dạ 99k ạ", 10), tin("K2", "giá bao nhiêu, sđt em 0911222333", 11)] } },
      { updated_time: new Date().toISOString(), messages: { data: [tin("PAGE", "Dạ 99k ạ", 20), tin("K3", "đắt thế", 21)] } },
      { updated_time: new Date(Date.now() - 5 * 86400000).toISOString(), messages: { data: [tin("K4", "cũ quá", 7200)] } },
    ] } };
    return {};
  },
});
await b.khach("A", "giá bao nhiêu");
await b.khach("B", "thôi để sau nhé");
await b.khach("C", "giá bao nhiêu");
await b.khach("D", "0912345678 số 1 Hà Nội");
await wait(13000); // bot trả lời sau 10 giây gom tin
await b.trang("C", "Dạ chị cần gì ạ", 1733556690196497); // nhân viên nhắn khách C
await wait(30000); // đủ 6 giây im lặng + vòng quét 6 giây, rồi chờ thêm xem có nhắc lần 2 không
const r1 = await fetch("http://localhost:3995/phan-tich?key=thu&chay=1&ngay=2").then((r) => r.status);
await wait(2000);
const pt = await fetch("http://localhost:3995/phan-tich?key=thu").then((r) => r.text());
const cam = await fetch("http://localhost:3995/phan-tich?key=sai").then((r) => r.status);
const log = b.log();
b.tat();
console.log(log.split("\n").filter((l) => /nhắc|chốt đơn|tạm dừng|phân tích|Lỗi/.test(l)).join("\n"));
ok((log.match(/\[nhắc lại\] khách A/g) || []).length === 1, "A hỏi giá rồi im: bot nhắc đúng 1 lần");
ok(/\[không nhắc\] khách B/.test(log) && !/\[nhắc lại\] khách B/.test(log), "B nói để sau: không nhắc");
ok(!/khách C\b/.test(log.split("tạm dừng AI] khách C")[1] || "") && !/\[nhắc lại\] khách C/.test(log), "C nhân viên đã nhắn: không nhắc");
ok(/\[chốt đơn\] khách D/.test(log) && !/nhắc[^\n]*khách D/.test(log), "D đã chốt đơn: không nhắc");
ok(r1 === 200 && /3 cuộc chat có khách nhắn, 2 cuộc có đơn hoặc khách để SĐT\/địa chỉ \(67%\), 1 cuộc không thành đơn/.test(pt) && pt.includes("BÁO CÁO GIẢ"), "phân tích: đếm đúng 3 cuộc trong 2 ngày, 2 có đơn, trả báo cáo");
ok(claudePhanTich.includes("đắt thế") && !claudePhanTich.includes("0911222333") && !claudePhanTich.includes("0987654321"), "phân tích: chỉ gửi Claude cuộc không thành đơn, không có SĐT");
ok(cam === 403, "phân tích: sai mã thì bị chặn");
