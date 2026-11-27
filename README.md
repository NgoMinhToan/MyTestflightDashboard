# MyTestflightDashboard

Bảng quản trị web cho **MyTestflightServer**: thả APK nội bộ, xem thư viện phiên bản, tải APK
theo ABI và cấu hình kết nối máy chủ. HTML/CSS/JavaScript thuần, đóng gói bằng Vite, không
framework UI.

![Build and deploy dashboard](https://github.com/NgoMinhToan/MyTestflightDashboard/actions/workflows/pages.yml/badge.svg)

**Trạng thái:** dùng nội bộ trong workspace `MyTestflight`; không có bản phát hành công khai, không
có giấy phép mã nguồn mở trong repo này.

## Bắt đầu trong một phút

Yêu cầu Node `^20.19.0 || >=22.12.0` và một MyTestflightServer đang chạy.

```bash
cd MyTestflightDashboard
npm ci
npm run dev
```

Mở <http://localhost:5173>, nhập Base URL và management token ở màn **Cài đặt**. Dashboard tự
chuyển tới Cài đặt khi chưa có token.

Nếu chạy cả workspace bằng Docker Compose, máy chủ mặc định ở `http://localhost:8080`:

```bash
# từ workspace MyTestflight
CORS_ORIGINS=http://localhost:5173 docker compose up -d --build
```

Máy chủ phải cho phép origin của dashboard qua `CORS_ORIGINS`. Khi deploy GitHub Pages, dùng
`https://<owner>.github.io` (không thêm tên repo). Trang HTTPS chỉ gọi được máy chủ HTTPS, trừ
`localhost`/`127.0.0.1`.

## Vì sao dùng cái này?

Nhóm Android nội bộ cần một nơi để đẩy APK và gửi link cài đặt mà không phụ thuộc Google Play.
Dashboard là lớp quản trị mỏng chạy trên trình duyệt, còn máy chủ tự host giữ volume APK.

- **APK là nguồn dữ liệu duy nhất.** Không chọn ứng dụng, không sửa versionName/versionCode/minSdk,
  không chọn ABI bằng tay. Dashboard đọc `AndroidManifest.xml` và `resources.arsc` tại chỗ, rồi gửi
  `POST /api/v1/import` để máy chủ xác minh lại.
- **Tự gắn hoặc tự tạo ứng dụng.** Package khớp một ứng dụng duy nhất thì gắn vào đó; chưa có thì
  tạo mới bằng `android:label` và id suy từ package. Không có bước xác nhận thừa.
- **Icon APK được dựng trong trình duyệt.** Icon raster xem trực tiếp; icon adaptive/vector được
  dựng SVG rồi rasterize thành PNG 512×512. Chỉ ghi `PUT /apps/:id/icon?if_missing=1` khi ứng dụng
  chưa có icon hiệu lực, nên không bao giờ ghi đè icon đang dùng.
- **Thay ABI có hỏi, thêm ABI thì không.** Nếu phiên bản đích đã có ABI của tệp, dashboard hỏi ngay
  trong form trước khi thay; ABI mới được thêm thẳng.

**Khi nào nên dùng thứ khác:** nếu bạn cần crash reporting, phân phối theo nhóm tester, chữ ký
store, hoặc rollout theo tỷ lệ phần trăm, hãy dùng Google Play internal testing hoặc Firebase App
Distribution. Dashboard này chỉ quản lý APK, phiên bản và lượt tải trên máy chủ của bạn.

## Tải APK

1. Bấm **Tải APK lên** (hoặc thả tệp vào form). Có thể thêm nhiều APK cho các ABI khác nhau.
2. Dashboard đọc manifest và tài nguyên **trong trình duyệt**, hiện read-only: package,
   versionName, versionCode, minSdk, targetSdk, ABI từng tệp, cờ `debuggable`/`testOnly`/config
   split, và nhãn icon.
3. Form chỉ còn **ngày phát hành** và **ghi chú**. Không có field version/ABI để sửa.
4. Khi bấm tải lên, dashboard gọi `POST /api/v1/import` cho từng tệp. Tệp đầu tiên mang `appId`
   (ứng dụng đã khớp) hoặc `create=1` + `name` (ứng dụng mới); các tệp sau dùng `appId` máy chủ trả
   về. `version` chỉ được gửi khi APK đã resolve được versionName.

Các kiểm tra chặn tải lên: APK lỗi/không phải APK, ZIP64, config split, các tệp lệch package,
versionCode, versionName hoặc minSdk, và trùng ABI. Dashboard **không** gửi `allow_mismatch`.

**Gắn theo package**

- Trang thư viện: tìm ứng dụng duy nhất có `packageName` trùng APK. Không có thì tạo ứng dụng mới,
  không hỏi; package trùng nhiều ứng dụng là lỗi dữ liệu và bị chặn.
- Trang chi tiết: nếu ứng dụng đã có package thật và khác package APK, upload bị chặn. Ứng dụng cũ
  còn package placeholder (package bằng id) được phép gắn package thật ở lần tải đầu.
- Nếu trình duyệt không đọc được manifest, dashboard vẫn gửi APK để máy chủ quyết định; chỉ phần
  xem trước và icon bị bỏ qua.

**Thay ABI:** nếu phiên bản đích đã có ABI của tệp, dashboard gọi
`GET /apps/:id/versions/:name` và hiện xác nhận inline kèm danh sách ABI sẽ bị thay. ABI mới không
kích hoạt xác nhận.

## Icon APK

- **Raster** (PNG/JPEG/WebP): xem trước đúng bytes trong APK.
- **Adaptive/vector XML**: dựng SVG từ viewport, group transform, path fill/stroke/alpha, màu nền
  adaptive; bỏ qua lớp monochrome; rasterize thành PNG 512×512 bằng canvas.
- Nếu ứng dụng đích đã có icon hiệu lực, form hiện icon APK và icon hiện tại cạnh nhau.
- Sau khi import, dashboard chỉ gọi `PUT /api/v1/apps/:id/icon?if_missing=1` khi ứng dụng **chưa**
  có icon hiệu lực và descriptor là adaptive/vector. Icon raster do máy chủ tự tách từ APK.
- Thiếu `Image`/canvas thì bỏ qua bước ghi icon; upload APK vẫn thành công.

## CLI nhanh

Modal **Lệnh phát hành** sinh lệnh curl (versionName được URL-encode) và các lệnh CLI:

```bash
npx my-testflight-cli@latest login "http://localhost:8080"
npx my-testflight-cli@latest apk inspect app-arm64-v8a.apk --json
npx my-testflight-cli@latest publish app-arm64-v8a.apk --app-id dev.minhtoan.mytestflight
```

`publish` nhận nhiều APK cùng phiên bản; thêm `--create` nếu ứng dụng chưa tồn tại. Xem
`npx my-testflight-cli@latest --help` để biết đầy đủ cờ.

## Trình duyệt

| Trình duyệt | Xem trước APK nén | Icon adaptive/vector |
|---|---|---|
| Chromium / Edge 103+ | Có | Có |
| Firefox 113+ | Có | Có |
| Safari 16.4+ | Có | Có |
| Trình duyệt cũ hơn | Không | Không |

APK lưu `stored` luôn xem trước được vì không cần giải nén. Khi thiếu `DecompressionStream` hoặc
canvas, dashboard báo rõ và vẫn cho tải lên; máy chủ là nơi xác minh cuối cùng.

## Cài đặt kết nối

Màn **Cài đặt** lưu trong `localStorage` của trình duyệt:

| Khóa | Nội dung |
|---|---|
| `mytestflight.dashboard.settings.v1` | `{ baseUrl, token }` |
| `mytestflight.dashboard.theme.v1` | `"light"` hoặc `"dark"` |

- **Base URL** là origin của MyTestflightServer, không gồm `/api/v1`; có thể kèm tiền tố triển khai.
- **Management token** là `management_key` trong `data/config.json` của máy chủ, gửi qua header
  `X-Management-Key` cho thao tác ghi.
- **Kiểm tra kết nối** gọi `/api/v1/health`, rồi thử token bằng `PUT /api/v1/apps/__dashboard_probe__`
  với body rỗng. `400` nghĩa là token được chấp nhận, `401` là bị từ chối; không có dữ liệu nào bị
  thay đổi.
- **Xoá thông tin đã lưu** xoá cả token và Base URL.

## API sử dụng

| Method | Endpoint | Dùng cho |
|---|---|---|
| GET | `/api/v1/health` | Trạng thái máy chủ, độ trễ |
| GET | `/api/v1/apps` | Danh mục ứng dụng |
| GET | `/api/v1/apps/:id/versions[/:name]` | Danh sách quản trị và kiểm tra ABI trước khi thay |
| POST/PUT/DELETE | `/api/v1/apps[/:id]` | Tạo/sửa/xoá ứng dụng |
| POST | `/api/v1/import` | Tải APK; query `appId`, `create`, `name`, `version`, `releaseNotes`, `publishedAt` |
| PUT/DELETE | `/api/v1/apps/:id/icon` | Ghi icon (`?if_missing=1`) hoặc xoá icon |
| POST/PUT/DELETE | `/api/v1/apps/:id/versions[/:name]` | Sửa/xoá metadata phiên bản |
| GET | `/api/v1/apps/:id/versions/:name/download?abi=` | Tải APK trực tiếp |

Upload APK dùng `XMLHttpRequest` để có tiến trình từng tệp; các yêu cầu JSON dùng `fetch`.

## Build và kiểm thử

```bash
npm ci
npm test        # node --test: ZIP, AXML/ARSC, icon SVG, upload-plan
npm run build   # xuất dist/
npm run preview # chạy thử bản build
```

`npm test` chạy trên Node, không cần trình duyệt. Fixture thật trong `test/fixtures/` gồm
`resources.arsc` (172 KB), `res/BW.xml` (adaptive, nền `#ffff4f40`) và `res/Qr.xml` (vector 2 path
trắng), tách từ APK release của workspace. Test còn dùng các bộ dựng ARSC/AXML/ZIP tối giản để phủ
locale mặc định/en/tiếng Việt, density/anydpi, reference, raster/adaptive/vector và các giới hạn.

Kiểm tra thủ công nên làm sau khi đổi UI: thả APK adaptive thật để xem nền coral + mũi tên trắng,
thử tự tạo ứng dụng từ label, thay ABI, chặn package ở trang chi tiết, kiểm tra selection/option ở
light mode và sao chép lệnh npx.

## Cấu trúc

```text
MyTestflightDashboard/
├── .github/workflows/pages.yml   # test trên PR; build + deploy Pages trên main
├── index.html                    # entry Vite, áp theme trước khi paint
├── vite.config.js                # base "./" cho project pages
├── src/
│   ├── apk-archive.js            # ZIP/range/inflate/string pool
│   ├── apk-resources.js          # resources.arsc + binary XML + resolve
│   ├── apk-inspect.js            # metadata APK: package/version/SDK/ABI/icon
│   ├── icon-render.js            # SVG vector/adaptive + rasterize
│   ├── upload-plan.js            # bind package, validate, conflict ABI
│   ├── api.js                    # ApiClient, importApk, lỗi, probe token
│   ├── modals.js                 # upload/icon/app/version/confirm/curl
│   ├── actions.js                # luồng import, icon, settings
│   └── views/                    # list, detail, settings
├── test/                         # fixtures + node --test
└── README.md
```

## GitHub Pages

1. Đẩy repo lên GitHub với nhánh mặc định `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Workflow chạy `npm ci`, `npm test`, `npm run build` trên pull request; chỉ push lên `main` mới
   cấu hình Pages, upload `dist/` và deploy.
4. Cho phép origin Pages trên máy chủ: `CORS_ORIGINS=https://<owner>.github.io`.

`vite.config.js` đặt `base: "./"` nên bản build chạy đúng dưới
`https://<owner>.github.io/<repo>/`. Định tuyến dùng hash (`#/apps`, `#/apps/:id`, `#/settings`),
không cần rewrite.

## Bảo mật và giới hạn

- Token quản trị cho phép sửa ứng dụng, phiên bản và APK. Không dùng dashboard trên máy chia sẻ.
- Token chỉ nằm trong `localStorage` của origin dashboard và chỉ gửi tới Base URL bạn nhập. Không có
  analytics hay dịch vụ thứ ba.
- Đọc APK chạy hoàn toàn trong trình duyệt bằng `Blob.slice()`; không có byte nào rời máy trước khi
  bấm tải lên. Máy chủ vẫn đọc và xác minh lại mọi APK.
- Giới hạn bộ đọc: central directory ≤ 64 MiB, ≤ 200 000 entry, manifest nén ≤ 16 MiB và sau giải
  nén ≤ 8 MiB; ZIP64 bị từ chối. ARSC ≤ 32 MiB nén / 64 MiB giải nén; XML icon ≤ 2 MiB nén / 4 MiB
  giải nén; raster icon ≤ 2 MiB.
- Không có API thống kê volume; thẻ dung lượng tính từ danh mục. Mỗi trình duyệt giữ một cấu hình
  kết nối, chưa hỗ trợ nhiều máy chủ.

## Đóng góp

Repo này là một phần của workspace `MyTestflight` và được dùng nội bộ. Khi sửa dashboard, chạy
`npm ci && npm test && npm run build` trước khi mở pull request. CI trong
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) chạy lại ba bước này trên mọi PR.
