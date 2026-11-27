import { hasToken, maskToken, SETTINGS_KEY } from "../settings.js";
import { esc } from "../format.js";
import { svg } from "../icons.js";
import { healthPillHTML, healthShort } from "../shell.js";

function draftValues(state) {
  return state.ui.settingsDraft || state.settings;
}

export function settingsPageHTML(state) {
  const values = draftValues(state);
  const token = String(values?.token ?? "");
  const baseUrl = String(values?.baseUrl ?? "");
  const showToken = Boolean(state.ui.showToken);
  const tokenSaved = hasToken(state.settings);
  const appCount = state.catalogLoaded ? String(state.catalog.length) : "—";
  const theme = state.theme === "dark" ? "Tối" : "Sáng";

  return `
  <header class="mast">
    <div class="mnav">
      <div class="mword"><b>My TestFlight</b><span>Quản trị nội bộ</span></div>
      <div class="sp"></div>
      <span class="mhealth" data-health>${healthPillHTML(state)}</span>
    </div>
    <div class="mhero">
      <div>
        <div class="kick">Cấu hình kết nối</div>
        <h1>Nói chuyện với<br><em>máy chủ của bạn.</em></h1>
      </div>
      <div class="mstats">
        <div class="mstat"><b id="setStatToken">${tokenSaved ? "Đã lưu" : "Chưa có"}</b><span>token trong trình duyệt</span></div>
        <div class="mstat"><b data-health-stat>${healthShort(state)}</b><span>trạng thái máy chủ</span></div>
        <div class="mstat"><b id="setStatApps">${appCount}</b><span>ứng dụng đọc được</span></div>
        <div class="mstat"><b id="setStatTheme">${theme}</b><span>giao diện</span></div>
      </div>
    </div>
  </header>
  <main class="msheet settings-sheet">
    <div class="settings-grid">
      <section class="panel settings-panel">
        <div class="phead">
          <div class="ptop"><h3>Kết nối máy chủ</h3><span class="sub">Bắt buộc để vào thư viện</span></div>
        </div>
        <form id="settingsForm" class="settings-form" novalidate>
          ${state.authError ? `<div class="auth-banner">${svg("alert", 16)} <span>${esc(state.authError)}</span></div>` : ""}
          <div class="field">
            <label for="setBaseUrl">Base URL</label>
            <input id="setBaseUrl" name="baseUrl" type="url" inputmode="url" spellcheck="false"
              placeholder="http://192.168.1.10:8080" value="${esc(baseUrl)}" autocomplete="url">
            <div class="hint">Origin của MyTestflightServer, không gồm <span class="mono">/api/v1</span>. Có thể kèm tiền tố triển khai.</div>
          </div>
          <div class="field">
            <label for="setToken">Management token</label>
            <div class="token-row">
              <input id="setToken" name="token" type="${showToken ? "text" : "password"}" spellcheck="false" autocomplete="off" autocapitalize="off"
                placeholder="management_key trong data/config.json" value="${esc(token)}">
              <button type="button" class="icon-btn" data-act="toggleToken" title="${showToken ? "Ẩn token" : "Hiện token"}" aria-label="${showToken ? "Ẩn token" : "Hiện token"}">${svg(showToken ? "eyeOff" : "eye", 18)}</button>
            </div>
            <div class="hint">Gửi trong header <span class="mono">X-Management-Key</span> cho thao tác ghi. Đọc danh mục không cần token.</div>
          </div>
          <div class="field">
            <label>Giao diện</label>
            <div class="theme-seg" role="group" aria-label="Giao diện">
              <button type="button" class="seg-btn ${state.theme === "dark" ? "" : "on"}" data-theme-choice="light">${svg("sun", 14)} Sáng</button>
              <button type="button" class="seg-btn ${state.theme === "dark" ? "on" : ""}" data-theme-choice="dark">${svg("moon", 14)} Tối</button>
            </div>
          </div>
          <div id="settingsStatus" class="conn-status" role="status" aria-live="polite"></div>
          <div class="settings-actions">
            <button type="button" class="btn btn-ghost" data-act="testConnection">${svg("pulse", 15)} Kiểm tra kết nối</button>
            <button type="submit" class="btn btn-primary">${svg("check", 15)} Lưu và mở thư viện</button>
          </div>
        </form>
      </section>

      <aside class="settings-side">
        <section class="panel sidecard">
          <div class="k">Lưu ở đâu</div>
          <h4>Chỉ trong trình duyệt này</h4>
          <div class="kv"><span>Khóa lưu</span><b title="${esc(SETTINGS_KEY)}">localStorage</b></div>
          <div class="kv"><span>Token</span><b class="mono-ellipsis">${esc(maskToken(state.settings.token))}</b></div>
          <div class="kv"><span>Phiên bản</span><b>1.0</b></div>
        </section>
        <section class="panel sidecard">
          <div class="k">HTTPS &amp; CORS</div>
          <h4>Để trình duyệt gọi được API</h4>
          <p>Máy chủ cần cho phép origin này qua <span class="mono">CORS_ORIGINS</span>.</p>
        </section>
        <section class="panel sidecard">
          <div class="k">Bảo mật</div>
          <button type="button" class="mini danger" data-act="clearSettings" ${state.settings.token || state.catalogLoaded ? "" : "disabled"}>${svg("trash", 12)} Xoá thông tin đã lưu</button>
        </section>
      </aside>
    </div>
  </main>`;
}

export function renderSettingsStats(state) {
  const token = document.getElementById("setStatToken");
  if (token) token.textContent = hasToken(state.settings) ? "Đã lưu" : "Chưa có";
  const apps = document.getElementById("setStatApps");
  if (apps) apps.textContent = state.catalogLoaded ? String(state.catalog.length) : "—";
  const theme = document.getElementById("setStatTheme");
  if (theme) theme.textContent = state.theme === "dark" ? "Tối" : "Sáng";
  document.querySelectorAll("[data-health-stat]").forEach((element) => {
    element.textContent = healthShort(state);
  });
}
