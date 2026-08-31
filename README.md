# Live Comment Desktop

Ứng dụng desktop giúp quản lý nhiều tài khoản và gửi bình luận đồng thời lên **Gosh** và **Loco**. Mỗi tài khoản gắn với một nền tảng và dùng một hồ sơ Chrome riêng trên máy; ứng dụng không xuất token/cookie.

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
3. Mở **Live**, nhập URL phòng Gosh và URL `https://loco.com/stream/{id}` vào hai ô riêng. Thêm mẫu vào đúng khung **Bình luận Gosh** hoặc **Bình luận Loco**; có thể chỉ nhập một website nếu cần.
4. Bấm **Gửi song song** để gửi mẫu kế tiếp của từng khung đồng thời tới Gosh và Loco, hoặc **Chạy tất cả** để gửi toàn bộ các kho.
5. Mở **Kiểm tra API** để xem HTTP status, độ trễ và endpoint đang lỗi. Mở **Thiết lập** để đặt khoảng nghỉ; đổi tên tự động hiện áp dụng cho Gosh.

URL phòng và các thiết lập được tự lưu; không cần bấm nút lưu.

Tên tài khoản Gosh được đọc bằng endpoint hồ sơ trong chính browser session, sau đó fallback sang trang hồ sơ. Với Loco, app thử `device_profile`, sau đó đọc link `Channel preview` trong menu `Your profile`. Cookie và token không được sao chép ra khỏi Chrome profile.

Khi gửi, Gosh tái sử dụng WebSocket chat của website; Loco tái sử dụng Chat V2 qua HTTPS và giữ MQTT/WebSocket để nhận realtime. Nếu lớp gửi của website chưa sẵn sàng, app mới fallback sang nút gửi trên giao diện. Video, font và telemetry không cần thiết được chặn để giảm CPU, RAM và băng thông mà không ngắt luồng chat.

Màn kiểm tra API chỉ gọi danh sách endpoint cố định của ứng dụng, không nhận URL tùy ý. HTTP `401/403` được xem là endpoint vẫn hoạt động nhưng cần session; lỗi mạng, timeout và `5xx` được báo hỏng.

Mỗi lượt chọn mẫu kế tiếp độc lập từ kho Gosh và kho Loco rồi gửi tới hai website cùng lúc. Khi có nhiều tài khoản trên cùng một website, ứng dụng luân phiên tài khoản ở các lượt tiếp theo. Nếu một website lỗi hoặc hết phiên đăng nhập, website còn lại vẫn tiếp tục. Khoảng nghỉ được áp dụng sau khi các website đang có mẫu hoàn tất lượt hiện tại. Trong lúc gửi, kho tin, cấu hình và danh sách tài khoản được khóa để giữ đúng thứ tự. Đổi tên chỉ áp dụng cho tài khoản Gosh.

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
