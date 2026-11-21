# my-claude-mods

Marketplace mod Claude Code của VFM (`vfm-mods`).

| Mod | Làm gì |
| --- | --- |
| [`tien-do`](./tien-do) | Thay lệnh bash / code dài bằng tên việc + % tiến độ + thời gian ước tính; gọi tên lệnh xoá / nguy hiểm mà không hỏi thêm; **chặn cứng lệnh xoá database khi người dùng chưa yêu cầu**; theo dõi từng subagent. |
| [`xem-ket-qua`](./xem-ket-qua) | Claude cho bạn xem kết quả ngay trong terminal: ảnh, ảnh chụp trang HTML / localhost, **trước và sau đặt cạnh nhau**, kèm danh sách thay đổi và kiểm tra đã chạy. Ý tưởng từ [claude-show-your-work](https://github.com/iamumeransari/claude-show-your-work). |

## Cài

Cần Claude Code v2.1.287 trở lên.

```bash
claude plugin marketplace add duylinhdang1998/my-claude-mods
claude plugin install tien-do@vfm-mods
claude plugin install xem-ket-qua@vfm-mods
```

Đang mở phiên Claude Code thì gõ `/reload-plugins`.

## Kiểm tra

```bash
claude plugin validate tien-do
claude plugin test tien-do
claude plugin validate xem-ket-qua
claude plugin test xem-ket-qua
```
