/* Copy Desk. Reads copy.json via #d= / localStorage desk_data_path. No hardcoded FOMO URLs. */
(function () {
  "use strict";

  const TZ = "Pacific/Auckland";
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const view = document.getElementById("view");
  const errorBar = document.getElementById("error-bar");
  const banners = document.getElementById("banners");
  const confettiCanvas = document.getElementById("confetti");

  const S = {
    d: null,
    route: { name: "desk" },
    loading: true,
    error: null,
    data: null,
    range: "LIVE",
    seenId: Number(localStorage.getItem("copy_seen_activity") || 0),
    seededSeen: false,
  };

  let pollTimer = null;
  let chartTimer = null;
  let confettiTimer = null;
  let countdownTimer = null;

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
    if ((segs[0] === "coin") && segs[1]) return { name: "coin", mint: segs[1] };
    return { name: "desk" };
  }

  function routeToHash(route) {
    if (route && route.name === "coin" && route.mint) {
      return "#/coin/" + encodeURIComponent(route.mint);
    }
    return "#/";
  }

  function captureBoot() {
    const parsed = parseHash(location.hash);
    if (parsed.params.d) localStorage.setItem("desk_data_path", parsed.params.d);
    if (parsed.params.t) localStorage.setItem("desk_app_token", parsed.params.t);
    const qs = new URLSearchParams(location.search);
    S.noBanner = qs.get("nobanner");
    S.forceBanner = qs.get("banner");
    let route = parsed.route;
    if (!route && qs.get("screen")) {
      const screen = qs.get("screen");
      const mint = qs.get("mint");
      if ((screen === "coin") && mint) route = { name: "coin", mint: mint };
      else route = { name: "desk" };
    }
    if (parsed.params.d || parsed.params.t || qs.get("screen")) {
      history.replaceState(null, "", location.pathname + routeToHash(route || { name: "desk" }));
    }
    S.d = localStorage.getItem("desk_data_path");
    S.route = route || parseRoute((location.hash || "").slice(1) || "/");
  }

  function go(route) {
    S.route = route;
    const h = routeToHash(route);
    if (location.hash !== h) location.hash = h;
    else render();
  }

  function dataUrl(name) {
    return "../d/" + S.d + "/" + name;
  }

  function formatNZ(iso, opt) {
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-NZ", Object.assign({ timeZone: TZ }, opt || {
      hour: "numeric", minute: "2-digit", hour12: true,
    })).format(d);
  }

  function formatMoney(n, digits) {
    if (n == null || isNaN(Number(n))) return null;
    const d = digits == null ? 2 : digits;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function formatUsd(n) {
    const s = formatMoney(n);
    return s == null ? "—" : "$" + s;
  }

  function formatCompact(n) {
    if (n == null || isNaN(Number(n))) return "—";
    const x = Number(n);
    const abs = Math.abs(x);
    const sign = x < 0 ? "-" : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e4) return sign + "$" + (abs / 1e3).toFixed(1) + "K";
    if (abs >= 1000) return sign + "$" + (abs / 1e3).toFixed(2) + "K";
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(n) {
    if (n == null || isNaN(Number(n))) return null;
    const x = Number(n);
    return (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
  }

  function formatMult(n) {
    if (n == null || isNaN(Number(n))) return null;
    return Number(n).toFixed(2) + "\u00d7";
  }

  function ageLabel(min) {
    if (min == null || isNaN(Number(min))) return null;
    const m = Number(min);
    if (m < 60) return m + "m since copy";
    if (m < 1440) return Math.floor(m / 60) + "h since copy";
    return Math.floor(m / 1440) + "d since copy";
  }

  function hueFor(s) {
    let h = 0;
    String(s || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return h % 360;
  }

  function avatar(label, cls) {
    const ch = String(label || "?").replace(/^@/, "").slice(0, 1).toUpperCase();
    const handle = String(label || "").toLowerCase();
    const preset = handle.indexOf("aiwass") === 0 ? "a" : handle.indexOf("bysteven") === 0 ? "b" : "t";
    const extra = cls || "";
    const style = preset === "t" ? ' style="background:hsl(' + hueFor(label) + ' 45% 38%)"' : "";
    return '<span class="av ' + preset + " " + extra + '"' + style + ">" + esc(ch) + "</span>";
  }

  function tokenAv(symbol, mint) {
    return avatar(symbol || mint, "lg");
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }

  const ICO = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    share: svg('<path d="M12 14V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>'),
    binoc: svg('<circle cx="8" cy="14" r="4"/><circle cx="16" cy="14" r="4"/><path d="M10.5 12.5h3M6 10l2-4h8l2 4"/>'),
    bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
    shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6l8-3z"/>'),
    clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>'),
  };

  function setError(msg) {
    if (!msg) {
      errorBar.hidden = true;
      errorBar.textContent = "";
      return;
    }
    errorBar.hidden = false;
    errorBar.innerHTML = "<span>" + esc(msg) + '</span><button type="button" id="retry">Retry</button>';
    const btn = document.getElementById("retry");
    if (btn) btn.onclick = function () { load(); };
  }

  async function load() {
    if (!S.d) {
      S.loading = false;
      S.error = "missing_path";
      render();
      return;
    }
    try {
      const r = await fetch(dataUrl("copy.json") + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("status " + r.status);
      const data = await r.json();
      S.data = data;
      S.error = null;
      S.loading = false;
      seedSeen(data);
      maybeNotify(data);
      maybeConfetti(data);
      render();
    } catch (e) {
      S.loading = false;
      S.error = "load";
      render();
    }
  }

  function seedSeen(data) {
    if (S.seededSeen) return;
    const acts = (data && data.activity) || [];
    if (!S.seenId && acts.length) {
      S.seenId = acts[0].id;
      localStorage.setItem("copy_seen_activity", String(S.seenId));
    }
    S.seededSeen = true;
  }

  function maybeNotify(data) {
    const acts = (data && data.notifications) || [];
    const fresh = [];
    acts.forEach(function (n) {
      if (n && n.id && n.id > S.seenId) fresh.push(n);
    });
    if (fresh.length) {
      S.seenId = fresh[0].id;
      localStorage.setItem("copy_seen_activity", String(S.seenId));
      if (!S.noBanner) {
        fresh.slice().reverse().forEach(showBanner);
      }
    }
    if (S.forceBanner && acts[0]) {
      showBanner(acts[0]);
    }
  }

  function showBanner(n) {
    const el = document.createElement("div");
    el.className = "banner";
    el.innerHTML =
      avatar((n.title || "C"), "lg") +
      '<div class="txt"><div class="ttl">' + esc(n.title || "") + "</div>" +
      '<div class="sub">' + esc(n.subtitle || "") + "</div></div>" +
      '<div class="now">now</div>';
    banners.appendChild(el);
    document.body.classList.add("has-banners");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (!banners.children.length) document.body.classList.remove("has-banners");
    }, 5200);
  }

  function maybeConfetti(data) {
    const lock = data && data.lock;
    if (!lock || !lock.completed || !lock.profitable) return;
    if (window.CopyChart && window.CopyChart.reduceMotion()) return;
    const key = "copy_lock_confetti_" + String(lock.at || "");
    if (sessionStorage.getItem(key) && !new URLSearchParams(location.search).get("confetti")) return;
    sessionStorage.setItem(key, "1");
    startConfetti();
  }

  function startConfetti() {
    if (!confettiCanvas) return;
    confettiCanvas.hidden = false;
    const t0 = performance.now();
    function tick(now) {
      const t = (now - t0) / 1000;
      if (t > 3.2) {
        confettiCanvas.hidden = true;
        return;
      }
      if (window.CopyChart) window.CopyChart.drawConfetti(confettiCanvas, t);
      confettiTimer = requestAnimationFrame(tick);
    }
    if (confettiTimer) cancelAnimationFrame(confettiTimer);
    confettiTimer = requestAnimationFrame(tick);
  }

  function publicUrl() {
    return location.origin + location.pathname;
  }

  async function onShare() {
    const url = publicUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Copy Desk", url: url });
        return;
      }
    } catch (e) {}
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {}
  }

  function traderLine(data) {
    const traders = data.traders || [];
    const avs = traders.map(function (t) { return avatar(t.handle); }).join("");
    const names = traders.map(function (t) { return t.handle; }).join(" · ");
    const n = data.open_count || 0;
    return (
      '<div class="copying-line">' +
        '<span class="fomo-word">fomo</span> copying ' +
        '<span class="avatars">' + avs + "</span> " +
        '<span class="handles">' + esc(names) + "</span>" +
        '<span>· ' + n + " open</span>" +
      "</div>"
    );
  }

  function renderDesk(data) {
    const up = (data.balance_pnl || 0) > 0;
    const down = (data.balance_pnl || 0) < 0;
    const deltaCls = up ? "up" : down ? "down" : "flat";
    const pnl = formatUsd(Math.abs(data.balance_pnl || 0));
    const pct = formatPct(data.balance_pnl_pct);
    const mult = formatMult(data.multiplier);
    const sign = up ? "+" : down ? "−" : "";
    const ranges = RANGES.map(function (r) {
      const on = S.range === r ? " on" : "";
      const dot = r === "LIVE" && S.range === "LIVE" ? '<span class="dot"></span>' : "";
      return '<button type="button" data-range="' + r + '" class="' + on.trim() + '">' + dot + r + "</button>";
    }).join("");

    const empty = !(data.activity && data.activity.length) && !data.open_count;
    return (
      '<div class="topbar">' +
        '<button class="icon-btn" id="back-main" aria-label="Back">' + ICO.back + "</button>" +
        '<div class="title">Copy Desk</div>' +
        '<button class="share-btn" id="share">' + ICO.share + " Share</button>" +
      "</div>" +
      (data.demo ? '<div class="demo-banner">DEMO DATA · not live paper</div>' : "") +
      '<div class="brand-row"><span class="brand-mark">GB</span><span class="brand-name">Grok Bot</span>' +
        '<span class="live-pill"><span class="dot"></span>Live</span></div>' +
      traderLine(data) +
      '<div class="hero"><div class="bal-row">' +
        '<div class="balance">' + formatUsd(data.balance) + "</div>" +
        '<span class="paper-pill">PAPER</span></div>' +
        '<div class="delta ' + deltaCls + '">' +
          (pct ? sign + pnl + " (" + (pct || "") + ")" : "—") +
          (mult ? '<span class="mult-pill">' + esc(mult) + "</span>" : "") +
        "</div></div>" +
      '<div class="chart-wrap"><canvas id="eq-chart"></canvas></div>' +
      '<div class="ranges">' + ranges + "</div>" +
      '<div class="section"><h2>Agents</h2><div class="meta">' +
        esc(String((data.agents && data.agents.running) || 0)) + " running</div></div>" +
      renderAgents(data) +
      '<div class="section"><h2>Activity</h2></div>' +
      (empty ? '<div class="empty">' + esc(data.empty_message || "Waiting for aiwass or bystevenr to buy") + "</div>" : renderActivity(data))
    );
  }

  function renderAgents(data) {
    const a = data.agents || {};
    return '<div class="agent-scroller">' +
      watcherCard(a.watcher) +
      copierCard(a.copier) +
      executorCard(a.executor) +
      riskCard(a.risk) +
      "</div>";
  }

  function watcherCard(w) {
    w = w || {};
    const rows = (w.events || []).slice(0, 3).map(function (e) {
      const amt = e.amount_usd != null ? formatUsd(e.amount_usd) : "";
      return '<div class="w-row">' + avatar(e.trader) +
        '<span class="side">' + esc(e.side || "") + " " + esc(e.symbol || "") + "</span>" +
        '<span class="amt">' + esc(amt) + "</span></div>";
    }).join("");
    return '<div class="agent-card"><div class="agent-head">' +
      '<div class="agent-ico watch">' + ICO.binoc + "</div>" +
      '<div><div class="agent-title">Watcher</div>' +
      '<div class="agent-sub"><span class="dot">•</span> ' + esc(w.subtitle || "2 traders") + "</div></div></div>" +
      (rows || '<div class="w-row">Watching aiwass, bystevenr</div>') +
      "</div>";
  }

  function copierCard(c) {
    c = c || {};
    const counting = c.status === "counting" && c.countdown_s != null;
    const body = '<div class="copier-body"><div class="ring"><canvas id="copy-ring"></canvas>' +
      (counting ? '<div class="sec" id="copy-sec">' + esc(String(c.countdown_s)) + "s</div>" : '<div class="sec"></div>') +
      '</div><div class="copier-meta">' +
      (c.trader ? avatar(c.trader) + " <b>" + esc(c.trader) + "</b>" : "") +
      "<div>" + esc(c.action || "30s behind") + "</div></div></div>";
    return '<div class="agent-card"><div class="agent-head">' +
      '<div class="agent-ico copy">' + ICO.clock + "</div>" +
      '<div><div class="agent-title">Copier</div>' +
      '<div class="agent-sub"><span class="dot">•</span> ' + esc(c.subtitle || "30s behind") + "</div></div></div>" +
      body + "</div>";
  }

  function executorCard(e) {
    e = e || {};
    const pct = e.progress == null ? 0 : e.progress;
    const done = e.status === "filled" || pct >= 100;
    return '<div class="agent-card"><div class="agent-head">' +
      '<div class="agent-ico exec">' + ICO.bolt + "</div>" +
      '<div><div class="agent-title">Executor</div>' +
      '<div class="agent-sub"><span class="dot">•</span> ' + esc(e.subtitle || "") + "</div></div></div>" +
      (e.symbol ? '<div class="exec-amt">' + esc(e.symbol) + (e.amount_usd != null ? " · " + formatUsd(e.amount_usd) : "") + "</div>" : "") +
      '<div class="progress' + (done ? " done" : "") + '"><span style="width:' + pct + '%"></span><label>' +
      esc(e.label || (done ? "Filled" : "Waiting")) + "</label></div></div>";
  }

  function riskCard(r) {
    r = r || {};
    const pills = (r.pills || ["Trail -30%", "Lock 6:30am"]).map(function (p) {
      return '<span class="pill">' + esc(p) + "</span>";
    }).join("");
    const last = r.last_action
      ? '<div class="w-row" style="margin-top:10px">' + esc(r.last_action.title || "") +
        (r.last_action.pnl != null ? '<span class="amt ' + (r.last_action.pnl >= 0 ? "pos" : "neg") + '">' +
          (r.last_action.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(r.last_action.pnl)).slice(1) + "</span>" : "") +
        "</div>"
      : "";
    return '<div class="agent-card"><div class="agent-head">' +
      '<div class="agent-ico risk">' + ICO.shield + "</div>" +
      '<div><div class="agent-title">Risk</div>' +
      '<div class="agent-sub"><span class="dot">•</span> ' + esc(r.subtitle || "Same exits") + "</div></div></div>" +
      '<div class="pills">' + pills + "</div>" + last + "</div>";
  }

  function renderActivity(data) {
    const rows = (data.activity || []).map(function (a) {
      const sold = a.kind === "sold";
      const pos = (a.pnl == null) || a.pnl >= 0;
      const badge = sold ? (pos ? "sell-up" : "sell-dn") : "buy";
      const mark = sold ? (pos ? "✓" : "✕") : "↓";
      let right = "";
      if (sold && a.pnl != null) {
        right = '<div class="act-pnl ' + (pos ? "up" : "down") + '">' +
          (pos ? "+" : "−") + formatUsd(Math.abs(a.pnl)).replace("$", "$") + "</div>";
        if (pos && a.multiplier != null && Number(a.multiplier) >= 1.15) {
          right += '<div class="act-mult">x' + Number(a.multiplier).toFixed(1).replace(/\.0$/, "") + "</div>";
        } else if (a.pnl_pct != null) {
          right += '<div class="act-mult ' + (pos ? "" : "down") + '">' + Number(a.pnl_pct).toFixed(1) + "%</div>";
        }
      } else if (!sold && a.amount != null) {
        right = '<div class="act-pnl flat">' + formatUsd(a.amount) + '</div><div class="act-mult muted">on fomo</div>';
      }
      const when = a.ts ? formatNZ(a.ts) : "";
      const cond = a.condition || "";
      const mintAttr = a.mint ? ' data-mint="' + esc(a.mint) + '"' : "";
      return '<button type="button" class="act-row"' + mintAttr + ">" +
        '<div class="av-wrap">' + tokenAv(a.symbol, a.mint) + '<span class="badge ' + badge + '">' + mark + "</span></div>" +
        '<div class="act-main"><div class="act-title">' + esc(a.title) + "</div>" +
        '<div class="act-sub">' + (a.trader ? avatar(a.trader) : "") + " " + esc(cond) + (when ? " · " + esc(when) : "") + "</div></div>" +
        '<div class="act-right">' + right + "</div></button>";
    }).join("");
    return '<div class="act-list">' + rows + "</div>";
  }

  function renderCoin(data, mint) {
    const coin = (data.coins && data.coins[mint]) || null;
    if (!coin) {
      return '<button class="home-back" id="to-desk">' + ICO.back + " Home</button>" +
        '<div class="empty">No copy-trade data for this coin yet.</div>';
    }
    const pct = coin.pct_since_copy;
    const sinceCls = pct == null ? "" : pct >= 0 ? "up" : "down";
    const hero = coin.market_cap != null ? formatCompact(coin.market_cap) : (coin.current_price != null ? formatUsd(coin.current_price) : "—");
    const heroNote = coin.market_cap != null ? "" : (coin.current_price != null ? "" : "");
    const age = ageLabel(coin.age_min);
    const ctaHref = safeUrl(coin.coin_url || (data.signup_url));
    const cta = coin.open ? "Sell on FOMO" : "Open on FOMO";
    const value = coin.value_held != null ? formatUsd(coin.value_held) : "—";
    const profitN = coin.open ? coin.unrealized_pnl : coin.realized_pnl;
    const profit = profitN != null ? formatUsd(Math.abs(profitN)) : null;
    const inAmt = coin.original_size_usd != null ? formatUsd(coin.original_size_usd) : (coin.size_usd != null ? formatUsd(coin.size_usd) : "—");
    const sold = coin.sold_pct != null ? Number(coin.sold_pct).toFixed(1).replace(/\.0$/, "") + "% sold" : "";
    return (
      '<button class="home-back" id="to-desk">' + ICO.back + " Home</button>" +
      (data.demo ? '<div class="demo-banner">DEMO DATA · not live paper</div>' : "") +
      '<div class="coin-head">' + tokenAv(coin.symbol, coin.mint) +
        "<div><div class=\"coin-name\">" + esc(coin.symbol || "Coin") + "</div>" +
        '<div class="coin-meta">Solana' + (age ? " · " + esc(age) : "") + "</div></div></div>" +
      '<div class="mcap">' + esc(hero) + heroNote + "</div>" +
      '<div class="since ' + sinceCls + '">' +
        (pct != null ? ((pct >= 0 ? "+" : "") + Number(pct).toFixed(1) + "% since Grok Bot copied") : "No stored price since copy") +
      "</div>" +
      '<div class="candle-wrap"><canvas id="cd-chart"></canvas></div>' +
      '<div class="stats-row"><div><div class="k">Market cap</div><div class="v">' +
        (coin.market_cap != null ? esc(formatCompact(coin.market_cap)) : "—") +
        '</div></div><div><div class="k">Last stored vol</div><div class="v">' +
        (coin.volume != null ? esc(formatUsd(coin.volume)) : "—") +
        "</div></div></div>" +
      '<div class="pos-card"><div><div class="n">Position</div>' +
        '<div class="k">' + esc(inAmt) + " in · copied " + esc(coin.trader || "") +
        (sold ? " · " + esc(sold) : "") + "</div></div>" +
        '<div><div class="big">' + esc(value) + "</div>" +
        (profit != null ? '<div class="k" style="text-align:right;color:' +
          ((profitN || 0) >= 0 ? "var(--green)" : "var(--red)") + '">' +
          ((profitN || 0) >= 0 ? "+" : "−") + profit + "</div>" : "") +
        "</div></div>" +
      '<div class="rule-card"><div class="agent-ico risk">' + ICO.shield + "</div>" +
        '<div class="txt"><div class="n">Trail -' + esc(String((data.rules && data.rules.trail_pct) || 30)) +
        "% · Lock " + esc((data.rules && data.rules.lock_label) || "6:30am") + "</div>" +
        '<div class="sub">Same share when they sell · 30s behind · no hands</div></div></div>' +
      (ctaHref ? '<a class="cta" href="' + esc(ctaHref) + '" target="_blank" rel="noopener">' + esc(cta) + "</a>" : "")
    );
  }

  function render() {
    setError(null);
    if (S.loading) {
      view.innerHTML = '<div class="loading">Loading Copy Desk…</div>';
      return;
    }
    if (!S.d) {
      view.innerHTML = '<div class="empty">Open Copy Desk from the link Grok Bot sent you.</div>';
      setError("This page needs the same desk link fragment as the main app.");
      return;
    }
    if (S.error || !S.data) {
      view.innerHTML = '<div class="empty">Couldn’t load Copy Desk.</div>';
      setError("Couldn’t reach the desk data file. Retry in a moment.");
      return;
    }
    if (S.route.name === "coin" && S.route.mint) {
      view.innerHTML = renderCoin(S.data, S.route.mint);
    } else {
      view.innerHTML = renderDesk(S.data);
    }
    bind();
    draw();
  }

  function bind() {
    const back = document.getElementById("back-main");
    if (back) back.onclick = function () { location.href = "../"; };
    const home = document.getElementById("to-desk");
    if (home) home.onclick = function () { go({ name: "desk" }); };
    const share = document.getElementById("share");
    if (share) share.onclick = onShare;
    view.querySelectorAll("[data-range]").forEach(function (b) {
      b.onclick = function () {
        S.range = b.getAttribute("data-range");
        render();
      };
    });
    view.querySelectorAll(".act-row[data-mint]").forEach(function (b) {
      b.onclick = function () {
        go({ name: "coin", mint: b.getAttribute("data-mint") });
      };
    });
  }

  function draw() {
    const data = S.data;
    if (!data) return;
    const eq = document.getElementById("eq-chart");
    if (eq && window.CopyChart) {
      window.CopyChart.drawLine(eq, {
        points: data.balance_series || [],
        marks: data.marks || [],
        range: S.range,
        base: data.start_stack,
      });
    }
    const ring = document.getElementById("copy-ring");
    if (ring && window.CopyChart && data.agents && data.agents.copier) {
      const c = data.agents.copier;
      const delay = c.delay_s || 30;
      let frac = 1;
      if (c.status === "counting" && c.countdown_s != null) {
        frac = 1 - (c.countdown_s / delay);
      }
      window.CopyChart.drawRing(ring, frac, c.status === "copied");
    }
    const cd = document.getElementById("cd-chart");
    if (cd && window.CopyChart && S.route.name === "coin" && S.route.mint) {
      const coin = (data.coins || {})[S.route.mint] || {};
      window.CopyChart.drawCandles(cd, {
        candles: coin.candles || [],
        entry: coin.entry_price,
        sells: coin.sells || [],
      });
    }
  }

  window.addEventListener("hashchange", function () {
    const parsed = parseHash(location.hash);
    S.route = parsed.route || parseRoute((location.hash || "").slice(1) || "/");
    render();
  });
  window.addEventListener("resize", function () { draw(); });

  captureBoot();
  render();
  load();
  pollTimer = setInterval(load, 15000);
})();
