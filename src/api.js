const TOKEN_HEADER = "X-Management-Key";
const DEFAULT_TIMEOUT = 15000;

export class ApiError extends Error {
  constructor(status, code, message, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function friendlyMessage(code, fallback) {
  switch (code) {
    case "invalid_management_key":
      return "Management token không đúng hoặc đã bị đổi.";
    case "management_key_not_configured":
      return "Máy chủ chưa cấu hình management_key (data/config.json).";
    case "app_exists":
      return "App ID này đã tồn tại.";
    case "version_exists":
      return "Phiên bản này đã tồn tại.";
    case "payload_too_large":
      return "Tệp vượt quá giới hạn máy chủ cho phép.";
    case "unsupported_media_type":
      return "Máy chủ không chấp nhận loại tệp này.";
    case "app_not_found":
      return "Không tìm thấy ứng dụng.";
    case "version_not_found":
      return "Không tìm thấy phiên bản.";
    case "artifact_not_found":
      return "Không tìm thấy APK cho kiến trúc này.";
    case "icon_not_found":
      return "Ứng dụng chưa có icon.";
    case "invalid_apk":
      return fallback
        ? `APK không hợp lệ: ${fallback}`
        : "Máy chủ không đọc được APK (không phải APK hợp lệ, thiếu AndroidManifest.xml, ZIP64 hoặc config split).";
    case "apk_metadata_mismatch":
      return fallback
        ? `APK không khớp metadata: ${fallback}`
        : "APK không khớp package/version/minSdk/ABI mà máy chủ mong đợi.";
    case "invalid_request":
      return fallback ? `Yêu cầu không hợp lệ: ${fallback}` : "Yêu cầu không hợp lệ.";
    default:
      return fallback;
  }
}

const MISMATCH_KINDS = ["package", "version", "sdk", "abi"];

/** Normalise `allow_mismatch` to the canonical, deduplicated CSV order. */
export function allowMismatchQuery(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const selected = new Set(
    list
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => MISMATCH_KINDS.includes(item)),
  );
  if (!selected.size) return "";
  return MISMATCH_KINDS.filter((kind) => selected.has(kind)).join(",");
}

function timeoutSignal(ms, external) {
  if (typeof AbortSignal.timeout !== "function") return external;
  const timer = AbortSignal.timeout(ms);
  if (!external) return timer;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([external, timer]);
  return external;
}

function encode(value) {
  return encodeURIComponent(String(value));
}

export class ApiClient {
  constructor({ baseUrl, token } = {}) {
    this.baseUrl = String(baseUrl ?? "").replace(/\/+$/, "");
    this.token = String(token ?? "").trim();
  }

  get configured() {
    return this.baseUrl.length > 0;
  }

  url(path) {
    if (!path) return this.baseUrl;
    return this.baseUrl + (path.startsWith("/") ? path : `/${path}`);
  }

  iconUrl(appId, revision) {
    const base = this.url(`/api/v1/apps/${encode(appId)}/icon`);
    return revision ? `${base}?v=${encodeURIComponent(revision)}` : base;
  }

  async request(
    path,
    { method = "GET", headers = {}, body, signal, timeout = DEFAULT_TIMEOUT } = {},
  ) {
    if (!this.configured) {
      throw new ApiError(0, "missing_base_url", "Chưa cấu hình địa chỉ máy chủ.");
    }
    const verb = method.toUpperCase();
    const requestHeaders = new Headers(headers);
    let payload = body;

    if (body !== undefined && body !== null) {
      const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
      const isBuffer = body instanceof ArrayBuffer || ArrayBuffer.isView(body);
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      const isParams =
        typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
      const isStream =
        typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
      if (
        !isBlob &&
        !isBuffer &&
        !isForm &&
        !isParams &&
        !isStream &&
        typeof body !== "string"
      ) {
        requestHeaders.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
      }
    }
    if (verb !== "GET" && verb !== "HEAD" && this.token) {
      requestHeaders.set(TOKEN_HEADER, this.token);
    }

    let response;
    try {
      response = await fetch(this.url(path), {
        method: verb,
        headers: requestHeaders,
        body: payload,
        signal: timeoutSignal(timeout, signal),
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ApiError(0, "aborted", "Đã huỷ yêu cầu.");
      }
      if (error?.name === "TimeoutError") {
        throw new ApiError(0, "timeout", "Máy chủ không phản hồi kịp.");
      }
      throw new ApiError(
        0,
        "network_error",
        "Không kết nối được máy chủ. Kiểm tra địa chỉ, mạng nội bộ và CORS.",
      );
    }

    if (!response.ok) {
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        /* non-JSON error body */
      }
      const code = parsed?.error?.code || `http_${response.status}`;
      const serverMessage = parsed?.error?.message;
      throw new ApiError(
        response.status,
        code,
        friendlyMessage(code, serverMessage || `Máy chủ trả về HTTP ${response.status}.`),
        parsed,
      );
    }

    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json();
    return response;
  }

