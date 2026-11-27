import {
  ABI_META,
  MX_ABIS,
  abiChip,
  abiMeta,
  apkCount,
  defaultArtifact,
  draftCount,
  errorMessage,
  esc,
  fmtDate,
  fmtSize,
  iconInner,
  latestOf,
  published,
  shortSha,
  sortedVersions,
  totalBytes,
} from "../format.js";
import { svg } from "../icons.js";

function missingPage(state, title, message) {
  return `
  <section class="detailview page-detail">
    <div class="detail" style="height:100vh">
      <div class="dwrap">
        <button class="dback" data-act="backList" style="color:var(--coral-deep);background:var(--surface)">${svg("back", 14)} Thư viện</button>
        <div class="statecard" style="min-height:320px;margin-top:18px">
          <div class="ic">${svg("server", 22)}</div>
          <div class="t">${esc(title)}</div>
          <p>${message}</p>
          <div class="acts">
            <button class="btn btn-primary" data-act="retryLoad">${svg("refresh", 14)} Thử lại</button>
            <button class="btn btn-ghost" data-nav="settings">${svg("settings", 14)} Mở cài đặt</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function detailPageHTML(state, app) {
  if (!app) {
    if (state.loading) {
      return missingPage(
        state,
        "Đang tải ứng dụng",
        "Đang đọc danh mục và lịch sử phiên bản từ máy chủ.",
      );
    }
    if (state.error) {
      return missingPage(
        state,
        "Không đọc được ứng dụng",
        `<b>${esc(errorMessage(state.error))}</b><br>Kiểm tra kết nối rồi thử lại.`,
      );
    }
    return missingPage(
      state,
      "Không tìm thấy ứng dụng",
      `Không có ứng dụng với id <span class="mono">${esc(state.route.id || "")}</span> trong danh mục.`,
    );
  }

  const latest = latestOf(app);
  const builds = published(app).length;
  const drafts = draftCount(app);
  const bytes = totalBytes(app);
  const apks = apkCount(app);
  const abiCount = latest ? latest.artifacts.length : 0;

  const allDrafts = state.catalog.reduce((sum, item) => sum + draftCount(item), 0);

  const catalogBytes = state.catalog.reduce((sum, item) => sum + totalBytes(item), 0);
  const share = catalogBytes > 0 ? Math.round((bytes / catalogBytes) * 100) : 0;
  const average = apks > 0 ? bytes / apks : 0;

  return `
  <section class="detailview page-detail">
    <header class="dhero" style="--tint:${app.color}">
      <div class="dnav">
        <button class="dback" data-act="backList">${svg("back", 14)} Thư viện</button>
        <span class="dev">${esc(app.developer || "Nội bộ")}, nội bộ</span>
        <div class="dacts">
          <button class="dib" data-act="curl" data-id="${esc(app.id)}" title="Lệnh phát hành">${svg("copy", 15)}</button>
          <button class="dib" data-act="editApp" data-id="${esc(app.id)}" title="Sửa thông tin">${svg("edit", 15)}</button>
          <button class="dib" data-act="askDeleteApp" data-id="${esc(app.id)}" title="Xoá ứng dụng">${svg("trash", 15)}</button>
        </div>
      </div>
      <div class="dident">
        <button class="icon-tile" style="background:${app.color}" data-act="icon" data-id="${esc(app.id)}" title="Bấm để đổi icon">${iconInner(app)}</button>
        <div>
          <h1>${esc(app.name)}</h1>
          <div class="pk">${esc(app.packageName)}</div>
          <div class="tags">
            ${latest ? `<span class="tag hot">v${esc(latest.name)}, mới nhất</span>` : `<span class="tag">Chưa có bản dựng</span>`}
            <span class="tag">${builds} bản dựng</span>
            ${drafts ? `<span class="tag draft">${drafts} bản nháp</span>` : ""}
            ${latest ? `<span class="tag">${abiCount} kiến trúc</span>` : ""}
          </div>
        </div>
      </div>
    </header>
    <div class="dsheet">
      <p class="adesc">${esc(app.description || "Chưa có mô tả.")}</p>
      <div class="dstats">
        <div class="dstat"><div class="k">Phiên bản</div><b>${app.versions.length}</b><span>${drafts ? `${drafts} bản nháp` : "không có nháp"}</span></div>
        <div class="dstat"><div class="k">Bản mới nhất</div><b>${latest ? `v${esc(latest.name)}` : "—"}</b><span>${latest ? fmtDate(latest.publishedAt) : "chưa phát hành"}</span></div>
        <div class="dstat"><div class="k">Dung lượng</div><b>${fmtSize(bytes)}</b><span>${apks} APK trên máy chủ</span></div>
        <div class="dstat"><div class="k">Kiến trúc</div><b>${abiCount}</b><span>ABI ở bản mới nhất</span></div>
      </div>

      <section class="panel archpanel">
        <div class="phead">
          <div class="ptop"><h3>Kiến trúc trong các phiên bản</h3><span class="sub" id="matrixSub">${apks} APK</span></div>
        </div>
        <div class="shelves" id="matrix"></div>
      </section>

      <div class="bodygrid">
        <section class="panel">
          <div class="phead">
            <div class="ptop"><h3>Lịch sử phiên bản</h3><span class="sub" id="vsub">${app.versions.length} mục</span></div>
            <div class="ptools">
              <div class="vsearch">${svg("search", 13)}<input id="vSearch" placeholder="Tìm phiên bản, versionCode, ghi chú" value="${esc(state.ui.vQuery)}" autocomplete="off"></div>
              <div class="chips" style="margin:0" id="vStatus">
                <button class="chip" data-act="vFilter" data-val="all">Tất cả</button>
                <button class="chip" data-act="vFilter" data-val="published">Đã phát hành</button>
                <button class="chip" data-act="vFilter" data-val="draft">Bản nháp</button>
              </div>
            </div>
            <div class="chips" style="margin-top:6px" id="vAbiChips">
              <span style="font-size:12px;font-weight:800;color:var(--mute);display:inline-flex;align-items:center;margin-right:2px">Kiến trúc</span>
              <button class="chip" data-act="vAbi" data-val="all">Tất cả</button>
              ${MX_ABIS.map((abi) => `<button class="chip ab" data-act="vAbi" data-val="${abi}">${ABI_META[abi].label}</button>`).join("")}
            </div>
          </div>
          <div class="vlist" id="versionList"></div>
        </section>

        <aside class="side">
          <section class="panel sidecard">
            <div class="k">Độ phủ kiến trúc</div>
            <h4>${builds} bản dựng đã phát hành</h4>
            <div class="coverage" id="coverage"></div>
          </section>
          <section class="panel sidecard">
            <div class="k">Dung lượng APK</div>
            <div class="healthrow"><span class="big">${fmtSize(bytes)}</span><span class="ok">${share}% danh mục</span></div>
            <div class="meter u"><i style="width:${Math.max(2, Math.min(100, share))}%"></i></div>
            <div style="margin-top:9px">
              <div class="kv"><span>APK</span><b>${apks} tệp</b></div>
              <div class="kv"><span>Phiên bản</span><b>${app.versions.length}</b></div>
              <div class="kv"><span>Trung bình / APK</span><b>${apks ? fmtSize(average) : "—"}</b></div>
            </div>
          </section>
          <section class="panel sidecard">
            <div class="k">Trạng thái phát hành</div>
            <h4>${allDrafts ? `${allDrafts} bản nháp đang chờ` : "Không có bản nháp"}</h4>
            <div class="kv" style="margin-top:8px"><span>Máy chủ</span><b data-health-card>Đang kiểm tra</b></div>
            <div class="kv"><span>Kiểm tra SHA-256</span><b>Bật khi có</b></div>
          </section>
        </aside>
      </div>
    </div>
  </section>`;
}

function versionArtifactsHTML(version, state) {
  const def = defaultArtifact(version);
  const sum = version.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
  const rows = version.artifacts
    .map((artifact) => {
      const href = artifact.downloadPath ? state.api.url(artifact.downloadPath) : "#";
      return `
      <div class="art">
        ${abiChip(artifact.abi)}
        <span class="sz">${fmtSize(artifact.sizeBytes)}</span>
        ${artifact === def && version.artifacts.length > 1 ? `<span class="def">mặc định</span>` : ""}
        <span class="sha">sha ${esc(shortSha(artifact.sha256))}</span>
        <a class="dl" href="${esc(href)}" download rel="noopener" title="Tải APK ${esc(artifact.abi)}">${svg("download", 14)}</a>
      </div>`;
    })
    .join("");
  return { rows, sum };
}

export function renderVersionList(state, app) {
  const list = document.getElementById("versionList");
  if (!list) return;

  const query = state.ui.vQuery.trim().toLowerCase();
  const versions = sortedVersions(app.versions).filter((version) => {
    if (
      query &&
      !`${version.name} ${version.code} ${version.minSdk ?? ""} ${version.notes}`
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (state.ui.vFilter === "published" && version.artifacts.length === 0) return false;
    if (state.ui.vFilter === "draft" && version.artifacts.length > 0) return false;
    if (
      state.ui.vAbi !== "all" &&
      !version.artifacts.some((artifact) => artifact.abi === state.ui.vAbi)
    ) {
      return false;
    }
    return true;
  });

  const subtitle = document.getElementById("vsub");
  if (subtitle) subtitle.textContent = `${versions.length} mục`;
  document
    .querySelectorAll("#vStatus [data-val]")
    .forEach((chip) => chip.classList.toggle("on", chip.dataset.val === state.ui.vFilter));
  document
    .querySelectorAll("#vAbiChips [data-val]")
    .forEach((chip) => chip.classList.toggle("on", chip.dataset.val === state.ui.vAbi));

  if (!versions.length) {
    list.innerHTML = `<div class="vempty"><b>Không có phiên bản nào khớp</b>Thử bỏ bộ lọc kiến trúc hoặc từ khoá tìm kiếm.</div>`;
    return;
  }

  const latest = latestOf(app);
  list.innerHTML = versions
    .map((version) => {
      const isDraft = version.artifacts.length === 0;
      const isLatest = latest && version.name === latest.name;
      const { rows, sum } = versionArtifactsHTML(version, state);
      const notes = version.notes || "Không có ghi chú.";
      const meta = `code ${version.code}, minSdk ${version.minSdk ?? "—"}, ${fmtDate(version.publishedAt)}`;
      const edit = `<button class="mini ghost" data-act="editVersion" data-id="${esc(app.id)}" data-version="${esc(version.name)}" title="Sửa metadata">${svg("edit", 12)} Sửa</button>`;
      return `
      <article class="ver ${isLatest ? "latest" : ""} ${isDraft ? "draft" : ""}">
        <div class="vtop">
          <span class="vname">v${esc(version.name)}</span>
          ${isLatest ? `<span class="badge l">Mới nhất</span>` : ""}
          ${isDraft ? `<span class="badge d">Bản nháp</span>` : ""}
          <span class="vmeta">${esc(meta)}</span>
        </div>
        <p class="vnote">${esc(notes)}</p>
        ${
          isDraft
            ? `<div class="draftzone">
                 <div class="dz"><b>Chưa có APK.</b></div>
                 <button class="mini navy" data-act="upload" data-app="${esc(app.id)}">${svg("upload", 12)} Đẩy APK lên</button>
               </div>
               <div class="vfoot">
                 <span class="lbl">code ${version.code}, minSdk ${version.minSdk ?? "—"}</span>
                 <span class="sp"></span>
                 ${edit}
                 <button class="mini danger" data-act="askDeleteVersion" data-id="${esc(app.id)}" data-version="${esc(version.name)}">${svg("trash", 12)} Xoá bản nháp</button>
               </div>`
            : `<div class="arts">${rows}</div>
               <div class="vfoot">
                 <span class="lbl">${version.artifacts.length} kiến trúc, ${fmtSize(sum)}</span>
                 <span class="sp"></span>
                 ${edit}
                 <button class="mini ghost" data-act="curl" data-id="${esc(app.id)}" data-version="${esc(version.name)}">${svg("copy", 12)} Lệnh phát hành</button>
                 <button class="mini danger" data-act="askDeleteVersion" data-id="${esc(app.id)}" data-version="${esc(version.name)}">${svg("trash", 12)} Xoá</button>
               </div>`
        }
      </article>`;
    })
    .join("");
}

export function renderMatrix(state, app) {
  const matrix = document.getElementById("matrix");
  if (!matrix) return;

  const versions = sortedVersions(app.versions);
  const latest = latestOf(app);
  const rows = versions
    .map((version) => {
      const isDraft = version.artifacts.length === 0;
      const def = defaultArtifact(version);
      const sum = version.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
      const artifacts = version.artifacts
        .slice()
        .sort((left, right) => right.sizeBytes - left.sizeBytes);
      const lanes = isDraft
        ? `<div class="lane na"><span class="ln">Chưa có APK</span><span class="lv">Bản nháp</span></div>`
        : artifacts
            .map((artifact) => {
              const meta = abiMeta(artifact.abi);
              const cls = artifact.abi === "universal" ? "u" : meta.cls;
              const isDefault = artifact === def && artifacts.length > 1;
              return `<div class="lane ${cls} ${isDefault ? "def" : ""}" style="flex:${Math.max(1, artifact.sizeBytes / (1024 * 1024))} 1 0" title="${esc(meta.short)} ${fmtSize(artifact.sizeBytes)}"><span class="ln">${esc(meta.short)}</span><span class="lv">${fmtSize(artifact.sizeBytes).replace(" MB", "")}</span></div>`;
            })
            .join("");
      return `<div class="shelf">
        <div class="shelfhead">
          <b>v${esc(version.name)}</b>
          ${latest && version.name === latest.name ? `<span class="badge l">Mới nhất</span>` : ""}
          ${isDraft ? `<span class="badge d">Bản nháp</span>` : ""}
          <span class="sm">${isDraft ? "chưa có APK" : `${version.artifacts.length} kiến trúc, ${fmtSize(sum)}`}</span>
        </div>
        <div class="lanes">${lanes}</div>
      </div>`;
    })
    .join("");

  matrix.innerHTML =
    rows || `<div class="vempty"><b>Chưa có phiên bản</b>Đẩy APK đầu tiên để dựng kệ kiến trúc.</div>`;

  const sub = document.getElementById("matrixSub");
  if (sub) sub.textContent = `${apkCount(app)} APK`;

  const coverage = document.getElementById("coverage");
  if (!coverage) return;
  const publishedCount = published(app).length;
  coverage.innerHTML = MX_ABIS.map((abi) => {
    const count = app.versions.filter((version) =>
      version.artifacts.some((artifact) => artifact.abi === abi),
    ).length;
    const percent = publishedCount ? Math.round((count / publishedCount) * 100) : 0;
    return `<div class="cov"><span class="nm">${ABI_META[abi].label}</span><span class="ct">${count}/${publishedCount}</span>
      <div class="bar ${abi === "universal" ? "u" : ""}"><i style="width:${percent}%"></i></div></div>`;
  }).join("");
}
