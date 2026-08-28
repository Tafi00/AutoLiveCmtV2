# Ghi nhận kỹ thuật từ Gosh và Loco

Khảo sát được thực hiện ở chế độ chỉ đọc bằng Chrome ngày 25–26/08/2026. Các giá trị nhận dạng phiên, cookie, header xác thực và token không được thu thập hoặc lưu lại.

## Luồng điều hướng

- Phòng/kênh của người sáng tạo có thể dùng `gosh6.app` hoặc `gosh.com`, với mẫu đường dẫn `/{showID}` hoặc `/vi/{showID}`.
- Trang hồ sơ cài đặt dùng route `/streamer-dashboard/settings/profile`.

## Endpoint quan trọng đã quan sát

| Method | Path | Mục đích quan sát được |
| --- | --- | --- |
| `GET` | `/gosh_base/app/live/get_by_anchor_v1` | Lấy trạng thái live theo tài khoản người phát |
| `GET` | `/gosh_base/app/live/get_by_id` | Lấy thông tin một phiên live |
| `POST` | `/gosh_base/app/live/join` | Tham gia phòng live |
| `POST` | `/gosh_base/app/live/quit` | Rời phòng live |
| `GET` | `/gosh_base/app/user/user_info` | Thông tin hồ sơ công khai/hiện hành |
| `POST` | `/gosh_base/app/user/user_center?scene=avatar` | Cập nhật hồ sơ, gồm nickname |
| `POST` | `/gosh_base/app/user/refresh_token` | Làm mới phiên do chính website quản lý |
| `GET` | `/gosh_base/app/anchor/sensitive_words` | Danh sách từ nhạy cảm của phòng |
| `GET` | `/gosh_base/app/anchor/setting` | Cấu hình chat của người phát |
| `GET` | `/gosh_base/app/live/room_block_list` | Trạng thái chặn trong phòng |
| `GET` | `/gosh_base/app/live/pinned` | Nội dung ghim trong phòng |
| `POST` | `/gosh_base/app/room/delete_public_chat` | Xóa chat, dành cho quyền quản trị phù hợp |

## Chat và đổi tên

Luồng gửi chat dùng Tencent Cloud Chat SDK. SDK duy trì WebSocket trong Web Worker; HTTP chỉ phục vụ các bước như lấy thông tin live, vào phòng và tải cấu hình. Không có REST endpoint gửi comment công khai, ổn định để thay thế.

Công cụ ưu tiên gọi lớp gửi chính thức đã được website tải trong trang để tái sử dụng WebSocket và phiên đăng nhập do website quản lý. Cách này chờ phản hồi xác nhận của SDK, không sao chép cookie/token và không tự dựng giao thức WebSocket. Nếu không tìm thấy lớp gửi (ví dụ website vừa đổi bundle), công cụ tự quay về thao tác ô chat và nút Gửi. Sau khi bắt đầu gửi realtime, lỗi không tự gửi lại qua UI để tránh tạo comment trùng khi chỉ thất lạc phản hồi xác nhận.

Chrome dành cho từng tài khoản cũng chặn luồng video, font, ảnh đại diện và telemetry không cần thiết. Phần HTML/JavaScript của phòng vẫn được giữ để đăng nhập, duy trì SDK chat và cung cấp phương án gửi dự phòng.

Biểu mẫu hồ sơ chính thức có trường nickname tối đa 20 ký tự và gọi endpoint cập nhật hồ sơ `POST /gosh_base/app/user/user_center?scene=avatar`. Sau khi người dùng ngừng nhập tên mới, công cụ tự thao tác trên biểu mẫu trong một tab hồ sơ riêng, tự bấm lưu và luôn đồng ý hộp xác nhận mà không sao chép request xác thực hay token. Khi có danh sách tên tự động, công cụ cũng xoay vòng danh sách và gọi cùng tính năng cập nhật hồ sơ sau mỗi số comment đã cấu hình. Tab phòng live vẫn được giữ riêng để lượt gửi hàng loạt có thể tiếp tục.

## Loco

- Trang live dùng `https://loco.com/stream/{uuid}` và có thể chuyển sang `/streamers/{username}`.
- Ô chat có placeholder động như `Slow mode is on: 5 sec`; nút gửi có accessible name `Send`.
- Trạng thái đăng nhập được nhận biết bằng nút `Your profile`. Menu này chứa `Channel preview` trỏ tới `/streamers/{username}`, là nguồn fallback để đồng bộ tên tài khoản.
- Trang hồ sơ chính thức là `/user/profile`.

| Method | URL | Mục đích quan sát được |
| --- | --- | --- |
| `GET` | `https://api.loco.com/auth/v3/user/device_profile/` | Hồ sơ thiết bị/người dùng hiện hành |
| `POST` | `https://api.loco.com/auth/v3/user/refresh_token/` | Làm mới access/refresh token |
| `GET` | `https://api.loco.com/auth/v1/ivory/config/?ivory=true` | Cấu hình client |
| `GET` | `https://api.loco.com/ivr/v3/homepage/sub_recipe/` | Dữ liệu discovery/homepage |
| `GET` | `https://api.loco.com/chat/v2/streams/{id}/history/` | Lịch sử chat của live |
| `GET` | `https://api.loco.com/chat/v2/streams/{id}/chat/?get=true` | Poll trạng thái/tin chat |
| `POST` | `https://api.loco.com/chat/v2/streams/{id}/chat/?send=true` | Gửi tin nhắn live chat |
| `GET` | `https://api.loco.com/ivr/v1/live/{id}/view/` | Thông tin lượt xem live |

Loco duy trì MQTT over WebSocket tại `wss://cf-mqtt-ws.getloconow.com/mqtt` để nhận chat/sự kiện realtime và gửi ping thiết bị. Tin nhắn live mới lại được gửi bằng Chat V2 REST qua HTTPS. Vì vậy, công cụ gọi chính hàm Chat V2 đã được website tải trong trang: phiên đăng nhập và header vẫn do mã Loco quản lý, không bị sao chép ra khỏi Chrome.

Kết quả thành công được xác nhận bằng mã phản hồi `C10`. Nếu bundle thay đổi khiến không tìm thấy hàm REST trước khi request bắt đầu, công cụ quay về thao tác nút `Send`. Khi request HTTPS đã bắt đầu, lỗi hoặc mất phản hồi không kích hoạt UI fallback để tránh comment trùng. MQTT vẫn được giữ để website nhận cập nhật realtime; video, font, playlist/segment phát live và telemetry không cần thiết bị chặn để giảm tài nguyên. Với phòng có cảnh báo nội dung trưởng thành, người dùng vẫn phải tự xác nhận trong Chrome trước khi công cụ được phép gửi.
