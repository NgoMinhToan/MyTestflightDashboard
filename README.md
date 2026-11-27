# MyTestflightDashboard

Bảng quản trị web cho **MyTestflightServer**, dựng từ bản thiết kế đã chốt
`web_design/design-demos/shelf-final.html` trong workspace (**Shelf** + rail dọc của **Release
Desk**). Ứng dụng là HTML/CSS/JavaScript thuần, đóng gói bằng Vite, không framework UI.

## Chức năng

- **Thư viện**: tìm theo tên/package/nhà phát triển, lọc trạng thái và ABI, sắp xếp, tạo ứng dụng,
  mở chi tiết, đổi icon bằng cách bấm icon.
- **Chi tiết**: số liệu phiên bản, kệ kiến trúc (làn ABI theo dung lượng), ma trận phiên bản × ABI,
  lịch sử phiên bản, tìm/lọc phiên bản, tải APK theo từng ABI, sửa metadata phiên bản, xoá.
- **Tải APK**: thả nhiều tệp, đọc `AndroidManifest.xml` ngay trong trình duyệt (package, versionName,
  versionCode, minSdk, ABI), tự điền form, tự chọn ứng dụng theo package, cảnh báo lệch/trùng ABI
  trước khi gửi. Tiến trình từng tệp và thanh tổng, SHA-256 do máy chủ trả về. Luồng ghi vẫn là
  `POST /versions` rồi `PUT /artifacts/:abi` cho từng tệp.
- **Icon**: thả PNG/JPG/WebP ≤ 2 MB, xem trước trên nền pastel và nền tối, lưu hoặc xoá.
- **Metadata**: tạo/sửa ứng dụng, sửa `versionCode`, `minSdk`, ghi chú và ngày phát hành.
- **Curl cho CI**: sinh lệnh từ Base URL hiện tại, token để dạng biến môi trường.
- **Cài đặt**: Base URL + management token, kiểm tra kết nối, xoá thông tin đã lưu.
- **Sáng/Tối**: nút chuyển theme ở rail, lưu vào trình duyệt.
- **Sức khoẻ máy chủ**: gọi `/api/v1/health` định kỳ, hiện độ trễ.

Ba mục **Phiên bản / Hoạt động / Máy chủ** trên rail được giữ nguyên theo phạm vi thiết kế đã
chốt; chúng chỉ hiện thông báo "chưa khả dụng", không điều hướng.

## Xem trước APK trước khi tải lên

Khi thả APK, dashboard đọc tệp **tại chỗ trong trình duyệt** trước khi gửi bất cứ thứ gì:

1. Tìm EOCD trong 65 557 byte cuối, đọc central directory và lấy `AndroidManifest.xml` (method 0
   `stored` hoặc method 8 qua `DecompressionStream("deflate-raw")`).
2. Parse binary AXML để lấy `packageName`, `versionName`, `versionCode`, `minSdk`, `targetSdk`,
   `debuggable`, `testOnly`, `split`/`configForSplit`.
3. Đọc `lib/<abi>/` trong central directory: đúng một ABI → ABI đó; 0 hoặc nhiều hơn → `universal`.
   ABI từ metadata **thắng** đoán theo tên tệp.

Hộp thoại hiện package, version, minSdk và ABI của từng tệp. Sau khi đọc xong:

- **Tự điền** `versionName`, `versionCode`, `minSdk` từ APK khi hộp thoại **không** mở cho một phiên
  bản cụ thể và field đó chưa bị người dùng sửa. Field đã sửa tay không bao giờ bị ghi đè.
- Nếu hộp thoại không mở cho một ứng dụng cụ thể, ứng dụng có `packageName` khớp sẽ được chọn tự
  động; không có ứng dụng khớp thì hiện gợi ý tạo ứng dụng mới.
- **Chặn tải lên**: APK lỗi/không phải APK, ZIP64, config split, các tệp lệch package hoặc version,
  và trùng ABI. Nút tải lên bị vô hiệu hoá trong khi đang đọc và khi còn lỗi fatal.
- **Cảnh báo**: APK `debuggable`/`testOnly`, ABI bị sửa tay, package APK khác package ứng dụng.
- Khi người dùng sửa `versionName`/`versionCode`/`minSdk` lệch với APK (hoặc đổi ABI), dashboard gửi
  `allow_mismatch=version`, `sdk`, `abi` tương ứng. Package lệch **không** tự cho qua: lỗi `422
  apk_metadata_mismatch` của máy chủ hiện rõ trong `#upError` kèm chi tiết từng trường.

Giới hạn bộ đọc: central directory ≤ 64 MiB, ≤ 200 000 entry, manifest nén ≤ 16 MiB và sau giải nén
≤ 8 MiB; ZIP64 bị từ chối với lỗi có mã riêng.

