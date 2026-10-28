/**
 * backend/src/services/ai-chat.service.ts
 * ========================================
 * AI Chat Service — business logic for Financial Copilot chatbot.
 *
 * Provider: Ollama (local/self-hosted) via centralized ollama-client.
 * Multi-Currency: strictly honors currency isolation; never sums cross-currency amounts.
 * Security: Uses server-computed financial context; prevents prompt injection.
 * Intent Routing: Uses AI Intent Router to isolate contexts and dynamic prompts.
 */

import type {
  ChatMessage,
  FinancialContext,
  AiChatRequest,
  AiChatResult,
  CrudActionType,
  PendingCrudActionProposal,
  ExecutedCrudActionResult,
} from "../types/ai.types";
import {
  executeOllamaChat,
  executeOllamaChatStream,
  type OllamaClientError,
  type OllamaToolCall,
} from "./ollama-client.ts";
import {
  type ServerFinancialContext,
  formatServerFinancialContextForPrompt,
} from "./financial-context.service.ts";

import {
  searchSystemKnowledge,
  formatRagContextForPrompt,
} from "./system-rag.service.ts";

import {
  FINANCIAL_TOOLS,
  classifyFinancialQuery,
  parsePurchaseQuery,
  executeFinancialTool,
  type ToolExecutionContext,
} from "./financial-tools.service.ts";

import {
  routeUserIntent,
  type RoutingResult,
  type UserIntent,
} from "./ai-router.service.ts";
import { tryResolveFastPath } from "./fast-path.service.ts";
import { validateAndSanitizeAiOutput, createStreamOutputSanitizer } from "./ai-output-validation.service.ts";
import type { BudgetConstrainedPlanResult } from "./budget-planning.service.ts";
import { CRUD_ACTION_TOOLS, handleChatCrudIntent } from "./ai-crud-tools.service.ts";

export {
  type ChatMessage,
  type FinancialContext,
  type AiChatRequest,
  type AiChatResult,
  type RoutingResult,
  type UserIntent,
  classifyFinancialQuery,
  parsePurchaseQuery,
};

