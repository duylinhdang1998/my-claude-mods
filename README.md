# my-claude-mods

Marketplace mod Claude Code của VFM (`vfm-mods`).

| Mod | Làm gì |
| --- | --- |
| [`tien-do`](./tien-do) | Thay lệnh bash / code dài bằng tên việc + % tiến độ + thời gian ước tính; lệnh xoá trong project chạy bình thường, **hỏi trước khi push commit có xoá file**; gọi tên lệnh nguy hiểm khác; **chặn cứng lệnh xoá database khi người dùng chưa yêu cầu**; theo dõi từng subagent. |

## Cài

Cần Claude Code v2.1.287 trở lên.

```bash
claude plugin marketplace add duylinhdang1998/my-claude-mods
claude plugin install tien-do@vfm-mods
```

Đang mở phiên Claude Code thì gõ `/reload-plugins`.

## Kiểm tra

```bash
claude plugin validate tien-do
claude plugin test tien-do
```
