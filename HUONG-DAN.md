# Hướng dẫn đưa nhân viên chat AI lên fanpage

Chương trình nhận tin nhắn khách từ fanpage và trả lời bằng Claude Haiku 5.5. Các việc nó làm:

- Tư vấn, báo giá và chốt đơn theo thông tin trong file `shop.txt`. Tổng tiền do chương trình tự tính, không để AI cộng nhẩm.
- Gom các tin khách gửi liên tiếp thành một lượt, rồi trả lời một lần.
- **Tự im lặng 12 giờ với một khách** khi khách đòi gặp người thật, khiếu nại, đổi trả, hoặc khi bạn tự vào trả lời khách đó trên fanpage.
- Đơn hàng nằm luôn trong cuộc chat Messenger, không lưu ở nơi khác.

## Bước 1: Sửa thông tin cửa hàng

Mở `shop.txt` và thay sản phẩm, giá, size, phí ship, đổi trả bằng thông tin thật của shop. Nếu phí ship khác 30.000đ hoặc mức miễn phí ship khác 500.000đ, sửa thêm `SHIP_FEE` và `FREE_SHIP_FROM` trong file `.env` (bước 4).

## Bước 2: Lấy khóa API Anthropic (để trả tiền dùng Haiku)

1. Vào console.anthropic.com, đăng ký tài khoản.
2. Vào mục Billing, nạp tiền (mức nạp thấp nhất là đủ để thử).
3. Vào mục API Keys, bấm Create Key rồi chép khóa lại. Không gửi khóa này cho ai.

## Bước 3: Đưa chương trình lên Railway

**3a. Đưa file lên GitHub**
1. Tạo tài khoản tại github.com.
2. Bấm **New repository**, đặt tên `nhan-vien-chat`, chọn **Private**, rồi bấm **Create repository**.
3. Bấm **uploading an existing file**, kéo thả các file đã giải nén từ `nhan-vien-chat.zip` vào, rồi bấm **Commit changes**.

**3b. Chạy trên Railway**
1. Vào railway.com và đăng nhập bằng tài khoản GitHub.
2. Bấm **New Project**, chọn **Deploy from GitHub repo**, rồi chọn `nhan-vien-chat`.
3. Mở tab **Variables** và thêm 2 biến:
   - `ANTHROPIC_API_KEY`: khóa API Anthropic (bước 2)
   - `VERIFY_TOKEN`: một chuỗi bạn tự đặt, ví dụ `may-boutique-2026`
4. Vào **Settings > Networking**, bấm **Generate Domain**. Bạn sẽ nhận được một địa chỉ, ví dụ `https://nhan-vien-chat.up.railway.app`.
5. Mở địa chỉ đó. Nếu trang hiện "Nhân viên chat đang chạy" là thành công.

**3c. Chạy thử với Haiku thật (chưa cần Facebook)**

Mở `https://<địa-chỉ>/thu?key=<VERIFY_TOKEN>` và nhắn như khách để kiểm tra cách trả lời, tính tiền và chuyển nhân viên. Mỗi tin thử tốn vài đồng.

Railway tính phí theo mức dùng. Xem giá trên trang của Railway trước khi chọn gói.

## Bước 4: Tạo ứng dụng trên Meta

1. Vào developers.facebook.com và đăng nhập bằng tài khoản Facebook đang quản trị fanpage.
2. Bấm **Tạo ứng dụng**, chọn mục đích liên quan đến **Messenger**.
3. Trong phần cài đặt Messenger:
   - Kết nối fanpage và bấm **Tạo mã** (Generate token). Chép mã này vào `PAGE_ACCESS_TOKEN`.
   - Phần Webhook: nhập Callback URL là `https://<địa-chỉ-của-bạn>/webhook`. Verify token là một chuỗi bạn tự đặt, ví dụ `may-boutique-2026`, và chuỗi này phải giống hệt `VERIFY_TOKEN`.
   - Đăng ký nhận sự kiện (subscribe) cho fanpage: tick **messages**, **messaging_postbacks** và **message_echoes**. Mục message_echoes là thứ giúp AI biết lúc bạn tự trả lời khách.
4. Vào **Cài đặt ứng dụng > Thông tin cơ bản**, chép **Khóa bí mật của ứng dụng** (App Secret) vào `APP_SECRET`.

5. Quay lại tab **Variables** trên Railway, thêm `PAGE_ACCESS_TOKEN` và `APP_SECRET`. Railway sẽ tự khởi động lại chương trình.

Giao diện của Meta thay đổi thường xuyên, nên tên các nút có thể hơi khác. Nếu bạn bị kẹt ở bước nào, chụp màn hình gửi tôi.

## Bước 5: Chạy thử rồi mở cho khách thật

1. Khi ứng dụng còn ở **chế độ phát triển**, chỉ những tài khoản có vai trò trong ứng dụng (bạn, hoặc người bạn thêm làm Tester) mới nhận được trả lời. Dùng tài khoản Facebook cá nhân nhắn vào fanpage để thử.
2. Thử đủ các tình huống: hỏi giá, hỏi size, chốt đơn, đòi gặp nhân viên, bạn tự trả lời xem AI có im lặng không.
3. Để khách thật được trả lời, gửi ứng dụng cho Meta duyệt (**App Review**) quyền `pages_messaging`, rồi chuyển ứng dụng sang chế độ **Live**. Meta có thể yêu cầu xác minh doanh nghiệp, và thời gian duyệt thường mất vài ngày.

## Vận hành hằng ngày

- **Sửa thông tin shop:** sửa `shop.txt` rồi khởi động lại chương trình.
- **Thời gian AI im lặng sau khi chuyển người thật:** đổi `PAUSE_HOURS` (mặc định 12 giờ).
- **Trả lời khách bằng tay:** cứ trả lời bình thường trong hộp thư fanpage. AI tự ngừng với khách đó.
- **Chi phí:** xem trong console.anthropic.com, mục Usage.
