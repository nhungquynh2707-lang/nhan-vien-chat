# Ghi chú bàn giao: nhân viên chat AI cho fanpage

Dán file này (hoặc nói "đọc TIEP-TUC.md") khi mở phiên mới để làm tiếp.

## Mục tiêu
Chủ shop bán hàng online (thời trang) cần một nhân viên chat AI tự trả lời khách trên **Facebook Messenger** của fanpage. Người dùng nói tiếng Việt và không phải lập trình viên: hướng dẫn từng bước bằng tiếng Việt, có kèm tên nút bấm.

## Các quyết định đã chốt
- **Mô hình:** Claude Haiku 5.5 (`claude-haiku-5-5`), mức suy nghĩ `low`, chọn vì rẻ nhất (khoảng 5đ mỗi câu trả lời, theo ước tính).
- **Đơn hàng:** để nguyên trong cuộc chat Messenger, không lưu Google Sheets hay nơi khác.
- **Chuyển cho người thật, AI im lặng 12 giờ với khách đó, khi:** khách đòi gặp người thật, khách khiếu nại hoặc đổi trả, hoặc chủ shop tự trả lời khách trên fanpage (nhận biết qua `message_echoes` không có metadata `ai-bot`).
- **Tổng tiền** do code tính bằng công cụ `tinh_tong_don`, AI không tự cộng. Phí ship 30.000đ, miễn phí từ 500.000đ.
- **Máy chủ:** Railway, triển khai từ GitHub.

## Đã xong
- Bản demo trên trình duyệt: https://claude.ai/artifact/QzimNK66atrttCrJtzBNet
- Code ở repository `nhungquynh2707-lang/nhan-vien-chat`, nhánh `main`. Repository đang **Public**, đã khuyên người dùng chuyển sang Private.
  - `bot.js`: webhook Messenger dùng Express, Anthropic SDK, có trang chạy thử `/thu?key=<VERIFY_TOKEN>`
  - `shop.txt`: thông tin shop **mẫu** ("Mây Boutique"), chưa thay bằng thông tin thật
  - `HUONG-DAN.md`: hướng dẫn từng bước cho người dùng
- Đã chạy thử với Claude và Facebook giả lập: gom tin, tính tiền (349.000đ), chuyển người thật, im lặng khi chủ shop trả lời, kiểm tra chữ ký đều đúng. **Chưa thử với Haiku thật.**
- Đã có khóa API Anthropic mới, có 5 USD. Khóa cũ bị dán vào chat đã được xóa.
- Railway: dự án đã **Online**, đã nhập `ANTHROPIC_API_KEY` và `VERIFY_TOKEN`.
  Tên miền công khai: https://nhan-vien-chat-production-e945231a.up.railway.app

## Đang kẹt
Tên miền trả lỗi **502 "Application failed to respond"**, nhiều khả năng do cổng không khớp. Đã hướng dẫn người dùng:
1. Xem Deploy Logs, tìm dòng "Đang chạy ở cổng XXXX".
2. Đặt cổng của tên miền (Settings > Networking > Public Networking) đúng số đó.
3. Nếu tab Variables có biến `PORT` (ví dụ 3000, chép từ `.env.example`) thì xóa đi.

Kiểm tra lại bằng: `curl https://nhan-vien-chat-production-e945231a.up.railway.app/`. Kết quả mong đợi là "Nhân viên chat đang chạy".

## Việc tiếp theo
1. Sửa xong lỗi 502. Người dùng mở `/thu?key=<VERIFY_TOKEN>` để thử Haiku thật với hai đơn mẫu:
   - 1 set croptop size S, ra **349.000đ** (319.000đ cộng 30.000đ ship, không được tự bịa màu)
   - 2 váy hoa size M màu kem, ra **578.000đ** (miễn phí ship)
   - Câu "cho em gặp nhân viên" phải chuyển người thật rồi dừng trả lời.
2. Người dùng thay `shop.txt` bằng thông tin shop thật.
3. Tạo ứng dụng trên developers.facebook.com: thêm Messenger, kết nối fanpage, lấy Page Access Token. Webhook là `https://<tên-miền>/webhook` với verify token bằng `VERIFY_TOKEN`. Đăng ký nhận `messages`, `messaging_postbacks`, `message_echoes`. Thêm `PAGE_ACCESS_TOKEN` và `APP_SECRET` vào Variables trên Railway.
4. Thử bằng tài khoản có vai trò trong ứng dụng, rồi gửi App Review quyền `pages_messaging` và chuyển ứng dụng sang chế độ Live.

## Lưu ý khi làm việc với người dùng
- Không bao giờ để người dùng dán khóa API hoặc token vào chat. Họ đã lỡ làm một lần.
- Phiên đám mây không gọi được API Claude bằng khóa của người dùng. Muốn thử Haiku thật thì dùng trang `/thu` trên Railway.
- Người dùng gửi ảnh chụp màn hình để báo tiến độ.
