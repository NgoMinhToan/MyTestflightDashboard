import {
  ABI_META,
  ABI_ORDER,
  ID_PATTERN,
  esc,
  fmtSize,
  inferAbi,
  initialOf,
  shortSha,
  sortedVersions,
  suggestVersion,
  toDateInput,
  todayDateInput,
} from "./format.js";
import { svg } from "./icons.js";
import { inspectApk } from "./apk-inspect.js";
import {
  applyInspection,
  applyInspectionError,
  applyPrefill,
  refreshUploadValidation,
  selectAppForPackage,
} from "./upload-plan.js";

const ABI_OPTIONS = ABI_ORDER.map(
  (abi) => `<option value="${abi}">${ABI_META[abi].label}</option>`,
).join("");

function fileId() {
  return `f${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
}

function overlay(content, width) {
  return `
  <div class="overlay" data-act="overlay">
    <div class="dialog" style="width:min(${width}px,100%)" role="dialog" aria-modal="true" tabindex="-1">
      ${content}
    </div>
  </div>`;
}

function closeButton() {
  return `<button class="x" data-act="closeModal" title="Đóng">${svg("close", 16)}</button>`;
}

/* ------------------------------------------------------------------ upload */

function appForUpload(state, upload) {
  return (
    state.catalog.find((candidate) => candidate.id === upload?.appId) ||
    state.catalog[0] ||
    null
  );
}

function emptyConsistency() {
  return { fatal: [], warnings: [], inspecting: false, detected: null };
}

export function openUpload(state, appId = null, versionName = null) {
  const explicitApp = appId != null;
  const app = explicitApp
    ? state.catalog.find((candidate) => candidate.id === appId) || null
    : null;
  if (explicitApp && !app) return false;
  const fallbackApp = app || state.catalog[0] || null;
  if (!fallbackApp) return false;
  const versions = sortedVersions(fallbackApp.versions);
  const known = versionName ? versions.find((version) => version.name === versionName) : null;
  const draft = versionName ? null : versions.find((version) => version.artifacts.length === 0);
  const top = versions[0];
  const source = known || draft || null;
  const upload = {
    appId: fallbackApp.id,
    explicitApp,
    appTouched: false,
    existingVersion: Boolean(versionName),
    versionName: versionName || draft?.name || suggestVersion(fallbackApp),
    versionCode: String(source?.code || (top?.code || 0) + 1 || 1),
    minSdk: String(source?.minSdk ?? top?.minSdk ?? 26),
    date: source?.publishedAt ? toDateInput(source.publishedAt) : todayDateInput(),
    notes: source?.notes || "",
    files: [],
    touched: { versionName: false, versionCode: false, minSdk: false },
    inspecting: false,
    consistency: emptyConsistency(),
    packageWarning: "",
    packageHint: "",
    allowMismatch: [],
    running: false,
    done: false,
    error: "",
    allowReplace: false,
    progress: 0,
  };
  refreshUploadValidation(upload, fallbackApp);
  state.modal = { type: "upload", upload };
  return true;
}

async function inspectUploadEntry(state, upload, entry, onUpdate) {
  if (state.modal?.upload !== upload || !upload.files.includes(entry)) return;
  try {
    const result = await inspectApk(entry.file);
    if (state.modal?.upload !== upload) return;
    if (!upload.files.includes(entry)) return;
    applyInspection(upload, entry.id, result);
  } catch (error) {
    if (state.modal?.upload !== upload) return;
    if (!upload.files.includes(entry)) return;
    applyInspectionError(upload, entry.id, error);
  }
  if (state.modal?.upload !== upload) return;
  if (!upload.files.includes(entry)) return;
  applyPrefill(upload);
  const selection = selectAppForPackage(upload, state.catalog);
  if (selection) {
    upload.packageHint = selection.app
      ? ""
      : `Chưa có ứng dụng nào có package ${selection.packageName}. Tạo ứng dụng mới trong Thư viện rồi thử lại.`;
  }
  refreshUploadValidation(upload, appForUpload(state, upload));
  onUpdate?.();
}

/**
 * Add APKs and inspect each one in the browser. Entries appear immediately as
 * "inspecting" so the footer can block upload while the manifest is read; each
 * result triggers `onUpdate` (the caller re-renders the modal).
 */
export async function addFilesToUpload(state, fileList, { onUpdate } = {}) {
  const upload = state.modal?.upload;
  if (!upload || upload.running || upload.done) {
    return {
      added: 0,
      rejected: 0,
      inspecting: 0,
      failed: 0,
      fatal: 0,
      warnings: 0,
    };
  }
  let added = 0;
  let rejected = 0;
  const pending = [];
  Array.from(fileList || []).forEach((file) => {
    if (!/\.apk$/i.test(file.name)) {
      rejected += 1;
      return;
    }
    const duplicate = upload.files.some(
      (existing) =>
        existing.status !== "error" &&
        existing.name === file.name &&
        existing.sizeBytes === file.size,
    );
    if (duplicate) {
      rejected += 1;
      return;
    }
    const entry = {
      id: fileId(),
      file,
      name: file.name,
      sizeBytes: file.size,
      abi: inferAbi(file.name),
      detectedAbi: null,
      abiOverridden: false,
      status: "inspecting",
      metadata: null,
      error: "",
      errorCode: "",
      previewUnavailable: false,
      previewMessage: "",
      progress: 0,
      sha256: null,
    };
    upload.files.push(entry);
    pending.push(entry);
    added += 1;
  });
  upload.error = "";
  refreshUploadValidation(upload, appForUpload(state, upload));
  onUpdate?.();

  if (pending.length) {
    await Promise.all(
      pending.map((entry) => inspectUploadEntry(state, upload, entry, onUpdate)),
    );
    if (state.modal?.upload === upload) {
      applyPrefill(upload);
      refreshUploadValidation(upload, appForUpload(state, upload));
      onUpdate?.();
    }
  }
  const consistency = upload.consistency || emptyConsistency();
  return {
    added,
    rejected,
    inspecting: upload.files.filter((file) => file.status === "inspecting").length,
    failed: upload.files.filter((file) => file.status === "error").length,
    fatal: consistency.fatal.length,
    warnings: consistency.warnings.length,
  };
}

export function removeUploadFile(state, id) {
  const upload = state.modal?.upload;
  if (!upload || upload.running || upload.done) return;
  upload.files = upload.files.filter((file) => file.id !== id);
  if (!upload.files.some((file) => file.metadata)) upload.packageHint = "";
  refreshUploadValidation(upload, appForUpload(state, upload));
}

function filePreviewHTML(file) {
  if (file.status === "inspecting") {
    return `<div class="apkprev inspecting"><span class="spinner"></span> Đang đọc AndroidManifest.xml…</div>`;
  }
  if (file.status === "error") {
    return `<div class="apkprev bad">${esc(file.error || "Không đọc được APK.")}</div>`;
  }
  if (file.previewUnavailable) {
    return `<div class="apkprev muted">${esc(file.previewMessage || "Không xem trước được APK trong trình duyệt này.")} ABI đang lấy từ tên tệp; máy chủ sẽ xác minh.</div>`;
  }
  const metadata = file.metadata;
  if (!metadata) return "";
  const meta = ABI_META[metadata.artifactAbi] || {
    label: metadata.artifactAbi,
    cls: "more",
  };
  const flags = [
    metadata.debuggable ? `<span class="flag bad">debuggable</span>` : "",
    metadata.testOnly ? `<span class="flag bad">testOnly</span>` : "",
    metadata.configSplit ? `<span class="flag bad">config split</span>` : "",
  ].join("");
  const abiDetail = metadata.abis.length > 1 ? ` · ${metadata.abis.join(", ")}` : "";
  const targetLabel =
    metadata.targetSdk != null ? ` · targetSdk ${metadata.targetSdk}` : "";
  const uploadError = file.uploadError
    ? `<div class="apkprev bad">${esc(file.uploadError)}</div>`
    : "";
  return `
    <div class="apkprev">
      <div class="pkline"><span class="pkg">${esc(metadata.packageName)}</span>${flags}</div>
      <div class="kvline">v${esc(metadata.versionName ?? "—")} · code ${metadata.versionCode} · minSdk ${metadata.minSdk ?? "—"}${targetLabel}</div>
      <div class="abiline"><span class="abi ${meta.cls}">${esc(meta.label)}</span><span class="det">ABI từ APK${esc(abiDetail)}</span></div>
    </div>${uploadError}`;
}

function uploadFileRows(upload) {
  if (!upload.files.length) return "";
  return upload.files
    .map((file) => {
      const meta = ABI_META[file.abi] || { label: file.abi, cls: "more" };
      const percent = Math.round((file.progress || 0) * 100);
      const options = ABI_ORDER.map(
        (abi) =>
          `<option value="${abi}" ${abi === file.abi ? "selected" : ""}>${ABI_META[abi].label}</option>`,
      ).join("");
      const overridden = Boolean(
        file.metadata && file.abi !== file.metadata.artifactAbi,
      );
      const statusPill =
        file.status === "inspecting"
          ? `<span class="fstat">đang đọc…</span>`
          : file.status === "error"
            ? `<span class="fstat bad">lỗi</span>`
            : file.previewUnavailable
              ? `<span class="fstat muted">không xem trước</span>`
              : "";
      const locked = upload.running || upload.done || file.status === "inspecting";
      return `
      <div class="file ${percent >= 100 ? "done" : ""} ${esc(file.status)}" data-file="${esc(file.id)}">
        <div class="f1">
          <span class="abi ${meta.cls}">${esc(meta.label)}</span>
          <span class="nm">${esc(file.name)}</span>
          <span class="sz">${fmtSize(file.sizeBytes)}</span>
          ${statusPill}
          ${
            upload.running || upload.done
              ? ""
              : `<button class="rm" data-act="rmFile" data-file="${esc(file.id)}" title="Bỏ tệp">${svg("close", 10)}</button>`
          }
        </div>
        ${filePreviewHTML(file)}
        <div class="fab">
          <select data-act="fileAbi" data-file="${esc(file.id)}" class="${overridden ? "override" : ""}" title="ABI đọc từ APK được ưu tiên; đổi tay sẽ gửi allow_mismatch=abi." ${locked ? "disabled" : ""}>${options}</select>
          ${overridden ? `<span class="ovr">đã sửa</span>` : ""}
          <span class="pr">${percent}%</span>
          ${file.sha256 ? `<span class="hashok">${svg("check", 11)} sha ${esc(shortSha(file.sha256))}</span>` : ""}
        </div>
        <div class="pb"><i style="width:${percent}%"></i></div>
      </div>`;
    })
    .join("");
}

export function uploadBlocked(upload) {
  if (!upload) return true;
  if (upload.running) return true;
  if (upload.inspecting || upload.consistency?.inspecting) return true;
  return (upload.consistency?.fatal?.length || 0) > 0;
}

function alertItems(items) {
  return items.map((item) => `<li>${esc(item.message)}</li>`).join("");
}

function uploadAlertsHTML(upload) {
  const fatal = upload.consistency?.fatal || [];
  const warnings = upload.consistency?.warnings || [];
  const hint = upload.packageHint
    ? `<div class="upload-alert info">${esc(upload.packageHint)}</div>`
    : "";
  const mismatch = upload.allowMismatch?.length
    ? `<div class="upload-alert info">Sẽ gửi <span class="mono">allow_mismatch=${esc(upload.allowMismatch.join(","))}</span> cho máy chủ.</div>`
    : "";
  const fatalHtml = fatal.length
    ? `<div class="upload-alert fatal"><b>Chưa thể tải lên</b><ul>${alertItems(fatal)}</ul></div>`
    : "";
  const warningHtml = warnings.length
    ? `<div class="upload-alert warn"><b>Cảnh báo</b><ul>${alertItems(warnings)}</ul></div>`
    : "";
  return hint + fatalHtml + warningHtml + mismatch;
}

/** Patch the alert block and button after a form field changes (no re-render). */
export function updateUploadAlertsDOM(state) {
  const upload = state.modal?.upload;
  if (!upload) return;
  refreshUploadValidation(upload, appForUpload(state, upload));
  const alerts = document.getElementById("upAlerts");
  if (alerts) alerts.innerHTML = uploadAlertsHTML(upload);
  const appHint = document.getElementById("upAppHint");
  if (appHint) appHint.textContent = upload.packageWarning || "";
  const button = document.getElementById("uploadBtn");
  if (button) button.disabled = uploadBlocked(upload);
  const hint = document.getElementById("upFootHint");
  if (hint) hint.textContent = uploadFootHint(upload);
}

function uploadFootHint(upload) {
  if (upload.done) return "Đã cập nhật danh mục và manifest.";
  if (upload.running) return "Không đóng cửa sổ khi đang tải.";
  if (upload.inspecting || upload.consistency?.inspecting) {
    return "Đang đọc metadata APK trong trình duyệt…";
  }
  if (upload.consistency?.fatal?.length) {
    return "Sửa lỗi APK bên trái trước khi tải lên.";
  }
  return "APK được đọc tại chỗ trước khi gửi; máy chủ vẫn xác minh lại.";
}

function uploadModal(state) {
  const upload = state.modal.upload;
  const app = appForUpload(state, upload);
  if (!app) return overlay(`<div class="dbody">Không còn ứng dụng để tải lên.</div>`, 620);
  const disabled = upload.running || upload.done ? "disabled" : "";
  const appOptions = state.catalog
    .map(
      (candidate) =>
        `<option value="${esc(candidate.id)}" ${candidate.id === upload.appId ? "selected" : ""}>${esc(candidate.name)}, ${esc(candidate.id)}</option>`,
    )
    .join("");
  const blocked = uploadBlocked(upload);
  const overallText = upload.done
    ? "Hoàn tất"
    : upload.running
      ? "Đang tải lên…"
      : upload.inspecting || upload.consistency?.inspecting
        ? "Đang đọc APK…"
        : "Sẵn sàng";
  const percent = Math.round((upload.progress || 0) * 100);
  const uploadLabel = upload.running
    ? `<span class="spinner"></span> Đang tải lên…`
    : upload.inspecting || upload.consistency?.inspecting
      ? `<span class="spinner"></span> Đang đọc APK…`
      : `Tải lên${upload.files.length ? ` ${upload.files.length} tệp` : ""}`;

  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Phát hành</div><h2>Tải bản dựng lên</h2>
        <p>APK được đọc ngay trong trình duyệt để lấy package, version và ABI trước khi gửi.</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="uploadgrid">
        <div>
          <div class="drop ${upload.files.length ? "has" : ""}" id="dropzone" data-act="pickFiles" style="${upload.files.length ? "min-height:150px" : ""}">
            <div class="up">${svg("upload", 24)}</div>
            <h3>${upload.files.length ? "Thả thêm APK" : "Thả APK vào đây"}</h3>
            <p>Kéo một hoặc nhiều tệp .apk. Dashboard đọc AndroidManifest.xml tại chỗ, không tải tệp lên trước.</p>
            <button class="btn btn-ghost pick" data-act="pickFiles">Chọn tệp</button>
            <div class="tiny">Mỗi ABI chỉ giữ một tệp. Giới hạn dung lượng do máy chủ quy định.</div>
          </div>
          <div class="files" id="fileList">${uploadFileRows(upload)}</div>
          <div id="upAlerts">${uploadAlertsHTML(upload)}</div>
          ${
            upload.files.length
              ? `<div class="overall" id="overall"><span id="ovText">${overallText}</span><div class="pb"><i id="ovBar" style="width:${percent}%"></i></div><span id="ovPct">${percent}%</span></div>`
              : ""
          }
          <div class="upload-error" id="upError">${esc(upload.error || "")}</div>
          <div class="up-hint"><b>Bản nháp trước, APK sau.</b> Phiên bản chỉ xuất hiện trong app Android khi có APK đầu tiên.</div>
          <input type="file" id="fileInput" multiple accept=".apk,application/vnd.android.package-archive" class="sr">
        </div>
        <div class="form">
          <div class="field"><label for="upApp">Ứng dụng</label>
            <select id="upApp" ${disabled}>${appOptions}</select>
            <div class="hint" id="upAppHint" style="color:var(--danger)">${esc(upload.packageWarning)}</div>
          </div>
          <div class="f2">
            <div class="field"><label for="upVersion">Tên phiên bản</label>
              <input id="upVersion" value="${esc(upload.versionName)}" spellcheck="false" ${disabled}>
              <div class="hint">versionName, ví dụ 1.5.0</div>
            </div>
            <div class="field"><label for="upCode">Version code</label>
              <input id="upCode" type="number" min="1" value="${esc(upload.versionCode)}" ${disabled}>
              <div class="hint">số nguyên tăng dần</div>
            </div>
          </div>
          <div class="f2">
            <div class="field"><label for="upMinSdk">minSdk</label>
              <input id="upMinSdk" type="number" min="1" value="${esc(upload.minSdk)}" ${disabled}>
            </div>
            <div class="field"><label for="upDate">Ngày phát hành</label>
              <input id="upDate" type="date" value="${esc(upload.date)}" ${disabled}>
            </div>
          </div>
          <div class="field"><label for="upNotes">Ghi chú phát hành</label>
            <textarea id="upNotes" placeholder="Điều gì thay đổi trong bản này?" ${disabled}>${esc(upload.notes)}</textarea>
          </div>
          <div class="switch"><input type="checkbox" checked disabled> Tạo bản nháp trước, gắn APK sau</div>
          <div class="hint" style="font-size:12px;line-height:1.55;color:var(--mute)">APK được băm SHA-256 khi lên máy chủ. Bản nháp chỉ hiện ở quản trị.</div>
        </div>
      </div>
    </div>
    <div class="dfoot">
      <span class="hint" id="upFootHint">${esc(uploadFootHint(upload))}</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${upload.running ? "disabled" : ""}>${upload.done ? "Đóng" : "Huỷ"}</button>
      ${
        upload.done
          ? `<button class="btn btn-dark" data-act="goUploadVersion">Xem phiên bản</button>`
          : `<button class="btn btn-primary" id="uploadBtn" data-act="startUpload" ${blocked ? "disabled" : ""}>${uploadLabel}</button>`
      }
    </div>`,
    920,
  );
}