export const FINANCE_SYSTEM_PROMPT = `Bạn là Financial Copilot — Trợ lý tài chính cá nhân thông minh của hệ thống "Sổ Chi Tiêu".

VAI TRÒ VÀ TRÁCH NHIỆM:
1. Bạn là chuyên gia tư vấn tài chính cá nhân độc lập, chính trực, giúp người dùng quản lý ví, ngân sách, chi tiêu và mục tiêu tiết kiệm.
2. DỮ LIỆU TÀI CHÍNH TỪ MÁY CHỦ VÀ CÔNG CỤ (TOOLS):
   - Mọi số liệu số dư ví, tiền đã phân bổ, số dư khả dụng, tổng thu chi, ngân sách, mục tiêu tiết kiệm và phân tích khả năng chi trả đã được tính toán bằng logic toán học xác định tại backend.
   - BẮT BUỘC sử dụng đúng các con số từ kết quả công cụ (Tools) và dữ liệu máy chủ.
   - TUYỆT ĐỐI KHÔNG tự bịa số liệu, KHÔNG tính nhẩm lại gây sai lệch.
   - Luôn kèm theo đơn vị tiền tệ rõ ràng (VND, USD). TUYỆT ĐỐI KHÔNG cộng gộp VND và USD.
3. HƯỚNG DẪN TRẢ LỜI CÁC CÂU HỎI QUAN TRỌNG:
   - "Tôi có bao nhiêu tiền?" / "Tổng tài sản" / "Tôi còn bao nhiêu tiền?" / "Số dư":
     + BẮT BUỘC báo cáo ngay lập tức và đầy đủ 3 chỉ số tài chính cốt lõi từ dữ liệu công cụ/ngữ cảnh:
       1. Tổng tài sản: Tổng số dư thực tế trong tất cả các ví/tài khoản.
       2. Đã phân bổ: Tiền đã được giữ chỗ cho các hạn mức ngân sách và mục tiêu tiết kiệm.
       3. Số dư khả dụng chi tiêu: Số tiền tự do thực tế có thể chi tiêu ngay (= Tổng tài sản - Đã phân bổ).
       4. Chi tiết từng ví: Liệt kê rõ từng ví gồm Tổng số dư, Đã phân bổ và Khả dụng.
     + TUYỆT ĐỐI KHÔNG hỏi ngược lại người dùng muốn biết số dư ví hay khả dụng. Trả lời ngay cả 3 chỉ số!
   - "Tôi có bao nhiêu tiền mặt?" / "Tiền mặt tôi còn bao nhiêu?" / "Trong ví tiền mặt có bao nhiêu?":
     + BÁO CÁO ĐÚNG SỐ LIỆU CỦA VÍ TIỀN MẶT:
       * Số dư ví tiền mặt: Số dư thực tế của ví tiền mặt.
       * Đã phân bổ: Tiền đã phân bổ từ ví tiền mặt.
       * Khả dụng ví tiền mặt: Số tiền khả dụng thực tế của ví tiền mặt.
     + NGUYÊN TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG lấy Tổng tài sản (hoặc Tổng khả dụng toàn bộ tài khoản) để trả lời thay thế cho ví tiền mặt!
   - "Trong ngân hàng tôi có bao nhiêu?" / "Tiền trong ngân hàng còn bao nhiêu?":
     + BÁO CÁO ĐÚNG SỐ LIỆU CỦA VÍ NGÂN HÀNG (Số dư, Đã phân bổ, Khả dụng của ví ngân hàng).
     + NGUYÊN TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG lấy Tổng tài sản để trả lời thay thế cho ví ngân hàng!
   - "Ví tiền mặt đã phân bổ bao nhiêu?" / "Ví [X] đã phân bổ bao nhiêu?":
     + Báo cáo chính xác số tiền đã phân bổ từ ví được hỏi (ví dụ: ví tiền mặt đã phân bổ bao nhiêu).
   - "Ví nào đang có nhiều tiền nhất?":
     + Báo cáo chính xác tên ví và số dư của ví có số dư lớn nhất, kèm số dư khả dụng của ví đó và so sánh với các ví khác.
   - "Tôi có đủ [X] tiền mặt để mua hàng không?":
     + BẮT BUỘC so sánh X với số dư KHẢ DỤNG CỦA VÍ TIỀN MẶT: Nếu khả dụng ví tiền mặt < X => KHÔNG ĐỦ TIỀN MẶT (dù các ví khác hoặc tổng khả dụng của toàn bộ tài khoản có thể đủ).
   - "Tôi có bao nhiêu tiền khả dụng?" / "Tôi còn bao nhiêu tiền khả dụng?":
     + Báo cáo ngay Số dư khả dụng chi tiêu và nêu rõ công thức: Khả dụng = Tổng tài sản - Đã phân bổ.
   - "Tôi đã phân bổ bao nhiêu tiền?": Báo cáo chính xác tổng số tiền đã phân bổ vào các ngân sách và mục tiêu tiết kiệm, kèm giải thích tiền phân bổ vẫn nằm trong tài sản của người dùng.
   - "Tại sao tôi chỉ còn [X] khả dụng?":
     + Giải thích rõ ràng và trấn an người dùng rằng tiền của họ KHÔNG hề bị mất đi.
     + Tổng tài sản thực tế vẫn còn nguyên vẹn.
     + Sở dĩ số dư khả dụng thấp hơn tổng tài sản là vì người dùng đã phân bổ tiền vào các hạn mức ngân sách chi tiêu và mục tiêu tiết kiệm nhằm kiểm soát chi tiêu.
     + Công thức: Số dư khả dụng = Tổng tài sản - Đã phân bổ.
   - "Tôi có đủ tiền chi [X] không?" / "Tôi có đủ tiền mua món đồ [X] không?":
     + Kiểm tra Số dư khả dụng chi tiêu: Nếu Khả dụng >= X => ĐỦ TIỀN; nếu Khả dụng < X => KHÔNG ĐỦ TIỀN hoặc CẢNH BÁO nếu số tiền vượt khả dụng dù tổng tài sản có thể đủ.
     + Nêu rõ nguồn ví cụ thể nào đủ số dư khả dụng để thanh toán.
   - "Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?" (Kế hoạch chi tiêu nhiều ngày):
     + Tính toán ngân sách mỗi ngày: 200.000 VND / 7 ngày ≈ 28.571 VND/ngày.
     + Đánh giá tính khả thi: Khẳng định dựa trên số dư khả dụng thực tế của người dùng và nguồn ví khả dụng để chi trả.
     + Gợi ý các món ăn sáng bình dân, thực tế tại Việt Nam phù hợp với ngân sách ~28.571 VND/ngày:
       * Bánh mì (chả, pate, trứng ốp la): ~15.000 - 25.000 VND
       * Xôi nóng (xôi bắp, xôi xéo, xôi gà): ~15.000 - 20.000 VND
       * Bánh bao nhân thịt, trứng cút: ~15.000 - 20.000 VND
       * Bánh cuốn / bún xào bình dân: ~20.000 - 28.000 VND
       * Tự chuẩn bị tại nhà (trứng, bánh mì sandwich, sữa): ~15.000 - 20.000 VND
   - "Tôi nên làm gì với số tiền hiện tại?": Cung cấp lời khuyên 3 bước có cấu trúc:
     + Bước 1: Giữ lại đủ tiền cho các khoản chi thiết yếu và ngân sách sinh hoạt đến hết tháng.
     + Bước 2: Trích quỹ cho các mục tiêu tiết kiệm quan trọng (đặc biệt các mục tiêu sắp đến hạn).
     + Bước 3: Phần thặng dư nhàn rỗi có thể dùng cho chi tiêu tùy ý hoặc dự phòng khẩn cấp.
   - "Tôi đã chi bao nhiêu / Chi tiêu thế nào?": Nêu tổng thu nhập, tổng chi tiêu, tiết kiệm ròng, tỷ lệ tiết kiệm (%) và danh mục chi nhiều nhất trong kỳ. So sánh cụ thể với tháng trước (tăng/giảm bao nhiêu).
   - "Ngân sách của tôi thế nào?": Phân biệt rõ Hạn mức ngân sách, Chi tiêu thực tế, Còn được chi theo hạn mức (= Hạn mức - Chi tiêu thực tế), và Quỹ phong bì cấp vốn.
4. BẢO VỆ DỮ LIỆU & BẢO MẬT:
   - Bạn chỉ có quyền ĐỌC dữ liệu và TƯ VẤN (Read-Only). Không được tự ý xóa, sửa hoặc tạo giao dịch trực tiếp trong chat mà không có xác nhận từ người dùng.
   - Phân quyền nghiêm ngặt: Không để lộ token, mật khẩu, khóa bí mật hay dữ liệu của bất kỳ người dùng nào khác.
5. XỬ LÝ KHI GẶP LỖI HỆ THỐNG / CƠ SỞ DỮ LIỆU:
   - Khi có thông báo lỗi truy vấn cơ sở dữ liệu hoặc dữ liệu không khả dụng:
     + BẮT BUỘC thông báo rõ ràng rằng hệ thống đang gặp lỗi kết nối và dữ liệu tài chính hiện không khả dụng.
     + TUYỆT ĐỐI KHÔNG mặc định số dư là 0đ hay 0 VND, KHÔNG nói người dùng 'hết tiền' hay 'chưa có ví nào'.
     + TUYỆT ĐỐI KHÔNG tự bịa số dư hay suy đoán số liệu tài chính giả mạo.
6. PHONG CÁCH TRÌNH BÀY:
   - Tiếng Việt chuẩn mực, Markdown rõ ràng, in đậm các con số tài chính quan trọng, gạch đầu dòng súc tích.
7. QUY TẮC SUY LUẬN MỤC TIÊU TIẾT KIỆM (SAVINGS GOAL REASONING):
   - Phân biệt rõ:
     + 'Mục tiêu tiết kiệm X': Đích đến tổng cộng cần đạt là X (nếu đã tích lũy Y, chỉ cần tích lũy thêm X - Y).
     + 'Tiết kiệm thêm X': Cần trích thêm khoản mới X ngoài số tiền đã tích lũy trước đó.
     + 'Số tiền đã tiết kiệm': Báo cáo số tiền hiện có trong mục tiêu hoặc đã phân bổ vào quỹ.
   - TUYỆT ĐỐI KHÔNG kết luận người dùng 'tiết kiệm 100%' khi chi tiêu ghi nhận bằng 0 nếu chưa có giao dịch chi tiêu nào được ghi nhận trong kỳ hoặc dữ liệu bị thiếu.
   - Backend tính toán toàn bộ số tiền khả dụng, mức chi tiêu tối đa, khả năng đạt và phần thiếu hụt. Không tự bịa hoặc suy diễn số liệu.
   - Khi đủ tiền đạt mục tiêu, đề xuất phương án phân bổ cụ thể từ ví khả dụng; CHỈ khuyên cắt giảm chi tiêu hoặc tăng thu nhập khi THỰC SỰ THIẾU TIỀN (shortfall > 0).
   - KHÔNG tự ý thực hiện tạo giao dịch hoặc chuyển tiền khi chưa có xác nhận từ người dùng.`;

/**
 * Dynamically construct the appropriate system persona and instructions based on routed intent.
 * Isolate personal financial data strictly to personal finance & advice intents.
 */
