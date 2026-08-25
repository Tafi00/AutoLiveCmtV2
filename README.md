# Live Comment Desktop

Ứng dụng desktop giúp quản lý nhiều tài khoản và gửi bình luận lên **Gosh** hoặc **Loco**. Mỗi tài khoản gắn với một nền tảng và dùng một hồ sơ Chrome riêng trên máy; ứng dụng không đọc hoặc xuất token/cookie.

## Cài đặt và chạy

Yêu cầu: Node.js 20+ và Google Chrome trên macOS.

```bash
npm install
npm start
```

Lệnh `npm start` mở cửa sổ **Live Comment** riêng; không cần mở địa chỉ localhost trong trình duyệt.

Nếu cần chạy giao diện web cục bộ để phát triển, dùng `npm run web`.

## Cách dùng

1. Mở **Tài khoản**, chọn Gosh/Loco, bấm **Thêm tài khoản** rồi đăng nhập trong cửa sổ Chrome vừa mở.
2. Sau khi đăng nhập, app tự lấy tên hiển thị từ hồ sơ/menu tài khoản và lưu cho session đó. Bật các tài khoản cần tham gia lượt gửi.
3. Mở **Live**, chọn nền tảng, nhập URL phòng Gosh hoặc `https://loco.com/stream/{id}` rồi thêm các mẫu bình luận.
4. Bấm **Gửi một ×N** để gửi mẫu kế tiếp từ toàn bộ `N` tài khoản đang bật, hoặc **Chạy tất cả** để gửi toàn bộ kho.
5. Mở **Kiểm tra API** để xem HTTP status, độ trễ và endpoint đang lỗi. Mở **Thiết lập** để đặt khoảng nghỉ; đổi tên tự động hiện áp dụng cho Gosh.

URL phòng và các thiết lập được tự lưu; không cần bấm nút lưu.

Tên tài khoản Gosh được đọc bằng endpoint hồ sơ trong chính browser session, sau đó fallback sang trang hồ sơ. Với Loco, app thử `device_profile`, sau đó đọc link `Channel preview` trong menu `Your profile`. Cookie và token không được sao chép ra khỏi Chrome profile.

Khi gửi, Gosh tái sử dụng WebSocket chat của website; Loco tái sử dụng Chat V2 qua HTTPS và giữ MQTT/WebSocket để nhận realtime. Nếu lớp gửi của website chưa sẵn sàng, app mới fallback sang nút gửi trên giao diện. Video, font và telemetry không cần thiết được chặn để giảm CPU, RAM và băng thông mà không ngắt luồng chat.

Màn kiểm tra API chỉ gọi danh sách endpoint cố định của ứng dụng, không nhận URL tùy ý. HTTP `401/403` được xem là endpoint vẫn hoạt động nhưng cần session; lỗi mạng, timeout và `5xx` được báo hỏng.

Mỗi mẫu được gửi lần lượt qua mọi tài khoản đang bật. Nếu một tài khoản lỗi hoặc hết phiên đăng nhập, ứng dụng ghi lỗi cho tài khoản đó và tiếp tục với các tài khoản còn lại. Khoảng nghỉ được áp dụng giữa hai mẫu bình luận. Trong lúc gửi, kho tin, cấu hình và danh sách tài khoản được khóa để giữ đúng thứ tự.

## Dữ liệu cục bộ

- `data/state.json`: tài khoản, cấu hình và kho bình luận.
- `data/browser-profile/`: session cũ, nay là **Tài khoản 1**.
- `data/browser-profiles/{account-id}/`: session riêng của các tài khoản thêm mới.

Thư mục `data/` đã được loại khỏi Git. Không chia sẻ thư mục này vì nó chứa trạng thái trình duyệt riêng của bạn.

## Kiểm thử

```bash
npm test
```

Chi tiết khảo sát endpoint nằm tại [`docs/api-findings.md`](docs/api-findings.md).