export function updateUploadProgressDOM(state) {
  const upload = state.modal?.upload;
  if (!upload) return;
  let loaded = 0;
  let total = 0;
  upload.files.forEach((file) => {
    total += file.sizeBytes || 0;
    loaded += (file.progress || 0) * (file.sizeBytes || 0);
    const element = document.querySelector(`.file[data-file="${CSS.escape(file.id)}"]`);
    if (element) {
      const bar = element.querySelector(".pb i");
      const percent = Math.round((file.progress || 0) * 100);
      if (bar) bar.style.width = `${percent}%`;
      const label = element.querySelector(".pr");
      if (label) label.textContent = `${percent}%`;
      if (percent >= 100) element.classList.add("done");
    }
  });
  const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
  upload.progress = percent / 100;
  const overallBar = document.getElementById("ovBar");
  const overallPct = document.getElementById("ovPct");
  const overallText = document.getElementById("ovText");
  if (overallBar) overallBar.style.width = `${percent}%`;
  if (overallPct) overallPct.textContent = `${percent}%`;
  if (overallText) {
    overallText.textContent = upload.done
      ? "Hoàn tất"
      : percent >= 100
        ? "Đang ghi manifest…"
        : upload.running
          ? "Đang tải lên…"
          : "Sẵn sàng";
  }
}

