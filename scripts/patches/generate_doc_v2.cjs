const fs = require('fs');
const path = require('path');

const htmlContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Kế hoạch phân công dự án</title>
<style>
  body { font-family: 'Times New Roman', serif; line-height: 1.5; font-size: 13pt; }
  h1 { text-align: center; font-size: 18pt; text-transform: uppercase; font-weight: bold; }
  p { margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; }
  th, td { border: 1px solid black; padding: 8px; text-align: left; vertical-align: top; }
  th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
  .week-row { background-color: #d9e1f2; font-weight: bold; text-align: center; }
  .center { text-align: center; }
</style>
</head>
<body>
  <h1>BẢNG KẾ HOẠCH VÀ PHÂN CÔNG CÔNG VIỆC</h1>
  <p><b>Tên đề tài:</b> Xây dựng hệ thống quản lý chi tiêu cá nhân có tích hợp AI</p>
  <p><b>Trưởng nhóm (Leader):</b> Nguyễn Duy Trường</p>
  <p><b>Thành viên:</b> Nguyễn Duy Trường, Sìn Văn Cương, Giàng Hồng Anh, Giáp Đăng Khoa</p>
  <p><b>Định hướng thực hiện:</b> Nhóm sử dụng phương pháp "Vibe Coding" (sử dụng các công cụ Trí tuệ nhân tạo như ChatGPT, Gemini, Copilot để hỗ trợ tạo mã lập trình và xây dựng hệ thống mà không cần tự viết mã thủ công quá nhiều).</p>
  <p><b>Nguyên tắc phân công:</b></p>
  <ul>
    <li><b>Nguyễn Duy Trường & Sìn Văn Cương:</b> Đảm nhận các công việc khó nhất như thiết kế cơ sở dữ liệu, xử lý tính toán số liệu phức tạp, tự động hóa và tích hợp AI.</li>
    <li><b>Giàng Hồng Anh & Giáp Đăng Khoa:</b> Đảm nhận các công việc đơn giản hơn như tinh chỉnh giao diện, kiểm thử phần mềm (tìm lỗi), chuẩn bị dữ liệu và viết báo cáo.</li>
  </ul>

  <table>
    <thead>
      <tr>
        <th width="8%">Tuần</th>
        <th width="22%">Tên thành viên</th>
        <th width="45%">Công việc</th>
        <th width="25%">Ghi chú (Công cụ)</th>
      </tr>
    </thead>
    <tbody>
      <!-- TUAN 1 -->
      <tr class="week-row"><td colspan="4">Tuần 1: Lên ý tưởng và khởi tạo dự án</td></tr>
      <tr>
        <td rowspan="4" class="center">1</td>
        <td>Nguyễn Duy Trường</td>
        <td>Thiết kế cơ sở dữ liệu (các bảng lưu thông tin người dùng, ví tiền, giao dịch).</td>
        <td>Dùng AI để hỗ trợ thiết kế dữ liệu</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Khởi tạo dự án, thiết lập kết nối giữa trang web và cơ sở dữ liệu.</td>
        <td>Dùng công cụ lập trình AI (Cursor)</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Tìm kiếm ý tưởng giao diện, chọn màu sắc và bố cục cho phần mềm.</td>
        <td>Tham khảo mẫu trên mạng, Canva</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Tạo kho lưu trữ chung trên mạng để cả nhóm cùng tải công việc lên.</td>
        <td>GitHub</td>
      </tr>

      <!-- TUAN 2 -->
      <tr class="week-row"><td colspan="4">Tuần 2: Làm giao diện cơ bản và phần Đăng nhập</td></tr>
      <tr>
        <td rowspan="4" class="center">2</td>
        <td>Nguyễn Duy Trường</td>
        <td>Làm chức năng bảo mật, đảm bảo dữ liệu chi tiêu của ai thì người đó mới xem được.</td>
        <td>Nhờ AI viết mã bảo mật cơ sở dữ liệu</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm chức năng Đăng ký, Đăng nhập và Quên mật khẩu.</td>
        <td>Dùng AI hỗ trợ tạo chức năng đăng nhập</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Hoàn thiện màn hình trang Đăng nhập và giao diện bảng điều khiển chính.</td>
        <td>Dùng AI tạo giao diện kéo thả</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Tạo các tài khoản ảo để đăng nhập thử xem có lỗi không.</td>
        <td>Kiểm thử thủ công</td>
      </tr>

      <!-- TUAN 3 -->
      <tr class="week-row"><td colspan="4">Tuần 3: Quản lý Ví tiền và Danh mục chi tiêu</td></tr>
      <tr>
        <td rowspan="4" class="center">3</td>
        <td>Nguyễn Duy Trường</td>
        <td>Làm chức năng tính toán tổng số tiền hiện có dựa trên các khoản đã tiêu.</td>
        <td>Dùng AI tạo thuật toán tính tiền</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm chức năng Thêm, Sửa, Xóa cho Ví tiền và Danh mục chi tiêu.</td>
        <td>AI hỗ trợ viết mã kết nối dữ liệu</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Vẽ các bảng nhập thông tin (Thêm ví mới, Thêm danh mục mới).</td>
        <td>Dùng AI tạo giao diện nhập liệu</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Dùng thử phần mềm để nhập sẵn các danh mục chi tiêu phổ biến (Ăn uống, Đi lại...).</td>
        <td>Thao tác trực tiếp trên phần mềm</td>
      </tr>

      <!-- TUAN 4 -->
      <tr class="week-row"><td colspan="4">Tuần 4: Ghi chép Thu/Chi và tải ảnh hóa đơn</td></tr>
      <tr>
        <td rowspan="4" class="center">4</td>
        <td>Nguyễn Duy Trường</td>
        <td>Xử lý phần tải ảnh hóa đơn lên hệ thống lưu trữ đám mây an toàn.</td>
        <td>Sử dụng AI kết nối kho lưu trữ</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm tính năng khi người dùng nhập khoản chi thì ví tiền tự động bị trừ đi.</td>
        <td>Dùng AI xử lý dữ liệu thu/chi</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Làm đẹp danh sách các giao dịch (thêm biểu tượng, màu đỏ cho chi, màu xanh cho thu).</td>
        <td>Dùng AI chỉnh sửa phong cách giao diện</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Tải thử các ảnh hóa đơn rất to hoặc sai định dạng xem trang web có bị sập không.</td>
        <td>Tìm ảnh mẫu và kiểm thử thủ công</td>
      </tr>

      <!-- TUAN 5 -->
      <tr class="week-row"><td colspan="4">Tuần 5: Tính năng Giao dịch tự động lặp lại và Ngân sách</td></tr>
      <tr>
        <td rowspan="4" class="center">5</td>
        <td>Nguyễn Duy Trường</td>
        <td>Làm tính năng tự động ghi nhận giao dịch mỗi tuần/tháng/quý (tính năng khó).</td>
        <td>Nhờ AI viết thuật toán tự động hóa</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm tính năng Ngân sách, tự động cảnh báo khi người dùng sắp tiêu hết tiền.</td>
        <td>Dùng AI tính toán phần trăm số dư</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Vẽ giao diện hiển thị các khoản sắp đến hạn (như tiền thuê nhà, tiền mạng).</td>
        <td>Dùng AI tạo giao diện cảnh báo</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Kiểm tra xem đến ngày hẹn, hệ thống có tự động trừ tiền thật không.</td>
        <td>Kiểm thử bằng cách đổi ngày máy tính</td>
      </tr>

      <!-- TUAN 6 -->
      <tr class="week-row"><td colspan="4">Tuần 6: Tích hợp Trí tuệ nhân tạo (AI) nhận diện chi tiêu</td></tr>
      <tr>
        <td rowspan="4" class="center">6</td>
        <td>Nguyễn Duy Trường</td>
        <td>Kết nối với AI (như Gemini) để dịch câu nói của người dùng thành thông tin giao dịch (ví dụ: "vừa uống trà đá 10k").</td>
        <td>Dùng AI hỗ trợ kết nối với công cụ AI</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm ô nhập văn bản để người dùng gõ câu nói vào, xử lý khi AI trả lời chậm.</td>
        <td>Dùng AI hỗ trợ làm khung nhập liệu</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Làm hiệu ứng "đang chờ AI phân tích" cho đẹp mắt.</td>
        <td>Dùng AI tạo hiệu ứng hình ảnh</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Nghĩ ra hơn 100 câu nói chi tiêu tiếng Việt phức tạp để thử thách xem AI nhận diện đúng không.</td>
        <td>Soạn thảo trên Excel hoặc Word</td>
      </tr>

      <!-- TUAN 7 -->
      <tr class="week-row"><td colspan="4">Tuần 7: Chức năng Tiết kiệm và Vẽ biểu đồ thống kê</td></tr>
      <tr>
        <td rowspan="4" class="center">7</td>
        <td>Nguyễn Duy Trường</td>
        <td>Làm chức năng gom nhóm số tiền đã tiêu để tổng hợp cho việc vẽ biểu đồ.</td>
        <td>Nhờ AI viết mã gom nhóm số liệu</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Làm chức năng Lập mục tiêu tiết kiệm (mua xe, mua nhà) và khóa tiền lại không cho tiêu.</td>
        <td>Dùng AI hỗ trợ xử lý quỹ tiền</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Đưa các biểu đồ hình tròn, hình cột sinh động vào trang thống kê chi tiêu.</td>
        <td>Nhờ AI chèn thư viện biểu đồ</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Cầm máy tính bấm cộng lại số tiền xem biểu đồ vẽ có đúng thực tế không.</td>
        <td>Máy tính cầm tay, kiểm tra số liệu</td>
      </tr>

      <!-- TUAN 8 -->
      <tr class="week-row"><td colspan="4">Tuần 8: Sửa lỗi và Làm mượt hệ thống</td></tr>
      <tr>
        <td rowspan="4" class="center">8</td>
        <td>Nguyễn Duy Trường</td>
        <td>Tối ưu hóa để trang web tải nhanh hơn, khi bấm không bị đơ.</td>
        <td>Nhờ AI tìm và sửa các đoạn mã bị chậm</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Sửa các lỗi vặt nguy hiểm như hiển thị số dư âm tiền, lỗi mất kết nối mạng.</td>
        <td>Dùng AI quét lỗi toàn bộ phần mềm</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Chỉnh lại giao diện để khi mở bằng điện thoại thì trang web không bị vỡ chữ.</td>
        <td>Dùng AI căn chỉnh giao diện điện thoại</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Đóng vai người dùng khó tính, dùng thử mọi nút bấm để tìm lỗi và ghi lại.</td>
        <td>Viết danh sách báo lỗi</td>
      </tr>

      <!-- TUAN 9 -->
      <tr class="week-row"><td colspan="4">Tuần 9: Triển khai lên mạng và Viết báo cáo</td></tr>
      <tr>
        <td rowspan="4" class="center">9</td>
        <td>Nguyễn Duy Trường</td>
        <td>Đưa trang web lên mạng internet để ai cũng có thể truy cập được thông qua đường link.</td>
        <td>Nhờ AI hướng dẫn cách đưa web lên mạng</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Đọc lại toàn bộ luồng hoạt động của hệ thống để chuẩn bị kịch bản báo cáo với thầy cô.</td>
        <td>Viết kịch bản giải thích phần mềm</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Thiết kế bản trình chiếu (Slide) thật đẹp, thống nhất màu sắc với phần mềm để thuyết trình.</td>
        <td>Thiết kế trên Canva hoặc PowerPoint</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Soạn thảo quyển báo cáo tổng kết môn học (in ra giấy), quay video minh họa cách dùng phần mềm.</td>
        <td>Microsoft Word, phần mềm quay màn hình</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const outputPath = path.join(__dirname, 'Ke_Hoach_Phan_Cong_Du_An_V2.doc');
fs.writeFileSync(outputPath, htmlContent, 'utf8');
console.log('Word document updated to ' + outputPath);
