import { state, makeApi } from "./store.js";
import { ApiError } from "./api.js";
import {
  DEFAULT_BASE_URL,
  SETTINGS_KEY,
  THEME_KEY,
  clearStoredSettings,
  hasToken,
  loadSettings,
  loadTheme,
  normalizeBaseUrl,
  saveSettings,
  saveTheme,
} from "./settings.js";
import { ID_PATTERN, errorMessage, esc, isoFromDateInput } from "./format.js";
import { svg } from "./icons.js";
import { findApp } from "./model.js";
import {
  checkHealth,
  refreshCatalog,
  renderCurrent,
  renderModal,
  toast,
} from "./render.js";
import { go, handleRoute } from "./router.js";
import {
  addFilesToUpload,
  closeModal,
  curlCode,
  openAppForm,
  openConfirm,
  openCurl,
  openIcon,
  openUpload,
  openVersionForm,
  removeUploadFile,
  updateIconPreview,
  updateUploadProgressDOM,
} from "./modals.js";
import {
  buildUploadPlan,
  computeVersionConflicts,
  effectiveVersionName,
} from "./upload-plan.js";
import { renderSettingsStats } from "./views/settings.js";
import { renderListResults } from "./views/list.js";
import { renderVersionList } from "./views/detail.js";
import { updateThemeControls } from "./shell.js";

/* --------------------------------------------------------------- helpers */

function rerenderModal() {
  renderModal();
}

function syncUploadForm(upload) {
  const date = document.getElementById("upDate");
  if (date) upload.date = date.value;
  const notes = document.getElementById("upNotes");
  if (notes) upload.notes = notes.value;
}

function setConnStatus(kind, message) {
  const element = document.getElementById("settingsStatus");
  if (!element) return;
  element.className = `conn-status ${kind}`;
  element.innerHTML = `<i></i><span>${esc(message)}</span>`;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (error) {
      reject(error);
    } finally {
      area.remove();
    }
  });
}