export function buildDynamicSystemPrompt(routing: RoutingResult): string {
  // Pure CONVERSATION_SUMMARY (e.g. "Tóm tắt những điều chúng ta vừa trao đổi")
  if (routing.primaryIntent === "CONVERSATION_SUMMARY") {
    return `Bạn là Trợ lý AI trong hệ thống "Sổ Chi Tiêu".
VAI TRÒ: Tóm tắt ngắn gọn, trung thực các nội dung ĐÃ ĐƯỢC TRAO ĐỔI trong các lượt hội thoại vừa qua giữa bạn và người dùng.
QUY TẮC BẮT BUỘC:
1. CHỈ tóm tắt những gì người dùng đã hỏi và những gì bạn đã trả lời trong lịch sử hội thoại thực tế.
2. TUYỆT ĐỐI KHÔNG tự suy đoán, bịa đặt các xu hướng tài chính chưa được nhắc tới (ví dụ: TUYỆT ĐỐI KHÔNG nói "tài sản tăng so với tháng trước" hay so sánh thu chi nếu người dùng không hỏi hoặc hai bên chưa hề thảo luận về điều đó).
3. Trình bày ngắn gọn, gạch đầu dòng các chủ đề chính đã thảo luận.`;
  }

  // Multi-intent: e.g. general knowledge + personal finance
  if (routing.intents.length > 1 && (routing.requiresPersonalData || routing.requiresFinancialAnalysis)) {
    return `${FINANCE_SYSTEM_PROMPT}

HƯỚNG DẪN CÂU HỎI KẾT HỢP NHIỀU Ý ĐỊNH (MULTI-INTENT):
- Người dùng hỏi kết hợp nhiều chủ đề (ví dụ: kiến thức tổng quát / thị trường VÀ số liệu tài chính cá nhân).
- Bạn phải trả lời ĐẦY ĐỦ CẢ HAI PHẦN:
  1. Trả lời câu hỏi kiến thức / thông tin chung một cách chính xác, khách quan.
  2. Báo cáo số liệu tài chính cá nhân dựa trên dữ liệu máy chủ / công cụ một cách rõ ràng.
- Phân chia các phần rõ ràng, dễ đọc bằng Markdown.`;
  }

  // Pure GENERAL_KNOWLEDGE (e.g. "Người giàu nhất thế giới bây giờ là ai?", "Ngân sách là gì?", "Lạm phát là gì?")
  if (routing.primaryIntent === "GENERAL_KNOWLEDGE" && !routing.requiresPersonalData) {
    return `Bạn là Trợ lý AI thông minh trong ứng dụng "Sổ Chi Tiêu".
VAI TRÒ: Giải đáp các thắc mắc về kiến thức kinh tế, tài chính tổng quát, danh nhân thế giới và các khái niệm phổ thông cho người dùng.
HƯỚNG DẪN TRẢ LỜI:
1. Trả lời trực tiếp, chính xác, súc tích và tự nhiên bằng tiếng Việt theo đúng câu hỏi của người dùng.
2. TUYỆT ĐỐI KHÔNG tự động hiển thị số dư, thu chi, ví tiền hay báo cáo tài chính cá nhân của người dùng vì người dùng KHÔNG hỏi về dữ liệu cá nhân của họ.
3. Không tự bịa đặt thông tin nếu không có cơ sở xác thực.`;
  }

  // Pure REALTIME_INFORMATION (e.g. "Hôm nay có tin tức kinh tế nổi bật nào?", tỷ giá, thị trường)
  if (routing.primaryIntent === "REALTIME_INFORMATION" && !routing.requiresPersonalData) {
    return `Bạn là Trợ lý AI thông minh trong ứng dụng "Sổ Chi Tiêu".
VAI TRÒ: Cung cấp thông tin thị trường, tỷ giá và tin tức kinh tế cập nhật cho người dùng.
HƯỚNG DẪN TRẢ LỜI:
1. Sử dụng kết quả từ công cụ (Tool) bên dưới để trả lời, nêu rõ nguồn và thời điểm kiểm chứng nếu có.
2. NGUYÊN TẮC BẮT BUỘC VỀ THÔNG TIN THỜI GIAN THỰC:
   - Nếu hệ thống chưa cấu hình API công cụ tìm kiếm tin tức Internet (Web Search Engine API), bạn BẮT BUỘC phải thông báo giới hạn này một cách lịch sự đến người dùng.
   - TUYỆT ĐỐI KHÔNG tự bịa đặt các tin tức thời sự, sự kiện kinh tế nóng không có thực.
   - Cung cấp tỷ giá ngoại tệ thực tế hoặc thông tin thị trường xác thực đã lấy được từ công cụ.
3. TUYỆT ĐỐI KHÔNG tự động đưa số dư hay dữ liệu tài chính cá nhân của người dùng vào câu trả lời.`;
  }

  // Pure GENERAL_CHAT (e.g. "Xin chào, bạn có thể giúp gì?", lời chào, giới thiệu bot)
  if (routing.primaryIntent === "GENERAL_CHAT" && !routing.requiresPersonalData) {
    return `Bạn là Trợ lý AI thân thiện của hệ thống "Sổ Chi Tiêu".
VAI TRÒ: Trò chuyện lịch sự, chào hỏi và giới thiệu các tính năng bạn có thể hỗ trợ người dùng.
HƯỚNG DẪN:
1. Chào hỏi nhã nhặn, tự nhiên bằng tiếng Việt.
2. Giới thiệu ngắn gọn các khả năng: tra cứu số dư ví & số dư khả dụng, phân tích thu chi, kiểm tra ngân sách, theo dõi mục tiêu tiết kiệm, tư vấn tài chính, giải thích khái niệm kinh tế và hướng dẫn sử dụng Sổ Chi Tiêu.
3. TUYỆT ĐỐI KHÔNG tự động in bảng báo cáo tài chính cá nhân khi người dùng chỉ chào hỏi hoặc hỏi về bạn.`;
  }

  // Authorized CRUD Create / Confirmation Action
  if (
    (routing.canonicalIntent === "ACTION_REQUEST" || routing.primaryIntent === "ACTION_REQUEST") &&
    routing.crudIntent
  ) {
    return `Bạn là Trợ lý AI thực thi thao tác có kiểm soát trong hệ thống "Sổ Chi Tiêu".
VAI TRÒ: Hỗ trợ người dùng tạo danh mục thu/chi, ngân sách, giao dịch và giao dịch định kỳ qua công cụ Backend được cấp quyền.
QUY TẮC BẮT BUỘC:
1. Chỉ gọi các công cụ được phép: create_category, create_budget, create_transaction, create_recurring_transaction.
2. Nếu thiếu thông tin bắt buộc (như số tiền, loại thu/chi, chu kỳ ngân sách, tần suất định kỳ, ví thực hiện), BẮT BUỘC hỏi lại người dùng, TUYỆT ĐỐI KHÔNG tự giả định dữ liệu.
3. Với ngân sách, giao dịch và giao dịch định kỳ, luôn hiển thị bản tóm tắt để người dùng xác nhận trước khi ghi vào cơ sở dữ liệu.
4. Chỉ thông báo tạo thành công khi Backend API và Supabase xác nhận thành công.`;
  }

  // Pure ACTION_REQUEST (e.g. "Xóa giao dịch này cho tôi", unpermitted destructive mutations)
  if (routing.canonicalIntent === "ACTION_REQUEST" || routing.primaryIntent === "ACTION_REQUEST") {
    return `Bạn là Trợ lý AI trong hệ thống "Sổ Chi Tiêu".
VAI TRÒ: Hướng dẫn người dùng thao tác an toàn trên giao diện ứng dụng.
QUY TẮC AN TOÀN BẮT BUỘC:
1. Bạn là Trợ lý AI hoạt động ở chế độ CHỈ ĐỌC (Read-Only) để đảm bảo an toàn tuyệt đối cho dữ liệu tài chính của người dùng.
2. TUYỆT ĐỐI KHÔNG tự ý thực hiện các thao tác ghi, cập nhật, hoặc xóa dữ liệu (như xóa giao dịch, thêm giao dịch, sửa ví, xóa ngân sách) trực tiếp vào cơ sở dữ liệu.
3. Giải thích rõ ràng nguyên tắc an toàn này cho người dùng một cách lịch sự, nhã nhặn.
4. Hướng dẫn chi tiết từng bước (Step-by-step) trên giao diện ứng dụng để người dùng tự thực hiện thao tác đó một cách dễ dàng và an toàn (sử dụng tài liệu RAG đi kèm).
5. TUYỆT ĐỐI KHÔNG tự động in số dư hay báo cáo tài chính cá nhân nếu người dùng không yêu cầu.`;
  }

  // Pure SYSTEM_KNOWLEDGE (e.g. "Hệ thống Sổ Chi Tiêu có chức năng gì?", "Làm thế nào để thêm giao dịch?")
  if ((routing.primaryIntent === "SYSTEM_KNOWLEDGE" || routing.canonicalIntent === "SYSTEM_HELP") && !routing.requiresPersonalData) {
    return `Bạn là Trợ lý hướng dẫn sử dụng hệ thống "Sổ Chi Tiêu".
VAI TRÒ: Hướng dẫn người dùng các thao tác và chức năng trong ứng dụng (quản lý ví, ghi nhận thu chi, ngân sách, mục tiêu tiết kiệm, xuất nhập Excel, quét hóa đơn AI, quy tắc hoàn tác số dư khi xóa/sửa giao dịch, chính sách bảo mật).
HƯỚNG DẪN:
1. Sử dụng tài liệu hệ thống (System Knowledge / RAG) được cung cấp để hướng dẫn chi tiết từng bước (nút bấm, menu, quy trình).
2. Trả lời đúng trọng tâm chức năng được hỏi.
3. TUYỆT ĐỐI KHÔNG in số dư hay báo cáo tài chính cá nhân khi người dùng chỉ hỏi cách sử dụng phần mềm.`;
  }

  // Explicit LIST_TRANSACTIONS intent
  if (routing.category === "LIST_TRANSACTIONS") {
    return `${FINANCE_SYSTEM_PROMPT}

HƯỚNG DẪN TRÌNH BÀY DANH SÁCH GIAO DỊCH:
1. Người dùng yêu cầu xem/liệt kê danh sách các giao dịch cụ thể.
2. Bạn BẮT BUỘC phải trình bày danh sách chi tiết các bản ghi giao dịch thực tế từ kết quả công cụ (ngày, danh mục, số tiền, ghi chú, ví).
3. TUYỆT ĐỐI KHÔNG thay thế danh sách bằng một câu tóm tắt tổng số tiền hay số lượng giao dịch đơn thuần.
4. Trình bày rõ ràng theo bảng hoặc danh sách Markdown.`;
  }

  // Default: Full Financial Copilot (PERSONAL_FINANCE / FINANCIAL_ADVICE)
  return FINANCE_SYSTEM_PROMPT;
}

