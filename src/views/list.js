import {
  ABI_META,
  ABI_ORDER,
  abiChips,
  appColor,
  draftCount,
  errorMessage,
  esc,
  fmtSize,
  iconInner,
  latestOf,
  published,
  relativeTime,
  totalBytes,
} from "../format.js";
import { svg } from "../icons.js";
import { healthPillHTML } from "../shell.js";

export function mastStatsHTML(state) {
  const loaded = state.catalogLoaded;
  const apps = loaded ? state.catalog.length : null;
  const builds = loaded
    ? state.catalog.reduce((sum, app) => sum + published(app).length, 0)
    : null;
  const bytes = loaded
    ? state.catalog.reduce((sum, app) => sum + totalBytes(app), 0)
    : null;
  const drafts = loaded
    ? state.catalog.reduce((sum, app) => sum + draftCount(app), 0)
    : null;
  return `
    <div class="mstat"><b>${apps ?? "—"}</b><span>ứng dụng nội bộ</span></div>
    <div class="mstat"><b>${builds ?? "—"}</b><span>bản dựng đã phát hành</span></div>
    <div class="mstat"><b>${bytes === null ? "—" : fmtSize(bytes)}</b><span>APK trên máy chủ</span></div>
    <div class="mstat"><b>${drafts ?? "—"}</b><span>bản nháp đang chờ</span></div>`;
}

export function listPageHTML(state) {
  const ui = state.ui;
  return `
  <header class="mast">
    <div class="mnav">
      <div class="mword"><b>My TestFlight</b><span>Quản trị nội bộ</span></div>
      <div class="sp"></div>
      <span class="mhealth" data-health>${healthPillHTML(state)}</span>
    </div>
    <div class="mhero">
      <div>
        <div class="kick">Thư viện phát hành nội bộ</div>
        <h1>Mọi bản dựng,<br><em>một kệ.</em></h1>
        <p>Đẩy bản dựng mới, đổi icon, và nhìn thấy ngay mỗi phiên bản đang phục vụ những kiến trúc nào.</p>
      </div>
      <div class="mstats" id="mastStats">${mastStatsHTML(state)}</div>
    </div>
  </header>
  <main class="msheet">
    <div class="toolbar2">
      <label class="gsearch2">${svg("search", 16)}<input id="listSearch" type="search" placeholder="Tìm tên, package, nhà phát triển" autocomplete="off" value="${esc(ui.listQuery)}"><kbd>/</kbd></label>
      <select id="sortSel" class="tool-select" aria-label="Sắp xếp">
        <option value="recent">Mới cập nhật</option>
        <option value="name">Tên A–Z</option>
        <option value="versions">Nhiều bản dựng</option>
      </select>
      <button class="btn btn-ghost" data-act="newApp">${svg("plus", 15)} Tạo ứng dụng</button>
      <button class="btn btn-primary" data-act="upload">${svg("upload", 15)} Tải APK lên</button>
    </div>
    <div class="filters2">
      <span class="fl">Trạng thái</span>
      <div class="chips" style="margin:0" id="statusChips">
        <button class="chip" data-act="listFilter" data-val="all">Tất cả</button>
        <button class="chip" data-act="listFilter" data-val="built">Có bản dựng</button>
        <button class="chip" data-act="listFilter" data-val="draft">Có bản nháp</button>
        <button class="chip" data-act="listFilter" data-val="empty">Chưa có</button>
      </div>
      <span class="fl" style="margin-left:8px">Kiến trúc</span>
      <select id="abiSel" class="tool-select" aria-label="Lọc theo kiến trúc">
        <option value="all">Mọi ABI</option>
        ${ABI_ORDER.map((abi) => `<option value="${abi}">${ABI_META[abi].label}</option>`).join("")}
      </select>
    </div>
    <div class="gridhead"><h2>Thư viện</h2><span class="cnt" id="listCount"></span></div>
    <div class="libgrid" id="listBody"></div>
  </main>`;
}

export function filteredApps(state) {
  const query = state.ui.listQuery.trim().toLowerCase();
  let apps = state.catalog.filter((app) => {
    if (
      query &&
      !`${app.name} ${app.packageName} ${app.developer} ${app.id}`.toLowerCase().includes(query)
    ) {
      return false;
    }
    if (state.ui.listFilter === "built" && published(app).length === 0) return false;
    if (state.ui.listFilter === "draft" && draftCount(app) === 0) return false;
    if (state.ui.listFilter === "empty" && app.versions.length > 0) return false;
    if (state.ui.listAbi !== "all") {
      const latest = latestOf(app);
      if (!latest || !latest.artifacts.some((artifact) => artifact.abi === state.ui.listAbi)) {
        return false;
      }
    }
    return true;
  });

  if (state.ui.sort === "name") {
    apps = apps.slice().sort((left, right) => left.name.localeCompare(right.name, "vi"));
  } else if (state.ui.sort === "versions") {
    apps = apps.slice().sort((left, right) => right.versions.length - left.versions.length);
  } else {
    apps = apps.slice().sort((left, right) => {
      const leftTime = latestOf(left)?.publishedAt || "";
      const rightTime = latestOf(right)?.publishedAt || "";
      return String(rightTime).localeCompare(String(leftTime));
    });
  }
  return apps;
}

