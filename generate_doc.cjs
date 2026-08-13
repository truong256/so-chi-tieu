const fs = require('fs');
const path = require('path');

const htmlContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Kế hoạch phân công dự án</title>
<style>
  body { font-family: 'Times New Roman', serif; line-height: 1.5; }
  h1 { text-align: center; font-size: 20pt; text-transform: uppercase; }
  h2 { font-size: 14pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid black; padding: 8px; text-align: left; vertical-align: top; }
  th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
  .week-row { background-color: #d9e1f2; font-weight: bold; }
</style>
</head>
<body>
  <h1>BẢNG PHÂN CÔNG CÔNG VIỆC CHI TIẾT</h1>
  <p><b>Tên đề tài:</b> Xây dựng hệ thống quản lý chi tiêu cá nhân có tích hợp AI</p>
  <p><b>Leader:</b> Nguyễn Duy Trường</p>
  <p><b>Thành viên:</b> Nguyễn Duy Trường, Sìn Văn Cương, Giàng Hồng Anh, Giáp Đăng Khoa</p>
  <p><b>Nguyên tắc phân công:</b></p>
  <ul>
    <li><b>Nguyễn Duy Trường & Sìn Văn Cương:</b> Đảm nhận các công việc lõi phức tạp, thuật toán (Idempotency, advanceRecurring), thiết kế cơ sở dữ liệu (Supabase), tích hợp AI (Smart Parser), và tối ưu hiệu năng.</li>
    <li><b>Giàng Hồng Anh & Giáp Đăng Khoa:</b> Đảm nhận giao diện UI/UX (React, CSS), thao tác forms, quản lý QA/Testing, và viết tài liệu báo cáo.</li>
  </ul>

  <table>
    <thead>
      <tr>
        <th width="10%">Tuần</th>
        <th width="20%">Thành viên</th>
        <th width="45%">Nhiệm vụ chi tiết</th>
        <th width="25%">Công cụ / Ghi chú</th>
      </tr>
    </thead>
    <tbody>
      <!-- TUAN 1 -->
      <tr class="week-row"><td colspan="4">Tuần 1: Khởi tạo dự án & Thiết kế hệ thống</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">1</td>
        <td>Nguyễn Duy Trường</td>
        <td>Thiết kế lược đồ cơ sở dữ liệu (Database Schema) cho Users, Wallets, Transactions, Recurring. Cấu hình bảo mật RLS cơ bản.</td>
        <td>Supabase, PostgreSQL</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Khởi tạo framework Next.js, cài đặt TypeScript, thiết lập kết nối Supabase Auth.</td>
        <td>Next.js, TypeScript</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Phân tích UI/UX, thiết kế thư mục giao diện, viết CSS (globals.css), tạo các component cơ sở (Button, Input).</td>
        <td>Figma, CSS/Tailwind</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Cấu hình repository, quản lý source code nhóm, tìm hiểu môi trường chạy dự án.</td>
        <td>Git, GitHub</td>
      </tr>

      <!-- TUAN 2 -->
      <tr class="week-row"><td colspan="4">Tuần 2: Xây dựng Core UI & Quản lý Tài khoản (Auth)</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">2</td>
        <td>Nguyễn Duy Trường</td>
        <td>Viết các RLS Policies chuyên sâu bảo vệ dữ liệu chéo giữa các User. Cấu hình bảng Profiles.</td>
        <td>Supabase SQL</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Hoàn thiện luồng logic Đăng nhập/Đăng ký (auth-screen.tsx), xử lý token session.</td>
        <td>Supabase Auth, React</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Code giao diện trang Đăng nhập và layout Dashboard tổng thể. Xử lý trạng thái Loading.</td>
        <td>React, TSX</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Tạo mock data cho Users, viết kịch bản test case cho luồng đăng nhập (Manual Test).</td>
        <td>Excel, Manual Test</td>
      </tr>

      <!-- TUAN 3 -->
      <tr class="week-row"><td colspan="4">Tuần 3: Chức năng Quản lý Ví & Danh mục</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">3</td>
        <td>Nguyễn Duy Trường</td>
        <td>Xây dựng logic đồng bộ số dư (availableBalances), tính toán tổng tài sản dựa trên giao dịch.</td>
        <td>TypeScript, useMemo</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Tích hợp API CRUD (Thêm/Sửa/Xóa) cho Ví (Wallets) và Danh mục (Categories).</td>
        <td>Supabase JS SDK</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Code giao diện form/modal Thêm/Sửa Ví và Danh mục (chọn icon, màu sắc).</td>
        <td>React Modals</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Test các trường hợp nhập liệu thiếu ở Modal, tạo danh mục chi tiêu mặc định.</td>
        <td>Browser, Test script</td>
      </tr>

      <!-- TUAN 4 -->
      <tr class="week-row"><td colspan="4">Tuần 4: Giao dịch Thu/Chi & Hóa đơn</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">4</td>
        <td>Nguyễn Duy Trường</td>
        <td>Xử lý logic lưu ảnh hóa đơn, phân quyền Storage bảo mật (chỉ user thấy hóa đơn của mình).</td>
        <td>Supabase Storage</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Hoàn thiện logic form tạo giao dịch (saveSimple), liên kết ngân sách/ví nguồn.</td>
        <td>React, FormData</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Code CSS và layout cho danh sách giao dịch, lưới hiển thị, responsive giao diện.</td>
        <td>CSS, Flexbox/Grid</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Test upload file kích thước lớn, định dạng sai, kiểm tra hiển thị list giao dịch.</td>
        <td>Manual Test, Dummy images</td>
      </tr>

      <!-- TUAN 5 -->
      <tr class="week-row"><td colspan="4">Tuần 5: Giao dịch định kỳ (Recurring) & Ngân sách</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">5</td>
        <td>Nguyễn Duy Trường</td>
        <td>Thiết kế logic chống tạo trùng lặp (Idempotency), thuật toán tính ngày (advanceRecurring, finance-utils).</td>
        <td>TypeScript, SQL Constraints</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Xây dựng logic Ngân sách (Budgets), kiểm tra số dư và chặn chi vượt ngân sách.</td>
        <td>React State, Hooks</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Xây dựng giao diện thẻ Giao dịch định kỳ, trang thái "Sắp đến hạn", "Quá hạn".</td>
        <td>React Components</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Test các chu kỳ đặc biệt (tuần, quý, tháng thiếu ngày 29-31), test cảnh báo ngân sách.</td>
        <td>Boundary Testing</td>
      </tr>

      <!-- TUAN 6 -->
      <tr class="week-row"><td colspan="4">Tuần 6: Tích hợp Trí tuệ nhân tạo (AI Smart Parser)</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">6</td>
        <td>Nguyễn Duy Trường</td>
        <td>Kết nối API của AI (Gemini/OpenAI), viết prompt engineering để phân tích text tự nhiên sang JSON giao dịch (smart-parser.ts).</td>
        <td>Gemini API / LLM</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Tích hợp module AI vào UI (input nhận dạng giọng nói/văn bản), xử lý timeout/error của AI.</td>
        <td>React, Fetch API</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Làm loading state (skeleton), giao diện hiển thị và chỉnh sửa kết quả AI dự đoán.</td>
        <td>CSS Animations, React</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Thu thập 200+ mẫu câu nhập chi tiêu tự nhiên phức tạp để test và tinh chỉnh AI Prompt.</td>
        <td>Excel, Prompt Testing</td>
      </tr>

      <!-- TUAN 7 -->
      <tr class="week-row"><td colspan="4">Tuần 7: Chức năng Tiết kiệm (Goals) & Báo cáo Thống kê</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">7</td>
        <td>Nguyễn Duy Trường</td>
        <td>Viết thuật toán tổng hợp dữ liệu báo cáo (Buckets) theo Ngày/Tuần/Tháng/Năm.</td>
        <td>TypeScript Array Methods</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Xây dựng tính năng Mục tiêu tiết kiệm (Savings Goals) và luồng phân bổ tiền từ ví.</td>
        <td>Supabase, React Hooks</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Tích hợp thư viện và custom giao diện biểu đồ (Chart) vào trang Dashboard.</td>
        <td>Chart.js / Recharts</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Kiểm tra chéo số liệu biểu đồ, đảm bảo tổng số dư báo cáo khớp với thực tế.</td>
        <td>Calculator, QA</td>
      </tr>

      <!-- TUAN 8 -->
      <tr class="week-row"><td colspan="4">Tuần 8: Tối ưu hóa hiệu năng (Optimize) & Fix Bugs</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">8</td>
        <td>Nguyễn Duy Trường</td>
        <td>Tối ưu query cơ sở dữ liệu, áp dụng kỹ thuật Memoization (useMemo, useCallback) giảm re-render.</td>
        <td>React Profiler</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Xử lý các lỗi edge-cases (đồng bộ chậm, mạng yếu), refactor dọn dẹp mã nguồn.</td>
        <td>TypeScript, Error Boundaries</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Fix các lỗi hiển thị UI trên màn hình điện thoại (Responsive), tinh chỉnh màu sắc cảnh báo.</td>
        <td>Chrome DevTools (Mobile)</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Chạy kiểm thử hồi quy (Regression Test) toàn bộ chức năng, log danh sách lỗi.</td>
        <td>Jira / Trello</td>
      </tr>

      <!-- TUAN 9 -->
      <tr class="week-row"><td colspan="4">Tuần 9: Triển khai & Viết tài liệu (Báo cáo)</td></tr>
      <tr>
        <td rowspan="4" style="text-align:center">9</td>
        <td>Nguyễn Duy Trường</td>
        <td>Triển khai dự án (Deploy), cấu hình domain, thiết lập Environment Variables.</td>
        <td>Vercel, Supabase Dashboard</td>
      </tr>
      <tr>
        <td>Sìn Văn Cương</td>
        <td>Xây dựng kịch bản báo cáo chuyên môn, rà soát kiến trúc mã nguồn lần cuối.</td>
        <td>Kiến trúc hệ thống</td>
      </tr>
      <tr>
        <td>Giàng Hồng Anh</td>
        <td>Hoàn thiện thiết kế Slide trình bày đồ án chuyên nghiệp, thống nhất UI.</td>
        <td>PowerPoint / Canva</td>
      </tr>
      <tr>
        <td>Giáp Đăng Khoa</td>
        <td>Viết tài liệu báo cáo tổng kết (file Word), đóng cuốn, quay video Hướng dẫn sử dụng.</td>
        <td>MS Word, OBS Studio</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const outputPath = path.join(__dirname, 'Ke_Hoach_Phan_Cong_Du_An.doc');
fs.writeFileSync(outputPath, htmlContent, 'utf8');
console.log('Word document saved to ' + outputPath);