| Trình duyệt | Xem trước APK nén | Ghi chú |
|---|---|---|
| Chromium / Edge 103+ | Có | `DecompressionStream("deflate-raw")` |
| Firefox 113+ | Có | |
| Safari 16.4+ | Có | |
| Trình duyệt cũ hơn | Không | Vẫn tải lên được: báo "không xem trước được", ABI lấy từ tên tệp, máy chủ xác minh lại |

APK lưu `stored` (method 0) luôn xem trước được vì không cần API giải nén.

## Chạy local

Yêu cầu Node `^20.19.0 || >=22.12.0` và một MyTestflightServer đang chạy.

```bash
cd MyTestflightDashboard
npm ci
npm run dev
```

Mở <http://localhost:5173>. Lần mở đầu tiên chưa có token sẽ tự chuyển tới **Cài đặt**.

Máy chủ phải cho phép origin của dashboard. Ví dụ khi chạy server từ workspace:

```bash
cd ../MyTestflightServer
DATA_DIR=../data \
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
npm run dev
```

Hoặc thêm vào `.env` của workspace rồi chạy lại compose:

```bash
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
docker compose up -d --build
```

## Cài đặt kết nối

Màn **Cài đặt** (bấm bánh răng ở đáy rail, hoặc bị chuyển hướng tự động khi chưa có token) cần:

| Trường | Ý nghĩa |
|---|---|
| **Base URL** | Origin của MyTestflightServer, không gồm `/api/v1`. Ví dụ `http://127.0.0.1:8080`. Có thể kèm tiền tố triển khai, ví dụ `https://example.com/testflight`. |
| **Management token** | Giá trị `management_key` trong `data/config.json` của máy chủ. |

- Thông tin được lưu trong `localStorage` của **trình duyệt này**:
  - `mytestflight.dashboard.settings.v1` — `{ baseUrl, token }`
  - `mytestflight.dashboard.theme.v1` — `"light"` hoặc `"dark"`
- Không có token (hoặc chưa có Base URL) thì mọi đường dẫn khác đều bị đưa về `#/settings`.
- **Kiểm tra kết nối** gọi `/api/v1/health`, rồi kiểm tra token bằng một yêu cầu ghi vô hại:
  `PUT /api/v1/apps/__dashboard_probe__` với body rỗng. Hook xác thực chạy trước khi route kiểm tra
  id/body, nên `400` nghĩa là **token hợp lệ**, `401` là token sai. Không có dữ liệu nào bị thay đổi.
  Vì vậy bạn sẽ thấy một `400` trong DevTools khi bấm kiểm tra; đó là chủ đích.
- **Xoá thông tin đã lưu** xoá cả token và Base URL; lần mở sau quay lại màn cài đặt.

## API sử dụng

| Method | Endpoint | Dùng cho |
|---|---|---|
| GET | `/api/v1/health` | Trạng thái máy chủ, độ trễ |
| GET | `/api/v1/apps` | Danh mục ứng dụng |
| GET | `/api/v1/apps/:id/versions` | Danh sách quản trị, gồm cả bản nháp |
| POST/PUT/DELETE | `/api/v1/apps[/:id]` | Tạo/sửa/xoá ứng dụng |
| PUT/DELETE | `/api/v1/apps/:id/icon` | Cập nhật/xoá icon |
| POST/PUT/DELETE | `/api/v1/apps/:id/versions[/:name]` | Tạo/sửa/xoá phiên bản |
| PUT/DELETE | `/api/v1/apps/:id/versions/:name/artifacts/:abi` | Tải/xoá APK; upload nhận thêm `?allow_mismatch=package,version,sdk,abi` |
| GET | `/api/v1/apps/:id/versions/:name/download?abi=` | Tải APK (link trực tiếp) |

Mọi thao tác ghi gửi header `X-Management-Key`. Các route đọc vẫn công khai như máy chủ quy định.
Tải APK dùng `XMLHttpRequest` để có tiến trình theo từng tệp; các yêu cầu JSON dùng `fetch`.

## GitHub Pages

Thư mục này được thiết kế để trở thành **repo riêng** trên GitHub (repo root chính là
`MyTestflightDashboard/`).

1. Đẩy thư mục lên một repository, nhánh mặc định `main`.
2. Vào **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) tự chạy khi push lên
   `main` (và có `workflow_dispatch`): `npm ci` → `npm run build` → upload `dist` → deploy Pages.
4. Trên máy chủ, cho phép origin Pages:

   ```bash
   CORS_ORIGINS=https://<owner>.github.io
   ```

   Origin chỉ gồm scheme + host + port; **không** thêm tên repo. Nếu dùng custom domain, dùng
   origin của domain đó.

`vite.config.js` đặt `base: "./"`, nên bản build chạy đúng dưới đường dẫn project
`https://<owner>.github.io/<repo>/`. Định tuyến dùng hash (`#/apps`, `#/apps/:id`, `#/settings`),
không cần rewrite trên Pages.

## Build và kiểm tra

```bash
npm test          # node --test: bộ đọc ZIP/AXML + quy tắc prefill/validate
npm run build     # xuất dist/
npm run preview   # chạy thử bản build
```