function cardHTML(app) {
  const latest = latestOf(app);
  const builds = published(app).length;
  const drafts = draftCount(app);
  const chips = latest
    ? abiChips(latest.artifacts)
    : drafts
      ? `<span class="abi draft">${drafts} bản nháp</span>`
      : `<span class="abi draft">Chưa có APK</span>`;
  const updated = latest
    ? relativeTime(latest.publishedAt)
    : drafts
      ? "bản nháp"
      : "chưa có";
  return `
  <article class="appcard" data-act="openApp" data-id="${esc(app.id)}" role="button" tabindex="0" aria-label="Mở ${esc(app.name)}">
    <div class="cardtop">
      <button class="icon-tile" style="background:${appColor(app.id)}" data-act="icon" data-id="${esc(app.id)}" title="Đổi icon" aria-label="Đổi icon ${esc(app.name)}">${iconInner(app)}<span class="ic-edit">${svg("edit", 9)}</span></button>
      <span class="updated">${esc(updated)}</span>
    </div>
    <h3>${esc(app.name)}</h3>
    <div class="pk">${esc(app.packageName)}</div>
    <div class="verline">${latest ? `<b>v${esc(latest.name)}</b><span>${builds} bản dựng</span>` : `<b>—</b><span>${drafts ? `${drafts} bản nháp` : "chưa có bản dựng"}</span>`}</div>
    <div class="chips" style="margin-top:9px">${chips}</div>
    <div class="cardfoot"><span>${fmtSize(totalBytes(app))}</span><span class="open">Mở kệ</span></div>
  </article>`;
}

function addCardHTML() {
  return `
  <button class="appcard empty" data-act="newApp">
    <span class="plus">${svg("plus", 20)}</span>
    <h3>Thêm ứng dụng</h3>
    <p>Tạo app mới rồi đẩy APK đầu tiên lên.</p>
  </button>`;
}

function stateCard({ icon = "info", title, message, actions = "" }) {
  return `
  <div class="statecard">
    <div class="ic">${svg(icon, 22)}</div>
    <div class="t">${esc(title)}</div>
    <p>${message}</p>
    ${actions ? `<div class="acts">${actions}</div>` : ""}
  </div>`;
}

function skeletonHTML() {
  const card = `
    <div class="skel">
      <span class="blk tile"></span>
      <span class="blk w70"></span>
      <span class="blk w45"></span>
      <span class="blk w30"></span>
      <span class="blk w45"></span>
    </div>`;
  return `<div class="skel-wrap">${card.repeat(4)}</div>`;
}

function inlineBanner(message, action = "") {
  return `
  <div class="inline-banner">
    ${svg("alert", 16)}
    <span>${esc(message)}</span>
    <span class="sp"></span>
    ${action}
  </div>`;
}

export function renderListResults(state) {
  const body = document.getElementById("listBody");
  if (!body) return;

  const stats = document.getElementById("mastStats");
  if (stats) stats.innerHTML = mastStatsHTML(state);

  const chips = document.querySelectorAll("#statusChips [data-val]");
  chips.forEach((chip) => chip.classList.toggle("on", chip.dataset.val === state.ui.listFilter));
  const sort = document.getElementById("sortSel");
  if (sort) sort.value = state.ui.sort;
  const abi = document.getElementById("abiSel");
  if (abi) abi.value = state.ui.listAbi;

  const count = document.getElementById("listCount");
  if (state.loading && !state.catalog.length) {
    if (count) count.textContent = "đang tải…";
    body.innerHTML = skeletonHTML();
    return;
  }

  if (state.error && !state.catalog.length) {
    if (count) count.textContent = "0 mục";
    body.innerHTML = stateCard({
      icon: "server",
      title: "Không đọc được danh mục",
      message: `<b>${esc(errorMessage(state.error))}</b><br>Kiểm tra Base URL trong Cài đặt, mạng nội bộ và <span class="mono">CORS_ORIGINS</span> trên máy chủ.`,
      actions: `
        <button class="btn btn-primary" data-act="retryLoad">${svg("refresh", 14)} Thử lại</button>
        <button class="btn btn-ghost" data-nav="settings">${svg("settings", 14)} Mở cài đặt</button>`,
    });
    return;
  }

  if (state.catalogLoaded && !state.catalog.length) {
    if (count) count.textContent = "0 mục";
    body.innerHTML = stateCard({
      icon: "box",
      title: "Chưa có ứng dụng nào",
      message: "Tạo ứng dụng trước, rồi đẩy APK đầu tiên lên máy chủ.",
      actions: `<button class="btn btn-primary" data-act="newApp">${svg("plus", 14)} Tạo ứng dụng</button>`,
    });
    return;
  }

  const apps = filteredApps(state);
  if (count) count.textContent = `${apps.length} mục`;

  const notices = [];
  if (state.degraded) {
    notices.push(
      inlineBanner(
        "Một số ứng dụng chỉ hiển thị bản đã phát hành vì không đọc được danh sách quản trị.",
        `<button class="mini ghost" data-act="retryLoad">Thử lại</button>`,
      ),
    );
  }
  if (state.error) {
    notices.push(
      inlineBanner(errorMessage(state.error), `<button class="mini ghost" data-act="retryLoad">Thử lại</button>`),
    );
  }

  const hasQuery = state.ui.listQuery.trim().length > 0;
  const isAll = state.ui.listFilter === "all" && state.ui.listAbi === "all";

  if (!apps.length) {
    body.innerHTML =
      notices.join("") +
      stateCard({
        icon: "search",
        title: hasQuery ? "Không tìm thấy ứng dụng" : "Không có mục nào khớp",
        message: hasQuery
          ? `Không có mục nào khớp “${esc(state.ui.listQuery)}”.`
          : "Thử bỏ bộ lọc trạng thái hoặc kiến trúc.",
        actions: `<button class="btn btn-primary" data-act="clearList">${svg("refresh", 14)} Xoá bộ lọc</button>`,
      });
    return;
  }

  const add = !hasQuery && isAll ? addCardHTML() : "";
  body.innerHTML = notices.join("") + apps.map(cardHTML).join("") + add;
}