  health(signal) {
    return this.request("/api/v1/health", { signal, timeout: 6000 });
  }

  async listApps(signal) {
    const data = await this.request("/api/v1/apps", { signal });
    return Array.isArray(data?.apps) ? data.apps : [];
  }

  async listVersions(appId, signal) {
    const data = await this.request(`/api/v1/apps/${encode(appId)}/versions`, { signal });
    return Array.isArray(data?.versions) ? data.versions : [];
  }

  async getVersion(appId, versionName, signal) {
    const data = await this.request(
      `/api/v1/apps/${encode(appId)}/versions/${encode(versionName)}`,
      { signal },
    );
    return data?.version ?? null;
  }

  createApp(input) {
    return this.request("/api/v1/apps", { method: "POST", body: input });
  }

  updateApp(appId, patch) {
    return this.request(`/api/v1/apps/${encode(appId)}`, { method: "PUT", body: patch });
  }

  deleteApp(appId) {
    return this.request(`/api/v1/apps/${encode(appId)}`, { method: "DELETE" });
  }

  uploadIcon(appId, file) {
    return this.request(`/api/v1/apps/${encode(appId)}/icon`, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
      timeout: 60000,
    });
  }

  deleteIcon(appId) {
    return this.request(`/api/v1/apps/${encode(appId)}/icon`, { method: "DELETE" });
  }

  createVersion(appId, input) {
    return this.request(`/api/v1/apps/${encode(appId)}/versions`, {
      method: "POST",
      body: input,
    });
  }

  updateVersion(appId, versionName, patch) {
    return this.request(
      `/api/v1/apps/${encode(appId)}/versions/${encode(versionName)}`,
      { method: "PUT", body: patch },
    );
  }

  deleteVersion(appId, versionName) {
    return this.request(
      `/api/v1/apps/${encode(appId)}/versions/${encode(versionName)}`,
      { method: "DELETE" },
    );
  }

  deleteArtifact(appId, versionName, abi) {
    return this.request(
      `/api/v1/apps/${encode(appId)}/versions/${encode(versionName)}/artifacts/${encode(abi)}`,
      { method: "DELETE" },
    );
  }

  /**
   * XHR is used for APK uploads because fetch does not expose upload progress.
   */
  uploadArtifact(
    appId,
    versionName,
    abi,
    file,
    { onProgress, signal, allowMismatch } = {},
  ) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const mismatch = allowMismatchQuery(allowMismatch);
      const query = mismatch ? `?allow_mismatch=${encode(mismatch)}` : "";
      const target = this.url(
        `/api/v1/apps/${encode(appId)}/versions/${encode(versionName)}/artifacts/${encode(abi)}${query}`,
      );
      xhr.open("PUT", target, true);
      xhr.setRequestHeader("Content-Type", "application/vnd.android.package-archive");
      if (this.token) xhr.setRequestHeader(TOKEN_HEADER, this.token);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)));
        }
      });
      xhr.addEventListener("load", () => {
        let parsed = null;
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed);
          return;
        }
        const code = parsed?.error?.code || `http_${xhr.status}`;
        reject(
          new ApiError(
            xhr.status,
            code,
            friendlyMessage(
              code,
              parsed?.error?.message || `Tải APK thất bại (HTTP ${xhr.status}).`,
            ),
            parsed,
          ),
        );
      });
      xhr.addEventListener("error", () => {
        reject(
          new ApiError(
            0,
            "network_error",
            "Mất kết nối khi đang tải APK. Kiểm tra mạng và CORS.",
          ),
        );
      });
      xhr.addEventListener("abort", () => {
        reject(new ApiError(0, "aborted", "Đã huỷ tải APK."));
      });
      if (signal) {
        if (signal.aborted) {
          reject(new ApiError(0, "aborted", "Đã huỷ tải APK."));
          return;
        }
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });
  }

  /**
   * A safe auth probe: the write hook runs before the route validates the
   * deliberately invalid id/body. 400 therefore means the token was accepted;
   * 401 means it was rejected. No data is mutated.
   */
  async probeToken(signal) {
    try {
      await this.request("/api/v1/apps/__dashboard_probe__", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal,
        timeout: 8000,
      });
      return { ok: true, message: "Token hợp lệ." };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        return { ok: true, message: "Token hợp lệ." };
      }
      if (error instanceof ApiError && error.status === 401) {
        return { ok: false, message: "Token bị từ chối (401 invalid_management_key)." };
      }
      if (error instanceof ApiError && error.status === 503) {
        return {
          ok: false,
          message: "Máy chủ chưa cấu hình management_key (503).",
        };
      }
      throw error;
    }
  }
}
