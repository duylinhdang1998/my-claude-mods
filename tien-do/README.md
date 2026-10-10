# tien-do — mod tiến độ cho Claude Code

Mod này đổi cách Claude Code hiển thị khi làm việc:

1. **Không còn lệnh bash / code dài loằng ngoằng.** Mỗi lệnh hiện thành một dòng tên việc, ví dụ `✓ Cài thư viện JavaScript`, `… Chạy test đăng nhập`, `✓ Sửa file app.ts (−3 +12 dòng)`. Kết quả lệnh thu gọn còn `⎿ xong · 120 dòng kết quả (đã ẩn)`; lỗi thì hiện dòng lỗi đầu tiên. Khối code dài trong câu trả lời thu gọn thành `▤ Đoạn ts · 85 dòng đã thu gọn`.
2. **Bảng tiến độ phía trên ô nhập**: đang làm phần nào, thanh %, đã chạy bao lâu, còn khoảng bao lâu, và danh sách việc `✓ ▶ ○`.
3. **Lệnh xoá / nguy hiểm được gọi tên rõ ràng**: `⚠ Xoá thư mục: build`, `⚠ Ghi đè lịch sử trên remote (force push): push --force origin main`, `⚠ Xoá bảng / cơ sở dữ liệu (DROP)`… Có một dòng cảnh báo trong transcript. Khi Claude vốn phải xin phép, hộp xin phép ghi tên việc nguy hiểm. Khi Claude được tự chạy (auto mode, allow rule, bypass), mod vẫn dừng lại hỏi bạn `Cho chạy / Chặn`.
4. **Cấm xoá database khi bạn chưa yêu cầu.** `prisma migrate reset`, `prisma db push --force-reset/--accept-data-loss`, `docker compose down -v`, `docker volume rm/prune`, `dropdb`, `supabase db reset`, `redis-cli FLUSHALL`, SQL `DROP/TRUNCATE/DELETE không WHERE` gửi vào psql/mysql/sqlite3, và công cụ MCP như `reset_branch` / `execute_sql` có DROP — bị **chặn cứng** (`⛔`), kể cả ở auto/bypass mode và kể cả với subagent, trừ khi **chính tin nhắn bạn gõ** yêu cầu xoá (vd "reset database đi"). Câu phủ định ("đừng / cấm xoá db") hay câu hỏi ("có nên xoá db không?") không tính; tin đến từ kênh chat, peer, lịch chạy cũng không tính. Có yêu cầu rồi mod vẫn hỏi lại `Cho chạy / Chặn`.
5. **Subagent có tên và tiến độ riêng**: `… Trinh sát #1 — Tìm file cấu hình ████░░ 60%~ · còn ~40 giây · 12 thao tác`, kèm dòng `đang: Đọc file config.ts`. Khi xong: `✓ Trinh sát #1 — … · xong sau 1:20`.

## Cách tính % và thời gian còn lại

- **Có danh sách việc** (Claude lập bằng công cụ todo/task): % = (việc xong + ½ việc đang làm) / tổng việc. Thời gian còn lại = tốc độ từ đầu đến giờ × phần việc còn lại. Mod nhắc Claude lập danh sách này cho việc từ 3 bước trở lên.
- **Subagent không có danh sách việc**: % ước tính theo thời gian chạy trung bình của loại subagent đó trên máy bạn (mod tự học sau mỗi lần chạy; lần đầu dùng mặc định 1–3 phút). Dấu `~` sau % nghĩa là ước tính theo giờ. Không bao giờ vượt 95% khi chưa xong thật; chạy lâu hơn thường lệ thì ghi rõ.
- **Chưa có danh sách việc**: bảng chỉ hiện thời gian đã chạy và số thao tác, không bịa %.

## Lệnh trong phiên

| Lệnh | Tác dụng |
| --- | --- |
| `/tien-do` | Ẩn / hiện bảng tiến độ |
| `/chi-tiet` | Bật / tắt xem đầy đủ lệnh, output và code nguyên văn |

## Tuỳ chọn (trong `/config`)

| Tuỳ chọn | Mặc định | Ý nghĩa |
| --- | --- | --- |
| Hỏi lại trước lệnh nguy hiểm | bật | Dừng hỏi `Cho chạy / Chặn` kể cả khi Claude được tự chạy |
| Số dòng code tối đa trước khi thu gọn | 12 | Khối code dài hơn sẽ thu gọn |
| Hướng dẫn Claude báo tiến độ | bật | Thêm đoạn ngắn vào system prompt: mô tả lệnh bằng tiếng Việt, lập danh sách việc, đặt tên subagent |

## Cài đặt

Cần Claude Code **v2.1.287 trở lên** (kiểm tra bằng `claude --version`). Mods chạy trong CLI ở terminal và tab Code của app Desktop.

1. Giải nén vào một thư mục cố định, ví dụ `~/claude-mods/tien-do` (Windows: `%USERPROFILE%\claude-mods\tien-do`).
2. Thử nhanh cho một phiên:
   ```bash
   claude --plugin-dir ~/claude-mods/tien-do
   ```
3. Cài hẳn (mọi phiên): trong terminal
   ```bash
   claude plugin marketplace add duylinhdang1998/my-claude-mods
   claude plugin install tien-do@vfm-mods
   ```
   Nếu đang mở phiên Claude Code, gõ `/reload-plugins`. Gõ `/plugin` sẽ thấy dòng `1 mod active · tien-do`.

Tắt mod: `/plugin` → tab **Installed** → disable `tien-do`.

## An toàn

Mod chạy với quyền của bạn như mọi mod. Mod này chỉ đọc sự kiện của phiên, vẽ giao diện, lưu thời gian chạy trung bình của subagent vào kho riêng của mod, và hỏi bạn trước lệnh nguy hiểm. Mod không gọi mạng, không chạy tiến trình, không đọc file. Kiểm tra lại bằng:

```bash
claude plugin validate ~/claude-mods/tien-do
```

Chuỗi trong dấu nháy và thân heredoc (message commit, nội dung file, `grep "DELETE FROM"`) là dữ liệu, không bị coi là lệnh; SQL chỉ bị xét khi nó thật sự được gửi vào client database. Lệnh lồng trong `sh -c "…"` hay heredoc đưa vào `bash` vẫn được xét.

Nhận diện lệnh nguy hiểm dựa trên mẫu chữ của lệnh, nên là lớp nhắc nhở, không thay được backup hay quyền truy cập đúng mức.

## Kiểm thử

```bash
claude plugin test ~/claude-mods/tien-do
```