function isMixedContentBlocked(baseUrl) {
  if (location.protocol !== "https:" || !baseUrl.startsWith("http:")) return false;
  try {
    const host = new URL(baseUrl).hostname;
    return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

/**
 * Returns true when the error was an auth/config problem and the app navigated
 * to Settings. Callers should not show a second toast in that case.
 */
function handleAuthError(error) {
  if (error instanceof ApiError && error.status === 401) {
    state.authError = error.message;
    closeModal(state, true);
    go("/settings");
    toast(error.message, "error");
    return true;
  }
  if (error instanceof ApiError && error.status === 503) {
    state.authError = error.message;
    closeModal(state, true);
    go("/settings");
    toast(error.message, "error");
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ theme */

export function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  saveTheme(state.theme);
  document.documentElement.dataset.theme = state.theme;
  updateThemeControls(state);
  renderSettingsStats(state);
}

/* ---------------------------------------------------------------- settings */

function readSettingsForm() {
  const baseInput = document.getElementById("setBaseUrl");
  const tokenInput = document.getElementById("setToken");
  if (!baseInput || !tokenInput) return null;
  return { baseInput, tokenInput, baseUrl: baseInput.value, token: tokenInput.value };
}

async function testConnection() {
  const values = readSettingsForm();
  if (!values) return;
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(values.baseUrl);
  } catch (error) {
    setConnStatus("err", errorMessage(error));
    values.baseInput.focus();
    return;
  }
  if (isMixedContentBlocked(baseUrl)) {
    setConnStatus(
      "err",
      `Trang đang chạy HTTPS nên trình duyệt sẽ chặn ${baseUrl}. Dùng máy chủ HTTPS hoặc mở dashboard trên HTTP.`,
    );
    return;
  }
  const token = values.token.trim();
  setConnStatus("busy", "Đang kiểm tra máy chủ…");
  const api = makeApi({ baseUrl, token });
  const started = performance.now();
  try {
    await api.health();
    const latency = Math.max(1, Math.round(performance.now() - started));
    if (!token) {
      setConnStatus(
        "ok",
        `Máy chủ phản hồi trong ${latency} ms. Nhập management token để kiểm tra quyền ghi.`,
      );
      return;
    }
    const probe = await api.probeToken();
    if (!probe.ok) {
      setConnStatus(
        "err",
        `${probe.message} Máy chủ vẫn phản hồi trong ${latency} ms, nhưng thao tác ghi sẽ bị từ chối.`,
      );
      return;
    }
    setConnStatus("ok", `Kết nối tốt · ${latency} ms · token hợp lệ.`);
  } catch (error) {
    setConnStatus("err", errorMessage(error));
  }
}

async function saveSettingsFromForm() {
  const values = readSettingsForm();
  if (!values) return;
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(values.baseUrl);
  } catch (error) {
    setConnStatus("err", errorMessage(error));
    values.baseInput.focus();
    return;
  }
  const token = values.token.trim();
  if (!token) {
    setConnStatus("err", "Nhập management token trước khi lưu.");
    values.tokenInput.focus();
    return;
  }
  if (isMixedContentBlocked(baseUrl)) {
    setConnStatus(
      "err",
      `Trang đang chạy HTTPS nên trình duyệt sẽ chặn ${baseUrl}. Dùng máy chủ HTTPS hoặc mở dashboard trên HTTP.`,
    );
    return;
  }
  if (!saveSettings({ baseUrl, token })) {
    setConnStatus(
      "err",
      "Trình duyệt không cho lưu localStorage. Kiểm tra chế độ riêng tư hoặc quyền lưu dữ liệu trang.",
    );
    return;
  }
  state.settings = { baseUrl, token };
  state.api = makeApi(state.settings);
  state.ui.settingsDraft = null;
  state.authError = "";
  state.catalog = [];
  state.catalogLoaded = false;
  state.degraded = false;
  state.loading = false;
  state.error = null;
  state.health = { status: "unknown", latency: null, checkedAt: null };
  toast("Đã lưu cài đặt kết nối.");
  go("/apps");
}

function clearSettings() {
  clearStoredSettings();
  state.settings = { baseUrl: DEFAULT_BASE_URL, token: "" };
  state.api = makeApi(state.settings);
  state.ui.settingsDraft = null;
  state.authError = "";
  state.catalog = [];
  state.catalogLoaded = false;
  state.degraded = false;
  state.loading = false;
  state.error = null;
  state.health = { status: "unknown", latency: null, checkedAt: null };
  const baseInput = document.getElementById("setBaseUrl");
  if (baseInput) baseInput.value = DEFAULT_BASE_URL;
  const tokenInput = document.getElementById("setToken");
  if (tokenInput) tokenInput.value = "";
  renderCurrent();
  void checkHealth();
  toast("Đã xoá thông tin kết nối khỏi trình duyệt.");
}

/* ------------------------------------------------------------------ files */

function readIconFile(file) {
  const icon = state.modal?.icon;
  if (!icon) return;
  const errorElement = document.getElementById("iconErr");
  const setError = (message) => {
    icon.error = message;
    if (errorElement) errorElement.textContent = message;
  };
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    setError("Chỉ nhận PNG, JPG hoặc WebP.");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setError("Ảnh vượt quá 2 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    icon.error = "";
    icon.remove = false;
    icon.file = file;
    icon.dataUrl = typeof reader.result === "string" ? reader.result : "";
    if (errorElement) errorElement.textContent = "";
    updateIconPreview(state);
    toast("Đã nạp ảnh icon.");
  };
  reader.onerror = () => setError("Không đọc được tệp ảnh.");
  reader.readAsDataURL(file);
}

async function addFiles(fileList) {
  const result = await addFilesToUpload(state, fileList, { onUpdate: rerenderModal });
  if (!result.added && !result.rejected) return;
  if (result.rejected && !result.added) {
    toast("Chỉ nhận tệp .apk (hoặc tệp đã có trong danh sách).", "error");
    return;
  }
  if (result.failed) {
    toast(`${result.failed} tệp không đọc được — xem lỗi trong hộp thoại.`, "error");
  } else if (result.added) {
    toast(result.added === 1 ? "Đã đọc 1 APK." : `Đã đọc ${result.added} APK.`);
  }
  rerenderModal();
}

/* ----------------------------------------------------------------- upload */

async function startUpload() {
  const modal = state.modal;
  if (!modal || modal.type !== "upload" || modal.upload.running) return;
  const upload = modal.upload;
  syncUploadForm(upload);

  upload.error = "";
  if (
    upload.files.some((file) => file.status === "inspecting") ||
    upload.inspecting
  ) {
    upload.error = "Đang đọc metadata APK. Chờ đọc xong rồi thử lại.";
    rerenderModal();
    return;
  }
  if (!state.api.token) {
    upload.error = "Chưa có management token. Mở Cài đặt để nhập token.";
    rerenderModal();
    return;
  }

  const plan = buildUploadPlan(upload, state.catalog, upload.expectedAppId);
  upload.consistency = plan;
  upload.target = plan.target;
  if (!plan.ready) {
    upload.error = plan.fatal.map((item) => item.message).join(" ");
    rerenderModal();
    return;
  }

  const metadata = plan.detected;
  const notes = upload.notes.trim();
  const publishedAt = isoFromDateInput(upload.date);
  const target = plan.target;

  // One inline confirmation covers every ABI that already exists. Adding a new
  // ABI to an existing version does not ask.
  if (!upload.allowReplace && target.status === "existing" && plan.conflictVersion) {
    let existing = null;
    try {
      existing = await state.api.getVersion(target.appId, plan.conflictVersion);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        if (!handleAuthError(error)) {
          upload.error = errorMessage(error);
          rerenderModal();
        }
        return;
      }
    }
    const conflicts = computeVersionConflicts(existing, upload.files);
    if (conflicts.conflict) {
      upload.pendingReplace = {
        version: plan.conflictVersion,
        replacedAbis: conflicts.replacedAbis,
      };
      rerenderModal();
      return;
    }
  }

  upload.pendingReplace = null;
  upload.running = true;
  upload.done = false;
  upload.progress = 0;
  upload.error = "";
  upload.iconWarning = "";
  upload.files.forEach((file) => {
    file.progress = 0;
    file.sha256 = null;
    file.uploadError = "";
  });
  rerenderModal();

  try {
    let appId = target.status === "existing" ? target.appId : null;
    for (const file of upload.files) {
      const params = {};
      if (appId) params.appId = appId;
      else params.create = true;
      if (!appId && target.name) params.name = target.name;
      if (plan.version) params.version = plan.version;
      if (file === upload.files[0]) {
        if (notes) params.releaseNotes = notes;
        if (publishedAt) params.publishedAt = publishedAt;
      }
      try {
        const result = await state.api.importApk(file.file, params, {
          onProgress: (value) => {
            file.progress = value;
            updateUploadProgressDOM(state);
          },
        });
        const resultAppId = result?.app?.id;
        if (!appId && resultAppId) {
          appId = resultAppId;
          upload.appId = resultAppId;
        }
        file.progress = 1;
        if (result?.artifact?.sha256) file.sha256 = result.artifact.sha256;
        updateUploadProgressDOM(state);
      } catch (error) {
        file.uploadError = uploadErrorMessage(error);
        throw error;
      }
    }

    // Adaptive/vector launcher icons are rendered in the browser. Only write
    // when the app had no effective icon before this upload; never overwrite.
    const descriptor = metadata?.icon;
    const iconPreview = upload.files.find(
      (file) => file.iconPreview?.pngBlob && file.metadata?.icon,
    )?.iconPreview;
    const hadIcon = Boolean(target.app?.iconUrl);
    if (
      appId &&
      !hadIcon &&
      descriptor &&
      descriptor.kind !== "raster" &&
      iconPreview?.pngBlob
    ) {
      try {
        await state.api.putIcon(appId, iconPreview.pngBlob, { ifMissing: true });
      } catch (error) {
        upload.iconWarning = `Đã phát hành nhưng chưa ghi được icon: ${errorMessage(error)}`;
      }
    }

    upload.running = false;
    upload.done = true;
    upload.progress = 1;
    await refreshCatalog({ silent: true });
    const appName =
      findApp(state.catalog, appId)?.name || target.name || appId || "ứng dụng";
    const versionLabel =
      plan.version || effectiveVersionName(metadata) || "";
    toast(
      versionLabel
        ? `Đã phát hành ${appName} v${versionLabel}.`
        : `Đã phát hành ${appName}.`,
    );
    rerenderModal();
  } catch (error) {
    upload.running = false;
    upload.error = uploadErrorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

function confirmReplace() {
  const upload = state.modal?.upload;
  if (!upload?.pendingReplace) return;
  upload.allowReplace = true;
  upload.pendingReplace = null;
  rerenderModal();
  void startUpload();
}

function uploadErrorMessage(error) {
  if (error instanceof ApiError && error.status === 422) {
    return `Máy chủ từ chối APK (422): ${error.message}`;
  }
  if (error instanceof ApiError && error.status === 400) {
    return `Máy chủ từ chối APK (400): ${error.message}`;
  }
  return errorMessage(error);
}

/* ------------------------------------------------------------------- icon */

async function deleteCurrentIcon(icon) {
  icon.busy = true;
  icon.error = "";
  rerenderModal();
  try {
    try {
      await state.api.deleteIcon(icon.appId);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    const app = findApp(state.catalog, icon.appId);
    if (app) app.iconUrl = null;
    closeModal(state, true);
    renderCurrent();
    toast("Đã xoá icon.");
  } catch (error) {
    icon.busy = false;
    icon.error = errorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

async function saveIcon() {
  const icon = state.modal?.icon;
  if (!icon || icon.busy) return;
  if (icon.remove) {
    await deleteCurrentIcon(icon);
    return;
  }
  if (!icon.file) {
    closeModal(state, true);
    rerenderModal();
    toast("Không có thay đổi icon.");
    return;
  }
  icon.busy = true;
  icon.error = "";
  rerenderModal();
  try {
    const result = await state.api.uploadIcon(icon.appId, icon.file);
    const app = findApp(state.catalog, icon.appId);
    if (app) {
      const path = result?.iconPath;
      app.iconPath = path || app.iconPath;
      app.iconUrl = path ? `${state.api.url(path)}?v=${Date.now()}` : app.iconUrl;
    }
    closeModal(state, true);
    renderCurrent();
    toast("Đã cập nhật icon.");
  } catch (error) {
    icon.busy = false;
    icon.error = errorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

/* -------------------------------------------------------------- app/version */

async function saveApp() {
  const modal = state.modal;
  if (!modal || modal.type !== "app" || modal.form.busy) return;
  const form = modal.form;
  const id = (document.getElementById("fId")?.value || "").trim();
  const name = (document.getElementById("fName")?.value || "").trim();
  const packageName = (document.getElementById("fPkg")?.value || "").trim();
  const developer = document.getElementById("fDev")?.value || "";
  const description = document.getElementById("fDesc")?.value || "";
  form.id = id;
  form.name = name;
  form.packageName = packageName;
  form.developer = developer;
  form.description = description;
  form.error = "";

  if (!name) {
    form.error = "Hãy nhập tên hiển thị.";
    rerenderModal();
    return;
  }
  if (form.mode === "new") {
    if (!ID_PATTERN.test(id)) {
      form.error = "App ID không hợp lệ. Dùng chữ, số, dấu chấm, gạch.";
      rerenderModal();
      return;
    }
    if (findApp(state.catalog, id)) {
      form.error = "App ID này đã tồn tại trong danh mục.";
      rerenderModal();
      return;
    }
  }

  form.busy = true;
  rerenderModal();
  try {
    if (form.mode === "new") {
      const input = { id, name, description, developer };
      if (packageName) input.packageName = packageName;
      await state.api.createApp(input);
      closeModal(state, true);
      await refreshCatalog({ silent: true });
      if (findApp(state.catalog, id)) go(`/apps/${encodeURIComponent(id)}`);
      else go("/apps");
      toast(`Đã tạo ứng dụng ${name}.`);
      return;
    }
    const patch = { name, description, developer };
    if (packageName) patch.packageName = packageName;
    await state.api.updateApp(form.id, patch);
    closeModal(state, true);
    await refreshCatalog({ silent: true });
    toast("Đã lưu thông tin ứng dụng.");
  } catch (error) {
    form.busy = false;
    form.error = errorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

async function saveVersion() {
  const modal = state.modal;
  if (!modal || modal.type !== "version" || modal.form.busy) return;
  const form = modal.form;
  const versionCode = Number.parseInt(document.getElementById("vfCode")?.value || "", 10);
  const minSdkRaw = (document.getElementById("vfMinSdk")?.value || "").trim();
  const minSdk = minSdkRaw === "" ? null : Number.parseInt(minSdkRaw, 10);
  const notes = document.getElementById("vfNotes")?.value || "";
  const date = document.getElementById("vfDate")?.value || "";
  form.versionCode = document.getElementById("vfCode")?.value || "";
  form.minSdk = minSdkRaw;
  form.notes = notes;
  form.date = date;
  form.error = "";

  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    form.error = "Version code phải là số nguyên dương.";
    rerenderModal();
    return;
  }
  if (minSdk !== null && (!Number.isInteger(minSdk) || minSdk <= 0)) {
    form.error = "minSdk phải là số nguyên dương hoặc để trống.";
    rerenderModal();
    return;
  }

  form.busy = true;
  rerenderModal();
  try {
    await state.api.updateVersion(form.appId, form.versionName, {
      versionCode,
      minSdk,
      releaseNotes: notes.trim() || null,
      publishedAt: isoFromDateInput(date),
    });
    const appId = form.appId;
    closeModal(state, true);
    await refreshCatalog({ silent: true });
    if (state.route.name === "detail" && state.route.id !== appId) {
      go(`/apps/${encodeURIComponent(appId)}`);
    }
    toast(`Đã lưu metadata phiên bản ${form.versionName}.`);
  } catch (error) {
    form.busy = false;
    form.error = errorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

async function performDelete() {
  const modal = state.modal;
  if (!modal || modal.type !== "confirm" || modal.confirm.busy) return;
  const confirm = modal.confirm;
  confirm.busy = true;
  confirm.error = "";
  rerenderModal();
  try {
    if (confirm.kind === "app") {
      await state.api.deleteApp(confirm.appId);
    } else {
      await state.api.deleteVersion(confirm.appId, confirm.versionName);
    }
    closeModal(state, true);
    await refreshCatalog({ silent: true });
    if (
      confirm.kind === "app" &&
      state.route.name === "detail" &&
      state.route.id === confirm.appId
    ) {
      go("/apps");
    }
    toast(
      confirm.kind === "app"
        ? "Đã xoá ứng dụng."
        : `Đã xoá phiên bản v${confirm.versionName}.`,
    );
  } catch (error) {
    confirm.busy = false;
    confirm.error = errorMessage(error);
    rerenderModal();
    handleAuthError(error);
  }
}

/* --------------------------------------------------------------- handlers */

export function handleClick(event) {
  const element = event.target.closest(
    "[data-act], [data-nav], [data-theme-choice], [data-soon]",
  );
  if (!element) return;

  if (element.dataset.themeChoice) {
    setTheme(element.dataset.themeChoice);
    return;
  }
  if (element.dataset.soon) {
    toast(`Mục “${element.dataset.soon}” chưa khả dụng trong bản này.`);
    return;
  }
  if (element.dataset.nav) {
    if (element.dataset.nav === "settings") go("/settings");
    else go("/apps");
    return;
  }

  const act = element.dataset.act;
  if (!act) return;

  if (act === "overlay") {
    if (event.target === element && closeModal(state)) rerenderModal();
    return;
  }
  if (act === "closeModal") {
    if (closeModal(state)) rerenderModal();
    else toast("Không thể đóng khi đang tải lên.", "error");
    return;
  }
  if (act === "toggleTheme") {
    setTheme(state.theme === "dark" ? "light" : "dark");
    return;
  }
  if (act === "retryLoad") {
    state.error = null;
    void refreshCatalog();
    return;
  }
  if (act === "reloadApp") {
    location.reload();
    return;
  }
  if (act === "openApp") {
    go(`/apps/${encodeURIComponent(element.dataset.id)}`);
    return;
  }
  if (act === "icon") {
    if (openIcon(state, element.dataset.id)) rerenderModal();
    return;
  }
  if (act === "upload") {
    const expectedAppId = element.dataset.app || null;
    if (openUpload(state, { expectedAppId })) {
      rerenderModal();
    } else {
      toast("Không còn ứng dụng này.", "error");
    }
    return;
  }
  if (act === "newApp") {
    openAppForm(state);
    rerenderModal();
    return;
  }
  if (act === "editApp") {
    if (openAppForm(state, element.dataset.id)) rerenderModal();
    return;
  }
  if (act === "askDeleteApp") {
    if (openConfirm(state, "app", element.dataset.id)) rerenderModal();
    return;
  }
  if (act === "askDeleteVersion") {
    if (openConfirm(state, "version", element.dataset.id, element.dataset.version)) {
      rerenderModal();
    }
    return;
  }
  if (act === "confirmDelete") {
    void performDelete();
    return;
  }
  if (act === "curl") {
    if (openCurl(state, element.dataset.id, element.dataset.version || null)) {
      rerenderModal();
    }
    return;
  }
  if (act === "editVersion") {
    if (openVersionForm(state, element.dataset.id, element.dataset.version)) {
      rerenderModal();
    }
    return;
  }
  if (act === "listFilter") {
    state.ui.listFilter = element.dataset.val;
    renderListResults(state);
    return;
  }
  if (act === "clearList") {
    state.ui.listQuery = "";
    state.ui.listFilter = "all";
    state.ui.listAbi = "all";
    const search = document.getElementById("listSearch");
    if (search) search.value = "";
    renderListResults(state);
    return;
  }
  if (act === "vFilter") {
    state.ui.vFilter = element.dataset.val;
    const app = findApp(state.catalog, state.route.id);
    if (app) renderVersionList(state, app);
    return;
  }
  if (act === "vAbi") {
    state.ui.vAbi = element.dataset.val;
    const app = findApp(state.catalog, state.route.id);
    if (app) renderVersionList(state, app);
    return;
  }
  if (act === "backList") {
    go("/apps");
    return;
  }
  if (act === "toggleToken") {
    state.ui.showToken = !state.ui.showToken;
    const input = document.getElementById("setToken");
    if (input) input.type = state.ui.showToken ? "text" : "password";
    element.innerHTML = svg(state.ui.showToken ? "eyeOff" : "eye", 18);
    element.title = state.ui.showToken ? "Ẩn token" : "Hiện token";
    element.setAttribute("aria-label", element.title);
    return;
  }
  if (act === "testConnection") {
    void testConnection();
    return;
  }
  if (act === "clearSettings") {
    clearSettings();
    return;
  }
  if (act === "pickFiles") {
    document.getElementById("fileInput")?.click();
    return;
  }
  if (act === "pickIcon") {
    document.getElementById("iconInput")?.click();
    return;
  }
  if (act === "rmFile") {
    removeUploadFile(state, element.dataset.file);
    rerenderModal();
    return;
  }
  if (act === "startUpload") {
    void startUpload();
    return;
  }
  if (act === "confirmReplace") {
    confirmReplace();
    return;
  }
  if (act === "goUploadVersion") {
    const upload = state.modal?.upload;
    const appId =
      upload?.appId ||
      upload?.target?.appId ||
      upload?.target?.app?.id ||
      upload?.expectedAppId;
    closeModal(state, true);
    rerenderModal();
    if (appId) go(`/apps/${encodeURIComponent(appId)}`);
    return;
  }
  if (act === "letterIcon") {
    const icon = state.modal?.icon;
    if (!icon) return;
    icon.remove = true;
    icon.dataUrl = null;
    icon.file = null;
    icon.error = "";
    updateIconPreview(state);
    toast("Sẽ dùng chữ cái đầu khi lưu.");
    return;
  }
  if (act === "removeIcon") {
    const icon = state.modal?.icon;
    if (icon) void deleteCurrentIcon(icon);
    return;
  }
  if (act === "saveIcon") {
    void saveIcon();
    return;
  }
  if (act === "saveApp") {
    void saveApp();
    return;
  }
  if (act === "saveVersion") {
    void saveVersion();
    return;
  }
  if (act === "copyCurl") {
    const curl = state.modal?.curl;
    const app = curl ? findApp(state.catalog, curl.appId) : null;
    if (!app) return;
    copyText(curlCode(state, app, curl.versionName))
      .then(() => toast("Đã sao chép lệnh phát hành."))
      .catch(() => toast("Không sao chép được — chọn lệnh và sao chép thủ công.", "error"));
    return;
  }
}

export function handleInput(event) {
  const target = event.target;
  if (target.id === "listSearch") {
    state.ui.listQuery = target.value;
    renderListResults(state);
    return;
  }
  if (target.id === "vSearch") {
    state.ui.vQuery = target.value;
    const app = findApp(state.catalog, state.route.id);
    if (app) renderVersionList(state, app);
    return;
  }
  const upload = state.modal?.upload;
  if (!upload) return;
  if (target.id === "upDate") {
    upload.date = target.value;
  } else if (target.id === "upNotes") {
    upload.notes = target.value;
  }
}

export function handleChange(event) {
  const target = event.target;
  if (target.id === "sortSel") {
    state.ui.sort = target.value;
    renderListResults(state);
    return;
  }
  if (target.id === "abiSel") {
    state.ui.listAbi = target.value;
    renderListResults(state);
    return;
  }
  if (target.id === "fileInput") {
    // Snapshot before clearing: resetting the input can empty the live FileList.
    const files = Array.from(target.files || []);
    target.value = "";
    void addFiles(files);
    return;
  }
  if (target.id === "iconInput") {
    if (target.files?.[0]) readIconFile(target.files[0]);
    return;
  }
}

export function handleSubmit(event) {
  if (event.target.id === "settingsForm") {
    event.preventDefault();
    void saveSettingsFromForm();
  }
}

export function handleKeydown(event) {
  if (event.key === "Escape" && state.modal) {
    if (closeModal(state)) rerenderModal();
    else toast("Không thể đóng khi đang tải lên.", "error");
    return;
  }
  if (event.key === "Tab" && state.modal) {
    const dialog = document.querySelector("#modalRoot .dialog");
    if (!dialog) return;
    const items = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]):not(.sr), select:not([disabled]), textarea:not([disabled]), a[href]',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  if (event.key === "/" && !state.modal) {
    const tag = document.activeElement?.tagName;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(tag || "")) {
      const search = document.getElementById("listSearch");
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
    return;
  }
  if (event.key === "Enter") {
    const card = event.target.closest?.('[data-act="openApp"]');
    // Only the card itself, not the icon button nested inside it.
    if (card && event.target === card) {
      event.preventDefault();
      card.click();
    }
  }
}

export function handleDragOver(event) {
  const zone = event.target.closest?.("#dropzone, #iconDrop");
  if (!zone) return;
  event.preventDefault();
  zone.classList.add("hot");
}

export function handleDragLeave(event) {
  const zone = event.target.closest?.("#dropzone, #iconDrop");
  if (zone) zone.classList.remove("hot");
}

export function handleDrop(event) {
  const zone = event.target.closest?.("#dropzone, #iconDrop");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("hot");
  if (zone.id === "iconDrop") {
    if (event.dataTransfer?.files?.[0]) readIconFile(event.dataTransfer.files[0]);
    return;
  }
  const upload = state.modal?.upload;
  if (upload && !upload.running && !upload.done) void addFiles(event.dataTransfer.files);
}

export function handleStorage(event) {
  if (event.key === THEME_KEY || event.key === null) {
    state.theme = loadTheme();
    document.documentElement.dataset.theme = state.theme;
    updateThemeControls(state);
    renderSettingsStats(state);
    renderToast();
  }
  if (event.key === SETTINGS_KEY || event.key === null) {
    state.settings = loadSettings();
    state.api = makeApi(state.settings);
    state.catalog = [];
    state.catalogLoaded = false;
    state.degraded = false;
    state.error = null;
    state.ui.settingsDraft = null;
    void checkHealth();
    if (hasToken(state.settings)) {
      toast("Cài đặt đã thay đổi ở tab khác.");
      handleRoute();
    } else {
      toast("Token đã bị xoá ở tab khác.", "error");
      handleRoute();
    }
  }
}

export function handleHashChange() {
  handleRoute();
}

export function handleUnhandled(error) {
  console.error(error);
  toast(errorMessage(error), "error");
}
