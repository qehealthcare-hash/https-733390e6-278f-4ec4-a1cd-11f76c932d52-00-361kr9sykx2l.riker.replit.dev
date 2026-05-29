/* eslint-disable */
/**
 * Hominal — legacy SPA → /api/v1 adapter.
 *
 * Phase 7 migration helper. The 16k-line legacy `legacy-crm.html` SPA still
 * speaks to Supabase REST directly for offline-first sync (tombstones, dirty
 * tracking, realtime), but every WRITE/READ that has a corresponding
 * Next.js Route Handler now prefers the API path. The direct-Supabase path
 * stays as a *fallback* so the app keeps working if the API tier is down
 * or the user is unauthenticated.
 *
 * Goals:
 *   - Single network shape: `{ success, data, error, code, details }`.
 *   - All mutations go through the audited service layer.
 *   - Soft-delete + close-bill guards become server-enforced.
 *   - No SPA-level changes to tombstones / realtime / merge logic.
 *
 * Modules covered so far:
 *   - receipts       (Phase 7a)
 *   - billings       (Phase 7b)
 *   - svcEntries     (Phase 7c) — duty diary
 *   - payoutCharges  (Phase 7c)
 *   - duties         (Phase 7c) — new hh_duties calendar
 *   - patients       (Phase 7d)
 *   - employees      (Phase 7e)
 *   - inquiries      (Phase 7f)
 *   - reports        (Phase 7g) — dashboard / billingTotals / payoutTotals / profitLoss / payroll
 *   - audits         (Phase 9) — read-only audit trail
 *
 * Usage (inside legacy-crm.html, after the script is included):
 *
 *   var listed = await window.legacyApi.receipts.list(billingId);
 *   if (listed.ok) {  ...listed.data  }
 *
 *   var created = await window.legacyApi.receipts.create(billingId, payload);
 *   if (created.ok) {  ...created.data  }
 *
 *   var deleted = await window.legacyApi.receipts.softDelete(billingId, id, reason);
 *   if (deleted.ok) {  ... }
 *
 * Each call returns:
 *   { ok: boolean, data?: any, error?: string, code?: string, status: number }
 *
 * `ok=false` means the legacy code should fall back to the direct-Supabase
 * path. Network errors, 401/403, and 5xx all return `ok=false`. A 4xx with
 * a server-validated business error returns `ok=false` AND surfaces
 * `error`/`code` so the UI can show a toast and STOP (no fallback).
 */
