// APP_TU_DONG: tin của ứng dụng tự động 556376998159104 bị bỏ qua; nhân viên thật trả lời thì vẫn dừng bot
import { chayBot, wait, ok } from "./chung.mjs";

const b = await chayBot({ port: 3996, fbPort: 3986 });
await b.khach("A", "giá", "standby");
await b.khach("B", "giá", "standby");
await wait(3500); // tin trả lời đến sau hơn 3 giây mới bị nghi là người thật
await b.trang("A", "chào", 556376998159104, "standby");
await b.trang("B", "dạ", 1733556690196497, "standby");
await wait(1500);
const log = b.log();
b.tat();
ok(/\[bỏ qua\][^\n]*A từ ứng dụng 556376998159104/.test(log) && !/tạm dừng AI\] khách A/.test(log), "ứng dụng tự động 556376998159104: bỏ qua, không dừng bot");
ok(/tạm dừng AI\] khách B/.test(log), "nhân viên (ứng dụng khác) trả lời: vẫn dừng bot như cũ");
