import { svg } from "./icons.js";

export function healthPillHTML(state) {
  const health = state.health || {};
  if (health.status === "ok") {
    return `<i class="ok"></i>Máy chủ ổn định, ${health.latency ?? "—"} ms`;
  }
  if (health.status === "down") {
    return `<i class="down"></i>Mất kết nối máy chủ`;
  }
  if (health.status === "unconfigured") {
    return `<i class="idle"></i>Chưa cấu hình máy chủ`;
  }
  return `<i class="idle"></i>Đang kiểm tra máy chủ…`;
}

export function healthShort(state) {
  if (state.health?.status === "ok") return "Ổn định";
  if (state.health?.status === "down") return "Mất kết nối";
  if (state.health?.status === "unconfigured") return "Chưa cấu hình";
  return "Đang kiểm tra";
}

export function updateHealthDOM(state) {
  document.querySelectorAll("[data-health]").forEach((pill) => {
    pill.innerHTML = healthPillHTML(state);
  });
  document.querySelectorAll("[data-health-card]").forEach((label) => {
    label.textContent = healthShort(state);
    label.style.color =
      state.health?.status === "ok"
        ? "var(--ok-ink)"
        : state.health?.status === "down"
          ? "var(--danger)"
          : "var(--mute)";
  });
}

export function shellHTML() {
  return `
  <div class="shell">
    <aside class="rail" aria-label="Điều hướng quản trị">
      <div class="logo" title="My TestFlight">T</div>
      <nav>
        <button class="on" data-nav="apps" title="Ứng dụng" aria-label="Ứng dụng">${svg("grid", 20)}</button>
        <button data-soon="Phiên bản" title="Phiên bản" aria-label="Phiên bản">${svg("box", 20)}</button>
        <button data-soon="Hoạt động" title="Hoạt động" aria-label="Hoạt động">${svg("pulse", 20)}</button>
        <button data-soon="Máy chủ" title="Máy chủ" aria-label="Máy chủ">${svg("server", 20)}</button>
      </nav>
      <div class="sp"></div>
      <button class="theme-btn" data-act="toggleTheme" title="Chuyển sang tối" aria-label="Chuyển sang tối" aria-pressed="false">${svg("moon", 20)}</button>
      <button data-nav="settings" title="Cài đặt" aria-label="Cài đặt">${svg("settings", 20)}</button>
      <div class="avatar" title="Người quản trị">NT</div>
    </aside>
    <div class="site">
      <div id="page"></div>
    </div>
  </div>
  <div id="modalRoot"></div>
  <div id="toastRoot"></div>`;
}

export function updateRail(state) {
  const activeNav =
    state.route?.name === "settings"
      ? "settings"
      : state.route?.name === "detail"
        ? "apps"
        : "apps";
  document.querySelectorAll(".rail [data-nav]").forEach((button) => {
    button.classList.toggle("on", button.dataset.nav === activeNav);
  });
  const themeButton = document.querySelector(".rail .theme-btn");
  if (themeButton) {
    const dark = state.theme === "dark";
    themeButton.innerHTML = svg(dark ? "sun" : "moon", 20);
    themeButton.title = dark ? "Chuyển sang sáng" : "Chuyển sang tối";
    themeButton.setAttribute("aria-label", themeButton.title);
    themeButton.setAttribute("aria-pressed", dark ? "true" : "false");
  }
}

export function updateThemeControls(state) {
  const dark = state.theme === "dark";
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("on", button.dataset.themeChoice === (dark ? "dark" : "light"));
  });
  const themeButton = document.querySelector(".rail .theme-btn");
  if (themeButton) {
    themeButton.innerHTML = svg(dark ? "sun" : "moon", 20);
    themeButton.title = dark ? "Chuyển sang sáng" : "Chuyển sang tối";
    themeButton.setAttribute("aria-label", themeButton.title);
    themeButton.setAttribute("aria-pressed", dark ? "true" : "false");
  }
}
