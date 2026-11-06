/* Hand-drawn, devicePixelRatio-aware canvas charts. No libraries. */
(function (global) {
  "use strict";

  function reduceMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  function fit(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
  }

  function parseT(t) {
    if (t == null) return NaN;
    if (typeof t === "number") return t;
    return Date.parse(t);
  }

  function filterRange(points, range) {
    const pts = (points || []).filter(function (p) {
      return p && p.v != null && !isNaN(Number(p.v)) && !isNaN(parseT(p.t));
    });
    if (!pts.length) return pts;
    const last = parseT(pts[pts.length - 1].t);
    const span = {
      LIVE: 30 * 60 * 1000,
      "1H": 3600 * 1000,
      "4H": 4 * 3600 * 1000,
      "1D": 24 * 3600 * 1000,
      "1W": 7 * 24 * 3600 * 1000,
    }[range];
    if (!span || range === "ALL") return pts;
    const cut = last - span;
    let idx = 0;
    for (let i = 0; i < pts.length; i++) {
      if (parseT(pts[i].t) >= cut) { idx = i; break; }
      idx = i;
    }
    // keep the point just before the window so a single in-window print still graphs
    if (idx > 0 && parseT(pts[idx].t) >= cut) idx = idx - 1;
    const kept = pts.slice(idx);
    return kept.length ? kept : pts.slice(-2);
  }

  function drawLine(canvas, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(canvas);
    const pts = filterRange(opts.points || [], opts.range || "ALL");
    const pad = { l: 8, r: 14, t: 28, b: 12 };
    const iw = Math.max(1, w - pad.l - pad.r);
    const ih = Math.max(1, h - pad.t - pad.b);
    if (!pts.length) return { empty: true };

    let min = Number(pts[0].v);
    let max = min;
    pts.forEach(function (p) {
      const v = Number(p.v);
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (opts.base != null && !isNaN(Number(opts.base))) {
      min = Math.min(min, Number(opts.base));
      max = Math.max(max, Number(opts.base));
    }
    if (min === max) {
      min -= Math.max(1, Math.abs(min) * 0.01);
      max += Math.max(1, Math.abs(max) * 0.01);
    } else {
      const padY = (max - min) * 0.12;
      min -= padY;
      max += padY * 0.35;
    }
    const t0 = parseT(pts[0].t);
    const t1 = parseT(pts[pts.length - 1].t);
    const dt = Math.max(1, t1 - t0);
    function xOf(t) { return pad.l + ((parseT(t) - t0) / dt) * iw; }
    function yOf(v) { return pad.t + (1 - (Number(v) - min) / (max - min)) * ih; }

    ctx.beginPath();
    pts.forEach(function (p, i) {
      const x = xOf(p.t);
      const y = yOf(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const last = pts[pts.length - 1];
    ctx.lineTo(xOf(last.t), pad.t + ih);
    ctx.lineTo(xOf(pts[0].t), pad.t + ih);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    g.addColorStop(0, "rgba(0,211,90,0.28)");
    g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
      const x = xOf(p.t);
      const y = yOf(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,211,90,0.55)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const lx = xOf(last.t);
    const ly = yOf(last.v);
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#00d35a";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 9, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,211,90,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();

    (opts.marks || []).forEach(function (m) {
      if (!m || isNaN(parseT(m.t)) || m.v == null) return;
      const ts = parseT(m.t);
      if (ts < t0 || ts > t1) return;
      const x = xOf(m.t);
      const up = m.kind !== "sold" || (m.pnl != null && m.pnl >= 0);
      ctx.beginPath();
      ctx.arc(x, yOf(m.v), 3, 0, Math.PI * 2);
      ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.fill();
    });
    return { empty: false };
  }

  function drawRing(canvas, frac, done) {
    const { ctx, w, h } = fit(canvas);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 5;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#2c2c2e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = "round";
    if (done) {
      ctx.strokeStyle = "#00d35a";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#00d35a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx - 2, cy + 7);
      ctx.lineTo(cx + 10, cy - 7);
      ctx.stroke();
      return;
    }
    const f = Math.max(0, Math.min(1, frac || 0));
    ctx.strokeStyle = "#ffd60a";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
    ctx.stroke();
  }

  function drawCandles(canvas, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(canvas);
    const candles = (opts.candles || []).filter(function (c) {
      return c && c.c != null && !isNaN(Number(c.c));
    });
    const pad = { l: 12, r: 48, t: 18, b: 42 };
    const iw = Math.max(1, w - pad.l - pad.r);
    const ih = Math.max(1, h - pad.t - pad.b);
    if (!candles.length) {
      ctx.fillStyle = "rgba(235,235,245,0.4)";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No stored prices yet", w / 2, h / 2);
      return { empty: true };
    }
    let min = Infinity;
    let max = -Infinity;
    candles.forEach(function (c) {
      const lo = c.l != null ? Number(c.l) : Number(c.c);
      const hi = c.h != null ? Number(c.h) : Number(c.c);
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    });
    if (opts.entry != null) {
      min = Math.min(min, Number(opts.entry));
      max = Math.max(max, Number(opts.entry));
    }
    (opts.sells || []).forEach(function (s) {
      if (s && s.price != null) {
        min = Math.min(min, Number(s.price));
        max = Math.max(max, Number(s.price));
      }
    });
    if (min === max) {
      min *= 0.98;
      max *= 1.02;
      if (min === max) {
        min -= 1;
        max += 1;
      }
    }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.18;
    function yOf(v) { return pad.t + (1 - (Number(v) - min) / (max - min)) * ih; }

    const n = candles.length;
    const slot = iw / n;
    const cw = Math.max(2, Math.min(9, slot * 0.62));

    candles.forEach(function (c, i) {
      const x = pad.l + slot * i + slot / 2;
      const o = Number(c.o != null ? c.o : c.c);
      const cl = Number(c.c);
      const hi = Number(c.h != null ? c.h : c.c);
      const lo = Number(c.l != null ? c.l : c.c);
      const up = cl >= o;
      ctx.strokeStyle = up ? "#00d35a" : "#ff453a";
      ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(hi));
      ctx.lineTo(x, yOf(lo));
      ctx.stroke();
      const top = yOf(Math.max(o, cl));
      const bot = yOf(Math.min(o, cl));
      ctx.fillRect(x - cw / 2, top, cw, Math.max(1, bot - top));
    });

    // volume
    const vh = 28;
    const vy = h - vh - 6;
    let vmax = 0;
    candles.forEach(function (c) {
      if (c.v != null && Math.abs(Number(c.v)) > vmax) vmax = Math.abs(Number(c.v));
    });
    if (vmax > 0) {
      candles.forEach(function (c, i) {
        const x = pad.l + slot * i + slot / 2;
        const o = Number(c.o != null ? c.o : c.c);
        const cl = Number(c.c);
        const vol = c.v == null ? 0 : Math.abs(Number(c.v));
        const bh = (vol / vmax) * vh;
        ctx.fillStyle = cl >= o ? "rgba(0,211,90,0.55)" : "rgba(255,69,58,0.55)";
        ctx.fillRect(x - cw / 2, vy + vh - bh, cw, bh);
      });
    }

    if (opts.entry != null && !isNaN(Number(opts.entry))) {
      const y = yOf(opts.entry);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(10,132,255,0.9)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#0a84ff";
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Grok Bot +30s", pad.l + 4, y - 6);
    }

    (opts.sells || []).forEach(function (s, idx) {
      if (!s) return;
      let price = s.price;
      if (price == null && candles.length) price = candles[candles.length - 1].c;
      if (price == null) return;
      const y = yOf(price);
      const x = w - pad.r - 4;
      const up = s.positive !== false;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = up ? "rgba(0,211,90,0.55)" : "rgba(255,69,58,0.55)";
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(x - 8, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = s.label || "Sold";
      ctx.font = "700 10px sans-serif";
      const tw = ctx.measureText(label).width + 12;
      const lx = Math.max(pad.l + 8, Math.min(w - tw - 8, pad.l + iw * 0.42 + (idx % 3) * 12));
      const ly = y - 16 - (idx % 2) * 16;
      ctx.fillStyle = up ? "rgba(0,211,90,0.16)" : "rgba(255,69,58,0.16)";
      roundRect(ctx, lx, ly - 11, tw, 16, 8);
      ctx.fill();
      ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.textAlign = "left";
      ctx.fillText(label, lx + 6, ly + 1);
    });
    return { empty: false };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawConfetti(canvas, t) {
    const { ctx, w, h } = fit(canvas);
    const colors = ["#00d35a", "#0a84ff", "#ffd60a", "#ff375f", "#64d2ff", "#bf5af2"];
    const n = 80;
    for (let i = 0; i < n; i++) {
      const seed = i * 9973;
      const x = ((seed * 13) % 1000) / 1000 * w;
      const speed = 40 + (seed % 80);
      const y = ((t * speed + (seed % 200)) % (h + 40)) - 20;
      const rot = t * (0.5 + (seed % 10) / 10) + i;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(-3, -5, 6, 10);
      ctx.restore();
    }
  }

  global.CopyChart = {
    drawLine: drawLine,
    drawCandles: drawCandles,
    drawRing: drawRing,
    drawConfetti: drawConfetti,
    reduceMotion: reduceMotion,
    filterRange: filterRange,
  };
})(window);
