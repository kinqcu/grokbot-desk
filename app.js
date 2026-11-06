/* Plan B iPhone app. Polls JSON via #d= fragment. No hardcoded FOMO URLs. */
(function () {
  "use strict";

  const TZ = "Pacific/Auckland";
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const SETTING_GROUPS = [
    ["scanner", "Scanner"],
    ["auditor", "Auditor"],
    ["analyst", "Analyst"],
    ["executor", "Executor"],
    ["risk", "Risk"],
    ["desk", "Desk"],
    ["copytrade", "Copy trade"],
  ];

  const view = document.getElementById("view");
  const errorBar = document.getElementById("error-bar");
  const tabbar = document.getElementById("tabbar");
  const modalRoot = document.getElementById("modal-root");
  const toastEl = document.getElementById("toast");

  const S = {
    d: null,
    t: null,
    route: { name: "home" },
    returnTab: "home",
    loading: true,
    error: null,
    retryIn: 0,
    lastUpdate: null,
    range: "LIVE",
    state: null,
    chart: null,
    activity: null,
    account: null,
    settings: null,
    positions: null,
    meta: null,
    decisions: {},
    coin: null,
    audit: null,
    homeAudit: null,
    searchOpen: false,
    searchQ: "",
    bellOpen: false,
    seenId: Number(localStorage.getItem("desk_seen_activity") || 0),
    auditPlayed: {},
    auditAnimating: false,
    modal: null,
    section: null,
  };

  let fail = 0;
  let tickTimer = null;
  let pollTimer = null;
  let toastTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function safeUrl(u) {
    if (!u) return "";
    try {
      const x = new URL(String(u), location.href);
      if (x.protocol === "http:" || x.protocol === "https:") return x.href;
    } catch (e) {}
    return "";
  }

  function parseHash(raw) {
    const h = (raw || "").startsWith("#") ? raw.slice(1) : raw || "";
    const params = {};
    let route = null;
    if (!h) return { params: params, route: route };
    if (h.startsWith("/")) {
      route = parseRoute(h);
      return { params: params, route: route };
    }
    h.split("&").forEach(function (p) {
      if (!p) return;
      if (p.startsWith("/")) {
        route = parseRoute(p);
        return;
      }
      const i = p.indexOf("=");
      if (i < 0) params[decodeURIComponent(p)] = "";
      else params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
    });
    return { params: params, route: route };
  }

  function parseRoute(path) {
    const segs = String(path || "").replace(/^#/, "").split("/").filter(Boolean);
    const name = segs[0] || "home";
    if ((name === "coin" || name === "audit") && segs[1]) return { name: name, mint: segs[1] };
    if (name === "auditor" && segs[1]) return { name: "audit", mint: segs[1] };
    if (["home", "agents", "activity", "account"].indexOf(name) >= 0) return { name: name };
    return { name: "home" };
  }

  function routeToHash(route) {
    if (!route || route.name === "home") return "#/home";
    if ((route.name === "coin" || route.name === "audit") && route.mint) {
      return "#/" + route.name + "/" + encodeURIComponent(route.mint);
    }
    return "#/" + route.name;
  }

  function go(route) {
    if (["home", "agents", "activity", "account"].indexOf(route.name) >= 0) S.returnTab = route.name;
    S.route = route;
    const h = routeToHash(route);
    if (location.hash !== h) location.hash = h;
    else {
      loadRouteExtras().then(function () { render(true); });
    }
  }

  function captureBoot() {
    const parsed = parseHash(location.hash);
    if (parsed.params.d) localStorage.setItem("desk_data_path", parsed.params.d);
    if (parsed.params.t) localStorage.setItem("desk_app_token", parsed.params.t);
    const qs = new URLSearchParams(location.search);
    let route = parsed.route;
    if (!route && qs.get("screen")) {
      const screen = qs.get("screen");
      const mint = qs.get("mint");
      if ((screen === "coin" || screen === "audit" || screen === "auditor") && mint) {
        route = { name: screen === "auditor" ? "audit" : screen, mint: mint };
      } else {
        route = { name: screen === "auditor" ? "audit" : screen };
      }
    }
    if (parsed.params.d || parsed.params.t || qs.get("screen")) {
      history.replaceState(null, "", location.pathname + routeToHash(route || { name: "home" }));
    }
    S.d = localStorage.getItem("desk_data_path");
    S.t = localStorage.getItem("desk_app_token");
    S.route = route || parseRoute((location.hash || "").slice(1) || "/home");
    if (["home", "agents", "activity", "account"].indexOf(S.route.name) >= 0) S.returnTab = S.route.name;
  }

  function base() { return "d/" + S.d + "/"; }

  function parseT(t) {
    if (t == null) return NaN;
    return Date.parse(t);
  }

  function formatNZ(iso, opt) {
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-NZ", Object.assign({ timeZone: TZ }, opt || { hour: "numeric", minute: "2-digit", hour12: true })).format(d);
  }

  function formatTime(iso) {
    return formatNZ(iso).replace(" ", "").toLowerCase();
  }

  function formatAge(iso) {
    const ms = parseT(iso);
    if (isNaN(ms)) return "";
    const sec = Math.max(0, (Date.now() - ms) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return Math.floor(sec / 60) + "m old";
    if (sec < 86400) return Math.floor(sec / 3600) + "h old";
    return Math.floor(sec / 86400) + "d old";
  }

  function formatBalance(n) {
    if (n == null || isNaN(Number(n))) return null;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatMoney(n) {
    const s = formatBalance(n);
    return s == null ? "—" : "$" + s;
  }

  function formatPct(n, digits) {
    if (n == null || isNaN(Number(n))) return "—";
    const x = Number(n);
    const d = digits == null ? 2 : digits;
    return (x >= 0 ? "+" : "") + x.toFixed(d) + "%";
  }

  function formatPrice(n) {
    if (n == null || isNaN(Number(n))) return "—";
    const x = Number(n);
    if (x === 0) return "0";
    if (Math.abs(x) >= 1) {
      return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }
    return String(Number(x.toPrecision(4)));
  }

  function formatMult(n) {
    if (n == null || isNaN(Number(n))) return "—";
    return Number(n).toFixed(2) + "\u00d7";
  }

  function shortMint(m) {
    if (!m) return "";
    if (m.length <= 10) return m;
    return m.slice(0, 4) + "\u2026" + m.slice(-4);
  }

  function setting(key) {
    const s = S.settings && S.settings.settings;
    return s ? s[key] : undefined;
  }

  function isPaper() {
    const mode = (S.state && S.state.mode) || (S.account && S.account.mode) || "PAPER";
    return String(mode).toUpperCase() !== "LIVE";
  }

  function paperBadge() {
    return isPaper() ? '<span class="paper-pill">PAPER</span>' : "";
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }

  const ICO = {
    search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>'),
    bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    back: svg('<path d="M15 19l-7-7 7-7"/>'),
    home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10.5V20h12v-9.5"/>'),
    agents: svg('<circle cx="8" cy="9" r="2.2"/><circle cx="16" cy="9" r="2.2"/><path d="M4.5 17c.6-2 2.2-3 3.5-3s2.9 1 3.5 3"/><path d="M12.5 17c.6-2 2.2-3 3.5-3s2.9 1 3.5 3"/>'),
    activity: svg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4.5" cy="7" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17" r="1"/>'),
    account: svg('<circle cx="12" cy="9" r="3"/><path d="M5 19c1.2-3 3.4-4.5 7-4.5S17.8 16 19 19"/>'),
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function showModal(opts) { S.modal = opts; drawModal(); }
  function hideModal() { S.modal = null; modalRoot.innerHTML = ""; }

  function drawModal() {
    const m = S.modal;
    if (!m) { modalRoot.innerHTML = ""; return; }
    modalRoot.innerHTML =
      '<div class="modal-bg"><div class="modal" role="dialog"><h3>' + esc(m.title || "") + "</h3>" +
      (m.body ? "<p>" + esc(m.body) + "</p>" : "") +
      (m.input ? '<input id="modal-input" type="text" autocomplete="off"/>' : "") +
      '<div class="btns"><button class="primary" id="modal-ok">' + esc(m.confirm || "OK") +
      '</button><button id="modal-cancel">Cancel</button></div></div></div>';
    document.getElementById("modal-cancel").onclick = hideModal;
    document.getElementById("modal-ok").onclick = function () {
      const val = m.input ? (document.getElementById("modal-input") || {}).value : undefined;
      if (m.onok && m.onok(val) === false) return;
      hideModal();
    };
  }

  function noteReadOnly() {
    toast("Changes go through Discord or the Grok Bot chat.");
  }

  async function fetchJson(rel) {
    const res = await fetch(base() + rel + (rel.indexOf("?") >= 0 ? "&" : "?") + "ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadCore() {
    const pack = await Promise.all([
      fetchJson("state.json"),
      fetchJson("chart.json"),
      fetchJson("activity.json"),
      fetchJson("account.json"),
      fetchJson("settings.json"),
      fetchJson("positions.json"),
      fetchJson("meta.json").catch(function () { return { plan: "B" }; }),
    ]);
    S.state = pack[0];
    S.chart = pack[1];
    S.activity = pack[2];
    S.account = pack[3];
    S.settings = pack[4];
    S.positions = pack[5];
    S.meta = pack[6];
    const decs = await Promise.all(AGENTS.map(function (n) {
      return fetchJson("agents/" + n + "/decisions.json").catch(function () {
        return { name: n, decisions: [] };
      });
    }));
    S.decisions = {};
    AGENTS.forEach(function (n, i) { S.decisions[n] = (decs[i] && decs[i].decisions) || []; });
    const audAgent = (S.state.agents || []).find(function (a) { return a.name === "auditor"; }) || {};
    const audMint = (audAgent.card && audAgent.card.latest && audAgent.card.latest.mint) ||
      (((S.activity.rows || []).find(function (r) { return r.agent === "auditor" && r.mint; }) || {}).mint);
    if (audMint) {
      try { S.homeAudit = await fetchJson("audit/" + encodeURIComponent(audMint) + ".json"); } catch (e) {}
    }
  }

  async function loadRouteExtras() {
    const r = S.route;
    if (r.name === "coin" && r.mint) {
      S.coin = await fetchJson("coin/" + encodeURIComponent(r.mint) + ".json").catch(function () { return null; });
      S.audit = await fetchJson("audit/" + encodeURIComponent(r.mint) + ".json").catch(function () { return null; });
    } else if (r.name === "audit" && r.mint) {
      S.audit = await fetchJson("audit/" + encodeURIComponent(r.mint) + ".json").catch(function () { return null; });
      S.coin = await fetchJson("coin/" + encodeURIComponent(r.mint) + ".json").catch(function () {
        return S.coin && S.coin.mint === r.mint ? S.coin : null;
      });
    }
  }

  function scheduleRetry(sec) {
    S.retryIn = sec;
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      S.retryIn = Math.max(0, S.retryIn - 1);
      drawError();
      if (S.retryIn <= 0) { clearInterval(tickTimer); poll(); }
    }, 1000);
  }

  async function poll() {
    if (!S.d) {
      S.loading = false;
      S.error = { msg: "Open the private app link once so this page can find its data." };
      render(true);
      return;
    }
    try {
      await loadCore();
      await loadRouteExtras();
      fail = 0;
      S.error = null;
      S.loading = false;
      S.lastUpdate = (S.state && S.state.updated_at) || new Date().toISOString();
      S.retryIn = 0;
      clearInterval(tickTimer);
      render(false);
      window.__DESK_READY = true;
    } catch (e) {
      fail += 1;
      const retry = Math.min(30, 5 + fail * 2);
      S.error = { retry: retry, time: S.lastUpdate };
      S.retryIn = retry;
      if (!S.state) S.loading = true;
      render(false);
      scheduleRetry(retry);
    }
  }

  function drawError() {
    if (!S.error) { errorBar.hidden = true; errorBar.textContent = ""; return; }
    errorBar.hidden = false;
    if (S.error.msg && !S.error.retry) { errorBar.textContent = S.error.msg; return; }
    const when = S.error.time ? formatTime(S.error.time) : "\u2014";
    errorBar.textContent = "Desk offline \u00b7 retrying in " + (S.retryIn || S.error.retry || 0) + "s \u00b7 last update " + when;
  }

  function unread() {
    const rows = (S.activity && S.activity.rows) || [];
    return rows.length ? Number(rows[0].id || 0) > S.seenId : false;
  }

  function markSeen() {
    const rows = (S.activity && S.activity.rows) || [];
    if (rows[0] && rows[0].id) {
      S.seenId = Number(rows[0].id);
      localStorage.setItem("desk_seen_activity", String(S.seenId));
    }
  }

  function agentBy(name) {
    return ((S.state && S.state.agents) || []).find(function (a) { return a.name === name; }) || { name: name, status: "idle", card: {} };
  }

  function runningCount() {
    return ((S.state && S.state.agents) || []).filter(function (a) { return a.status === "running"; }).length;
  }

  function filterPoints(points, range) {
    const pts = points || [];
    if (!pts.length || range === "ALL" || range === "LIVE") return pts.slice();
    const map = { "1H": 3600e3, "4H": 4 * 3600e3, "1D": 86400e3, "1W": 7 * 86400e3 };
    const win = map[range];
    if (!win) return pts.slice();
    const last = parseT(pts[pts.length - 1].t);
    if (isNaN(last)) return pts.slice();
    return pts.filter(function (p) { return parseT(p.t) >= last - win; });
  }

  function markLabel(m) {
    const kind = String(m.kind || "");
    const label = String(m.label || "");
    const value = String(m.value || "");
    if (kind === "bought") {
      const name = label.replace(/^Copy-bought\s+/i, "").replace(/^Bought\s+/i, "");
      return "Bought " + (name || "coin");
    }
    if (kind === "sold") {
      const hit = value.match(/\+\$[0-9,.]+/);
      return hit ? hit[0] : value || label;
    }
    if (kind === "stopped") {
      const stop = setting("risk.stop_pct");
      const loss = value.match(/-\$[0-9,.]+/);
      const pct = stop != null ? "-" + Number(stop) + "%" : "";
      return [pct, loss ? loss[0] : value].filter(Boolean).join(" \u00b7 ");
    }
    return label || value;
  }

  function skel(w, h, extra) {
    return '<div class="skel" style="width:' + w + ";height:" + h + ";" + (extra || "") + '"></div>';
  }

  function renderHomeLoading() {
    return navbarHTML() +
      '<div class="home-hero">' + skel("70%", "72px", "border-radius:12px") +
      '<div style="height:12px"></div>' + skel("40%", "22px") + "</div>" +
      '<div class="chart-wrap">' + skel("100%", "176px", "border-radius:0") + "</div>" +
      '<div class="section-h"><h2>Agents</h2></div>' +
      '<div class="carousel"><div class="agent-card">' + skel("40%", "20px") + "</div></div>" +
      '<div class="section-h"><h2>Activity</h2></div>' +
      '<div class="rows">' + [0,1,2,3,4].map(function () { return '<div style="padding:10px 0">' + skel("100%", "44px") + "</div>"; }).join("") + "</div>";
  }

  function navbarHTML() {
    const handle = (S.account && S.account.fomo_handle) || "";
    const initial = (handle || "G").trim().charAt(0).toUpperCase();
    const dot = unread() ? '<span class="bell-dot"></span>' : "";
    return '<div class="navbar">' +
      '<button class="avatar-btn" id="nav-avatar" aria-label="Account">' + esc(initial) + "</button>" +
      '<div class="title">Grok Bot <span class="chev">\u203a</span></div>' +
      '<button class="icon-btn" id="nav-search" aria-label="Search">' + ICO.search + "</button>" +
      '<button class="icon-btn" id="nav-bell" aria-label="Notifications">' + ICO.bell + dot + "</button></div>";
  }

  function backNav() {
    return '<div class="back-nav"><button class="back" id="btn-back">' + ICO.back + " Back</button></div>";
  }

  function rangeHTML() {
    return '<div class="range-switch">' + RANGES.map(function (r) {
      return '<button data-range="' + r + '" class="' + (S.range === r ? "on" : "") + '">' + r + "</button>";
    }).join("") + "</div>";
  }

  function activityRowHTML(row, i) {
    if (!row) return "";
    const title = row.title || "";
    const sub = row.subtitle || "";
    const val = row.value || "";
    let rhsClass = "";
    if (/^\+\$/.test(val) || /^\+/.test(val)) rhsClass = "up";
    else if (/^-\$/.test(val) || (row.kind === "stopped" && val)) rhsClass = "down";
    else if (/^skip/i.test(val)) rhsClass = "skip";
    return '<button class="row" data-act="' + i + '"><div class="mid"><div class="ttl">' + esc(title) +
      '</div><div class="sub">' + esc(sub) + '</div></div><div class="rhs ' + rhsClass + '">' + esc(val) + "</div></button>";
  }

  function wrapCard(a, title, accent, sub, body) {
    return '<article class="agent-card" data-agent="' + esc(a.name) + '"><h3 class="' + accent +
      '"><span class="status-dot ' + esc(a.status || "") + '"></span>' + esc(title) +
      "</h3><div class='sub'>" + esc(sub || "") + '</div><div class="body">' + body + "</div></article>";
  }

  function scannerCard(a) {
    const card = a.card || {};
    const feed = card.feed && card.feed.length ? card.feed : S.decisions.scanner || [];
    const pools = card.pools;
    const sub = pools != null ? pools + " pools" : "";
    let body = "";
    if (!feed.length) body = '<div class="empty-inline">Listening for graduations</div>';
    else {
      body = '<div class="feed">' + feed.slice(0, 6).map(function (f) {
        const killed = String(f.verdict || "").toLowerCase() !== "pass";
        const sym = f.symbol || f.name || shortMint(f.mint);
        if (killed) {
          return '<div class="feed-row killed"><span class="sym">' + esc(sym) + '</span><span class="reason">' + esc(f.reason || "") + "</span></div>";
        }
        return '<div class="feed-row passed"><span class="sym">' + esc(sym) + '</span><span class="go">\u2192 auditor</span></div>';
      }).join("") + "</div>";
    }
    return wrapCard(a, "Scanner", "accent-scanner", sub, body);
  }

  function auditorCard(a) {
    const card = a.card || {};
    const taken = card.taken_apart;
    const rejected = card.rejected;
    const audit = S.homeAudit;
    const layers = (audit && audit.layers) || [];
    let strips = '<div class="strips">';
    for (let i = 0; i < 8; i++) {
      const L = layers[i] || {};
      const cls = L.pass === true ? "pass" : L.pass === false ? "fail" : "";
      strips += '<div class="strip ' + cls + '"></div>';
    }
    strips += "</div>";
    let status = "";
    if (audit && audit.cleared) status = '<div class="auditor-status ok">8/8 \u2192 Executor</div>';
    else if (audit && audit.layers) {
      const bad = audit.layers.find(function (l) { return l.pass === false; });
      if (bad) status = '<div class="auditor-status fail">' + esc(bad.value || bad.name || "rejected") + "</div>";
      else if (audit.layers.some(function (l) { return l.pass == null && !l.value && !l.name; })) {
        status = '<div class="auditor-status">taking apart...</div>';
      }
    }
    const sub = taken != null ? taken + " taken apart" : "";
    const foot = rejected != null ? '<div class="muted" style="margin-top:10px">' + rejected + " rejected</div>" : "";
    return wrapCard(a, "Auditor", "", sub, strips + status + foot);
  }

  function analystCard(a) {
    const card = a.card || {};
    let score = card.latest && card.latest.score;
    if (score == null) {
      const d = (S.decisions.analyst || [])[0];
      if (d && d.detail) {
        const m = String(d.detail).match(/score=(-?\d+)/);
        if (m) score = Number(m[1]);
      }
    }
    const body = '<div class="score-wrap"><canvas class="score-canvas" width="96" height="96"></canvas>' +
      '<div><div class="score-num">' + (score == null ? "\u2014" : esc(String(score))) +
      '</div><div class="muted">0\u2013100 \u00b7 green from 70</div></div></div>';
    return wrapCard(a, "Analyst", "accent-analyst", "Scoring", body);
  }

  function executorCard(a) {
    const card = a.card || {};
    const trades = card.trades != null ? card.trades : ((S.activity && S.activity.rows) || []).filter(function (r) { return r.kind === "bought"; }).length;
    const last = card.last || {};
    let size = last.size_usd;
    let pct = last.stack_pct;
    if (size == null) {
      const d = (S.decisions.executor || [])[0];
      if (d && d.detail) {
        const m = String(d.detail).match(/\$([0-9.]+)\s*\u00b7\s*([0-9.]+)%/);
        if (m) { size = Number(m[1]); pct = Number(m[2]); }
      }
    }
    const status = String(last.status || "");
    const filled = !status || /bought|filled|copytrade/i.test(status);
    const line = size != null ? formatMoney(size) + (pct != null ? " \u00b7 " + Number(pct) + "% of stack" : "") : "";
    const barW = filled ? 100 : 40;
    const state = filled ? "\u2713 Filled" : "Executing... " + barW + "%";
    const body = (line ? '<div class="exec-line">' + esc(line) + "</div>" : "") +
      '<div class="bar"><i style="width:' + barW + '%"></i></div><div class="exec-state">' + esc(state) + "</div>";
    return wrapCard(a, "Executor", "accent-executor", trades + " trades", body);
  }

  function riskCard(a) {
    const card = a.card || {};
    const stop = card.stop_pct != null ? card.stop_pct : setting("risk.stop_pct");
    const trail = card.trail_pct != null ? card.trail_pct : setting("risk.trail_pct");
    const last = card.last || {};
    const blob = String(last.subtitle || last.title || last.kind || "");
    let headline = "Guarding";
    if (last.kind === "stopped" || /(^| )stop/i.test(blob)) headline = "Stopped";
    if (/trail/i.test(blob)) headline = "Trailed out";
    const pills = '<div class="pill-row">' +
      (stop != null ? '<span class="pill red">stop -' + esc(String(stop)) + "%</span>" : "") +
      (trail != null ? '<span class="pill green">trail ' + esc(String(trail)) + "%</span>" : "") +
      "</div>";
    return wrapCard(a, "Risk", "accent-risk", "Guarding", '<div class="exec-line">' + esc(headline) + "</div>" + pills);
  }

  function renderHome() {
    if (S.loading && !S.state) return renderHomeLoading();
    const pct = S.state ? Number(S.state.today_pct || 0) : 0;
    const pctCls = pct >= 0 ? "up" : "down";
    const rows = ((S.activity && S.activity.rows) || []).slice(0, 5);
    const cards = {
      scanner: scannerCard(agentBy("scanner")),
      auditor: auditorCard(agentBy("auditor")),
      analyst: analystCard(agentBy("analyst")),
      executor: executorCard(agentBy("executor")),
      risk: riskCard(agentBy("risk")),
    };
    const actBody = rows.length ? rows.map(activityRowHTML).join("") :
      '<div class="empty-inline" style="padding:8px 0 24px">Nothing yet tonight</div>';
    return navbarHTML() +
      '<div class="home-hero"><div class="balance-row"><div class="odo" id="balance-odo"></div>' + paperBadge() +
      '</div><div class="home-meta"><div class="today-pct ' + pctCls + '">' + formatPct(pct) +
      ' today</div><div class="mult-pill">' + formatMult(S.state && S.state.multiplier) +
      "</div></div></div>" +
      '<div class="chart-wrap"><canvas id="home-chart"></canvas><div class="chart-empty" id="home-chart-empty" hidden><div class="dash"></div>Waiting for the first trade</div></div>' +
      rangeHTML() +
      '<div class="section-h"><h2>Agents \u00b7 ' + runningCount() + ' running</h2><button class="linkish" id="goto-agents">See all</button></div>' +
      '<div class="carousel">' + AGENTS.map(function (n) { return cards[n]; }).join("") + "</div>" +
      '<div class="section-h"><h2>Activity</h2><button class="linkish" id="goto-activity">See all</button></div>' +
      '<div class="rows">' + actBody + "</div>";
  }

  function switchHTML(name, on, locked) {
    return '<button class="switch' + (on ? " on" : "") + (locked ? " locked" : "") +
      '" data-pause="' + esc(name) + '" aria-label="Pause ' + esc(name) + '"><i></i></button>';
  }

  function renderAgents() {
    const openPos = ((S.positions && S.positions.open) || []).length > 0;
    const html = ['<div class="page-title">Agents</div><div class="page-pad">'];
    html.push('<p class="note">Pause and resume are read-only on this host. Changes go through Discord or the Grok Bot chat.</p>');
    AGENTS.forEach(function (name) {
      const a = agentBy(name);
      const locked = name === "risk" && openPos;
      const dec = S.decisions[name] || [];
      html.push('<section class="agent-full" id="agent-' + name + '">');
      html.push('<div class="head"><span class="status-dot ' + esc(a.status || "") + '"></span><h3>' +
        esc(name[0].toUpperCase() + name.slice(1)) + '</h3><div class="count">' +
        esc(String((function () {
          const card = a.card || {};
          if (name === "scanner" && card.pools != null) return card.pools;
          if (name === "auditor" && card.taken_apart != null) return card.taken_apart;
          if (name === "executor" && card.trades != null) return card.trades;
          return a.today_count != null ? a.today_count : dec.length;
        })())) + " today</div>" +
        switchHTML(name, !a.paused, locked) + "</div>");
      if (locked) html.push('<div class="muted">Risk stays on while a position is open.</div>');
      html.push('<div class="decisions">');
      if (!dec.length) html.push('<div class="empty-inline">No decisions yet</div>');
      dec.slice(0, 20).forEach(function (d) {
        const href = safeUrl(d.coin_url);
        const label = (d.symbol || d.name || shortMint(d.mint) || "").trim();
        const coin = href
          ? '<a class="coin" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(label || "coin") + "</a>"
          : '<span class="coin">' + esc(label) + "</span>";
        html.push('<div class="dec"><time>' + esc(formatTime(d.ts)) + "</time><div>" + coin +
          ' \u00b7 <span class="verdict">' + esc(d.verdict || "") + '</span><div class="reason">' +
          esc(d.reason || d.detail || "") + "</div></div></div>");
      });
      html.push("</div>");
      html.push('<button class="settings-link" data-settings="' + name + '">Settings</button>');
      html.push("</section>");
    });
    html.push("</div>");
    return html.join("");
  }

  function renderActivity() {
    const rows = (S.activity && S.activity.rows) || [];
    const body = rows.length
      ? '<div class="rows">' + rows.map(activityRowHTML).join("") + "</div>"
      : '<div class="empty-page">Nothing yet tonight</div>';
    return '<div class="page-title">Activity</div>' + body;
  }

  function layerNames() {
    return ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundles", "Delegations"];
  }

  function auditorControls() {
    const on = setting("auditor.enabled") !== false && setting("auditor.enabled") !== "false";
    return '<div class="toggle-row"><div>Take apart before buying</div>' +
      switchHTML("auditor.enabled", on, false).replace("data-pause=", "data-auditor=") +
      "</div><p class=\"note\" style=\"padding-left:16px;padding-right:16px\">Turning this off asks twice. Changes go through Discord or the Grok Bot chat.</p>";
  }

  function renderAuditor() {
    if (S.loading && !S.audit) {
      return backNav() + '<div class="page-pad">' + skel("100%", "220px") + "</div>";
    }
    const audit = S.audit;
    const layers = (audit && audit.layers) || [];
    const has = layers.some(function (l) { return l && (l.name || l.value || l.pass != null || l.ts); });
    if (!audit || !has) {
      return backNav() + '<div class="empty-page">No coin taken apart yet</div>' + auditorControls();
    }
    const coin = S.coin || {};
    const name = coin.name || coin.symbol || shortMint(audit.mint);
    const names = layerNames();
    let discs = '<div class="disc-stack" id="disc-stack">';
    for (let i = 0; i < 8; i++) {
      const top = 6 + i * 13;
      discs += '<div class="disc" data-i="' + i + '" style="top:' + top + "px;z-index:" + (8 - i) + '">' + (i + 1) + "</div>";
    }
    discs += '<div class="beam" id="audit-beam"></div></div>';
    let rows = '<div class="layer-rows">';
    for (let i = 0; i < 8; i++) {
      const L = layers[i] || {};
      const nm = L.name || names[i];
      const val = L.value == null ? "" : L.value;
      const cls = L.pass === true ? "pass" : L.pass === false ? "fail" : "";
      rows += '<div class="layer-row ' + cls + '" data-i="' + i + '"><span class="name">' + esc(nm) +
        '</span><span class="val">' + esc(val) + "</span></div>";
    }
    rows += "</div>";
    const bad = layers.find(function (l) { return l.pass === false; });
    let result = "";
    if (audit.cleared) {
      result = '<div class="audit-result ok"><h2>Cleared \u00b7 8/8 parts</h2><div>Sent to Executor</div></div>';
    } else if (bad) {
      result = '<div class="audit-result fail"><h2>Rejected \u00b7 ' + esc(bad.value || bad.name || "") +
        "</h2><div>Grok Bot won't buy " + esc(coin.symbol || coin.name || "this coin") + "</div></div>";
    }
    const href = safeUrl(audit.coin_url || (coin && coin.coin_url));
    const btn = href ? '<a class="fomo-btn" href="' + esc(href) + '" target="_blank" rel="noopener">Open on FOMO</a>' : "";
    return backNav() + '<div class="audit-hero"><h1>' + esc(name) + "</h1></div>" + discs + rows + result + auditorControls() + btn;
  }

  function copytradeExits(coin) {
    const el = (coin && coin.exit_lines) || {};
    if (el.kind === "copytrade" && el.exits && el.exits.length) return el;
    const pos = coin && coin.position;
    if (!pos || pos.source !== "copytrade") return el;
    const tp = Number(el.take_profit_x != null ? el.take_profit_x : setting("copytrade.take_profit_x") || 10);
    const lock = el.lock_at_nz || setting("copytrade.lock_at_nz");
    const entry = pos.entry_price != null ? Number(pos.entry_price) : null;
    const tpPrice = el.take_profit_price != null ? el.take_profit_price : entry != null ? entry * tp : null;
    return {
      kind: "copytrade",
      take_profit_x: tp,
      take_profit_price: tpPrice,
      lock_at_nz: lock,
      lock_label: el.lock_label || "06:30 NZDT",
      trader: el.trader || pos.trader,
      exits: [
        { id: "trader_sell", label: "trader sell" },
        { id: "take_profit", label: tp + "x", price: tpPrice },
        { id: "lock", label: "06:30 NZDT", at: lock },
      ],
    };
  }

  function renderCoin() {
    if (S.loading && !S.coin) return backNav() + '<div class="page-pad">' + skel("100%", "280px") + "</div>";
    const coin = S.coin;
    if (!coin) return backNav() + '<div class="empty-page">No coin data</div>';
    const pos = coin.position;
    const name = coin.name || coin.symbol || shortMint(coin.mint);
    const symbol = coin.symbol || "";
    const rawChain = coin.chain || "Solana";
    const chain = rawChain.charAt(0).toUpperCase() + rawChain.slice(1);
    const age = formatAge(coin.migrated_at || (pos && pos.opened_at));
    const kickerBits = [symbol, chain, age].filter(Boolean);
    const hasAudit = S.audit && S.audit.layers && S.audit.layers.some(function (l) { return l.pass != null || l.value || l.name; });
    const shield = hasAudit
      ? '<button class="shield" id="open-audit">' + esc(String(S.audit.passed)) + "/" + esc(String(S.audit.total || 8)) + "</button>"
      : "";
    const price = coin.price;
    let since = "";
    if (price != null && pos && pos.entry_price) {
      const p = ((Number(price) - Number(pos.entry_price)) / Number(pos.entry_price)) * 100;
      since = '<div class="since ' + (p >= 0 ? "up" : "down") + '">' + (p >= 0 ? "\u25b2 " : "\u25bc ") + formatPct(p) + " since entry</div>";
    }
    const stats = coin.stats || {};
    function stat(label, value) {
      return '<div class="stat"><div class="lbl">' + esc(label) + '</div><div class="num">' + esc(value == null || value === "" ? "n/a" : value) + "</div></div>";
    }
    function moneyOrNA(v) { return v == null ? "n/a" : formatMoney(v); }
    const holders = stats.holders != null ? stats.holders : coin.holders;
    const statsHTML = '<div class="stats">' +
      stat("Market cap", moneyOrNA(stats.market_cap)) +
      stat("Liquidity", moneyOrNA(stats.liquidity)) +
      stat("24h volume", moneyOrNA(stats.volume_h24)) +
      stat("Holders", holders == null ? "n/a" : Number(holders).toLocaleString("en-US")) +
      "</div>";

    let posHTML = "";
    let exitHTML = "";
    if (pos) {
      const who = pos.source === "copytrade" ? "copytrade" : "Executor";
      posHTML = '<div class="pos-card"><h3>Your position \u00b7 ' + esc(formatMoney(pos.size_usd)) + " in \u00b7 " +
        esc(who) + (pos.trader ? " \u00b7 " + esc(pos.trader) : "") + "</h3>" +
        '<div class="exit-row"><span class="k">Entry</span><span class="v">' + esc(formatPrice(pos.entry_price)) + "</span></div>" +
        (pos.qty_remaining != null && Number(pos.qty_remaining) < 1
          ? '<div class="exit-row"><span class="k">Remaining</span><span class="v">' + esc((Number(pos.qty_remaining) * 100).toFixed(0) + "%") + "</span></div>"
          : "") +
        "</div>";
      const el = copytradeExits(coin);
      if (el && el.kind === "copytrade") {
        const rows = (el.exits || []).map(function (ex) {
          let right = "";
          if (ex.id === "trader_sell") right = el.trader ? "when " + el.trader + " sells" : "when they sell";
          else if (ex.id === "take_profit") right = (ex.label || "10x") + (ex.price != null ? " \u00b7 " + formatPrice(ex.price) : "");
          else if (ex.id === "lock") right = el.lock_label || ex.label || "06:30 NZDT";
          const left = ex.id === "trader_sell" ? "Trader sell" : ex.id === "take_profit" ? "Take profit" : "Lock";
          return '<div class="exit-row"><span class="k">' + esc(left) + '</span><span class="v">' + esc(right) + "</span></div>";
        });
        exitHTML = '<div class="exit-card"><h3>Exits</h3>' + rows.join("") + "</div>";
      } else if (el && el.kind === "desk") {
        const stop = el.stop_price;
        const trail = el.trail_price;
        let left = "";
        if (pos.opened_at && el.timeout_h) {
          const end = parseT(pos.opened_at) + Number(el.timeout_h) * 3600e3;
          const remain = end - Date.now();
          if (remain > 0) {
            const h = Math.floor(remain / 3600e3);
            const m = Math.floor((remain % 3600e3) / 60000);
            left = h + "h " + m + "m left";
          } else left = "timed out";
        }
        exitHTML = '<div class="exit-card"><h3>Exit</h3>' +
          '<div class="exit-row"><span class="k">Stop</span><span class="v">' + esc(stop != null ? formatPrice(stop) : "\u2014") + "</span></div>" +
          '<div class="exit-row"><span class="k">Trail</span><span class="v">' + esc(trail != null ? formatPrice(trail) : "\u2014") + "</span></div>" +
          '<div class="exit-row"><span class="k">Timeout</span><span class="v">' + esc(left || "\u2014") + "</span></div></div>";
      }
    }

    const href = safeUrl(coin.coin_url);
    const btnLabel = pos ? "Sell on FOMO" : "Buy on FOMO";
    const btn = href ? '<a class="fomo-btn" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(btnLabel) + "</a>" : "";

    return backNav() + '<div class="coin-head"><div class="kicker">' + esc(kickerBits.join(" \u00b7 ")) + " " + shield +
      "</div><h1>" + esc(name) + " " + paperBadge() + '</h1><div class="px' + (price == null ? " na" : "") + '">' + esc(formatPrice(price)) + "</div>" + since +
      "</div>" +
      ((coin.candles && coin.candles.length)
        ? '<div class="candle-wrap"><canvas id="coin-chart"></canvas></div>'
        : '') +
      statsHTML + posHTML + exitHTML + btn;
  }

  function renderAccount() {
    const mode = (S.account && S.account.mode) || (S.state && S.state.mode) || "PAPER";
    const stack = S.account && S.account.stack;
    const profile = safeUrl(S.account && S.account.profile_url);
    const handle = (S.account && S.account.fomo_handle) || "";
    const notifier = (S.account && S.account.notifier) || setting("desk.notifier") || "";
    const tgOn = String(notifier) === "telegram";
    const pushOn = !!(S.account && S.account.web_push_available);
    let html = '<div class="page-title">Account</div><div class="page-pad">';
    html += '<p class="note">These controls are read-only on this host. Changes go through Discord or the Grok Bot chat.</p>';
    html += '<div class="group-title">Mode</div><div class="group">';
    html += '<div class="item"><span>Mode</span><div class="seg">' +
      '<button data-mode="PAPER" class="' + (String(mode).toUpperCase() === "PAPER" ? "on" : "") + '">PAPER</button>' +
      '<button data-mode="LIVE" class="' + (String(mode).toUpperCase() === "LIVE" ? "on" : "") + '">LIVE</button></div></div>';
    html += '<div class="item"><span>Stack</span><span class="rhs">' + esc(formatMoney(stack)) + "</span></div></div>";
    html += '<div class="group-title">FOMO</div><div class="group">';
    if (profile) {
      html += '<a class="item" href="' + esc(profile) + '" target="_blank" rel="noopener"><span>Your FOMO profile</span><span class="rhs">' +
        esc(handle ? "@" + handle.replace(/^@/, "") : "") + "</span></a>";
    } else {
      html += '<div class="item"><span>Your FOMO profile</span><span class="rhs">\u2014</span></div>';
    }
    html += '<button class="item" id="invite"><span>Invite a friend</span><span class="rhs">Share</span></button></div>';
    html += '<div class="group-title">Notifications</div><div class="group">';
    html += '<div class="item"><span>Telegram</span><span class="rhs">' + (tgOn ? "Connected" : "Not connected") + "</span></div>";
    html += '<button class="item" id="test-push"><span>Send test push</span><span class="rhs"></span></button>';
    html += '<div class="item"><span>Web push</span><span class="rhs">' + (pushOn ? "Available" : "Unavailable on this host") + "</span></div></div>";
    if (!pushOn) html += '<p class="note">Web push isn\u2019t available on this host. Alerts go through Discord.</p>';

    const values = (S.settings && S.settings.settings) || {};
    const specs = (S.settings && S.settings.specs) || {};
    SETTING_GROUPS.forEach(function (pair) {
      const prefix = pair[0];
      const title = pair[1];
      const keys = Object.keys(values).filter(function (k) { return k === prefix || k.indexOf(prefix + ".") === 0; }).sort();
      if (!keys.length) return;
      html += '<div class="group-title" id="settings-' + prefix + '">' + esc(title) + '</div><div class="group">';
      keys.forEach(function (k) {
        const spec = specs[k] || {};
        const val = values[k];
        const kind = spec.kind || typeof val;
        html += '<div class="setting"><div class="lab"><span>' + esc(k) + "</span>";
        if (kind === "float" || kind === "int" || typeof val === "number") {
          html += "<code>" + esc(String(val)) + "</code></div>";
          const min = spec.min != null ? spec.min : 0;
          const max = spec.max != null ? spec.max : val;
          html += '<input type="range" min="' + esc(String(min)) + '" max="' + esc(String(max)) + '" step="any" value="' + esc(String(val)) + '" disabled/>';
          html += '<input type="number" value="' + esc(String(val)) + '" disabled/>';
        } else if (kind === "bool" || typeof val === "boolean") {
          html += "</div>" + switchHTML(k, !!val, true).replace("data-pause=", "data-noop=");
        } else if (spec.choices) {
          html += "</div><div class='seg'>";
          spec.choices.forEach(function (c) {
            html += '<button class="' + (String(val) === String(c) ? "on" : "") + '" disabled>' + esc(String(c)) + "</button>";
          });
          html += "</div>";
        } else {
          html += "</div><input type='text' value='" + esc(String(val == null ? "" : val)) + "' disabled/>";
        }
        html += "</div>";
      });
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function searchItems() {
    const map = {};
    function add(mint, name, symbol, extra) {
      if (!mint) return;
      if (!map[mint]) map[mint] = { mint: mint, name: name, symbol: symbol, coin_url: extra && extra.coin_url };
      else {
        if (name) map[mint].name = name;
        if (symbol) map[mint].symbol = symbol;
        if (extra && extra.coin_url) map[mint].coin_url = extra.coin_url;
      }
    }
    ((S.activity && S.activity.rows) || []).forEach(function (r) { add(r.mint, null, null, r); });
    ((S.positions && S.positions.open) || []).forEach(function (p) { add(p.mint, null, null, p); });
    Object.keys(S.decisions).forEach(function (k) {
      (S.decisions[k] || []).forEach(function (d) { add(d.mint, d.name, d.symbol, d); });
    });
    ((S.state && S.state.agents) || []).forEach(function (a) {
      ((a.card && a.card.feed) || []).forEach(function (f) { add(f.mint, f.name, f.symbol, f); });
    });
    if (S.coin) add(S.coin.mint, S.coin.name, S.coin.symbol, S.coin);
    return Object.values(map);
  }

  function renderSearch() {
    const q = (S.searchQ || "").trim().toLowerCase();
    const items = searchItems().filter(function (it) {
      if (!q) return true;
      return String(it.name || "").toLowerCase().indexOf(q) >= 0 ||
        String(it.symbol || "").toLowerCase().indexOf(q) >= 0 ||
        String(it.mint || "").toLowerCase().indexOf(q) >= 0;
    });
    return '<div class="sheet"><div class="search-bar"><input id="search-input" placeholder="Name, symbol or mint" value="' +
      esc(S.searchQ) + '"/><button class="cancel" id="search-close">Cancel</button></div><div class="rows">' +
      items.map(function (it) {
        return '<button class="row" data-search="1" data-mint="' + esc(it.mint) + '"><div class="mid"><div class="ttl">' +
          esc(it.symbol || it.name || shortMint(it.mint)) + '</div><div class="sub">' + esc(it.name || it.mint) + "</div></div></button>";
      }).join("") + "</div></div>";
  }

  function renderBell() {
    const rows = (S.activity && S.activity.rows) || [];
    return '<div class="sheet"><div class="navbar"><div class="title">Notifications</div><button class="icon-btn" id="bell-close">\u2715</button></div>' +
      (rows.length ? '<div class="rows">' + rows.map(activityRowHTML).join("") + "</div>" : '<div class="empty-page">Nothing yet tonight</div>') +
      "</div>";
  }

  function renderTabbar() {
    const tab = S.returnTab || "home";
    const hide = S.route.name === "coin" || S.route.name === "audit" || S.searchOpen || S.bellOpen;
    tabbar.hidden = !!hide;
    if (hide) return;
    const items = [["home", "Home", ICO.home], ["agents", "Agents", ICO.agents], ["activity", "Activity", ICO.activity], ["account", "Account", ICO.account]];
    tabbar.innerHTML = items.map(function (it) {
      return '<button data-tab="' + it[0] + '" class="' + (tab === it[0] ? "on" : "") + '">' + it[2] + "<span>" + it[1] + "</span></button>";
    }).join("");
  }

  function bindHome() {
    const av = document.getElementById("nav-avatar");
    if (av) av.onclick = function () { go({ name: "account" }); };
    const se = document.getElementById("nav-search");
    if (se) se.onclick = function () { S.searchOpen = true; render(true); const inp = document.getElementById("search-input"); if (inp) inp.focus(); };
    const bell = document.getElementById("nav-bell");
    if (bell) bell.onclick = function () { S.bellOpen = true; markSeen(); render(true); };
    const ga = document.getElementById("goto-agents");
    if (ga) ga.onclick = function () { go({ name: "agents" }); };
    const gy = document.getElementById("goto-activity");
    if (gy) gy.onclick = function () { go({ name: "activity" }); };
    document.querySelectorAll("[data-range]").forEach(function (b) {
      b.onclick = function () { S.range = b.getAttribute("data-range"); render(true); };
    });
    bindActivityRows();
    const odo = document.getElementById("balance-odo");
    if (odo && S.state && S.state.balance != null) mountOdometer(odo, S.state.balance);
    drawHomeChart();
    const sc = document.querySelector(".score-canvas");
    if (sc && window.DeskCharts) {
      const card = agentBy("analyst").card || {};
      let score = card.latest && card.latest.score;
      if (score == null) {
        const d = (S.decisions.analyst || [])[0];
        if (d && d.detail) {
          const m = String(d.detail).match(/score=(-?\d+)/);
          if (m) score = Number(m[1]);
        }
      }
      DeskCharts.drawScoreRing(sc, { score: score });
    }
  }

  function bindActivityRows() {
    document.querySelectorAll("[data-act]").forEach(function (el) {
      el.onclick = function () {
        const i = Number(el.getAttribute("data-act"));
        const row = ((S.activity && S.activity.rows) || [])[i];
        if (!row || !row.mint) return;
        if (row.kind === "rejected" || row.agent === "auditor") go({ name: "audit", mint: row.mint });
        else go({ name: "coin", mint: row.mint });
      };
    });
  }

  function drawHomeChart() {
    const canvas = document.getElementById("home-chart");
    const empty = document.getElementById("home-chart-empty");
    if (!canvas || !window.DeskCharts) return;
    const pts = filterPoints((S.chart && S.chart.points) || [], S.range);
    if (!pts.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    const t0 = parseT(pts[0].t);
    const t1 = parseT(pts[pts.length - 1].t);
    const marks = ((S.chart && S.chart.marks) || []).filter(function (m) {
      const t = parseT(m.t);
      return !isNaN(t) && t >= t0 && t <= t1;
    }).map(function (m) { return Object.assign({}, m, { display: markLabel(m) }); });
    DeskCharts.drawLine(canvas, { points: pts, marks: marks, startValue: pts[0].v });
  }

  function mountOdometer(root, value) {
    const text = formatBalance(value);
    if (text == null) { root.textContent = "\u2014"; return; }
    const reduced = window.DeskCharts ? DeskCharts.reduceMotion() : false;
    const prev = root.getAttribute("data-digits") || "";
    if (!root.childElementCount || prev.length !== text.length) {
      let html = '<span class="odo-prefix">$</span>';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch >= "0" && ch <= "9") {
          html += '<span class="odo-col"><span class="odo-strip">' +
            "0123456789".split("").map(function (d) { return "<span>" + d + "</span>"; }).join("") +
            "</span></span>";
        } else html += '<span class="odo-col sym">' + esc(ch) + "</span>";
      }
      root.innerHTML = html;
      root.setAttribute("data-digits", text);
      applyOdo(root, text, true);
      return;
    }
    if (prev === text) return;
    root.setAttribute("data-digits", text);
    applyOdo(root, text, reduced);
  }

  function applyOdo(root, text, instant) {
    const cols = root.querySelectorAll(".odo-col:not(.sym)");
    const digits = [];
    for (let i = 0; i < text.length; i++) if (text[i] >= "0" && text[i] <= "9") digits.push(text[i]);
    const n = digits.length;
    cols.forEach(function (col, i) {
      const strip = col.querySelector(".odo-strip");
      if (!strip) return;
      const digit = Number(digits[i] || 0);
      const delay = (n - 1 - i) * 30;
      strip.style.transition = instant ? "none" : "transform 600ms ease-out " + delay + "ms";
      strip.style.transform = "translateY(-" + digit + "em)";
    });
  }

  function bindCommon() {
    if (S.searchOpen) {
      const inp = document.getElementById("search-input");
      const close = document.getElementById("search-close");
      if (close) close.onclick = function () { S.searchOpen = false; render(true); };
      if (inp) {
        inp.oninput = function () {
          S.searchQ = inp.value;
          render(true);
          const n = document.getElementById("search-input");
          if (n) { n.focus(); const v = n.value; n.value = ""; n.value = v; }
        };
      }
      document.querySelectorAll("[data-search]").forEach(function (el) {
        el.onclick = function () { S.searchOpen = false; go({ name: "coin", mint: el.getAttribute("data-mint") }); };
      });
      return;
    }
    if (S.bellOpen) {
      const c = document.getElementById("bell-close");
      if (c) c.onclick = function () { S.bellOpen = false; render(true); };
      bindActivityRows();
      return;
    }
    const back = document.getElementById("btn-back");
    if (back) back.onclick = function () { go({ name: S.returnTab || "home" }); };
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { go({ name: b.getAttribute("data-tab") }); };
    });
    document.querySelectorAll("[data-pause]").forEach(function (b) {
      b.onclick = function () {
        const name = b.getAttribute("data-pause");
        if (name === "risk" && ((S.positions && S.positions.open) || []).length) {
          toast("Risk stays on while a position is open.");
          return;
        }
        noteReadOnly();
      };
    });
    document.querySelectorAll("[data-settings]").forEach(function (b) {
      b.onclick = function () { S.section = b.getAttribute("data-settings"); go({ name: "account" }); };
    });
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.onclick = function () { requestMode(b.getAttribute("data-mode")); };
    });
    const invite = document.getElementById("invite");
    if (invite) invite.onclick = inviteFriend;
    const tp = document.getElementById("test-push");
    if (tp) tp.onclick = function () { noteReadOnly(); };
    const au = document.querySelector("[data-auditor]");
    if (au) au.onclick = toggleAuditor;
    const oa = document.getElementById("open-audit");
    if (oa) oa.onclick = function () { if (S.route.mint) go({ name: "audit", mint: S.route.mint }); };
  }

  function requestMode(next) {
    const cur = (S.account && S.account.mode) || (S.state && S.state.mode) || "PAPER";
    if (String(next) === String(cur)) return;
    if (next === "LIVE") {
      showModal({
        title: "Switch to LIVE?",
        body: "Type LIVE to confirm. This host cannot save the change.",
        input: true,
        confirm: "Continue",
        onok: function (val) {
          if (val !== "LIVE") { toast("Type LIVE to confirm"); return false; }
          noteReadOnly();
        },
      });
      return;
    }
    noteReadOnly();
  }

  function toggleAuditor() {
    const on = setting("auditor.enabled") !== false && setting("auditor.enabled") !== "false";
    if (!on) { noteReadOnly(); return; }
    showModal({
      title: "Turn off auditor?",
      body: "Coins will skip the 8-layer check before a buy.",
      confirm: "Turn off",
      onok: function () {
        showModal({
          title: "Are you sure?",
          body: "Turning this off means Grok Bot will not take coins apart before buying.",
          confirm: "Turn off",
          onok: function () { noteReadOnly(); },
        });
      },
    });
  }

  async function inviteFriend() {
    const url = safeUrl(S.account && S.account.signup_url);
    if (!url) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Invite a friend", url: url }); return; } catch (e) {}
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch (e) { toast("Link copied"); }
  }

  function playAuditBeam() {
    const stack = document.getElementById("disc-stack");
    if (!stack || !S.audit) return;
    const layers = S.audit.layers || [];
    const mint = S.audit.mint;
    const discs = stack.querySelectorAll(".disc");
    const rows = document.querySelectorAll(".layer-row");
    const beam = document.getElementById("audit-beam");
    const reduced = window.DeskCharts ? DeskCharts.reduceMotion() : false;
    function apply(i) {
      const L = layers[i] || {};
      const disc = discs[i];
      const row = rows[i];
      if (L.pass === true) { if (disc) disc.classList.add("pass"); if (row) row.classList.add("pass"); }
      else if (L.pass === false) { if (disc) disc.classList.add("fail"); if (row) row.classList.add("fail"); }
    }
    function placeBeam(i) {
      if (!beam) return;
      const disc = discs[i];
      if (!disc) { beam.classList.remove("on"); return; }
      beam.style.top = disc.style.top;
      beam.classList.add("on");
      discs.forEach(function (d) { d.classList.remove("active"); });
      disc.classList.add("active");
    }
    function finish() {
      S.auditAnimating = false;
      S.auditPlayed[mint] = true;
      if (beam) beam.classList.remove("on");
      discs.forEach(function (d) { d.classList.remove("active"); });
      window.__DESK_READY = true;
    }
    if (S.auditPlayed[mint] || reduced) { for (let i = 0; i < 8; i++) apply(i); finish(); return; }
    S.auditAnimating = true;
    let i = 0;
    function step() {
      if (i >= 8) { finish(); return; }
      const L = layers[i] || {};
      const ready = !!(L.name || L.value || L.pass != null || L.ts);
      placeBeam(i);
      if (!ready) { S.auditAnimating = false; window.__DESK_READY = true; return; }
      setTimeout(function () { apply(i); i += 1; setTimeout(step, 150); }, 350);
    }
    step();
  }

  function drawCoinChart() {
    const canvas = document.getElementById("coin-chart");
    if (!canvas || !window.DeskCharts || !S.coin) return;
    const lines = [];
    const el = copytradeExits(S.coin);
    if (el && el.kind === "copytrade" && el.take_profit_price != null) {
      lines.push({ price: el.take_profit_price, color: "#ff9f0a" });
    } else if (S.coin.exit_lines && S.coin.exit_lines.kind === "desk") {
      const price = S.coin.exit_lines.trail_price != null ? S.coin.exit_lines.trail_price : S.coin.exit_lines.stop_price;
      if (price != null) lines.push({ price: price, color: "#ff9f0a" });
    }
    DeskCharts.drawCandles(canvas, { candles: S.coin.candles || [], exitLines: lines });
  }

  function render(force) {
    if (S.auditAnimating && S.route.name === "audit" && !force) { drawError(); return; }
    drawError();
    if (S.searchOpen) { view.innerHTML = renderSearch(); view.classList.add("detail"); }
    else if (S.bellOpen) { view.innerHTML = renderBell(); view.classList.add("detail"); }
    else {
      const name = S.route.name;
      view.classList.toggle("detail", name === "coin" || name === "audit");
      if (name === "home") view.innerHTML = renderHome();
      else if (name === "agents") view.innerHTML = renderAgents();
      else if (name === "activity") view.innerHTML = renderActivity();
      else if (name === "audit") view.innerHTML = renderAuditor();
      else if (name === "coin") view.innerHTML = renderCoin();
      else if (name === "account") view.innerHTML = renderAccount();
      else view.innerHTML = renderHome();
    }
    renderTabbar();
    drawModal();
    bindHome();
    bindCommon();
    if (S.route.name === "audit" && !S.searchOpen && !S.bellOpen) playAuditBeam();
    if (S.route.name === "coin") drawCoinChart();
    if (S.route.name === "account" && S.section) {
      const el = document.getElementById("settings-" + S.section);
      if (el) el.scrollIntoView({ block: "start" });
      S.section = null;
    }
    window.__DESK_SCREEN = S.route.name;
    if (S.state && !S.loading && S.route.name !== "audit") window.__DESK_READY = true;
  }

  window.addEventListener("hashchange", function () {
    const parsed = parseHash(location.hash);
    S.route = parsed.route || parseRoute((location.hash || "").slice(1));
    if (["home", "agents", "activity", "account"].indexOf(S.route.name) >= 0) S.returnTab = S.route.name;
    loadRouteExtras().then(function () { render(true); });
  });

  window.addEventListener("resize", function () {
    if (S.route.name === "home") drawHomeChart();
    if (S.route.name === "coin") drawCoinChart();
    const sc = document.querySelector(".score-canvas");
    if (sc && window.DeskCharts) {
      const card = agentBy("analyst").card || {};
      DeskCharts.drawScoreRing(sc, { score: card.latest && card.latest.score });
    }
  });

  captureBoot();
  render(true);
  poll();
  pollTimer = setInterval(function () { if (!S.error) poll(); }, 15000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