// Rule-based pre-filter for obvious non-financial questions
const OFF_TOPIC_PATTERNS = [
  /\b(viết code|lập trình|python|javascript|java|c\+\+|golang|rust|sql query)\b/i,
  /\b(thời tiết|weather|nhiệt độ|mưa|nắng|bão)\b/i,
  /\b(lịch sử|tổng thống|thủ tướng|chính trị|bầu cử|chiến tranh)\b/i,
  /(?:kể(?:\s+.*)?\s+chuyện|kể chuyện|truyện\s+(?:ngắn|cười)|thơ|bài văn|sáng tác)/i,
  /\b(giải bài toán toán học|đại số|hình học|calculus|vật lý|hóa học)\b/i,
  /\b(tạo hình ảnh|vẽ|thiết kế đồ họa|photoshop)\b/i,
  /\b(chơi game|hướng dẫn chơi game|qua màn|cheat game|esport)\b/i,
  /\b(âm nhạc|bài hát|ca sĩ|phim|diễn viên)\b/i,
  /\b(nấu ăn|công thức|recipe|món ăn)\b/i,
];

// Financial & Knowledge intent indicators — if any match, NEVER flag as off-topic
const FINANCIAL_INTENT_PATTERNS = [
  /(?:^|\s)(chi|tiêu|mua|tiền|lương|tốn|thu nhập|khoản thu|tổng thu|hết bao nhiêu|ngân sách|ví|tiết kiệm|bỏ ra|giá|đắt|rẻ|báo cáo|tổng kết|danh mục|ăn uống|hóa đơn|chuyển khoản|nạp|rút|nợ|vay|tài chính|kinh tế|số dư|quỹ|sổ chi tiêu|giao dịch)(?=$|\s|[.,?!;:])/i,
  /(?:^|\s)(vnd|usd|đồng|nghìn|triệu|\d+\s*k)(?=$|\s|[.,?!;:])/i,
];

export function isObviouslyOffTopic(message: string): boolean {
  if (FINANCIAL_INTENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(message));
}

export const OFF_TOPIC_REPLY =
  "Tôi là Financial Copilot chuyên hỗ trợ quản lý chi tiêu và tài chính cá nhân. Tôi chỉ có thể giải đáp các câu hỏi liên quan đến ngân sách, giao dịch, số dư và quản lý tiền bạc trong Sổ Chi Tiêu.";

const MAX_CHAT_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_MESSAGES = 20;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY_MESSAGES).flatMap((entry): ChatMessage[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "model") return [];
    if (!Array.isArray(record.parts)) return [];
    const text = cleanText(
      (record.parts[0] as Record<string, unknown> | undefined)?.text,
      MAX_CHAT_MESSAGE_LENGTH,
    );
    return text ? [{ role: record.role, parts: [{ text }] }] : [];
  });
}

export interface ProcessChatOptions {
  serverContext?: ServerFinancialContext | null;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
  modelOverride?: string;
  toolContext?: ToolExecutionContext | null;
}

export function extractToolCallsFromContent(content: string): OllamaToolCall[] {
  const toolCalls: OllamaToolCall[] = [];
  const trimmed = content.trim();

  // Pattern 1: Raw JSON object {"name": "...", "arguments": {...}}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.name === "string") {
        toolCalls.push({
          function: {
            name: parsed.name,
            arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
          },
        });
        return toolCalls;
      }
      if (parsed.function && typeof parsed.function.name === "string") {
        toolCalls.push({
          function: {
            name: parsed.function.name,
            arguments: parsed.function.arguments || {},
          },
        });
        return toolCalls;
      }
    } catch { }
  }

  // Pattern 2: Markdown fenced code block ```json ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (typeof parsed.name === "string") {
        toolCalls.push({
          function: {
            name: parsed.name,
            arguments: parsed.arguments || {},
          },
        });
        return toolCalls;
      }
    } catch { }
  }

  // Pattern 3: Embedded {"name": "get_...", "arguments": ...}
  const embeddedMatch = trimmed.match(/(\{\s*"name"\s*:\s*"(?:get_[a-z_]+|evaluate_[a-z_]+|create_[a-z_]+|list_[a-z_]+|search_[a-z_]+)"[\s\S]*?\})/);
  if (embeddedMatch) {
    try {
      const parsed = JSON.parse(embeddedMatch[1]);
      if (typeof parsed.name === "string") {
        toolCalls.push({
          function: {
            name: parsed.name,
            arguments: parsed.arguments || {},
          },
        });
        return toolCalls;
      }
    } catch { }
  }

  return toolCalls;
}

/**
 * Core chat processing function using Ollama client, Intent Router, and Agentic Tool Calling.
 */
