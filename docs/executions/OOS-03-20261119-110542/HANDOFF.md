# OOS-03 — BÁO CÁO BÀN GIAO KỸ THUẬT (FINAL HANDOFF)

- **Trạng thái tổng thể:** `PARTIAL` (Toàn bộ mã nguồn, unit/mock/HTTP/E2E tests, kiểm thử hồi quy `CowboyShort` và video 15 giây mới `OOSDemo15` đều **PASS 100%**; duy nhất cổng `Live Gemini Provider Probe` ở trạng thái **LIVE_BLOCKED** trung thực do môi trường máy chạy không có sẵn khóa API thực trong `app/data/settings.json` hoặc biến môi trường `GEMINI_API_KEY`; và bản render lại toàn bộ 894 frame của video cũ `CowboyShort` để **NOT_RUN** theo đúng quy định mục 4F/6 vì source `cowboy/**` và `pipeline/**` giữ nguyên `0` byte thay đổi và đã PASS 6 frame đại diện).
- **Repository:** `https://github.com/quocan050302/out-of-step-studio`
- **Branch triển khai duy nhất:** `feat/studio-react-vite-migration`
- **Baseline Commit SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`
- **Implementation Commit SHA:** `fa27bed5d165bf868d3823432cd2eefa7c16f48e`
- **Execution Folder:** `docs/executions/OOS-03-20261119-110542/` (Bảo toàn nguyên vẹn `docs/executions/OOS-UI-02-2026-11-19/` với `0` file bị ghi đè).

---

## 1. Danh mục các hàm/file đã thay đổi và các thành phần giữ nguyên tuyệt đối

### A. Các file/hàm đã nâng cấp có chủ đích
1. **`app/server/settings-store.mjs`:**
   - `redactSecrets`: Bổ sung lọc query `([?&]key=)[^&\s"']+` bên cạnh secret trực tiếp và `AIza...`.
   - `atomicWriteBufferSync` & `atomicWriteJsonSync`: Ghi file nguyên tử qua `${filePath}.${process.pid}.${nonce}.tmp` với `mode: 0o600` và tự động dọn file `.tmp` nếu lỗi đĩa.
   - `updateProviderSettings`: Trả thêm cờ `geminiConfigChanged` khi `selectionMode`, `modelPolicy`, `includePreview` hoặc model ID thay đổi để xóa trạng thái `verified` cũ không còn khớp policy.
2. **`app/server/gemini-models.mjs`:**
   - `classifyGeminiModel`: Chống nhận diện nhầm từ `displayName` gây hiểu lầm (model text có chữ `"TTS"` trong `displayName` không bị xếp nhầm vào `tts`, gắn nhãn `capabilityConfidence: "low"`); yêu cầu `supportedInputModalities` có `"IMAGE"` hoặc `inputTokenLimit >= 32768` cho `vision`; bổ sung `candidateOnly: true`, `verificationState: "unverified_candidate"`.
   - `fetchGeminiModelCatalog`: Bổ sung `loopDetected` (khi `nextPageToken` lặp vòng) và `paginationTruncated`.
   - `createModelCatalogService`: Gộp single-flight cho cả các lệnh `forceRefresh: true` đồng thời và ngắt tức thì caller nào có `AbortSignal` bị hủy mà không làm hỏng request dùng chung của các caller khác.
   - `rankGeminiModels`: Gắn rõ `rankSource: "tier_heuristic_candidate"` và `rankRationale`.
3. **`app/server/gemini-transport.mjs`:**
   - `inspectQuotaScope` & `classifyGeminiError`: Phân biệt `429` theo 3 phạm vi `model`, `global`, và `unknown`. Khi phạm vi `unknown`, giữ phân loại bảo thủ (`fallbackEligible: false`) để tuyệt đối không nhảy model nhằm lách quota dự án/tài khoản.
   - `retryWithBackoff`: Không bao giờ cắt ngắn `waitMs` xuống thấp hơn `Retry-After` của server; nếu `Retry-After` vượt quá ngân sách chờ (`maxRetryWaitMs` hoặc `deadlineAt`), dừng ngay với `retryAfterExceededBudget = true`.
   - `ModelHealthRegistry` & `chooseCandidateList`: Thêm `verifiedTtlMs` (30 phút), phân vùng `healthy` đứng trước `coolingTransient` ở mọi vị trí ứng viên (cả `auto` và `manual`), loại trừ model `404 unsupported` khi catalog chưa đổi, khóa single-probe `tryAcquireRecoveryProbe` chống thundering herd khi hết cooldown, nhân hệ số cooldown `1.5x` chống dao động (anti-oscillation), và chặn dùng model text cho `tts` hoặc model text-only (`gemini-1.0-pro`) cho `vision`.
   - `runGeminiWithFallback`: Đưa `acquireSlot(signal)` vào trong khối `try/catch` để hủy sạch khi đang xếp hàng semaphore; ghi nhận cả lần thử `configAdapted` thất bại vào `attemptedModels` và xuất `warning` + `configAdapted: true` khi adapt thành công.
   - `validateScriptResponse` & `validateTtsAudio`: Bắt buộc `estSec > 0`, `totalWords > 0` hợp lệ, tổng thời lượng `<= 600s`; từ chối buffer âm thanh PCM rỗng/toàn số 0 (im lặng), độ dài lẻ hoặc sai chuẩn base64.
4. **`app/server/create-server.mjs` & `app/src/lib/studio.mjs`:**
   - Đồng bộ mặc định `maxCandidates = 3`, `maxTotalRequests = 6` khớp với `createGeminiExecutionEngine()`.
   - Tuần tự hóa việc xuất file `app/data/tts-output.wav` trong `POST /api/tts` bằng `withDataDirLock` + `atomicWriteBufferSync`.
   - Đóng và hủy reader an toàn trong `streamTestConnection` khi client abort/unmount.
5. **`app/test/` (`gemini-models.test.mjs`, `gemini-fallback.test.mjs`, `server-api.test.mjs`, `demo15.test.mjs`, `e2e-ui.mjs`):**
   - Mở rộng từ `24` lên `33` bài test tự động (`100%` pass trong `~220 ms`).
   - Hỗ trợ đường dẫn Chrome trên macOS trong `e2e-ui.mjs`, fail-closed khi thiếu browser, và tách thư mục xuất mặc định sang `os.tmpdir()` để không bao giờ ghi đè `docs/executions/OOS-UI-02-2026-11-19/`.
6. **Thêm mới (Additive-only) trong `engine/` cho video 15 giây `OOSDemo15`:**
   - `engine/src/Root.tsx`: Chỉ đăng ký thêm `<Composition id="OOSDemo15" ... />` (`450` frames, `30` fps, `1080×1920`).
   - `engine/src/videos/demo15/{story.ts,motion.ts,art.tsx,Demo15.tsx}`: Mã nguồn hoạt hình 5 cảnh *"The Roman Messenger Who Lost His Scroll"*.
   - `engine/scripts/{synth_demo15_audio.py,render-oos-demo15.mjs}`: Tổng hợp nhạc nền + Foley SFX stereo 48 kHz và kết xuất portable + kiểm định `ffprobe` / `short_qa.py`.

### B. Các thành phần được bảo toàn nguyên vẹn (`0` dòng thay đổi)
- Toàn bộ `engine/src/videos/cowboy/**` (`CowboyShort` 894 frames, physics, camera, shaders, postprocessing) và `pipeline/**` (`make_mix.py`): `git diff engine/src/videos/cowboy pipeline` = **0 bytes**.
- Toàn bộ giao diện React + Vite Navy–Gold (`app/src/App.jsx`, `app/src/pages/**`, `app/src/components/**`, `app/src/styles/**`) và toàn bộ câu chữ prompt gốc của `/api/test-connection`, `/api/script`, `/api/check-still`.

---

## 2. Bảng kết quả các cổng chất lượng (`G0`–`G9`)

| Gate | Mô tả | Kết quả | Chi tiết Mock vs Live & Bằng chứng |
|---|---|---|---|
| **G0** | Branch & Baseline | **PASS** | Branch `feat/studio-react-vite-migration`, baseline SHA `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638` ([BASELINE.md](./BASELINE.md)) |
| **G1** | Settings & Secrecy | **PASS** | Atomic `0o600` writes, serialized queue, `0` lộ key trong repo/log/DOM/screenshots |
| **G2** | Model Catalog & Ranking | **PASS** | `MOCK_PASS` (`6/6` suites trong `app/test/gemini-models.test.mjs`) |
| **G3** | Fallback, Retry & Health | **PASS** | `MOCK_PASS` (`17/17` suites trong `app/test/gemini-fallback.test.mjs`) |
| **G4** | API & NDJSON Contracts | **PASS** (Mock) / **BLOCKED** (Live) | `MOCK_PASS` (`app/test/server-api.test.mjs`); Live API: `LIVE_BLOCKED` do máy chạy không có `app/data/settings.json` hay `GEMINI_API_KEY` ([test-artifacts/live-gemini-probe.json](./test-artifacts/live-gemini-probe.json)) |
| **G5** | Navy–Gold UI & Browser E2E | **PASS** | `MOCK_PASS` trên Chrome headless thật (`36/36` viewport/tab checks từ `320px`–`1920px`, `0` lỗi console, `10` ảnh chụp màn hình trong `screenshots/`) |
| **G6** | Engine Source & `CowboyShort` | **PASS** (`FULL_OLD_RENDER`: **NOT_RUN**) | `npx tsc --noEmit` PASS; `0` diff trong `cowboy/**` & `pipeline/**`; kết xuất thành công 6 frame đại diện `f60, f200, f400, f550, f700, f830` ([test-artifacts/cowboy-regression-stills.json](./test-artifacts/cowboy-regression-stills.json)); full 894-frame render đánh dấu `NOT_RUN` trung thực |
| **G7** | Video 15s mới (`OOSDemo15`) | **PASS** | File MP4 thật `1080×1920`, `30/1` fps, `450` frames, `15.000s`, H.264 + AAC 48kHz stereo (`-16.9` LUFS, `0` khoảng lặng, `0` black/white/frozen/pop frames) ([DEMO15.md](./DEMO15.md)) |
| **G8** | Disk, Concurrency & Performance | **PASS** | `33` unit tests chạy trong `222 ms`; đĩa trống `15.5 GiB` (`>10x` ngưỡng an toàn); toàn bộ thư mục tạm `.tmp-remotion-*` đã dọn sạch |
| **G9** | Git Hygiene & Delivery | **PASS** | `git diff --check` sạch; không commit file nhị phân `.mp4`/`.wav` hay khóa bí mật; đã commit và push lên `origin/feat/studio-react-vite-migration` |

---

## 3. Thông tin bàn giao Video 15 giây mới (*"The Roman Messenger Who Lost His Scroll"*)

- **Tiêu đề:** *"The Roman Messenger Who Lost His Scroll"* (`OOSDemo15`)
- **Đường dẫn thực tế trên máy:**
  - Bản chính Full-HD (`1080×1920`): `out/oos-03/demo15/final_15s_1080x1920.mp4` (`22,947,400` bytes)
  - Bản preview (`540×960`): `out/oos-03/demo15/preview_15s_540x960.mp4` (`8,449,986` bytes)
  - File âm thanh gốc (`48000 Hz` stereo WAV): `out/oos-03/demo15/demo15-mix.wav` (`2,880,044` bytes)
  - Kế hoạch cảnh quay (Shot Plan): `out/oos-03/demo15/shot-plan.json` (bản sao lưu trong Git: `docs/executions/OOS-03-20261119-110542/test-artifacts/demo15-shot-plan.json`)
  - 15 ảnh tĩnh `1080×1920`: `out/oos-03/demo15/stills/frame_0000.png` .. `frame_0440.png`
  - 8 bảng contact sheet kiểm định (60 frames/bảng) & báo cáo QA: `out/oos-03/demo15/qa/sheet_0000.jpg` .. `sheet_0420.jpg` và `out/oos-03/demo15/qa/report.md`
- **Mã băm SHA-256:**
  - `final_15s_1080x1920.mp4`: `3120d40cfd28d142790287cfec665f39a9f597b845055ff4cc16c54fbb0971ea`
  - `preview_15s_540x960.mp4`: `20b4d5920f6735e9281b9e49d509e0b53afde261ffedb3815f1d3a2049fd1d38`
  - `demo15-mix.wav`: `6e6878ab1ff4066dbfbd30db36c61a725179cfa7c8f63d0e294c1a216da8dc0e`
- **Thông số `ffprobe` & `short_qa.py` thực tế:**
  - Video: `h264`, `1080×1920` (9:16), `30/1` fps, đúng `450` decoded frames, thời lượng `15.000` giây.
  - Audio: `aac`, `48000` Hz, `2` kênh stereo, Integrated Loudness `-16.9 LUFS`, True Peak `-1.5 dBFS`, `SILENCES: none` (nhạc nền lyre/trống hài hước + Foley SFX tiếng gió cuốn, bước chân sandal, đài phun nước, va chạm xe gỗ, mở cuộn giấy và tiếng gió cuốn lần 2).
  - Frame QA: `black: []`, `unplanned white: []`, `frozen spans >=12f: []`, `POPS: []`, `frames with diff < 0.3 (held): 0 (0%)`.
- **Trạng thái phân phối từ xa (Remote Delivery):** `REMOTE_DELIVERY_BLOCKED` (Theo quy tắc `.gitignore` không đẩy file `.mp4` nhị phân lớn lên Git repository; file có sẵn trực tiếp trên ổ đĩa cục bộ tại `out/oos-03/demo15/final_15s_1080x1920.mp4` hoặc có thể tái tạo chính xác 100% bằng lệnh `cd engine && node scripts/render-oos-demo15.mjs`).
