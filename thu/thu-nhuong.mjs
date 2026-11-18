// NHUONG_NHAN_VIEN: khách chưa có đơn chờ nhân viên 10 giây; nhân viên chốt đơn thì bot dừng như cũ
import { chayBot, wait, ok } from "./chung.mjs";

const b = await chayBot({ port: 3999, fbPort: 3989, env: { NHUONG_NHAN_VIEN: "1", NHUONG_GIAY: "10" } });
for (const id of ["A", "B", "C", "D", "E"]) await b.khach(id, "giá bao nhiêu");
await wait(5000);
await b.trang("A", "Dạ 99k miễn ship chị ơi");
await b.trang("C", "Dạ! Để em chuẩn bị và gửi luôn ạ.");
await b.trang("D", "chị lấy 2 cái em báo tổng đơn nhé");
await b.trang("E", "Dạ tổng đơn 385k đã MIỄN SHIP ạ");
await wait(8000);
const log = b.log();
b.tat();
ok(/\[nhân viên trả lời\] khách A/.test(log) && /\[nhường\][^\n]*khách A/.test(log), "A: nhân viên trả lời trong 10 giây thì bot im, không dừng 12 giờ");
ok(!/\[nhường\][^\n]*khách B/.test(log) && /khách B/.test(log), "B: không ai trả lời thì bot tự trả lời");
ok(/\[tạm dừng AI\] khách C/.test(log), "C: nhân viên nói câu chốt thì bot dừng như cũ");
ok(/\[nhân viên trả lời\] khách D/.test(log) && !/\[tạm dừng AI\] khách D/.test(log), "D: \"em báo tổng đơn nhé\" (chưa có số tiền) chưa tính là có đơn");
ok(/\[tạm dừng AI\] khách E/.test(log), "E: \"tổng đơn 385k\" tính là có đơn, bot dừng");
