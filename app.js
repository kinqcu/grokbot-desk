/* Plan B: read #d= DATA_PATH into localStorage, poll /d/{path}/state.json every 15s. Stub. */
(function () {
  const h = location.hash.slice(1);
  const params = new URLSearchParams(h.replace(/&/g, "&"));
  // support #d=... and #t=...
  const parts = Object.fromEntries(h.split("&").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? [p, ""] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }).filter(([k]) => k));
  if (parts.d) localStorage.setItem("desk_data_path", parts.d);
  if (parts.t) localStorage.setItem("desk_app_token", parts.t);
  const d = localStorage.getItem("desk_data_path");
  document.getElementById("app").textContent = d
    ? "Desk ready (secret path stored). Waiting for data publish."
    : "Open once with #d={DATA_PATH} (Plan B).";
})();