`npm test` dùng Node 22 và không cần trình duyệt. Bộ test gồm:

- `test/fixtures.mjs` — ZIP writer (stored, deflate, data descriptor) và binary-AXML builder
  (UTF-8/UTF-16), kèm manifest AXML thật 8 000 byte của workspace (base64, không commit APK).
- `test/apk-inspect.test.mjs` — fixture thật, stored/deflate, UTF-8/UTF-16, 0/1/nhiều ABI,
  `versionName` dạng resource reference, config split, ZIP64, vượt giới hạn, APK hỏng, thiếu
  manifest, và trường hợp trình duyệt thiếu `DecompressionStream`.
- `test/upload-plan.test.mjs` — prefill không ghi đè field đã sửa/phiên bản cụ thể, lệch
  package/version giữa nhiều tệp, trùng ABI, ABI override, cảnh báo debuggable/testOnly, tự chọn
  ứng dụng theo package và `allow_mismatch`.

Đã kiểm tra bằng Chrome headless với server thật: chuyển hướng khi thiếu token, kiểm tra kết nối,
lưu cài đặt, tải danh mục, tạo/xoá ứng dụng, upload icon, upload APK có tiến trình và SHA-256, sửa
metadata phiên bản, chuyển sáng/tối, layout 375px không tràn ngang, và bản build production. Phần
đọc AXML/prefill/validate được kiểm tra tự động bằng `npm test`; nên thả thử một APK thật trong
trình duyệt đích trước khi phát hành.

## Cấu trúc

```text
MyTestflightDashboard/
├── .github/workflows/pages.yml   # deploy GitHub Pages khi push
├── index.html                    # entry Vite, bootstrap theme trước khi paint
├── vite.config.js                # base "./" cho project pages
├── src/
│   ├── main.js                   # boot + event listeners
│   ├── router.js                 # hash router + guard token
│   ├── actions.js                # thao tác UI → API
│   ├── render.js                 # render trang/modal/toast, tải danh mục, health
│   ├── api.js                    # ApiClient, lỗi, upload XHR, probe token
│   ├── apk-inspect.js            # ZIP + binary AXML parser (browser + Node)
│   ├── upload-plan.js            # prefill, validate, allow_mismatch, chọn app
│   ├── settings.js               # localStorage, chuẩn hoá Base URL, theme
│   ├── model.js                  # chuẩn hoá dữ liệu API → mô hình thiết kế
│   ├── format.js                 # ABI, dung lượng, ngày, icon, màu pastel
│   ├── icons.js                  # bộ SVG
│   ├── shell.js                  # rail + health pill
│   ├── modals.js                 # upload/icon/app/version/confirm/curl
│   ├── views/                    # list, detail, settings
│   ├── styles.css                # CSS từ bản thiết kế đã chốt
│   ├── theme.css                 # dark theme
│   └── app.css                   # settings, loading/error, theme control
├── test/                         # node --test: fixtures, parser, upload-plan
└── README.md
```

## Bảo mật và giới hạn

- Token quản trị cho phép thay đổi ứng dụng/phiên bản/APK. Không dùng dashboard trên máy chia sẻ.
- Token chỉ nằm trong `localStorage` của origin dashboard và chỉ được gửi tới Base URL bạn nhập.
  Không có analytics, không gọi dịch vụ thứ ba.
- Xem trước APK chạy hoàn toàn trong trình duyệt: chỉ các byte của ZIP/AXML cần thiết được đọc bằng
  `Blob.slice()`, không có yêu cầu mạng nào trước khi bấm tải lên. Dù vậy, máy chủ **luôn** đọc và
  xác minh lại APK; `allow_mismatch` chỉ bỏ qua đúng trường người dùng đã sửa tay.
- Nên dùng HTTPS cho máy chủ. Trang GitHub Pages chạy HTTPS nên trình duyệt sẽ chặn máy chủ HTTP
  không phải `localhost` (mixed content). Chrome có thể cần
  `Access-Control-Allow-Private-Network` khi gọi IP nội bộ; máy chủ đã trả header này khi được hỏi.
- Ưu tiên `CORS_ORIGINS` là origin cụ thể; `*` chỉ nên dùng trong mạng tin cậy.
- Không có API thống kê dung lượng volume; thẻ "Dung lượng APK" tính từ danh mục và tỉ trọng so
  với tổng dung lượng APK của tất cả ứng dụng.
- Mỗi trình duyệt giữ một cấu hình kết nối; chưa có bộ chuyển nhiều máy chủ.

## Ghi nhận thiết kế

Giao diện, token màu, font (Plus Jakarta Sans / IBM Plex Mono), bố cục Shelf và rail Release Desk
lấy từ `web_design/` trong workspace — hướng đã chốt ngày 20/11/2026. Phần Cài đặt, dark theme và
các trạng thái tải/lỗi được bổ sung cùng ngôn ngữ thị giác đó.
