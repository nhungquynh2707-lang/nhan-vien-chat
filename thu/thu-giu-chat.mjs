// Facebook báo "ứng dụng khác đang giữ cuộc chat" (2018300): bot phải giành lại, gửi được, rồi trả lại chat
import { chayBot, wait, ok } from "./chung.mjs";

let biChan = true;
const b = await chayBot({
  port: 3998, fbPort: 3988,
  fb: (q) => {
    if (q.url.includes("/me/messages") && biChan) return { status: 400, body: { error: { code: 10, error_subcode: 2018300 } } };
    if (q.url.includes("take_thread_control")) { biChan = false; return { body: { success: true } }; }
    if (q.url.includes("thread_owner")) return { body: { data: [{ thread_owner: { app_id: "556376998159104" } }] } };
    if (q.url.includes("pass_thread_control")) return { body: { success: true } };
  },
});
await b.khach("K", "Xóa dữ liệu của tôi"); // bot trả lời câu này không cần Claude
await wait(14000); // bot gom tin của khách trong DEBOUNCE_MS (10 giây) rồi mới trả lời
const log = b.log();
b.tat();
ok(/giành quyền: \{"success":true\}/.test(log) && /\[đã gửi\] tin cho khách K/.test(log), "bị ứng dụng khác giữ chat: bot giành lại và gửi được");
ok(b.goi.some((g) => g.includes("pass_thread_control")), "trả lời xong trả lại chat cho ứng dụng cũ");
