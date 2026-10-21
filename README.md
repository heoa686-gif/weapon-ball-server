# Máy chủ Weapon Ball Arena

## Đưa lên Render (miễn phí)
1. Đưa thư mục `server/` (gồm `server.js`, `package.json`, `render.yaml`) lên một kho GitHub.
2. Vào render.com, chọn New > Blueprint, rồi chọn kho GitHub vừa tạo.
3. Sau khi chạy xong, vào tab Environment của dịch vụ để xem `ADMIN_KEY` (mã admin do Render tạo tự động). Ghi lại mã này.
4. Địa chỉ dạng `https://weapon-ball-arena-server.onrender.com` là địa chỉ máy chủ. Dán vào dòng `const API=` trong file game.

## Lưu ý
- Gói miễn phí của Render sẽ tạm ngủ khi không có người dùng, lần vào đầu tiên có thể chậm vài chục giây.
- Dữ liệu lưu trong `data.json`. Trên gói miễn phí, dữ liệu có thể mất khi máy chủ khởi động lại. Muốn giữ lâu dài, cần gắn ổ đĩa lưu trữ (Render gọi là Disk, thu phí) hoặc chuyển sang cơ sở dữ liệu.
- Đổi `ADMIN_KEY` thì quyền admin cũ không bị xóa; mã mới chỉ dùng để cấp quyền admin lần tiếp theo.
