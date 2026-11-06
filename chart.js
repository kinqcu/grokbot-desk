/* Hand-drawn, devicePixelRatio-aware canvas charts. No chart libraries. */
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
    const ms = Date.parse(t);
    return ms;
  }

  const animState = {
    line: { lastKey: "", fromPts: null, started: 0 },
    marks: {},
  };

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function drawLine(canvas, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(canvas);
    const points = (opts.points || []).filter(function (p) {
      return p && p.v != null && !isNaN(Number(p.v)) && !isNaN(parseT(p.t));
    });
    const pad = { l: 4, r: 12, t: 36, b: 10 };
    const iw = Math.max(1, w - pad.l - pad.r);
    const ih = Math.max(1, h - pad.t - pad.b);

    if (points.length === 0) {
      return { empty: true };
    }

    let pts = points.slice();
    const now = performance.now();
    const last = pts[pts.length - 1];
    const key = String(last.t) + ":" + String(last.v) + ":" + pts.length;
    const reduced = opts.reducedMotion || reduceMotion();
    if (!reduced && animState.line.lastKey && animState.line.lastKey !== key && pts.length > 1) {
      if (animState.line.fromPts == null || animState.line.started === 0 || now - animState.line.started > 250) {
        animState.line.fromPts = { t: pts[pts.length - 2].t, v: pts[pts.length - 2].v };
        animState.line.started = now;
      }
      const u = easeOut(Math.min(1, (now - animState.line.started) / 250));
      const from = animState.line.fromPts;
      pts = pts.slice(0, -1).concat([
        {
          t: last.t,
          v: lerp(Number(from.v), Number(last.v), u),
          _slide: u,
        },
      ]);
      if (u < 1) {
        requestAnimationFrame(function () {
          drawLine(canvas, opts);
        });
      } else {
        animState.line.lastKey = key;
        animState.line.fromPts = null;
      }
    } else {
      animState.line.lastKey = key;
    }

    const vals = pts.map(function (p) { return Number(p.v); });
    const startValue = opts.startValue != null ? Number(opts.startValue) : vals[0];
    let minV = Math.min.apply(null, vals.concat([startValue]));
    let maxV = Math.max.apply(null, vals.concat([startValue]));
    if (minV === maxV) {
      minV -= Math.abs(minV) * 0.01 || 1;
      maxV += Math.abs(maxV) * 0.01 || 1;
    }
    const span = maxV - minV;
    minV -= span * 0.08;
    maxV += span * 0.08;

    const t0 = parseT(pts[0].t);
    const t1 = parseT(pts[pts.length - 1].t);
    const tspan = Math.max(1, t1 - t0);

    function xAt(t) {
      return pad.l + ((parseT(t) - t0) / tspan) * iw;
    }
    function yAt(v) {
      return pad.t + (1 - (Number(v) - minV) / (maxV - minV)) * ih;
    }

    // dashed start-value line
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, yAt(startValue));
    ctx.lineTo(pad.l + iw, yAt(startValue));
    ctx.stroke();
    ctx.restore();

    // line + gradient fill
    ctx.beginPath();
    pts.forEach(function (p, i) {
      const x = xAt(p.t);
      const y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.save();
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    const lastX = xAt(pts[pts.length - 1].t);
    const lastY = yAt(pts[pts.length - 1].v);
    ctx.lineTo(lastX, pad.t + ih);
    ctx.lineTo(xAt(pts[0].t), pad.t + ih);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, "rgba(0,211,90,0.28)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // end cap
    ctx.beginPath();
    ctx.fillStyle = "#00d35a";
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    const marks = opts.marks || [];
    const placed = [];
    marks.forEach(function (m, idx) {
      if (!m || isNaN(parseT(m.t))) return;
      const mx = xAt(m.t);
      if (mx < pad.l - 8 || mx > pad.l + iw + 8) return;
      const kind = String(m.kind || "");
      let label = m.display || m.label || "";
      let color = "#0a84ff";
      if (kind === "bought") color = "#0a84ff";
      else if (kind === "sold") color = "#00d35a";
      else if (kind === "stopped") color = "#ff453a";
      if (!label) return;

      const id = String(m.t) + "|" + label;
      let opacity = 1;
      if (!reduced) {
        if (!animState.marks[id]) animState.marks[id] = now;
        const age = now - animState.marks[id];
        if (age < 200) {
          opacity = age / 200;
          requestAnimationFrame(function () {
            drawLine(canvas, opts);
          });
        }
      }

      // move later marks up a row if they overlap
      let my = yAt(closestValue(pts, m.t)) - 14;
      const approxW = Math.min(140, 8 + label.length * 6.2);
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.some(function (p) {
          return Math.abs(p.x - mx) < (p.w + approxW) / 2 && Math.abs(p.y - my) < 16;
        });
        if (!hit) break;
        my -= 16;
      }
      placed.push({ x: mx, y: my, w: approxW });

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = color;
      ctx.fillText(label, Math.max(pad.l + 4, Math.min(w - pad.r - 4, mx)), my);
      ctx.restore();
    });

    return { empty: false };
  }

  function closestValue(pts, t) {
    const target = parseT(t);
    let best = pts[0];
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(parseT(pts[i].t) - target);
      if (d < bestD) {
        bestD = d;
        best = pts[i];
      }
    }
    return best.v;
  }

  function drawCandles(canvas, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(canvas);
    const candles = (opts.candles || []).filter(function (c) {
      return c && c.c != null;
    });
    if (!candles.length) return { empty: true };

    const pad = { l: 8, r: 8, t: 10, b: 8 };
    const volH = Math.round((h - pad.t - pad.b) * 0.22);
    const gap = 8;
    const plotH = h - pad.t - pad.b - volH - gap;
    const plotY = pad.t;
    const volY = pad.t + plotH + gap;
    const iw = Math.max(1, w - pad.l - pad.r);

    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach(function (c) {
      const hi = c.h != null ? Number(c.h) : Number(c.c);
      const lo = c.l != null ? Number(c.l) : Number(c.c);
      if (!isNaN(hi)) maxP = Math.max(maxP, hi);
      if (!isNaN(lo)) minP = Math.min(minP, lo);
      if (c.c != null) {
        maxP = Math.max(maxP, Number(c.c));
        minP = Math.min(minP, Number(c.c));
      }
    });
    const exitLines = opts.exitLines || [];
    exitLines.forEach(function (el) {
      if (el && el.price != null && !isNaN(Number(el.price))) {
        maxP = Math.max(maxP, Number(el.price));
        minP = Math.min(minP, Number(el.price));
      }
    });
    if (!isFinite(minP) || !isFinite(maxP)) return { empty: true };
    if (minP === maxP) {
      minP -= Math.abs(minP) * 0.02 || 1e-9;
      maxP += Math.abs(maxP) * 0.02 || 1e-9;
    }
    const pspan = maxP - minP;
    minP -= pspan * 0.06;
    maxP += pspan * 0.06;

    function yAt(v) {
      return plotY + (1 - (Number(v) - minP) / (maxP - minP)) * plotH;
    }

    const n = candles.length;
    const slot = iw / n;
    const bodyW = Math.max(1, Math.min(14, slot * 0.62));

    let maxVol = 0;
    candles.forEach(function (c) {
      const v = c.v == null ? 0 : Math.abs(Number(c.v));
      if (!isNaN(v)) maxVol = Math.max(maxVol, v);
    });

    candles.forEach(function (c, i) {
      const o = c.o != null ? Number(c.o) : Number(c.c);
      const hi = c.h != null ? Number(c.h) : Number(c.c);
      const lo = c.l != null ? Number(c.l) : Number(c.c);
      const cl = Number(c.c);
      const up = cl >= o;
      const color = up ? "#00d35a" : "#ff453a";
      const x = pad.l + slot * i + slot / 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yAt(hi));
      ctx.lineTo(x, yAt(lo));
      ctx.stroke();
      const y1 = yAt(o);
      const y2 = yAt(cl);
      const top = Math.min(y1, y2);
      const bh = Math.max(1, Math.abs(y2 - y1));
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);

      if (maxVol > 0 && c.v != null) {
        const vh = (Math.abs(Number(c.v)) / maxVol) * volH;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x - bodyW / 2, volY + volH - vh, bodyW, vh);
        ctx.globalAlpha = 1;
      }
    });

    exitLines.forEach(function (el) {
      if (!el || el.price == null || isNaN(Number(el.price))) return;
      const y = yAt(el.price);
      ctx.save();
      ctx.strokeStyle = el.color || "#ff9f0a";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iw, y);
      ctx.stroke();
      ctx.restore();
    });

    return { empty: false };
  }

  function drawScoreRing(canvas, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(canvas);
    const score = opts.score == null ? null : Number(opts.score);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.max(8, Math.min(w, h) / 2 - 8);
    const lw = Math.max(6, Math.min(10, r * 0.18));
    ctx.lineCap = "round";
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#2c2c2e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (score == null || isNaN(score)) return;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const start = -Math.PI / 2;
    const end = start + pct * Math.PI * 2;
    ctx.strokeStyle = score >= 70 ? "#00d35a" : "#ffd60a";
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();
    // tick at 70
    const tick = start + 0.7 * Math.PI * 2;
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tick) * (r - lw), cy + Math.sin(tick) * (r - lw));
    ctx.lineTo(cx + Math.cos(tick) * (r + lw * 0.15), cy + Math.sin(tick) * (r + lw * 0.15));
    ctx.stroke();
  }

  global.DeskCharts = {
    fit: fit,
    drawLine: drawLine,
    drawCandles: drawCandles,
    drawScoreRing: drawScoreRing,
    reduceMotion: reduceMotion,
  };
})(window);
