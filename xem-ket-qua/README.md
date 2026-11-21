# xem-ket-qua — Claude cho bạn xem kết quả ngay trong terminal

Lấy ý tưởng từ [claude-show-your-work](https://github.com/iamumeransari/claude-show-your-work) (MIT), viết lại gọn bằng tiếng Việt: chỉ ảnh và ảnh chụp trang, không có video, audio, PDF hay tự cập nhật.

1. **Ảnh hiện ngay dưới hàng công cụ.** Sau khi làm giao diện, Claude chụp lại và gọi `show_image`, nên bạn không phải tự mở file hay localhost. Nhận PNG, JPEG, WebP, GIF, TIFF, BMP, HEIC.
2. **Chụp trang HTML / localhost.** `show_html` mở file `.html` hoặc dev server (`http://localhost…`, `127.0.0.1`, `[::1]`) bằng Chrome headless, khung 1280×800 mặc định, rồi hiện ảnh chụp. Mod không mở trang ngoài máy.
3. **Trước / sau cạnh nhau.** Khi sửa lỗi giao diện, Claude truyền thêm ảnh hoặc trang bản cũ (`compare`). Terminal rộng từ khoảng 96 cột thì hai ảnh đặt cạnh nhau, hẹp hơn thì xếp chồng.
4. **Danh sách thay đổi và kiểm tra.** Dưới ảnh là `Đã thay đổi` (Claude đã sửa gì) và `Kiểm tra 3/4` với ✓ / ✗ cho từng kiểm tra Claude đã chạy thật.
5. **Claude tự làm, không cần nhắc.** Tin nhắn đầu mỗi phiên (và sau khi nén ngữ cảnh) có kèm một dòng nhắc Claude cho bạn xem kết quả trước khi báo xong.

Mỗi ảnh được lưu thành một bản PNG riêng trong thư mục tạm của phiên. Nhờ vậy, khi Claude chụp đè lên cùng file, ảnh cũ trong transcript vẫn giữ nguyên. Ảnh lớn được thu nhỏ còn cạnh dài 1600 px.

## Terminal nào hiện được ảnh

| Terminal | Hiện ảnh |
| --- | --- |
| Ghostty, kitty | Có |
| iTerm2 3.5+ | Chỉ khi Claude Code chạy toàn màn hình |
| Trong tmux | Cần `set -g allow-passthrough on` và `set -g focus-events on`, và terminal bên ngoài vẽ được ảnh |
| Terminal khác, app Desktop, điện thoại | Không. Chỉ hiện đường dẫn file, và Claude được báo là bạn chưa xem |

## Cần có

- Claude Code **v2.1.287 trở lên**.
- `show_html`: Google Chrome, Chromium, Edge hoặc Brave. Không có trình duyệt thì công cụ này không được đăng ký.
- Ảnh không phải PNG: macOS dùng `sips` có sẵn; Linux cần ImageMagick (`magick`) hoặc `ffmpeg`.

## Cài đặt

```bash
claude plugin marketplace add duylinhdang1998/my-claude-mods
claude plugin install xem-ket-qua@vfm-mods
```

Nếu đang mở phiên Claude Code, gõ `/reload-plugins`.

Thử nhanh cho một phiên mà không cài: `claude --plugin-dir ~/duong-dan/xem-ket-qua`.

## An toàn

Mod chạy với quyền của bạn như mọi mod. Mod chỉ đọc file ảnh Claude đưa, chạy `cp` / `sips` / `magick` / `ffmpeg` để đổi ảnh, chạy Chrome headless để chụp trang, và ghi vào thư mục tạm của phiên. Mod không gọi mạng. Chrome chỉ được mở file trên máy hoặc địa chỉ localhost, nhưng trang vẫn có thể chạy script của nó khi được chụp.

## Kiểm thử

```bash
claude plugin validate xem-ket-qua
claude plugin test xem-ket-qua
```
