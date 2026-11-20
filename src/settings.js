export const SETTINGS_KEY = "mytestflight.dashboard.settings.v1";
export const THEME_KEY = "mytestflight.dashboard.theme.v1";
export const DEFAULT_BASE_URL = "http://localhost:8080";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const fallback = { baseUrl: DEFAULT_BASE_URL, token: "" };
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed?.baseUrl === "string" ? parsed.baseUrl : DEFAULT_BASE_URL,
      token: typeof parsed?.token === "string" ? parsed.token : "",
    };
  } catch {
    return fallback;
  }
}

export function saveSettings({ baseUrl, token }) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(
      SETTINGS_KEY,
      JSON.stringify({ baseUrl: String(baseUrl ?? ""), token: String(token ?? "") }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSettings() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(SETTINGS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadTheme() {
  const store = storage();
  if (!store) return "light";
  try {
    return store.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(theme) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(THEME_KEY, theme === "dark" ? "dark" : "light");
    return true;
  } catch {
    return false;
  }
}

export function hasToken(settings) {
  return typeof settings?.token === "string" && settings.token.trim().length > 0;
}

/**
 * Accepts an origin, optionally with a deployment path prefix. Rejects
 * credentials, queries, hashes and non-http(s) schemes. A trailing `/api/v1`
 * is removed so users can paste the API root by mistake without breaking it.
 */
export function normalizeBaseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Nhập địa chỉ máy chủ.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Địa chỉ không hợp lệ. Ví dụ: http://192.168.1.10:8080");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Chỉ hỗ trợ địa chỉ http:// hoặc https://.");
  }
  if (url.username || url.password) {
    throw new Error("Không nhúng tên đăng nhập hoặc mật khẩu vào địa chỉ.");
  }
  if (url.search || url.hash) {
    throw new Error("Bỏ query string và dấu # khỏi địa chỉ máy chủ.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/api\/v1$/, "");
  path = path.replace(/\/+$/, "");
  return url.origin + path;
}

export function maskToken(token) {
  const value = String(token ?? "");
  if (!value) return "chưa có";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