/* -------------------------------------------------------------------- icon */

export function openIcon(state, appId) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = {
    type: "icon",
    icon: { appId, dataUrl: null, file: null, error: "", busy: false, remove: false },
  };
  return true;
}

function iconPreviewHTML(app, icon) {
  if (icon.dataUrl) return `<img src="${esc(icon.dataUrl)}" alt="">`;
  if (app.iconUrl && !icon.remove) {
    return `<span aria-hidden="true">${initialOf(app)}</span><img src="${esc(app.iconUrl)}" alt="" onerror="this.remove()">`;
  }
  return `<span aria-hidden="true">${initialOf(app)}</span>`;
}

function iconModal(state) {
  const icon = state.modal.icon;
  const app = state.catalog.find((candidate) => candidate.id === icon.appId);
  if (!app) return overlay(`<div class="dbody">Không còn ứng dụng này.</div>`, 620);
  const preview = iconPreviewHTML(app, icon);
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Nhận diện</div><h2>Đổi icon ứng dụng</h2><p>${esc(app.name)}, ${esc(app.packageName)}</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="icongrid">
        <div class="icprev">
          <div class="icbig" id="icLight" style="background:${app.color}">${preview}</div>
          <div class="iclabel">Nền pastel</div>
          <div class="icbig dark" id="icDark">${preview}</div>
          <div class="iclabel">Nền tối</div>
        </div>
        <div>
          <div class="icdrop" id="iconDrop">
            <div class="up" style="width:44px;height:44px;border-radius:15px;background:var(--coral);color:#fff;display:grid;place-items:center;margin:0 auto">${svg("image", 20)}</div>
            <h4 style="margin-top:10px">Thả ảnh icon vào đây</h4>
            <p>PNG, JPG hoặc WebP, tối đa 2 MB, khuyến nghị 512 × 512.</p>
            <button class="btn btn-ghost" data-act="pickIcon" ${icon.busy ? "disabled" : ""}>Chọn ảnh</button>
            <input type="file" id="iconInput" accept="image/png,image/jpeg,image/webp" class="sr">
          </div>
          <div class="icnote">Icon được lưu vào <span class="mono">apps/${esc(app.id)}/</span> và trả về qua <span class="mono">GET /apps/${esc(app.id)}/icon</span>. App Android cache 60 giây.</div>
          <div class="icrow">
            <button class="mini ghost" data-act="letterIcon" ${icon.busy ? "disabled" : ""}>${svg("file", 12)} Dùng chữ cái đầu</button>
            ${app.iconUrl ? `<button class="mini danger" data-act="removeIcon" ${icon.busy ? "disabled" : ""}>${svg("trash", 12)} Xoá icon hiện tại</button>` : ""}
          </div>
          <div class="inline-error" id="iconErr">${esc(icon.error || "")}</div>
        </div>
      </div>
    </div>
    <div class="dfoot">
      <span class="hint">${icon.busy ? "Đang lưu icon…" : "Ảnh được thay nguyên tử, không ghi đè manifest."}</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${icon.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveIcon" ${icon.busy ? "disabled" : ""}>${icon.busy ? `<span class="spinner"></span> Đang lưu…` : "Lưu icon"}</button>
    </div>`,
    700,
  );
}

export function updateIconPreview(state) {
  const icon = state.modal?.icon;
  if (!icon) return;
  const app = state.catalog.find((candidate) => candidate.id === icon.appId);
  if (!app) return;
  const html = iconPreviewHTML(app, icon);
  const light = document.getElementById("icLight");
  const dark = document.getElementById("icDark");
  if (light) light.innerHTML = html;
  if (dark) dark.innerHTML = html;
}

/* ---------------------------------------------------------------- app form */

export function openAppForm(state, appId = null) {
  const editing = Boolean(appId);
  const app = editing ? state.catalog.find((candidate) => candidate.id === appId) : null;
  state.modal = {
    type: "app",
    form: {
      mode: editing ? "edit" : "new",
      id: app?.id || "",
      name: app?.name || "",
      packageName: app?.packageName || "",
      developer: app?.developer || "",
      description: app?.description || "",
      error: "",
      busy: false,
    },
  };
  return true;
}

function appFormModal(state) {
  const form = state.modal.form;
  const editing = form.mode === "edit";
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">${editing ? "Thông tin" : "Ứng dụng mới"}</div><h2>${editing ? "Sửa thông tin ứng dụng" : "Tạo ứng dụng"}</h2>
        <p>${editing ? "Thay đổi được ghi vào app.json, giữ nguyên các trường lạ." : "Ứng dụng chưa có bản dựng sẽ chỉ hiện trong quản trị cho đến khi có APK."}</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="newgrid">
        <div class="field"><label for="fId">App ID</label>
          <input id="fId" value="${esc(form.id)}" placeholder="crm" spellcheck="false" ${editing || form.busy ? "disabled" : ""}>
          <div class="hint">Chữ, số, dấu chấm, gạch. Không đổi sau khi tạo.</div>
        </div>
        <div class="field"><label for="fName">Tên hiển thị</label>
          <input id="fName" value="${esc(form.name)}" placeholder="CRM Nội bộ" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="fPkg">Package name</label>
          <input id="fPkg" value="${esc(form.packageName)}" placeholder="com.acme.crm" spellcheck="false" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="fDev">Nhà phát triển</label>
          <input id="fDev" value="${esc(form.developer)}" placeholder="Platform Team" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field wide"><label for="fDesc">Mô tả</label>
          <textarea id="fDesc" placeholder="Ứng dụng này dùng để làm gì?" ${form.busy ? "disabled" : ""}>${esc(form.description)}</textarea>
        </div>
      </div>
      <div class="inline-error" id="formErr">${esc(form.error || "")}</div>
    </div>
    <div class="dfoot">
      <span class="hint">${editing ? "Chỉ metadata thay đổi; APK và phiên bản giữ nguyên." : "Có thể đổi icon sau khi tạo."}</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${form.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveApp" ${form.busy ? "disabled" : ""}>${form.busy ? `<span class="spinner"></span> Đang lưu…` : editing ? "Lưu thay đổi" : "Tạo ứng dụng"}</button>
    </div>`,
    620,
  );
}

