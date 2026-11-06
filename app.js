/* Plan B: read #t= APP_TOKEN and #d= DATA_PATH from fragment into localStorage; poll /d/{path}/state.json */
(function () {
  const app = document.getElementById("app");

  function parseHash() {
    const h = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    const parts = {};
    h.split("&").forEach((p) => {
      if (!p) return;
      const i = p.indexOf("=");
      if (i < 0) parts[p] = "";
      else parts[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
    });
    return parts;
  }

  const parts = parseHash();
  if (parts.d) localStorage.setItem("desk_data_path", parts.d);
  if (parts.t) localStorage.setItem("desk_app_token", parts.t);

  // clear secrets from address bar after capture (fragment not sent to server)
  if (parts.d || parts.t) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  const d = localStorage.getItem("desk_data_path");
  const t = localStorage.getItem("desk_app_token");

  function render(msg, state) {
    if (!state) {
      app.innerHTML = '<div class="status">' + msg + "</div>";
      return;
    }
    const bal = Number(state.balance);
    const pct = Number(state.today_pct || 0);
    const mode = state.mode || "?";
    const pctCls = pct >= 0 ? "up" : "down";
    const agents = (state.agents || [])
      .map(function (a) {
        return (
          '<div class="agent"><span class="dot ' +
          (a.status === "running" ? "on" : "") +
          '"></span>' +
          a.name +
          "</div>"
        );
      })
      .join("");
    app.innerHTML =
      '<div class="top"><span class="mode">' +
      mode +
      '</span><span class="muted">updated ' +
      (state.updated_at || "") +
      "</span></div>" +
      '<div class="balance" id="balance">' +
      bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) +
      "</div>" +
      '<div class="pct ' +
      pctCls +
      '">' +
      (pct >= 0 ? "+" : "") +
      pct.toFixed(2) +
      "% today · " +
      Number(state.multiplier || 0).toFixed(2) +
      "×</div>" +
      '<div class="agents">' +
      agents +
      "</div>" +
      '<div class="status">' +
      msg +
      "</div>";
  }

  if (!d) {
    render("Open once with #d={DATA_PATH}&t={APP_TOKEN} (Plan B).", null);
    return;
  }
  if (!t) {
    render("Missing APP_TOKEN. Open once with #t= in the URL fragment.", null);
    // still allow data poll for PAPER proof screens
  }

  const base = "d/" + d + "/";
  let fail = 0;

  async function poll() {
    try {
      const res = await fetch(base + "state.json?ts=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const state = await res.json();
      fail = 0;
      render("Live · polling /d/…/state.json", state);
    } catch (e) {
      fail += 1;
      const retry = Math.min(30, 5 + fail * 2);
      render("Desk offline · retrying in " + retry + "s · " + (e && e.message ? e.message : e), null);
    }
  }

  poll();
  setInterval(poll, 15000);
})();