export async function processChat(
  ollamaBaseUrl: string,
  req: AiChatRequest,
  options?: ProcessChatOptions,
): Promise<AiChatResult> {
  const { message, history, currentPage } = req;

  const userMessage = typeof message === "string" ? message.trim() : "";
  if (!userMessage) {
    return { error: "Tin nhắn không được để trống.", status: 400 };
  }
  if (userMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { error: "Câu hỏi quá dài. Vui lòng nhập tối đa 2.000 ký tự.", status: 400 };
  }

  // Pre-filter obvious off-topic queries
  if (isObviouslyOffTopic(userMessage)) {
    return { reply: OFF_TOPIC_REPLY, status: 200, isFastPath: true };
  }

  const safeHistory = sanitizeHistory(history);
  const currentUserId = options?.toolContext?.userId || options?.serverContext?.userId;

  // 1. Intent Classification & Routing
  const routing = routeUserIntent(userMessage, safeHistory, currentUserId);

  // Enrich toolContext with authoritative snapshot to avoid redundant Supabase queries
  if (options?.toolContext && options.serverContext?.snapshot && !options.toolContext.snapshot) {
    options.toolContext.snapshot = options.serverContext.snapshot;
  }

  // 1a. Authorized CRUD Action Handling (Create Category, Budget, Transaction, Recurring + Confirm/Slot-Fill)
  if (routing.crudIntent) {
    const crudRes = await handleChatCrudIntent(
      routing.crudIntent,
      userMessage,
      safeHistory,
      options?.toolContext,
    );
    if (crudRes.handled) {
      if (crudRes.status >= 400 && crudRes.error) {
        return {
          error: crudRes.error,
          status: crudRes.status,
        };
      }
      return {
        reply: crudRes.reply,
        status: 200,
        isFastPath: true,
        pendingAction: crudRes.pendingAction,
        executedAction: crudRes.executedAction,
      };
    }
  }

  // 1b. Fast Path Evaluation (0ms LLM, 100% mathematical accuracy for core finance queries)
  const fastResult = await tryResolveFastPath(
    userMessage,
    routing,
    options?.serverContext || null,
    options?.toolContext || null,
  );
  if (fastResult.handled && fastResult.reply) {
    return {
      reply: fastResult.reply,
      status: 200,
      isFastPath: true,
    };
  }

  // 2. Deterministic Tool Execution based on classification and routing
  const toolResultsList: string[] = [];
  let planToolResult: BudgetConstrainedPlanResult | undefined;

  // 2a. Realtime Information / Web Search (does not require DB connection)
  if (routing.requiresRealtimeSearch) {
    try {
      const fallbackToolCtx: ToolExecutionContext = options?.toolContext || {
        supabaseUrl: "",
        supabaseKey: "",
        token: "",
        userId: options?.serverContext?.userId || "",
      };
      const res = await executeFinancialTool("get_realtime_information", { query: userMessage }, fallbackToolCtx);
      if (res.summaryVi) toolResultsList.push(res.summaryVi);
    } catch (err) {
      console.warn("Error running realtime search tool:", err);
    }
  }

  // 2b. Deterministic What-If Simulation (uses serverContext.snapshot directly without DB writes)
  let simulationHandled = false;
  if (routing.category === "AFFORDABILITY_WHATIF" && options?.serverContext?.snapshot) {
    const purchaseToSimulate =
      routing.multiTurnRef?.referencedPurchase ||
      (routing.extractedAffordability
        ? {
            itemName: routing.extractedAffordability.itemName,
            price: routing.extractedAffordability.price,
            category: routing.extractedAffordability.category,
          }
        : null);

    if (purchaseToSimulate) {
      try {
        const { runFinancialSimulation } = await import("./financial-simulation.service.ts");
        const simResult = runFinancialSimulation(
          options.serverContext.snapshot,
          purchaseToSimulate,
          {
            scenarioType: routing.multiTurnRef?.referenceType || "PURCHASE_WHATIF",
            targetBudgetQuery: routing.multiTurnRef?.targetBudgetName,
            serverContext: options.serverContext,
          },
        );
        toolResultsList.push(simResult.summaryVi);
        simulationHandled = true;
      } catch (simErr) {
        console.warn("Error running in-memory simulation:", simErr);
      }
    }
  }

  // 2c. Personal financial tools that require DB / toolContext
  if (options?.toolContext && (routing.requiresPersonalData || routing.requiresFinancialAnalysis)) {
    try {
      if (routing.category === "LIST_TRANSACTIONS" || routing.transactionListQuery) {
        const listArgs: Record<string, unknown> = {};
        if (routing.transactionListQuery?.limit) listArgs.limit = routing.transactionListQuery.limit;
        if (routing.transactionListQuery?.type) listArgs.type = routing.transactionListQuery.type;
        if (routing.transactionListQuery?.period) listArgs.period = routing.transactionListQuery.period;
        if (routing.transactionListQuery?.startDate) listArgs.start_date = routing.transactionListQuery.startDate;
        if (routing.transactionListQuery?.endDate) listArgs.end_date = routing.transactionListQuery.endDate;
        if (routing.transactionListQuery?.month) listArgs.month = routing.transactionListQuery.month;
        if (routing.transactionListQuery?.year) listArgs.year = routing.transactionListQuery.year;
        if (routing.transactionListQuery?.category) listArgs.category = routing.transactionListQuery.category;
        if (routing.transactionListQuery?.minAmount) listArgs.min_amount = routing.transactionListQuery.minAmount;
        if (routing.transactionListQuery?.maxAmount) listArgs.max_amount = routing.transactionListQuery.maxAmount;

        const res = await executeFinancialTool("list_transactions", listArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "TRANSACTION_STATISTICS" || routing.transactionStatisticsQuery) {
        const statsArgs: Record<string, unknown> = {};
        if (routing.transactionStatisticsQuery?.period) statsArgs.period = routing.transactionStatisticsQuery.period;
        if (routing.transactionStatisticsQuery?.startDate) statsArgs.start_date = routing.transactionStatisticsQuery.startDate;
        if (routing.transactionStatisticsQuery?.endDate) statsArgs.end_date = routing.transactionStatisticsQuery.endDate;
        if (routing.transactionStatisticsQuery?.month) statsArgs.month = routing.transactionStatisticsQuery.month;
        if (routing.transactionStatisticsQuery?.year) statsArgs.year = routing.transactionStatisticsQuery.year;
        if (routing.transactionStatisticsQuery?.type) statsArgs.type = routing.transactionStatisticsQuery.type;
        if (routing.transactionStatisticsQuery?.category) statsArgs.category = routing.transactionStatisticsQuery.category;

        const res = await executeFinancialTool("get_transaction_statistics", statsArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "USER_FINANCIAL_DATA") {
        const walletArgs: Record<string, unknown> = {};
        if (routing.walletTargetQuery) {
          if (routing.walletTargetQuery.targetWalletKeyword) {
            walletArgs.wallet_query = routing.walletTargetQuery.targetWalletKeyword;
          }
          if (routing.walletTargetQuery.targetWalletType) {
            walletArgs.wallet_type = routing.walletTargetQuery.targetWalletType;
          }
          if (routing.walletTargetQuery.focusType) {
            walletArgs.focus = routing.walletTargetQuery.focusType;
          }
        }
        const res = await executeFinancialTool("get_wallet_balances", walletArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "SPENDING_ANALYSIS") {
        const res = await executeFinancialTool("get_spending_analysis", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "BUDGET_ADVICE") {
        const res = await executeFinancialTool("get_budget_status", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "SAVINGS_PLANNING") {
        const res = await executeFinancialTool("get_savings_goals", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "AFFORDABILITY_WHATIF" && !simulationHandled) {
        if (routing.extractedAffordability) {
          const affordArgs: Record<string, unknown> = {
            item_name: routing.extractedAffordability.itemName,
            price: routing.extractedAffordability.price,
            category: routing.extractedAffordability.category,
            days: routing.extractedAffordability.days,
          };
          if (routing.extractedAffordability.targetWalletKeyword) {
            affordArgs.target_wallet = routing.extractedAffordability.targetWalletKeyword;
          }
          if (routing.extractedAffordability.targetWalletType) {
            affordArgs.target_wallet_type = routing.extractedAffordability.targetWalletType;
          }
          const res = await executeFinancialTool(
            "evaluate_purchase_affordability",
            affordArgs,
            options.toolContext,
          );
          if (res.summaryVi) toolResultsList.push(res.summaryVi);
        } else {
          const [bRes, wRes] = await Promise.all([
            executeFinancialTool("get_budget_status", {}, options.toolContext),
            executeFinancialTool("get_wallet_balances", {}, options.toolContext),
          ]);
          if (bRes.summaryVi) toolResultsList.push(bRes.summaryVi);
          if (wRes.summaryVi) toolResultsList.push(wRes.summaryVi);
        }
      } else if (routing.category === "GENERAL_FINANCIAL_ADVICE") {
        const res = await executeFinancialTool("get_financial_advice", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "BUDGET_PLANNING" || routing.extractedBudgetPlan) {
        const planArgs: Record<string, unknown> = {
          scope: routing.extractedBudgetPlan?.scope || "BREAKFAST_PLAN",
          budget: routing.extractedBudgetPlan?.budget,
          days: routing.extractedBudgetPlan?.days,
          meal_type: routing.extractedBudgetPlan?.mealType,
          target_category: routing.extractedBudgetPlan?.targetCategory,
          use_remaining_funds: routing.extractedBudgetPlan?.useRemainingFunds,
          savings_mode: routing.extractedBudgetPlan?.savingsMode,
        };
        const res = await executeFinancialTool(
          "create_budget_constrained_plan",
          planArgs,
          options.toolContext,
        );
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
        if (res.data) planToolResult = res.data as BudgetConstrainedPlanResult;
      }
    } catch (toolErr) {
      console.warn("Error running deterministic tool:", toolErr);
    }
  }

  // 3. Retrieve verified System Knowledge via RAG ONLY if system knowledge intent is present
  let ragContext = "";
  if (routing.requiresSystemRag) {
    const ragResults = searchSystemKnowledge(userMessage, { history: safeHistory });
    ragContext = formatRagContextForPrompt(ragResults);
  }

  // 4. Build trusted server-verified financial context ONLY if personal finance / analysis is requested
  let financialContext = "";
  if (options?.serverContext && (routing.requiresPersonalData || routing.requiresFinancialAnalysis)) {
    financialContext = formatServerFinancialContextForPrompt(
      options.serverContext,
      cleanText(currentPage, 80),
      userMessage,
    );
  }

  // Multi-turn context note if follow-up refers to an amount from previous turn
  let multiTurnBlock = "";
  if (routing.multiTurnContext?.referencedAmount) {
    multiTurnBlock = `=== THÔNG TIN THAM CHIẾU TỪ LƯỢT TRƯỚC (MULTI-TURN REFERENCE) ===\nSố tiền được người dùng tham chiếu ("với số tiền đó"): ${routing.multiTurnContext.referencedAmount.toLocaleString("vi-VN")} VND.\nHãy đưa ra tư vấn phân bổ hoặc tiết kiệm cụ thể cho số tiền này (ví dụ: nguyên tắc tiết kiệm 20% - 30%).\n=== HẾT THÔNG TIN THAM CHIẾU ===`;
  }

  const toolBlock = toolResultsList.length > 0
    ? `=== KẾT QUẢ TRUY VẤN DỮ LIỆU TỪ CÔNG CỤ (DETERMINISTIC TOOL RESULT) ===\n${toolResultsList.join("\n\n")}\n=== HẾT KẾT QUẢ CÔNG CỤ ===`
    : "";

  const combinedContext = [ragContext, toolBlock, financialContext, multiTurnBlock].filter(Boolean).join("\n\n");

  const dynamicSystemPrompt = buildDynamicSystemPrompt(routing);
  const systemWithContext = combinedContext
    ? `${dynamicSystemPrompt}\n\n${combinedContext}`
    : dynamicSystemPrompt;

  // Build messages array
  const ollamaMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
    { role: "system", content: systemWithContext },
  ];

  for (const h of safeHistory) {
    const hRole = h.role === "model" ? "assistant" : "user";
    const hText = Array.isArray(h.parts) ? cleanText(h.parts[0]?.text, MAX_CHAT_MESSAGE_LENGTH) : "";
    if (hText) {
      ollamaMessages.push({ role: hRole, content: hText });
    }
  }

  ollamaMessages.push({ role: "user", content: userMessage });

  // 5. Ollama Inference with Tool Calling support
  const isUnpermittedAction = routing.canonicalIntent === "ACTION_REQUEST" && !routing.crudIntent;
  const shouldProvideFullTools =
    (routing.requiresPersonalData ||
      routing.requiresFinancialAnalysis ||
      routing.requiresRealtimeSearch) &&
    toolResultsList.length === 0;
  const canProvideCrudTools =
    Boolean(options?.toolContext) &&
    !isUnpermittedAction &&
    !routing.requiresSystemRag &&
    routing.primaryIntent !== "GENERAL_CHAT" &&
    routing.primaryIntent !== "GENERAL_KNOWLEDGE";

  const activeTools = shouldProvideFullTools
    ? FINANCIAL_TOOLS
    : canProvideCrudTools
      ? CRUD_ACTION_TOOLS
      : undefined;

  let result = await executeOllamaChat({
    baseUrl: ollamaBaseUrl,
    messages: ollamaMessages,
    tools: activeTools,
    totalTimeoutMs: options?.totalTimeoutMs || 60_000,
    signal: options?.signal,
    modelOverride: options?.modelOverride,
    temperature: 0.2, // Low temperature for deterministic precision
  });

  // 6. Handle Tool Calls (from both native tool_calls and text-emitted JSON)
  const extractedCalls = [
    ...(result.tool_calls || []),
    ...extractToolCallsFromContent(result.content || ""),
  ];

  if (extractedCalls.length > 0 && options?.toolContext && activeTools) {
    const crudToolNames = new Set<string>([
      "create_category",
      "create_budget",
      "create_transaction",
      "create_recurring_transaction",
    ]);
    const crudCall = extractedCalls.find((c) => crudToolNames.has(c.function.name));
    if (crudCall) {
      const crudRes = await handleChatCrudIntent(
        { kind: "CRUD_CREATE", actionType: crudCall.function.name as CrudActionType },
        userMessage,
        safeHistory,
        options.toolContext,
        crudCall,
      );
      if (crudRes.handled) {
        return {
          reply: crudRes.reply,
          status: 200,
          isFastPath: false,
          pendingAction: crudRes.pendingAction,
          executedAction: crudRes.executedAction,
        };
      }
    }

    const toolSummaries: string[] = [];
    for (const tc of extractedCalls) {
      try {
        const toolOutput = await executeFinancialTool(
          tc.function.name,
          tc.function.arguments,
          options.toolContext,
        );
        toolSummaries.push(toolOutput.summaryVi);
      } catch (err) {
        toolSummaries.push(`Lỗi công cụ ${tc.function.name}: ${String(err)}`);
      }
    }

    ollamaMessages.push({
      role: "assistant",
      content: result.content || `Tôi đang gọi công cụ ${extractedCalls.map((c) => c.function.name).join(", ")} để lấy dữ liệu mới nhất.`,
    });

    ollamaMessages.push({
      role: "user",
      content: `Dưới đây là kết quả thực thi từ hệ thống cho các công cụ:\n\n${toolSummaries.join("\n\n")}\n\nDựa vào các số liệu chính xác ở trên, hãy trả lời câu hỏi ban đầu của tôi một cách chi tiết, hữu ích và tự nhiên bằng tiếng Việt. In đậm các số tiền quan trọng.`,
    });

    // Call Ollama one more time (without tools to synthesize final advice)
    result = await executeOllamaChat({
      baseUrl: ollamaBaseUrl,
      messages: ollamaMessages,
      totalTimeoutMs: options?.totalTimeoutMs || 60_000,
      signal: options?.signal,
      modelOverride: options?.modelOverride,
      temperature: 0.3,
    });
  }

  if (!result.success || !result.content) {
    const err: OllamaClientError | undefined = result.error;
    return {
      error: err?.messageVi || "Không thể kết nối với Trợ lý AI lúc này.",
      status: err?.statusCode || 502,
    };
  }

  let finalContent = result.content;
  if (planToolResult) {
    const { verifyAndSanitizeBudgetPlan } = await import("./budget-planning.service.ts");
    const verified = verifyAndSanitizeBudgetPlan(
      result.content,
      planToolResult.constraints,
      planToolResult,
    );
    if (verified.corrected) {
      finalContent = verified.sanitizedText;
    }
  }

  const sanitized = validateAndSanitizeAiOutput(finalContent, {
    authoritativeSnapshot: options?.serverContext?.snapshot,
    toolSummaries: toolResultsList,
  });

  return {
    reply: sanitized,
    status: 200,
    isFastPath: false,
  };
}

export interface AiChatStreamChunk {
  token: string;
  done: boolean;
  isFastPath?: boolean;
  error?: string;
  status?: number;
  pendingAction?: PendingCrudActionProposal;
  executedAction?: ExecutedCrudActionResult;
}

/**
 * Streaming version of processChat — yields tokens in real time.
 */
export async function* processChatStream(
  ollamaBaseUrl: string,
  req: AiChatRequest,
  options?: ProcessChatOptions,
): AsyncGenerator<AiChatStreamChunk, void, unknown> {
  const { message, history, currentPage } = req;

  const userMessage = typeof message === "string" ? message.trim() : "";
  if (!userMessage) {
    yield { token: "", done: true, error: "Tin nhắn không được để trống.", status: 400 };
    return;
  }
  if (userMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
    yield { token: "", done: true, error: "Câu hỏi quá dài. Vui lòng nhập tối đa 2.000 ký tự.", status: 400 };
    return;
  }

  // Pre-filter obvious off-topic queries
  if (isObviouslyOffTopic(userMessage)) {
    yield { token: OFF_TOPIC_REPLY, done: true, isFastPath: true };
    return;
  }

  const safeHistory = sanitizeHistory(history);
  const currentUserId = options?.toolContext?.userId || options?.serverContext?.userId;
  const routing = routeUserIntent(userMessage, safeHistory, currentUserId);

  if (options?.toolContext && options.serverContext?.snapshot && !options.toolContext.snapshot) {
    options.toolContext.snapshot = options.serverContext.snapshot;
  }

  // Authorized CRUD Action Handling in Streaming Mode
  if (routing.crudIntent) {
    const crudRes = await handleChatCrudIntent(
      routing.crudIntent,
      userMessage,
      safeHistory,
      options?.toolContext,
    );
    if (crudRes.handled) {
      if (crudRes.status >= 400 && crudRes.error) {
        yield {
          token: "",
          done: true,
          error: crudRes.error,
          status: crudRes.status,
        };
        return;
      }
      yield {
        token: crudRes.reply,
        done: true,
        isFastPath: true,
        pendingAction: crudRes.pendingAction,
        executedAction: crudRes.executedAction,
      };
      return;
    }
  }

  // Fast Path Evaluation (Instant token delivery)
  const fastResult = await tryResolveFastPath(
    userMessage,
    routing,
    options?.serverContext || null,
    options?.toolContext || null,
  );
  if (fastResult.handled && fastResult.reply) {
    yield {
      token: fastResult.reply,
      done: true,
      isFastPath: true,
    };
    return;
  }

  // Non-Fast Path: run deterministic tool queries
  const toolResultsList: string[] = [];
  let planToolResult: BudgetConstrainedPlanResult | undefined;

  if (routing.requiresRealtimeSearch) {
    try {
      const fallbackToolCtx: ToolExecutionContext = options?.toolContext || {
        supabaseUrl: "",
        supabaseKey: "",
        token: "",
        userId: options?.serverContext?.userId || "",
      };
      const res = await executeFinancialTool("get_realtime_information", { query: userMessage }, fallbackToolCtx);
      if (res.summaryVi) toolResultsList.push(res.summaryVi);
    } catch (err) {
      console.warn("Error running realtime search tool:", err);
    }
  }

  let simulationHandled = false;
  if (routing.category === "AFFORDABILITY_WHATIF" && options?.serverContext?.snapshot) {
    const purchaseToSimulate =
      routing.multiTurnRef?.referencedPurchase ||
      (routing.extractedAffordability
        ? {
            itemName: routing.extractedAffordability.itemName,
            price: routing.extractedAffordability.price,
            category: routing.extractedAffordability.category,
          }
        : null);

    if (purchaseToSimulate) {
      try {
        const { runFinancialSimulation } = await import("./financial-simulation.service.ts");
        const simResult = runFinancialSimulation(
          options.serverContext.snapshot,
          purchaseToSimulate,
          {
            scenarioType: routing.multiTurnRef?.referenceType || "PURCHASE_WHATIF",
            targetBudgetQuery: routing.multiTurnRef?.targetBudgetName,
            serverContext: options.serverContext,
          },
        );
        toolResultsList.push(simResult.summaryVi);
        simulationHandled = true;
      } catch (simErr) {
        console.warn("Error running in-memory simulation:", simErr);
      }
    }
  }

  if (options?.toolContext && (routing.requiresPersonalData || routing.requiresFinancialAnalysis)) {
    try {
      if (routing.category === "LIST_TRANSACTIONS" || routing.transactionListQuery) {
        const listArgs: Record<string, unknown> = {};
        if (routing.transactionListQuery?.limit) listArgs.limit = routing.transactionListQuery.limit;
        if (routing.transactionListQuery?.type) listArgs.type = routing.transactionListQuery.type;
        if (routing.transactionListQuery?.period) listArgs.period = routing.transactionListQuery.period;
        if (routing.transactionListQuery?.startDate) listArgs.start_date = routing.transactionListQuery.startDate;
        if (routing.transactionListQuery?.endDate) listArgs.end_date = routing.transactionListQuery.endDate;
        if (routing.transactionListQuery?.month) listArgs.month = routing.transactionListQuery.month;
        if (routing.transactionListQuery?.year) listArgs.year = routing.transactionListQuery.year;
        if (routing.transactionListQuery?.category) listArgs.category = routing.transactionListQuery.category;
        if (routing.transactionListQuery?.minAmount) listArgs.min_amount = routing.transactionListQuery.minAmount;
        if (routing.transactionListQuery?.maxAmount) listArgs.max_amount = routing.transactionListQuery.maxAmount;

        const res = await executeFinancialTool("list_transactions", listArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "TRANSACTION_STATISTICS" || routing.transactionStatisticsQuery) {
        const statsArgs: Record<string, unknown> = {};
        if (routing.transactionStatisticsQuery?.period) statsArgs.period = routing.transactionStatisticsQuery.period;
        if (routing.transactionStatisticsQuery?.startDate) statsArgs.start_date = routing.transactionStatisticsQuery.startDate;
        if (routing.transactionStatisticsQuery?.endDate) statsArgs.end_date = routing.transactionStatisticsQuery.endDate;
        if (routing.transactionStatisticsQuery?.month) statsArgs.month = routing.transactionStatisticsQuery.month;
        if (routing.transactionStatisticsQuery?.year) statsArgs.year = routing.transactionStatisticsQuery.year;
        if (routing.transactionStatisticsQuery?.type) statsArgs.type = routing.transactionStatisticsQuery.type;
        if (routing.transactionStatisticsQuery?.category) statsArgs.category = routing.transactionStatisticsQuery.category;

        const res = await executeFinancialTool("get_transaction_statistics", statsArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "USER_FINANCIAL_DATA") {
        const walletArgs: Record<string, unknown> = {};
        if (routing.walletTargetQuery) {
          if (routing.walletTargetQuery.targetWalletKeyword) {
            walletArgs.wallet_query = routing.walletTargetQuery.targetWalletKeyword;
          }
          if (routing.walletTargetQuery.targetWalletType) {
            walletArgs.wallet_type = routing.walletTargetQuery.targetWalletType;
          }
          if (routing.walletTargetQuery.focusType) {
            walletArgs.focus = routing.walletTargetQuery.focusType;
          }
        }
        const res = await executeFinancialTool("get_wallet_balances", walletArgs, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "SPENDING_ANALYSIS") {
        const res = await executeFinancialTool("get_spending_analysis", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "BUDGET_ADVICE") {
        const res = await executeFinancialTool("get_budget_status", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "SAVINGS_PLANNING") {
        const res = await executeFinancialTool("get_savings_goals", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "AFFORDABILITY_WHATIF" && !simulationHandled) {
        if (routing.extractedAffordability) {
          const affordArgs: Record<string, unknown> = {
            item_name: routing.extractedAffordability.itemName,
            price: routing.extractedAffordability.price,
            category: routing.extractedAffordability.category,
            days: routing.extractedAffordability.days,
          };
          if (routing.extractedAffordability.targetWalletKeyword) {
            affordArgs.target_wallet = routing.extractedAffordability.targetWalletKeyword;
          }
          if (routing.extractedAffordability.targetWalletType) {
            affordArgs.target_wallet_type = routing.extractedAffordability.targetWalletType;
          }
          const res = await executeFinancialTool("evaluate_purchase_affordability", affordArgs, options.toolContext);
          if (res.summaryVi) toolResultsList.push(res.summaryVi);
        } else {
          const [bRes, wRes] = await Promise.all([
            executeFinancialTool("get_budget_status", {}, options.toolContext),
            executeFinancialTool("get_wallet_balances", {}, options.toolContext),
          ]);
          if (bRes.summaryVi) toolResultsList.push(bRes.summaryVi);
          if (wRes.summaryVi) toolResultsList.push(wRes.summaryVi);
        }
      } else if (routing.category === "GENERAL_FINANCIAL_ADVICE") {
        const res = await executeFinancialTool("get_financial_advice", {}, options.toolContext);
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
      } else if (routing.category === "BUDGET_PLANNING" || routing.extractedBudgetPlan) {
        const planArgs: Record<string, unknown> = {
          scope: routing.extractedBudgetPlan?.scope || "BREAKFAST_PLAN",
          budget: routing.extractedBudgetPlan?.budget,
          days: routing.extractedBudgetPlan?.days,
          meal_type: routing.extractedBudgetPlan?.mealType,
          target_category: routing.extractedBudgetPlan?.targetCategory,
          use_remaining_funds: routing.extractedBudgetPlan?.useRemainingFunds,
          savings_mode: routing.extractedBudgetPlan?.savingsMode,
        };
        const res = await executeFinancialTool(
          "create_budget_constrained_plan",
          planArgs,
          options.toolContext,
        );
        if (res.summaryVi) toolResultsList.push(res.summaryVi);
        if (res.data) planToolResult = res.data as BudgetConstrainedPlanResult;
      }
    } catch (toolErr) {
      console.warn("Error running deterministic tool:", toolErr);
    }
  }

  let ragContext = "";
  if (routing.requiresSystemRag) {
    const ragResults = searchSystemKnowledge(userMessage, { history: safeHistory });
    ragContext = formatRagContextForPrompt(ragResults);
  }

  let financialContext = "";
  if (options?.serverContext && (routing.requiresPersonalData || routing.requiresFinancialAnalysis)) {
    financialContext = formatServerFinancialContextForPrompt(
      options.serverContext,
      cleanText(currentPage, 80),
      userMessage,
    );
  }

  let multiTurnBlock = "";
  if (routing.multiTurnContext?.referencedAmount) {
    multiTurnBlock = `=== THÔNG TIN THAM CHIẾU TỪ LƯỢT TRƯỚC (MULTI-TURN REFERENCE) ===\nSố tiền được người dùng tham chiếu ("với số tiền đó"): ${routing.multiTurnContext.referencedAmount.toLocaleString("vi-VN")} VND.\nHãy đưa ra tư vấn phân bổ hoặc tiết kiệm cụ thể cho số tiền này (ví dụ: nguyên tắc tiết kiệm 20% - 30%).\n=== HẾT THÔNG TIN THAM CHIẾU ===`;
  }

  const toolBlock = toolResultsList.length > 0
    ? `=== KẾT QUẢ TRUY VẤN DỮ LIỆU TỪ CÔNG CỤ (DETERMINISTIC TOOL RESULT) ===\n${toolResultsList.join("\n\n")}\n=== HẾT KẾT QUẢ CÔNG CỤ ===`
    : "";

  const combinedContext = [ragContext, toolBlock, financialContext, multiTurnBlock].filter(Boolean).join("\n\n");
  const dynamicSystemPrompt = buildDynamicSystemPrompt(routing);
  const systemWithContext = combinedContext ? `${dynamicSystemPrompt}\n\n${combinedContext}` : dynamicSystemPrompt;

  const ollamaMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
    { role: "system", content: systemWithContext },
  ];

  for (const h of safeHistory) {
    const hRole = h.role === "model" ? "assistant" : "user";
    const hText = Array.isArray(h.parts) ? cleanText(h.parts[0]?.text, MAX_CHAT_MESSAGE_LENGTH) : "";
    if (hText) {
      ollamaMessages.push({ role: hRole, content: hText });
    }
  }
  ollamaMessages.push({ role: "user", content: userMessage });

  // If this is a verified budget constrained plan, stream the verified deterministic plan directly
  if (planToolResult?.summaryMarkdown) {
    const textToStream = planToolResult.summaryMarkdown;
    const chunkSize = 24;
    for (let i = 0; i < textToStream.length; i += chunkSize) {
      yield { token: textToStream.slice(i, i + chunkSize), done: false, isFastPath: false };
    }
    yield { token: "", done: true, isFastPath: false };
    return;
  }

  // Stream LLM tokens with real-time JSON / tool call suppression guard
  const streamSanitizer = createStreamOutputSanitizer({
    authoritativeSnapshot: options?.serverContext?.snapshot,
    toolSummaries: toolResultsList,
  });

  for await (const chunk of executeOllamaChatStream({
    baseUrl: ollamaBaseUrl,
    messages: ollamaMessages,
    totalTimeoutMs: options?.totalTimeoutMs || 60_000,
    signal: options?.signal,
    modelOverride: options?.modelOverride,
    temperature: 0.2,
  })) {
    if (chunk.error) {
      yield {
        token: "",
        done: true,
        error: chunk.error.messageVi,
        status: chunk.error.statusCode,
      };
      return;
    }

    if (chunk.done) {
      const remaining = streamSanitizer.flush();
      if (remaining) {
        yield { token: remaining, done: false, isFastPath: false };
      }
      yield { token: "", done: true, isFastPath: false };
      return;
    }

    const sanitizedToken = streamSanitizer.processToken(chunk.token);
    if (sanitizedToken) {
      yield {
        token: sanitizedToken,
        done: false,
        isFastPath: false,
      };
    }
  }
}