/* ------------------------------------------------------------ version form */

export function openVersionForm(state, appId, versionName) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  const version = app?.versions.find((candidate) => candidate.name === versionName);
  if (!app || !version) return false;
  state.modal = {
    type: "version",
    form: {
      appId,
      versionName,
      versionCode: String(version.code || 1),
      minSdk: version.minSdk == null ? "" : String(version.minSdk),
      notes: version.notes || "",
      date: version.publishedAt ? toDateInput(version.publishedAt) : "",
      error: "",
      busy: false,
    },
  };
  return true;
}

function versionFormModal(state) {
  const form = state.modal.form;
  const app = state.catalog.find((candidate) => candidate.id === form.appId);
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Metadata</div><h2>Sửa phiên bản ${esc(form.versionName)}</h2><p>${esc(app?.name || form.appId)}. versionName không đổi được.</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="newgrid">
        <div class="field"><label for="vfCode">Version code</label>
          <input id="vfCode" type="number" min="1" value="${esc(form.versionCode)}" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="vfMinSdk">minSdk</label>
          <input id="vfMinSdk" type="number" min="1" value="${esc(form.minSdk)}" placeholder="để trống nếu không đặt" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field wide"><label for="vfDate">Ngày phát hành</label>
          <input id="vfDate" type="date" value="${esc(form.date)}" ${form.busy ? "disabled" : ""}>
          <div class="hint">Để trống để máy chủ dùng thời gian sửa tệp.</div>
        </div>
        <div class="field wide"><label for="vfNotes">Ghi chú phát hành</label>
          <textarea id="vfNotes" placeholder="Điều gì thay đổi trong bản này?" ${form.busy ? "disabled" : ""}>${esc(form.notes)}</textarea>
        </div>
      </div>
      <div class="inline-error" id="formErr">${esc(form.error || "")}</div>
    </div>
    <div class="dfoot">
      <span class="hint">Chỉ metadata thay đổi; APK giữ nguyên.</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${form.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveVersion" ${form.busy ? "disabled" : ""}>${form.busy ? `<span class="spinner"></span> Đang lưu…` : "Lưu thay đổi"}</button>
    </div>`,
    620,
  );
}

/* ---------------------------------------------------------------- confirm */

export function openConfirm(state, kind, appId, versionName = null) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = {
    type: "confirm",
    confirm: { kind, appId, versionName, busy: false, error: "" },
  };
  return true;
}

function confirmModal(state) {
  const confirm = state.modal.confirm;
  const app = state.catalog.find((candidate) => candidate.id === confirm.appId);
  const isApp = confirm.kind === "app";
  const title = isApp ? "Xoá ứng dụng?" : "Xoá phiên bản?";
  const body = isApp
    ? `Xoá <b>${esc(app?.name || confirm.appId)}</b> cùng toàn bộ thư mục <span class="mono">apps/${esc(confirm.appId)}/</span>. Không thể hoàn tác.`
    : `Xoá phiên bản <b>v${esc(confirm.versionName)}</b> của <b>${esc(app?.name || confirm.appId)}</b> cùng mọi APK bên trong. Không thể hoàn tác.`;
  return overlay(
    `
    <div class="dhead"><div><div class="kick" style="color:var(--danger)">Xác nhận</div><h2>${title}</h2></div>${closeButton()}</div>
    <div class="dbody">
      <div class="warn">${body}</div>
      <div class="inline-error" id="formErr">${esc(confirm.error || "")}</div>
    </div>
    <div class="dfoot"><span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${confirm.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" style="background:#B23A2B" data-act="confirmDelete" ${confirm.busy ? "disabled" : ""}>${confirm.busy ? `<span class="spinner"></span> Đang xoá…` : "Xoá"}</button>
    </div>`,
    520,
  );
}

/* ------------------------------------------------------------------- curl */

export function openCurl(state, appId, versionName = null) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = { type: "curl", curl: { appId, versionName } };
  return true;
}

export function curlCode(state, app, versionName) {
  const base = state.settings.baseUrl || "http://localhost:8080";
  const version = versionName
    ? app.versions.find((candidate) => candidate.name === versionName)
    : null;
  const name = versionName || app.versions[0]?.name || "1.0.0";
  const code = version?.code || (app.versions[0]?.code || 0) + 1 || 1;
  const minSdk = version?.minSdk ?? app.versions[0]?.minSdk ?? 26;
  const abis = version?.artifacts?.length
    ? version.artifacts.map((artifact) => artifact.abi)
    : ["arm64-v8a", "armeabi-v7a"];
  const artifactCmds = abis
    .map(
      (abi) => `curl -X PUT "$MTF_URL/api/v1/apps/${app.id}/versions/${name}/artifacts/${abi}" \\
  -H 'content-type: application/vnd.android.package-archive' \\
  -H "X-Management-Key: $MTF_KEY" \\
  --data-binary @app-${abi}.apk`,
    )
    .join("\n\n");
  return `export MTF_URL='${base}'
export MTF_KEY='<management_key>'

# 1. Tạo phiên bản (bản nháp)
curl -X POST "$MTF_URL/api/v1/apps/${app.id}/versions" \\
  -H 'content-type: application/json' \\
  -H "X-Management-Key: $MTF_KEY" \\
  -d '{"versionName":"${name}","versionCode":${code},"minSdk":${minSdk}}'

# 2. Đẩy APK cho từng ABI
${artifactCmds}`;
}

function curlModal(state) {
  const curl = state.modal.curl;
  const app = state.catalog.find((candidate) => candidate.id === curl.appId);
  if (!app) return overlay(`<div class="dbody">Không còn ứng dụng này.</div>`, 620);
  const code = curlCode(state, app, curl.versionName);
  return overlay(
    `
    <div class="dhead"><div><div class="kick">CI / terminal</div><h2>Lệnh phát hành</h2>
      <p>${esc(app.name)}${curl.versionName ? `, v${esc(curl.versionName)}` : ""}. Chạy từ máy có APK, không cần mở web.</p></div>
      ${closeButton()}</div>
    <div class="dbody"><pre class="curl">${esc(code)}</pre>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary" data-act="copyCurl">${svg("copy", 14)} Sao chép lệnh</button>
        <span style="font-size:12px;color:var(--mute);align-self:center">Thay <span class="mono">&lt;management_key&gt;</span> bằng token trong Cài đặt.</span>
      </div>
    </div>
    <div class="dfoot"><span class="hint">API ghi cần header X-Management-Key. Tạo bản nháp trước, rồi PUT từng ABI.</span><span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal">Đóng</button></div>`,
    720,
  );
}

/* ------------------------------------------------------------------- root */

export function modalHTML(state) {
  if (!state.modal) return "";
  switch (state.modal.type) {
    case "upload":
      return uploadModal(state);
    case "icon":
      return iconModal(state);
    case "app":
      return appFormModal(state);
    case "version":
      return versionFormModal(state);
    case "confirm":
      return confirmModal(state);
    case "curl":
      return curlModal(state);
    default:
      return "";
  }
}

export function closeModal(state, force = false) {
  if (state.modal?.type === "upload" && state.modal.upload.running && !force) return false;
  state.modal = null;
  return true;
}

export function validateVersionName(value) {
  return ID_PATTERN.test(String(value || ""));
}