(function (root) {
  "use strict";

  var DEFAULT_API_BASE = "/api/v1";
  var IDEMPOTENCY_HEADER = "Idempotency-Key";

  function getApiBase() {
    try {
      if (root.HOMINAL_API_BASE && typeof root.HOMINAL_API_BASE === "string") {
        return String(root.HOMINAL_API_BASE).replace(/\/+$/, "");
      }
    } catch (ignore) {}
    return DEFAULT_API_BASE;
  }

  /** Resolve a Supabase bearer the same way the legacy SPA does. */
  async function resolveBearer() {
    try {
      if (typeof root.getSupabaseRestBearer === "function") {
        var bearer = await root.getSupabaseRestBearer();
        if (bearer) return bearer;
      }
    } catch (ignore) {}
    try {
      var sessionKey = root.SESSION_KEY || "hh_session";
      var raw = root.localStorage ? root.localStorage.getItem(sessionKey) : null;
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.accessToken) return parsed.accessToken;
      }
    } catch (ignore) {}
    return root.SB_KEY || "";
  }

  function genIdempotencyKey() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === "function") {
        return "legacy-" + root.crypto.randomUUID();
      }
    } catch (ignore) {}
    return "legacy-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Low-level helper.
   *
   * - Treats network failures as `ok=false` with no `error` payload so the
   *   caller can fall back silently to the direct-Supabase path.
   * - Treats `4xx`/`5xx` with a parseable JSON body as `ok=false` AND
   *   surfaces the server's `error`/`code` so the UI can present them.
   */
  /** 503 audit failures must not trigger Supabase fallback — data may be persisted. */
  function resolveTransport(status, code) {
    if (code === "audit_write_failed") return "business";
    return status >= 500 ? "server" : "business";
  }

  async function request(method, path, body, options) {
    var url = getApiBase() + path;
    var headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    try {
      var bearer = await resolveBearer();
      if (bearer) headers["Authorization"] = "Bearer " + bearer;
    } catch (ignore) {}
    if (options && options.idempotencyKey) {
      headers[IDEMPOTENCY_HEADER] = String(options.idempotencyKey);
    } else if (method !== "GET" && method !== "DELETE") {
      headers[IDEMPOTENCY_HEADER] = genIdempotencyKey();
    }

    var init = { method: method, headers: headers };
    if (body !== undefined && body !== null && method !== "GET") {
      init.body = JSON.stringify(body);
    }

    var response;
    try {
      response = await fetch(url, init);
    } catch (networkErr) {
      return {
        ok: false,
        status: 0,
        transport: "network",
        error: networkErr && networkErr.message ? networkErr.message : "Network error"
      };
    }

    var status = response.status;
    var text = "";
    try {
      text = await response.text();
    } catch (ignore) {
      text = "";
    }

    var json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (ignore) {
        json = null;
      }
    }

    // Canonical envelope: { success, data, error, code, details }
    if (json && typeof json.success === "boolean") {
      if (json.success) {
        return { ok: true, status: status, data: json.data };
      }
      return {
        ok: false,
        status: status,
        transport: resolveTransport(status, json.code || ""),
        error: json.error || ("HTTP " + status),
        code: json.code || "",
        details: json.details || null
      };
    }

    // Legacy envelope { ok, data, message } — be defensive.
    if (json && typeof json.ok === "boolean") {
      if (json.ok) return { ok: true, status: status, data: json.data };
      return {
        ok: false,
        status: status,
        transport: resolveTransport(status, json.code || ""),
        error: json.message || ("HTTP " + status),
        code: json.code || ""
      };
    }

    if (response.ok) {
      return { ok: true, status: status, data: json !== null ? json : text };
    }
    return {
      ok: false,
      status: status,
      transport: resolveTransport(status, ""),
      error: "HTTP " + status + (text ? ": " + text.slice(0, 200) : "")
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Receipts module (Phase 7a)
  // ──────────────────────────────────────────────────────────────────────────

  var receipts = {
    /** GET /billings/:id/receipts — returns active (non-soft-deleted) receipts. */
    list: function (billingId) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request("GET", "/billings/" + encodeURIComponent(billingId) + "/receipts");
    },

    /** POST /billings/:id/receipts — server validates + dispatches to hominal_save_receipt. */
    create: function (billingId, payload, idempotencyKey) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      var body = Object.assign({}, payload || {}, { billing_id: billingId });
      return request("POST", "/billings/" + encodeURIComponent(billingId) + "/receipts", body, {
        idempotencyKey: idempotencyKey || (payload && payload.id ? "receipt:" + payload.id : null)
      });
    },

    /** DELETE /billings/:id/receipts/:receiptId — server-enforced soft-delete + audit. */
    softDelete: function (billingId, receiptId, reason) {
      if (!billingId || !receiptId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId+receiptId required" });
      }
      return request(
        "DELETE",
        "/billings/" + encodeURIComponent(billingId) + "/receipts/" + encodeURIComponent(receiptId),
        { reason: reason || "" },
        { idempotencyKey: "receipt-del:" + receiptId }
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Billings module (Phase 7b)
  // ──────────────────────────────────────────────────────────────────────────

  var billings = {
    /** GET /billings?patient_id= — patient billing bundle from DB. */
    listByPatient: function (patientId) {
      if (!patientId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patientId required" });
      }
      return request("GET", "/billings?patient_id=" + encodeURIComponent(patientId));
    },

    /** GET /billings/:id — single bill + totals bundle. */
    getById: function (billingId) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request("GET", "/billings/" + encodeURIComponent(billingId));
    },

    /** POST /billings — ensure an Active bill exists for the patient. */
    create: function (payload) {
      return request("POST", "/billings", payload || {}, {
        idempotencyKey: payload && payload.patient_id ? "bill-create:" + payload.patient_id : null
      });
    },

    /**
     * POST /billings/sync — legacy upsert (honours client INVE… ids + Paused).
     * Mirrors `sbUpsert('hh_billings', [toSbBilling(...)])`.
     */
    sync: function (payload, idempotencyKey) {
      if (!payload || !payload.patient_id) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patient_id required" });
      }
      return request("POST", "/billings/sync", payload, {
        idempotencyKey: idempotencyKey || (payload.id ? "bill-sync:" + payload.id : "bill-sync:" + payload.patient_id)
      });
    },

    /** PATCH /billings/:id — sec_dep / notes only. */
    update: function (billingId, patch) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request("PATCH", "/billings/" + encodeURIComponent(billingId), patch || {});
    },

    /** POST /billings/:id/status — { status: "Active"|"Closed"|"Paused"|… } */
    setStatus: function (billingId, status) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request("POST", "/billings/" + encodeURIComponent(billingId) + "/status", { status: status });
    },

    /** POST /billings/:id/close — audited close with reason (+ optional force). */
    close: function (billingId, reason, otherReason, force) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request(
        "POST",
        "/billings/" + encodeURIComponent(billingId) + "/close",
        {
          reason: reason || "",
          close_reason_other: otherReason || "",
          force: !!force
        },
        { idempotencyKey: "bill-close:" + billingId }
      );
    },

    /** POST /billings/:id/reopen — requires reason string. */
    reopen: function (billingId, reason) {
      if (!billingId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "billingId required" });
      }
      return request(
        "POST",
        "/billings/" + encodeURIComponent(billingId) + "/reopen",
        { reason: reason || "" },
        { idempotencyKey: "bill-reopen:" + billingId }
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Service-entries (duty diary rows) — Phase 7c
  // ──────────────────────────────────────────────────────────────────────────

  var svcEntries = {
    /**
     * Atomically replace the entire svc_entries slice for a `svc_key`.
     * Server applies the close-bill guard + audit log.
     */
    replace: function (svcKey, rows) {
      if (!svcKey) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "svc_key required" });
      }
      return request(
        "POST",
        "/billings/svc-entries/replace",
        { svc_key: String(svcKey), rows: Array.isArray(rows) ? rows : [] },
        { idempotencyKey: "svc-replace:" + svcKey + ":" + Date.now() }
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Payout charges (per-partner) — Phase 7c
  // ──────────────────────────────────────────────────────────────────────────

  var payoutCharges = {
    /** Atomically replace the entire payout-charges slice for a `svc_key`. */
    replace: function (svcKey, rows) {
      if (!svcKey) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "svc_key required" });
      }
      return request(
        "POST",
        "/payouts/charges/replace",
        { svc_key: String(svcKey), rows: Array.isArray(rows) ? rows : [] },
        { idempotencyKey: "charge-replace:" + svcKey + ":" + Date.now() }
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Duty calendar (hh_duties) — Phase 7c
  // ──────────────────────────────────────────────────────────────────────────

  function dutyQueryString(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  var duties = {
    /** GET /duties — supports patient_id / employee_id / status / from / to. */
    list: function (params) {
      return request("GET", "/duties" + dutyQueryString(params));
    },

    /** GET /duties/:id */
    getById: function (dutyId) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request("GET", "/duties/" + encodeURIComponent(dutyId));
    },

    /** POST /duties — create a new duty. */
    create: function (payload) {
      return request("POST", "/duties", payload || {}, {
        idempotencyKey: payload && payload.id
          ? "duty-create:" + payload.id
          : null
      });
    },

    /** PATCH /duties/:id */
    update: function (dutyId, patch) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request("PATCH", "/duties/" + encodeURIComponent(dutyId), patch || {});
    },

    /** POST /duties/:id/cancel — body `{ reason }` (audited). */
    cancel: function (dutyId, reason) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request(
        "POST",
        "/duties/" + encodeURIComponent(dutyId) + "/cancel",
        { reason: reason || "" },
        { idempotencyKey: "duty-cancel:" + dutyId }
      );
    },

    /** POST /duties/:id/check-in */
    checkIn: function (dutyId, payload) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request(
        "POST",
        "/duties/" + encodeURIComponent(dutyId) + "/check-in",
        payload || {},
        { idempotencyKey: "duty-checkin:" + dutyId }
      );
    },

    /** POST /duties/:id/check-out */
    checkOut: function (dutyId, payload) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request(
        "POST",
        "/duties/" + encodeURIComponent(dutyId) + "/check-out",
        payload || {},
        { idempotencyKey: "duty-checkout:" + dutyId }
      );
    },

    /** POST /duties/:id/materialize — expand to per-day diary rows (optional dry_run). */
    materialize: function (dutyId, payload) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request(
        "POST",
        "/duties/" + encodeURIComponent(dutyId) + "/materialize",
        payload || {}
      );
    },

    /** GET /duties/totals — patient outstanding + partner payout pending. */
    totals: function (params) {
      return request("GET", "/duties/totals" + dutyQueryString(params));
    },

    /** POST /duties/:id/partners — replace extra_partners. */
    assignPartners: function (dutyId, payload) {
      if (!dutyId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "dutyId required" });
      }
      return request(
        "POST",
        "/duties/" + encodeURIComponent(dutyId) + "/partners",
        payload || {}
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Patients module (Phase 7d)
  // ──────────────────────────────────────────────────────────────────────────

  function patientQueryString(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  var patients = {
    /** GET /patients — paginated, supports q / status / caretaker_id. */
    list: function (params) {
      return request("GET", "/patients" + patientQueryString(params));
    },

    /** GET /patients/:id */
    getById: function (patientId) {
      if (!patientId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patientId required" });
      }
      return request("GET", "/patients/" + encodeURIComponent(patientId));
    },

    /** GET /patients/:id/history — bundle (billings + receipts + duties + audits). */
    history: function (patientId) {
      if (!patientId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patientId required" });
      }
      return request("GET", "/patients/" + encodeURIComponent(patientId) + "/history");
    },

    /**
     * POST /patients/sync — legacy upsert.
     *
     * Accepts the `toSbPatient()` column shape (legacy status enum,
     * `status_reason`, photo/docs blobs). Honours client-generated `PID…`
     * ids. Insert on missing/new id, update otherwise.
     */
    sync: function (payload, idempotencyKey) {
      if (!payload || !payload.name) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "name required" });
      }
      return request("POST", "/patients/sync", payload, {
        idempotencyKey: idempotencyKey || (payload.id ? "pat-sync:" + payload.id : null)
      });
    },

    /** POST /patients/:id/assign — caretaker assignment. */
    assignCaretaker: function (patientId, caretakerId, shift) {
      if (!patientId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patientId required" });
      }
      return request(
        "POST",
        "/patients/" + encodeURIComponent(patientId) + "/assign",
        { caretaker_id: caretakerId, shift: shift || "DAY" },
        { idempotencyKey: "pat-assign:" + patientId }
      );
    },

    /** DELETE /patients/:id — server-side soft-close (status=Closed). */
    remove: function (patientId) {
      if (!patientId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "patientId required" });
      }
      return request("DELETE", "/patients/" + encodeURIComponent(patientId), null, {
        idempotencyKey: "pat-del:" + patientId
      });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Employees module (Phase 7e)
  // ──────────────────────────────────────────────────────────────────────────

  function employeeQueryString(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  var employees = {
    /** GET /employees — paginated list. */
    list: function (params) {
      return request("GET", "/employees" + employeeQueryString(params));
    },

    /** GET /employees/:id */
    getById: function (employeeId) {
      if (!employeeId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "employeeId required" });
      }
      return request("GET", "/employees/" + encodeURIComponent(employeeId));
    },

    /** GET /employees/:id/links — duty/attendance/payout link counts. */
    links: function (employeeId) {
      if (!employeeId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "employeeId required" });
      }
      return request("GET", "/employees/" + encodeURIComponent(employeeId) + "/links");
    },

    /**
     * POST /employees/sync — legacy upsert (full `toSbEmployee()` shape).
     * Honours client `EMP…` ids. Insert on missing id, update otherwise.
     */
    sync: function (payload, idempotencyKey) {
      if (!payload || !payload.fn || !payload.phone) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "fn+phone required" });
      }
      return request("POST", "/employees/sync", payload, {
        idempotencyKey: idempotencyKey || (payload.id ? "emp-sync:" + payload.id : null)
      });
    },

    /** POST /employees/:id/status — { status, reason? } */
    setStatus: function (employeeId, status, reason) {
      if (!employeeId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "employeeId required" });
      }
      return request(
        "POST",
        "/employees/" + encodeURIComponent(employeeId) + "/status",
        { status: status, reason: reason || "" }
      );
    },

    /** DELETE /employees/:id — soft-delete when links exist, hard-delete otherwise. */
    remove: function (employeeId) {
      if (!employeeId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "employeeId required" });
      }
      return request("DELETE", "/employees/" + encodeURIComponent(employeeId), null, {
        idempotencyKey: "emp-del:" + employeeId
      });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Inquiries module (Phase 7f)
  // ──────────────────────────────────────────────────────────────────────────

  function inquiryQueryString(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  var inquiries = {
    /** GET /inquiries — paginated list (q, status, open_only, source, …). */
    list: function (params) {
      return request("GET", "/inquiries" + inquiryQueryString(params));
    },

    /** GET /inquiries/:id */
    getById: function (inquiryId) {
      if (!inquiryId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "inquiryId required" });
      }
      return request("GET", "/inquiries/" + encodeURIComponent(inquiryId));
    },

    /**
     * POST /inquiries/sync — legacy upsert (`toSbInquiry()` shape).
     * Honours client `INQ…` ids. Insert on missing id, update otherwise.
     */
    sync: function (payload, idempotencyKey) {
      if (!payload || !payload.name || !payload.phone) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "name+phone required" });
      }
      return request("POST", "/inquiries/sync", payload, {
        idempotencyKey: idempotencyKey || (payload.id ? "inq-sync:" + payload.id : null)
      });
    },

    /** POST /inquiries/:id/status — { status, followup_date? } */
    setStatus: function (inquiryId, status, followupDate) {
      if (!inquiryId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "inquiryId required" });
      }
      return request(
        "POST",
        "/inquiries/" + encodeURIComponent(inquiryId) + "/status",
        { status: status, followup_date: followupDate || "" }
      );
    },

    /** POST /inquiries/:id/convert — inquiry → patient (RPC). */
    convert: function (inquiryId, payload) {
      if (!inquiryId) {
        return Promise.resolve({ ok: false, status: 0, transport: "business", error: "inquiryId required" });
      }
      return request(
        "POST",
        "/inquiries/" + encodeURIComponent(inquiryId) + "/convert",
        payload || {},
        { idempotencyKey: "inq-convert:" + inquiryId }
      );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Reports module (Phase 7g) — read-only aggregates
  // ──────────────────────────────────────────────────────────────────────────

  function reportQueryString(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  // M10-G: read-only report helpers — no sync routes. Dashboard uses
  // DASHBOARD_READ_ROLES; financial totals use REPORT_READ_ROLES.
  var reports = {
    /** GET /reports/dashboard — KPI bundle for period / custom range. */
    dashboard: function (params) {
      return request("GET", "/reports/dashboard" + reportQueryString(params));
    },

    /** GET /reports/billing-totals */
    billingTotals: function (params) {
      return request("GET", "/reports/billing-totals" + reportQueryString(params));
    },

    /** GET /reports/payout-totals */
    payoutTotals: function (params) {
      return request("GET", "/reports/payout-totals" + reportQueryString(params));
    },

    /** GET /reports/profit-loss */
    profitLoss: function (params) {
      return request("GET", "/reports/profit-loss" + reportQueryString(params));
    },

    /** GET /reports/payroll — per-employee payout + attendance rollup. */
    payroll: function (params) {
      return request("GET", "/reports/payroll" + reportQueryString(params));
    }
  };

  root.legacyApi = root.legacyApi || {};
  root.legacyApi.receipts = receipts;
  root.legacyApi.billings = billings;
  root.legacyApi.svcEntries = svcEntries;
  root.legacyApi.payoutCharges = payoutCharges;
  root.legacyApi.duties = duties;
  root.legacyApi.patients = patients;
  root.legacyApi.employees = employees;
  root.legacyApi.inquiries = inquiries;
  root.legacyApi.reports = reports;

  // ──────────────────────────────────────────────────────────────────────────
  // Audits module (Phase 9) — read-only trail
  // ──────────────────────────────────────────────────────────────────────────

  var audits = {
    list: function (params) {
      return request("GET", "/audits" + reportQueryString(params));
    }
  };

  root.legacyApi.audits = audits;
  root.legacyApi._request = request;
})(typeof window !== "undefined" ? window : globalThis);
