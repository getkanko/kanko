// Generated from TypeScript. Run npm run runtime:build in editor-extension.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTES =
  exports.STOP_TYPES =
  exports.MODES =
  exports.SIDES =
  exports.ERROR_CODES =
  exports.PROTOCOL_VERSION =
    void 0;
const PROTOCOL_VERSION = 4;
exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
const ERROR_CODES = [
  "unauthorized",
  "protocol_mismatch",
  "bad_request",
  "file_not_found",
  "range_out_of_bounds",
  "git_failed",
  "no_active_editor",
  "content_drift",
  "diff_identity_mismatch",
  "invalid_tour_plan",
  "no_tour",
  "stale_presentation",
  "navigation_boundary",
];
exports.ERROR_CODES = ERROR_CODES;
const SIDES = ["base", "head", "working"];
exports.SIDES = SIDES;
const MODES = ["diff", "file"];
exports.MODES = MODES;
const STOP_TYPES = [
  "context",
  "implementation",
  "risk",
  "evidence",
  "limitation",
];
exports.STOP_TYPES = STOP_TYPES;
const ROUTES = {
  kanko_tour_status: { method: "GET", path: "/status" },
  kanko_tour_load: { method: "POST", path: "/tour/load" },
  kanko_tour_navigate: { method: "POST", path: "/tour/navigate" },
  kanko_tour_set_state: { method: "POST", path: "/tour/state" },
  kanko_tour_clear: { method: "POST", path: "/clear" },
  kanko_diagram_put: { method: "POST", path: "/diagram/put" },
  kanko_diagram_skip: { method: "POST", path: "/diagram/skip" },
  kanko_diagram_stream: { method: "POST", path: "/diagram/stream" },
  kanko_diagram_pin: { method: "POST", path: "/diagram/pin" },
  kanko_await_reviewer: { method: "POST", path: "/reviewer/await" },
};
exports.ROUTES = ROUTES;
