# Live Comment Desktop

Ứng dụng desktop giúp quản lý nhiều tài khoản và gửi bình luận đồng thời lên **Gosh**, **Loco** và **GaQuayTV**. Mỗi tài khoản gắn với một nền tảng và một hồ sơ Chrome riêng để đăng nhập; khi gửi, app chỉ dùng token đã lưu và gọi thẳng API của website, không mở Chrome.

## Cài đặt và chạy

Yêu cầu: Node.js 20+ và Google Chrome trên macOS.

```bash
npm install
npm start
```

Lệnh `npm start` mở cửa sổ **Live Comment** riêng; không cần mở địa chỉ localhost trong trình duyệt.

Nếu cần chạy giao diện web cục bộ để phát triển, dùng `npm run web`.

## Cách dùng

1. Mở **Tài khoản**, chọn Gosh/Loco/GaQuayTV, bấm **Thêm tài khoản** rồi đăng nhập trong cửa sổ Chrome vừa mở (hoặc nhập trực tiếp user/pass cho GaQuayTV).
2. Khi cửa sổ Chrome đăng nhập đóng lại, app tự đọc token từ hồ sơ đó. Với tài khoản đã đăng nhập từ trước, bấm **Nạp token từ Chrome** một lần (mỗi lần đọc tối đa 3 hồ sơ song song). Có thể cấu hình **Proxy** riêng cho từng tài khoản; khi gửi bằng token chỉ hỗ trợ proxy HTTP/HTTPS (`http://user:pass@host:port` hoặc `host:port:user:pass`). Bật các tài khoản cần tham gia lượt gửi.
3. Mở **Live**, nhập các URL phòng Gosh/Loco/GaQuayTV vào các ô riêng, mỗi dòng một link (tối đa 20 link mỗi website). Thêm mẫu vào đúng khung **Bình luận Gosh**, **Bình luận Loco** hoặc **Bình luận GaQuayTV**; có thể chỉ nhập một website nếu cần.
4. Bấm **Gửi song song** để gửi mẫu kế tiếp của từng khung đồng thời tới tất cả link đã nhập, hoặc **Chạy tất cả** để gửi toàn bộ các kho trên từng link.
5. Mở **Kiểm tra API** để xem HTTP status, độ trễ và endpoint đang lỗi. Mở **Thiết lập** để đặt khoảng nghỉ; đổi tên tự động hiện áp dụng cho Gosh và GaQuayTV.

URL phòng và các thiết lập được tự lưu; không cần bấm nút lưu.

Token được lấy từ cookie của hồ sơ Chrome (Gosh: `token`, `uid`, `did`, `tim_user_sig`; Loco và GaQuayTV: `access_token`, `refresh_token`) rồi lưu vào `data/account-tokens.json`. Tên hiển thị lấy từ `user_info` (Gosh), JWT (Loco) hoặc `auth/me` (GaQuayTV).

Khi gửi, mọi request đi thẳng từ app tới website qua proxy của tài khoản:

- **Gosh**: tra phòng bằng `live/batch_get_by_anchor` (request được ký `X-Signature` như website), rồi gửi custom message vào nhóm `im_room` qua Tencent Chat SDK. Mỗi tài khoản có một bản SDK riêng.
- **Loco**: `POST chat/v2/streams/{id}/chat/?send=true`. Token hết hạn (khoảng 2 giờ) được làm mới qua `auth/v3/user/refresh_token/` và lưu lại.
- **GaQuayTV**: socket.io tới `chat.gaquaytv.com` (`join_room` rồi `send_message`); coi là gửi thành công khi phòng phát lại tin nhắn. Token được làm mới qua `auth/refresh-token`.

Kết nối realtime (socket GaQuayTV, phiên IM Gosh) tự đóng sau 3 phút không dùng. Trong lúc **Chạy tất cả** chờ hết khoảng nghỉ, app kết nối trước cho các tài khoản sẽ gửi ở lượt kế tiếp. Nếu token bị từ chối, app làm mới token rồi gửi lại một lần; nếu không làm mới được thì đọc lại hồ sơ Chrome, sau đó báo tài khoản cần đăng nhập lại. Trước khi mở cửa sổ Chrome của tài khoản, token đã làm mới được ghi ngược vào hồ sơ để Chrome vẫn giữ đăng nhập.

Màn kiểm tra API chỉ gọi danh sách endpoint cố định của ứng dụng, không nhận URL tùy ý. HTTP `401/403` được xem là endpoint vẫn hoạt động nhưng cần session; lỗi mạng, timeout và `5xx` được báo hỏng.

Mỗi lượt chọn mẫu kế tiếp độc lập từ kho Gosh, kho Loco và kho GaQuayTV rồi gửi tới mọi phòng live của website đó cùng lúc. Một tài khoản vẫn có thể phục vụ nhiều phòng trùng giờ. Khi có nhiều tài khoản trên cùng một website, ứng dụng luân phiên tài khoản độc lập cho từng link. Nếu một link lỗi hoặc hết phiên đăng nhập, các link còn lại vẫn tiếp tục. Khoảng nghỉ được áp dụng sau khi các phòng đang có mẫu hoàn tất lượt hiện tại. Trong lúc gửi, kho tin, cấu hình và danh sách tài khoản được khóa để giữ đúng thứ tự. Đổi tên áp dụng cho tài khoản Gosh và GaQuayTV.

## Dữ liệu cục bộ

- `data/state.json`: tài khoản, cấu hình và kho bình luận.
- `data/account-tokens.json`: token API của từng tài khoản (quyền đọc chỉ cho người dùng hiện tại). Xóa tài khoản sẽ xóa token của nó.
- `data/browser-profile/`: session cũ, nay là **Tài khoản 1**.
- `data/browser-profiles/{account-id}/`: session riêng của các tài khoản thêm mới.

Thư mục `data/` đã được loại khỏi Git. Không chia sẻ thư mục này vì nó chứa trạng thái trình duyệt riêng của bạn.

## Kiểm thử

```bash
npm test
```

Chi tiết khảo sát endpoint nằm tại [`docs/api-findings.md`](docs/api-findings.md).
