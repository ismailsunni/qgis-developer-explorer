const NS = "http://www.w3.org/2000/svg";
const $ = (s, r = document) => r.querySelector(s);
const fmt = n => n.toLocaleString("en-US");
const tip = $("#tip");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SEQ_LIGHT = ["#e8f1fd","#cde2fb","#9ec5f4","#6da7ec","#3987e5","#2a78d6","#1c5cab","#104281"];
const SEQ_DARK  = ["#14243b","#16304f","#184f95","#1c5cab","#2a78d6","#3987e5","#6da7ec","#9ec5f4"];
// per-person yearly counters, as written by scripts/build.py
const [O, MG, CL, CM, RV, AP, MR] = [0, 1, 2, 3, 4, 5, 6];
const GH = "https://github.com/";

/* Release dates from qgis.org (via the QGIS Wikipedia article). */
const MILESTONES = [
  { m: "2013-09", l: "2.0", t: "QGIS 2.0 “Dufour” released, 8 September 2013" },
  { m: "2018-02", l: "3.0", t: "QGIS 3.0 “Girona” released, 23 February 2018" },
  { m: "2026-03", l: "4.0", t: "QGIS 4.0 “Norrköping” released, 6 March 2026" },
];
const METRIC = { o: "PRs opened", mg: "PRs merged", cl: "PRs closed unmerged", p: "PR authors", cm: "comments" };
const TOP = { 0: "PRs opened", 1: "PRs merged", 3: "comments", 4: "PRs reviewed", 6: "PRs merged by them" };

let D, state = { y0: 0, y1: 0, metric: "o", top: 1, peopleSort: { k: "mg", desc: true },
                 prSort: { k: "cm", desc: true }, q: "", prState: "", hideBots: true, marks: true,
                 minEdge: 10, aiMin: 10, limit: 25, plimit: 20 };

/** A bar whose data-end is rounded and whose baseline end is square. */
const barPath = (x, y, w, h, r = 4) => {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const on = (sel, ev, fn) => { const e = $(sel); if (e) e[ev] = fn; };
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of [].concat(kids)) e.appendChild(c);
  return e;
};
const text = (x, y, s, cls = {}) =>
  el("text", { x, y, "font-size": 11, fill: "var(--muted)", ...cls }, [document.createTextNode(s)]);
const root = (host, h) => {
  const w = Math.max(260, host.clientWidth);
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" });
  host.replaceChildren(s);
  return [s, w];
};
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches
  ? document.documentElement.dataset.theme !== "light"
  : document.documentElement.dataset.theme === "dark";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const empty = (host, msg) => host.replaceChildren(Object.assign(document.createElement("p"), { className: "hint", textContent: msg }));

function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.max(8, Math.min(e.clientY + 14, innerHeight - r.height - 8)) + "px";
}
const hideTip = () => { tip.hidden = true; };
const hover = (node, html) => {
  node.addEventListener("pointermove", e => showTip(e, html()));
  node.addEventListener("pointerleave", hideTip);
};

const inRange = y => y >= state.y0 && y <= state.y1;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const spanLabel = d => d >= 365
  ? `${Math.floor(d / 365)}y${Math.floor(d % 365 / 30.4) ? " " + Math.floor(d % 365 / 30.4) + "m" : ""}`
  : d >= 31 ? `${Math.floor(d / 30.4)}m` : d > 0 ? `${d}d` : "once";
const dayLabel = d => d < 1 ? `${Math.round(d * 24)}h` : d < 10 ? `${d.toFixed(1)}d` : `${Math.round(d)}d`;
const people = () => D.people.filter(a => !(state.hideBots && a.bot));
const V = () => D[state.hideBots ? "humans" : "all"];
/** state.aiMin+ merged PRs over all time (not just the selected period): allowed to use AI. */
const aiOk = a => Object.values(a.years).reduce((s, y) => s + y[MG], 0) >= state.aiMin;

/** Sum one counter of a person's yearly arrays over the selected period. */
const tally = (years, i) => {
  let s = 0;
  for (const y in years) if (inRange(+y)) s += years[y][i];
  return s;
};
const sumYears = obj => {
  let s = 0;
  for (const y in obj) if (inRange(+y)) s += obj[y];
  return s;
};

/** Round axis ticks to 1/2/5 x 10^n so labels read as numbers, not noise. */
function niceTicks(max, count = 4) {
  const raw = Math.max(1, max) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
  return Array.from({ length: Math.ceil(Math.max(1, max) / step) + 1 }, (_, i) => i * step);
}
const yearLabels = (svg, years, x, H) => years.forEach((yr, i) => {
  if (years.length <= 12 || yr % (years.length > 24 ? 4 : 2) === 0)
    svg.appendChild(text(x(i), H - 7, yr, { "text-anchor": "middle" }));
});

/* ---------------------------------------------------------- stat tiles */
function renderTiles() {
  const yrs = V().yearly.filter(y => inRange(y.y));
  const sum = k => yrs.reduce((a, y) => a + y[k], 0);
  const ppl = people();
  const mg = sum("mg"), cl = sum("cl");
  const tiles = [
    [fmt(sum("o")), "PRs opened"],
    [fmt(mg), `merged · ${mg + cl ? Math.round(mg / (mg + cl) * 100) : 0}% of resolved`],
    [fmt(ppl.filter(a => tally(a.years, O)).length), "PR authors"],
    [fmt(ppl.filter(a => tally(a.years, RV)).length), "reviewers"],
    [fmt(sum("cm")), "comments"],
  ];
  $("#tiles").innerHTML = tiles
    .map(([v, k]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}

/* ----------------------------------------------------------- timeline */
function monthRange(a, b) {
  const out = [];
  let [y, m] = a.split("-").map(Number);
  const [ey, em] = b.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function renderTimeline() {
  const host = $("#timeline"), H = 250, P = { t: 12, r: 12, b: 26, l: 44 };
  const [svg, W] = root(host, H);
  const series = V().monthly, key = state.metric;
  const months = monthRange(series[0].m, series.at(-1).m);
  const byM = new Map(series.map(d => [d.m, d]));
  const pts = months.map((m, i) => ({ o: 0, mg: 0, cl: 0, p: 0, cm: 0, ...byM.get(m), m, i }));

  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const ticks = niceTicks(Math.max(...pts.map(d => d[key])));
  const max = ticks.at(-1);
  const x = i => P.l + (iw * i) / Math.max(1, months.length - 1);
  const y = v => P.t + ih - (ih * v) / max;
  for (const v of ticks) {
    svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(text(P.l - 8, y(v) + 4, fmt(v), { "text-anchor": "end" }));
  }
  const line = pts.map((d, j) => `${j ? "L" : "M"}${x(d.i)},${y(d[key])}`).join("");
  svg.appendChild(el("path", {
    d: line + `L${x(pts.at(-1).i)},${y(0)}L${x(0)},${y(0)}Z`, fill: "var(--s1)", "fill-opacity": .16,
  }));
  svg.appendChild(el("path", { d: line, fill: "none", stroke: "var(--s1)", "stroke-opacity": .45, "stroke-width": 1 }));
  const roll = pts.map((_, j) => {
    const w = pts.slice(Math.max(0, j - 11), j + 1);
    return w.reduce((a, d) => a + d[key], 0) / w.length;
  });
  svg.appendChild(el("path", {
    d: roll.map((v, j) => `${j ? "L" : "M"}${x(j)},${y(v)}`).join(""),
    fill: "none", stroke: "var(--s1)", "stroke-width": 2, "stroke-linejoin": "round",
  }));

  // dim everything outside the selected period
  const inSel = m => inRange(+m.slice(0, 4));
  const firstSel = months.findIndex(inSel);
  let lastSel = months.length - 1;
  while (lastSel > 0 && !inSel(months[lastSel])) lastSel--;
  const dim = (x1, x2) => x2 > x1 && svg.appendChild(el("rect", {
    x: x1, y: P.t, width: x2 - x1, height: ih, fill: "var(--surface)", "fill-opacity": .66,
  }));
  dim(P.l, x(Math.max(0, firstSel)));
  dim(x(lastSel), W - P.r);

  let prevYear = null;
  months.forEach((m, i) => {
    const yr = +m.slice(0, 4);
    if (yr !== prevYear && yr % 2 === 0) {
      svg.appendChild(text(x(i), H - 8, yr, { "text-anchor": "middle" }));
      prevYear = yr;
    }
  });
  svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), stroke: "var(--axis)" }));

  if (state.marks) {
    for (const ms of MILESTONES) {
      const i = months.indexOf(ms.m);
      if (i < 0) continue;
      const mx = x(i), w = ms.l.length * 6.2 + 14, h = 17, fy = P.t + 2;
      const flip = mx + w > W - P.r, fx = flip ? mx - w : mx;
      const g = el("g", { cursor: "help" });
      g.appendChild(el("line", { x1: mx, x2: mx, y1: fy, y2: P.t + ih, stroke: "var(--axis)", "stroke-width": 1 }));
      g.appendChild(el("path", {
        d: flip ? `M${mx},${fy}H${fx + 5}l-5,${h / 2}l5,${h / 2}H${mx}Z`
                : `M${mx},${fy}H${fx + w - 5}l5,${h / 2}l-5,${h / 2}H${mx}Z`,
        fill: "var(--s1)", "fill-opacity": .92,
      }));
      g.appendChild(text(fx + (flip ? 9 : 6), fy + h / 2 + 4, ms.l, { fill: "#fff", "font-weight": 600 }));
      g.addEventListener("pointermove", e => { e.stopPropagation(); showTip(e, `<b>${ms.l}</b> · ${ms.m}<br>${ms.t}`); });
      g.addEventListener("pointerleave", hideTip);
      svg.appendChild(g);
    }
  }

  const cross = el("line", { y1: P.t, y2: P.t + ih, stroke: "var(--axis)", "stroke-width": 1, opacity: 0 });
  const dot = el("circle", { r: 4, fill: "var(--s1)", stroke: "var(--surface)", "stroke-width": 2, opacity: 0 });
  const sel = el("rect", { y: P.t, height: ih, fill: "var(--s1)", "fill-opacity": .14, opacity: 0 });
  svg.append(sel, cross, dot);
  const slotAt = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(months.length - 1, Math.round(((px - P.l) / iw) * (months.length - 1))));
  };
  let anchor = null;
  svg.addEventListener("pointermove", e => {
    const d = pts[slotAt(e)];
    cross.setAttribute("x1", x(d.i)); cross.setAttribute("x2", x(d.i)); cross.setAttribute("opacity", 1);
    dot.setAttribute("cx", x(d.i)); dot.setAttribute("cy", y(d[key])); dot.setAttribute("opacity", 1);
    if (anchor !== null) {
      sel.setAttribute("x", Math.min(x(anchor), x(d.i)));
      sel.setAttribute("width", Math.abs(x(d.i) - x(anchor)));
      sel.setAttribute("opacity", 1);
    }
    const [yy, mm] = d.m.split("-");
    showTip(e, `<b>${MONTHS[+mm - 1]} ${yy}</b><br>${fmt(d.o)} opened · ${fmt(d.mg)} merged · ${fmt(d.cl)} closed<br>
      <span class="k">${fmt(d.p)} authors · ${fmt(d.cm)} comments</span>`);
  });
  svg.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); hideTip(); });
  svg.addEventListener("pointerdown", e => { anchor = slotAt(e); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointerup", e => {
    if (anchor === null) return;
    const gi = slotAt(e);
    sel.setAttribute("opacity", 0);
    if (Math.abs(gi - anchor) > 1)
      setRange(+months[Math.min(anchor, gi)].slice(0, 4), +months[Math.max(anchor, gi)].slice(0, 4));
    anchor = null;
  });
  svg.appendChild(el("title", {}, [document.createTextNode(`Monthly ${METRIC[key]} on ${D.meta.repo}`)]));
}

/* ------------------------------------------------------ people (bars) */
function renderPeopleChart() {
  const host = $("#peopleChart"), k = state.top;
  const rows = people().map(a => ({ ...a, sum: tally(a.years, k) })).filter(a => a.sum > 0)
    .sort((x, y) => y.sum - x.sum).slice(0, 16);
  if (!rows.length) return empty(host, "Nothing in this period.");
  const RH = 21, H = rows.length * RH + 12, P = { t: 6, r: 52, l: 130 };
  const [svg, W] = root(host, H);
  const max = rows[0].sum, iw = W - P.l - P.r;
  rows.forEach((a, i) => {
    const y = P.t + i * RH, w = Math.max(2, (iw * a.sum) / max);
    const name = a.name.length > 17 ? a.name.slice(0, 16) + "…" : a.name;
    svg.appendChild(text(P.l - 10, y + 13, name, { "text-anchor": "end", fill: "var(--ink-2)", "font-size": 12 }));
    const bar = el("rect", { x: P.l, y: y + 3, width: w, height: 13, rx: 4, fill: "var(--s1)" });
    hover(bar, () => `<b>${esc(a.name)}</b><br>${fmt(a.sum)} ${TOP[k]} in ${state.y0}–${state.y1}<br>
      <span class="k">${fmt(tally(a.years, O))} opened · ${fmt(tally(a.years, MG))} merged ·
      ${fmt(tally(a.years, CM))} comments · ${fmt(tally(a.years, RV))} reviewed</span>`);
    svg.appendChild(bar);
    svg.appendChild(text(P.l + w + 7, y + 14, fmt(a.sum), { fill: "var(--ink-2)", "font-size": 11.5 }));
  });
}

/* ------------------------------------------------- PRs per author (hist) */
const BUCKETS = [[1, 1], [2, 2], [3, 5], [6, 10], [11, 25], [26, 100], [101, 500], [501, Infinity]];
const bucketLabel = ([a, b]) => b === Infinity ? `${a}+` : a === b ? `${a}` : `${a}–${b}`;

function renderHistogram() {
  const host = $("#histogram");
  const counts = people().map(a => tally(a.years, O)).filter(n => n > 0).sort((a, b) => b - a);
  if (!counts.length) return empty(host, "No PRs in this period.");
  const H = 232, P = { t: 22, r: 10, l: 36, b: 40 };
  const [svg, W] = root(host, H);
  const bins = BUCKETS.map(([lo, hi]) => {
    const inBin = counts.filter(n => n >= lo && n <= hi);
    return { lo, hi, people: inBin.length, prs: inBin.reduce((a, b) => a + b, 0) };
  });
  const total = counts.reduce((a, b) => a + b, 0);
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const ticks = niceTicks(Math.max(...bins.map(b => b.people)), 3);
  const max = ticks.at(-1), bw = iw / bins.length;
  const y = v => P.t + ih - (ih * v) / max;
  for (const v of ticks) {
    svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }));
    svg.appendChild(text(P.l - 7, y(v) + 4, fmt(v), { "text-anchor": "end" }));
  }
  bins.forEach((b, i) => {
    const w = Math.max(3, Math.min(46, bw - 12)), bx = P.l + i * bw + (bw - w) / 2;
    const r = el("path", { d: barPath(bx, y(b.people), w, Math.max(1, y(0) - y(b.people))), fill: "var(--s1)" });
    hover(r, () => `<b>${bucketLabel([b.lo, b.hi])} PR${b.hi === 1 ? "" : "s"}</b><br>
      ${fmt(b.people)} people <span class="k">(${(b.people / counts.length * 100).toFixed(1)}% of authors)</span><br>
      ${fmt(b.prs)} PRs <span class="k">(${(b.prs / total * 100).toFixed(1)}% of all PRs)</span>`);
    svg.appendChild(r);
    svg.appendChild(text(bx + w / 2, y(b.people) - 6, fmt(b.people), { "text-anchor": "middle", fill: "var(--ink-2)" }));
    svg.appendChild(text(bx + w / 2, H - P.b + 16,
      bw < 52 ? (b.hi === Infinity ? b.lo + "+" : b.lo) : bucketLabel([b.lo, b.hi]), { "text-anchor": "middle" }));
  });
  svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), stroke: "var(--axis)" }));
  svg.appendChild(text(P.l, H - 6, "PRs opened by one person"));

  let acc = 0, half = 0;
  while (acc < total / 2 && half < counts.length) acc += counts[half++];
  $("#histNote").innerHTML =
    `Half of all PRs come from <b>${fmt(half)}</b> ${half === 1 ? "person" : "people"}
     (${(half / counts.length * 100).toFixed(1)}% of authors); <b>${(bins[0].people / counts.length * 100).toFixed(0)}%</b>
     opened exactly one.`;
}

/* ----------------------------------------------------- time to merge */
function renderTtm() {
  const host = $("#ttm");
  const years = V().yearly.filter(y => inRange(y.y) && y.ttm);
  if (!years.length) return empty(host, "No merges in this period.");
  const H = 230, P = { t: 10, r: 10, l: 40, b: 26 };
  const [svg, W] = root(host, H);
  const iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / years.length;
  // log scale: a median of hours and a tail of months both need to read
  const lo = 0.1, hi = 10 ** Math.ceil(Math.log10(Math.max(1, ...years.map(y => y.ttm[2]))));
  const y = v => P.t + ih - ih * (Math.log10(Math.max(lo, v)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  for (let v = lo; v <= hi; v *= 10) {
    svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }));
    svg.appendChild(text(P.l - 7, y(v) + 4, v < 1 ? `${Math.round(v * 24)}h` : `${v}d`, { "text-anchor": "end" }));
  }
  years.forEach((yr, i) => {
    const [q1, med, q3] = yr.ttm, cx = P.l + i * bw + bw / 2, w = Math.max(3, Math.min(18, bw * .5));
    const g = el("g");
    g.appendChild(el("rect", { x: cx - w / 2, y: y(q3), width: w, height: Math.max(1, y(q1) - y(q3)), rx: 3,
      fill: "var(--s1)", "fill-opacity": .3 }));
    g.appendChild(el("circle", { cx, cy: y(med), r: 3.5, fill: "var(--s1)", stroke: "var(--surface)", "stroke-width": 1.5 }));
    g.appendChild(el("rect", { x: P.l + i * bw, y: P.t, width: bw, height: ih, fill: "transparent" }));
    hover(g, () => `<b>${yr.y}</b> · ${fmt(yr.mg)} merged<br>median ${dayLabel(med)}<br>
      <span class="k">half of merges took ${dayLabel(q1)}–${dayLabel(q3)}</span>`);
    svg.appendChild(g);
  });
  yearLabels(svg, years.map(y => y.y), i => P.l + i * bw + bw / 2, H);
}

/* -------------------------------------------------- outcomes (stacked) */
function renderOutcomes() {
  const host = $("#outcomes");
  const years = V().yearly.filter(y => inRange(y.y));
  const H = 230, P = { t: 10, r: 10, l: 40, b: 26 };
  const [svg, W] = root(host, H);
  const iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / Math.max(1, years.length);
  const ticks = niceTicks(Math.max(1, ...years.map(y => y.mg + y.cl)), 3), max = ticks.at(-1);
  const y = v => P.t + ih - (ih * v) / max;
  for (const v of ticks) {
    svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }));
    svg.appendChild(text(P.l - 7, y(v) + 4, fmt(v), { "text-anchor": "end" }));
  }
  years.forEach((yr, i) => {
    const w = Math.max(3, Math.min(30, bw * .7)), bx = P.l + i * bw + (bw - w) / 2;
    const g = el("g");
    g.appendChild(el("rect", { x: bx, y: y(yr.mg), width: w, height: y(0) - y(yr.mg), fill: "var(--s7)" }));
    g.appendChild(el("path", { d: barPath(bx, y(yr.mg + yr.cl), w, Math.max(0, y(yr.mg) - y(yr.mg + yr.cl)), 3), fill: "var(--s8)" }));
    g.appendChild(el("rect", { x: P.l + i * bw, y: P.t, width: bw, height: ih, fill: "transparent" }));
    hover(g, () => `<b>${yr.y}</b><br>${fmt(yr.mg)} merged · ${fmt(yr.cl)} closed unmerged<br>
      <span class="k">${Math.round(yr.mg / Math.max(1, yr.mg + yr.cl) * 100)}% merge rate · ${fmt(yr.o)} opened</span>`);
    svg.appendChild(g);
  });
  yearLabels(svg, years.map(y => y.y), i => P.l + i * bw + bw / 2, H);
  svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), stroke: "var(--axis)" }));
  host.insertAdjacentHTML("beforeend", `<div class="legend"><span><i style="background:var(--s7)"></i>merged</span>
    <span><i style="background:var(--s8)"></i>closed without merging</span></div>`);
}

/* ------------------------------------------------------ states (donut) */
function renderStates() {
  const host = $("#states"), ppl = people();
  const t = i => ppl.reduce((s, a) => s + tally(a.years, i), 0);
  const [o, mg, cl] = [t(O), t(MG), t(CL)];
  if (!o) return empty(host, "No PRs in this period.");
  const parts = [["merged", mg, "var(--s7)"], ["closed without merging", cl, "var(--s8)"], ["open", o - mg - cl, "var(--s3)"]];
  const H = 230, [svg, W] = root(host, H), cx = W / 2, cy = H / 2, R = H / 2 - 8, r = R * .6;
  let a0 = -Math.PI / 2;
  for (const [k, v, c] of parts) {
    if (!v) continue;
    const a1 = a0 + Math.min(v / o, .99999) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const seg = el("path", { d: `M${pt(R, a0)}A${R},${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${big} 0 ${pt(r, a0)}Z`,
      fill: c, stroke: "var(--surface)", "stroke-width": 2 });
    hover(seg, () => `<b>${fmt(v)}</b> ${k}<br><span class="k">${(v / o * 100).toFixed(1)}% of ${fmt(o)} PRs opened</span>`);
    svg.appendChild(seg);
    a0 = a1;
  }
  svg.appendChild(text(cx, cy + 2, fmt(o), { "text-anchor": "middle", "font-size": 20, "font-weight": 640, fill: "var(--ink)" }));
  svg.appendChild(text(cx, cy + 18, "PRs opened", { "text-anchor": "middle" }));
  host.insertAdjacentHTML("beforeend", `<div class="legend">${parts.map(([k, v, c]) =>
    `<span><i style="background:${c}"></i>${k} ${Math.round(v / o * 100)}%</span>`).join("")}</div>`);
}

/* --------------------------------------------------------- heatmap */
function renderHeatmap() {
  const host = $("#heatmap");
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const y in V().heatmapByYear) {
    if (!inRange(+y)) continue;
    V().heatmapByYear[y].forEach((row, d) => row.forEach((v, h) => { grid[d][h] += v; }));
  }
  const H = 196, P = { t: 14, r: 8, l: 34, b: 26 };
  const [svg, W] = root(host, H);
  const cw = (W - P.l - P.r) / 24, ch = (H - P.t - P.b) / 7;
  const max = Math.max(1, ...grid.flat());
  const ramp = dark() ? SEQ_DARK : SEQ_LIGHT;
  const color = v => v === 0 ? "var(--grid)" : ramp[Math.min(ramp.length - 1, Math.floor((v / max) ** .55 * ramp.length))];
  const total = grid.flat().reduce((a, b) => a + b, 0) || 1;
  grid.forEach((row, d) => {
    svg.appendChild(text(P.l - 7, P.t + d * ch + ch / 2 + 4, DAYS[d], { "text-anchor": "end" }));
    row.forEach((v, h) => {
      const r = el("rect", { x: P.l + h * cw + 1, y: P.t + d * ch + 1, width: Math.max(1, cw - 2),
        height: Math.max(1, ch - 2), rx: 2, fill: color(v) });
      hover(r, () => `<b>${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC</b><br>${fmt(v)} PRs opened
        <span class="k">(${(v / total * 100).toFixed(1)}%)</span>`);
      svg.appendChild(r);
    });
  });
  for (let h = 0; h < 24; h += 3)
    svg.appendChild(text(P.l + h * cw + cw / 2, H - 8, String(h).padStart(2, "0"), { "text-anchor": "middle" }));
  host.insertAdjacentHTML("beforeend",
    `<div class="legend scale"><span>fewer</span>${ramp.map(c => `<i style="background:${c}"></i>`).join("")}<span>more PRs</span></div>`);
}

/* ----------------------------------------------------- churn (bars) */
function renderChurn() {
  const host = $("#churn");
  const years = V().yearly.filter(y => inRange(y.y));
  const H = 196, P = { t: 10, r: 10, l: 34, b: 26 };
  const [svg, W] = root(host, H);
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const ticks = niceTicks(Math.max(1, ...years.map(y => Math.max(y.newcomers, y.returning))), 3);
  const max = ticks.at(-1), bw = iw / Math.max(1, years.length);
  const y = v => P.t + ih - (ih * v) / max;
  for (const v of ticks) {
    svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: "var(--grid)" }));
    svg.appendChild(text(P.l - 7, y(v) + 4, v, { "text-anchor": "end" }));
  }
  years.forEach((yr, i) => {
    [["newcomers", "var(--s1)", 0], ["returning", "var(--s2)", 1]].forEach(([k, c, s]) => {
      const w = Math.max(2, bw * .36), bx = P.l + i * bw + bw * .12 + s * (w + 2);
      const r = el("path", { d: barPath(bx, y(yr[k]), w, Math.max(1, y(0) - y(yr[k])), 3), fill: c });
      hover(r, () => `<b>${yr.y}</b><br>${fmt(yr.newcomers)} first-time authors<br>${fmt(yr.returning)} also opened a PR the year before<br>
        <span class="k">${fmt(yr.people)} authors, ${fmt(yr.o)} PRs</span>`);
      svg.appendChild(r);
    });
  });
  yearLabels(svg, years.map(y => y.y), i => P.l + i * bw + bw / 2, H);
  svg.appendChild(el("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), stroke: "var(--axis)" }));
  host.insertAdjacentHTML("beforeend",
    `<div class="legend"><span><i style="background:var(--s1)"></i>first-time authors</span>
     <span><i style="background:var(--s2)"></i>returning from last year</span></div>`);
}

/* ------------------------------------------------ who works with whom */
let sim = null;

function renderGraph() {
  const host = $("#graph"), g = V().graph;
  if (sim) { sim.stop(); sim = null; }
  const H = Math.max(360, Math.min(560, host.clientWidth * 0.5));
  const [svg, W] = root(host, H);
  const size = g.nodes.map(n => sumYears(n.years));
  const minW = state.minEdge;
  const raw = g.edges.map(([a, b, ys]) => ({ a, b, w: sumYears(ys) }))
    .filter(e => e.w >= minW && size[e.a] > 0 && size[e.b] > 0);
  const ids = [...new Set(raw.flatMap(e => [e.a, e.b]))].sort((a, b) => size[b] - size[a]);
  const at = new Map(ids.map((id, i) => [id, i]));

  $("#graphNote").innerHTML = ids.length
    ? `<b>${fmt(ids.length)}</b> of the ${g.nodes.length} most connected people share
       <b>${fmt(raw.length)}</b> connections of ${minW}+ PR${minW > 1 ? "s" : ""} in this period.
       <span class="k">Drag a node to pin it, double-click to release, scroll to zoom.</span>`
    : "No pair shares that many PRs in this period — lower the threshold.";
  if (!ids.length) return;

  const maxN = Math.max(...ids.map(i => size[i]));
  const nodes = ids.map((id, i) => {
    const a = (i * 2.399963) % (Math.PI * 2), r = (0.2 + 0.8 * (i / ids.length)) * Math.min(W, H) * 0.42;
    return { ...g.nodes[id], n: size[id], i, r: 4 + 18 * Math.sqrt(size[id] / maxN),
             x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r };
  });
  const links = raw.map(e => ({ source: at.get(e.a), target: at.get(e.b), w: e.w }));
  const maxW = Math.max(...links.map(l => l.w));

  const view = el("g"), eg = el("g", { stroke: "var(--s1)" }), ng = el("g"), lg = el("g");
  view.append(eg, ng, lg);
  svg.appendChild(view);
  const lines = links.map(l => eg.appendChild(el("line", {
    "stroke-width": 0.6 + 3 * (l.w / maxW), "stroke-opacity": 0.1 + 0.35 * (l.w / maxW) })));
  const circles = nodes.map(nd => ng.appendChild(el("circle", { r: nd.r, fill: "var(--s1)", "fill-opacity": .85,
    stroke: "var(--surface)", "stroke-width": 2, cursor: "grab" })));
  const labelled = nodes.slice(0, 14);
  const labels = labelled.map(nd => lg.appendChild(text(0, 0, nd.name, { "text-anchor": "middle", fill: "var(--ink-2)",
    "paint-order": "stroke", stroke: "var(--surface)", "stroke-width": 3, "pointer-events": "none" })));

  const tick = () => {
    lines.forEach((ln, i) => {
      const l = links[i];
      ln.setAttribute("x1", l.source.x); ln.setAttribute("y1", l.source.y);
      ln.setAttribute("x2", l.target.x); ln.setAttribute("y2", l.target.y);
    });
    circles.forEach((c, i) => { c.setAttribute("cx", nodes[i].x); c.setAttribute("cy", nodes[i].y); });
    const boxes = [];
    labels.forEach((t, i) => {
      const nd = labelled[i], w = t.textContent.length * 6, x = nd.x, y = nd.y - nd.r - 5;
      const clash = boxes.some(b => Math.abs(b.x - x) < (b.w + w) / 2 + 4 && Math.abs(b.y - y) < 13);
      if (!clash) boxes.push({ x, y, w });
      t.setAttribute("display", clash ? "none" : "inline");
      t.setAttribute("x", x); t.setAttribute("y", y);
    });
  };
  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).distance(l => 120 - 70 * (l.w / maxW)).strength(l => 0.06 + 0.5 * (l.w / maxW)))
    .force("charge", d3.forceManyBody().strength(-260).distanceMax(Math.max(W, H)))
    .force("collide", d3.forceCollide(d => d.r + 3))
    .force("x", d3.forceX(W / 2).strength(0.045))
    .force("y", d3.forceY(H / 2).strength(0.075))
    .alphaDecay(0.022)
    .on("tick", tick);

  const highlight = i => lines.forEach((ln, j) => {
    const hit = i == null || links[j].source.index === i || links[j].target.index === i;
    ln.setAttribute("stroke-opacity", i == null ? 0.1 + 0.35 * (links[j].w / maxW) : hit ? .85 : .04);
  });
  circles.forEach((c, i) => {
    const nd = nodes[i];
    c.addEventListener("pointermove", e => {
      const mates = links.filter(l => l.source.index === i || l.target.index === i)
        .sort((p, q) => q.w - p.w).slice(0, 3)
        .map(l => `${esc((l.source.index === i ? l.target : l.source).name)} (${l.w})`);
      showTip(e, `<b>${esc(nd.name)}</b><br>${fmt(nd.n)} interactions in ${state.y0}–${state.y1}<br>
        <span class="k">works most with: ${mates.join(", ") || "—"}</span>`);
      highlight(i);
    });
    c.addEventListener("pointerleave", () => { hideTip(); highlight(null); });
    c.addEventListener("dblclick", () => {
      nd.fx = nd.fy = null;
      c.setAttribute("stroke", "var(--surface)");
      sim.alpha(.25).restart();
    });
    d3.select(c).call(d3.drag()
      .subject(() => nd)
      .on("start", e => { if (!e.active) sim.alphaTarget(.3).restart(); nd.fx = nd.x; nd.fy = nd.y; c.setAttribute("cursor", "grabbing"); })
      .on("drag", e => { nd.fx = e.x; nd.fy = e.y; })
      .on("end", e => { if (!e.active) sim.alphaTarget(0); c.setAttribute("cursor", "grab"); c.setAttribute("stroke", "var(--ink-2)"); }));
  });

  let z = 1, tx = 0, ty = 0;
  const apply = () => view.setAttribute("transform", `translate(${tx},${ty}) scale(${z})`);
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * W, my = (e.clientY - r.top) / r.height * H;
    const nz = Math.max(0.4, Math.min(6, z * Math.exp(-e.deltaY * 0.0016)));
    tx = mx - (mx - tx) * (nz / z); ty = my - (my - ty) * (nz / z);
    z = nz; apply();
  }, { passive: false });
  let pan = null;
  svg.addEventListener("pointerdown", e => {
    if (e.target.tagName === "circle") return;
    pan = { x: e.clientX, y: e.clientY, tx, ty };
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", e => {
    if (!pan) return;
    const r = svg.getBoundingClientRect();
    tx = pan.tx + (e.clientX - pan.x) * (W / r.width);
    ty = pan.ty + (e.clientY - pan.y) * (H / r.height);
    apply();
  });
  const endPan = () => { pan = null; svg.style.cursor = ""; };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointerleave", endPan);
  on("#graphReset", "onclick", () => {
    z = 1; tx = ty = 0; apply();
    nodes.forEach(n => { n.fx = n.fy = null; });
    circles.forEach(c => c.setAttribute("stroke", "var(--surface)"));
    sim.alpha(1).restart();
  });
}

/* ----------------------------------------------------------- tables */
function spark(years) {
  const vals = D.years.map(y => years[y] ? years[y][O] : 0), max = Math.max(1, ...vals);
  const w = 3, h = 16;
  return `<svg width="${vals.length * w}" height="${h}" viewBox="0 0 ${vals.length * w} ${h}">` +
    vals.map((v, i) => {
      const bh = Math.max(v ? 1 : 0, (v / max) * h);
      return `<rect x="${i * w}" y="${h - bh}" width="${w - 1}" height="${bh}" rx="1"
        fill="var(--s1)" fill-opacity="${inRange(D.years[i]) ? .95 : .25}"/>`;
    }).join("") + "</svg>";
}

/** Render a sortable table: cols are [key, header, cell(row), class]. */
function table(sel, cols, rows, st, rerender) {
  rows.sort((a, b) => {
    const [x, y] = [a[st.k], b[st.k]];
    const c = x == null ? 1 : y == null ? -1 : typeof x === "string" ? x.localeCompare(y) : x - y;
    return x == null || y == null ? c : st.desc ? -c : c;
  });
  const tbl = $(sel);
  tbl.innerHTML =
    `<thead><tr>${cols.map(c => `<th data-k="${c[0]}" class="${c[3].includes("l") ? "l" : ""}">${c[1]}${
      c[0] === st.k ? (st.desc ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>`;
  tbl.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    if (k === "rank" || k === "spark") return;
    st.desc = st.k === k ? !st.desc : true;
    st.k = k;
    rerender();
  });
  return (shown, msg) => tbl.insertAdjacentHTML("beforeend", `<tbody>${shown.map(r =>
    `<tr>${cols.map(c => `<td class="${c[3]}">${c[2](r)}</td>`).join("")}</tr>`).join("")
    || `<tr><td class="l dim" colspan="${cols.length}">${msg}</td></tr>`}</tbody>`);
}

function renderPeopleTable() {
  const pct = r => r.mg + r.cl ? Math.round(r.mg / (r.mg + r.cl) * 100) + "%" : "—";
  const cols = [
    ["rank", "#", r => r.rank, "num dim"],
    ["name", "Developer", r => `<a href="${GH}${esc(r.name)}" target="_blank" rel="noopener">${esc(r.name)}</a>${
      aiOk(r) ? ` <span class="ai" title="${state.aiMin}+ merged PRs: allowed to use AI">✦</span>` : ""}`, "l"],
    ["o", "PRs", r => fmt(r.o), "num"],
    ["mg", "Merged", r => fmt(r.mg), "num"],
    ["cl", "Closed", r => fmt(r.cl), "num"],
    ["op", "Open", r => fmt(r.op), "num dim"],
    ["rate", "Merge rate", pct, "num dim"],
    ["cm", "Comments", r => fmt(r.cm), "num"],
    ["recv", "Received", r => fmt(r.recv), "num dim"],
    ["rv", "Reviewed", r => fmt(r.rv), "num"],
    ["ap", "Approved", r => fmt(r.ap), "num dim"],
    ["mr", "Merged for others", r => fmt(r.mr), "num dim"],
    ["ttm", "Time to merge", r => r.ttm == null ? "—" : dayLabel(r.ttm), "num dim"],
    ["lines", "Lines ±", r => fmt(r.lines), "num dim"],
    ["first", "First", r => r.first, "num dim"],
    ["last", "Last", r => r.last, "num dim"],
    ["span", "Span", r => spanLabel(r.span), "num dim"],
    ["spark", "PRs per year", r => spark(r.years), "l"],
  ];
  let rows = people().map(a => {
    const t = i => tally(a.years, i);
    const r = { ...a, o: t(O), mg: t(MG), cl: t(CL), cm: t(CM), rv: t(RV), ap: t(AP), mr: t(MR),
                lines: a.add + a.del, span: daysBetween(a.first, a.last) };
    r.op = r.o - r.mg - r.cl;
    r.rate = r.mg + r.cl ? r.mg / (r.mg + r.cl) : null;
    return r;
  }).filter(r => r.o + r.cm + r.rv + r.mr > 0);
  if (state.q) rows = rows.filter(a => a.name.toLowerCase().includes(state.q.toLowerCase()));
  const body = table("#peopleTable", cols, rows, state.peopleSort, renderPeopleTable);
  const shown = rows.slice(0, state.limit);
  shown.forEach((r, i) => { r.rank = i + 1; });
  body(shown, "Nobody in this period.");
  $("#peopleMore").hidden = rows.length <= state.limit;
  $("#peopleMore").textContent = `Show more (${fmt(rows.length - shown.length)} left)`;
}

function renderPrTable() {
  const cols = [
    ["n", "PR", p => `<a href="${GH}${D.meta.repo}/pull/${p.n}" target="_blank" rel="noopener">#${p.n}</a>`, "num"],
    ["t", "Title", p => `<span title="${esc(p.t)}">${esc(p.t)}</span>`, "l subj"],
    ["a", "Author", p => esc(p.a), "l dim"],
    ["s", "State", p => `<span class="pill ${p.s}">${p.s}</span>`, "l"],
    ["cm", "Comments", p => fmt(p.cm), "num"],
    ["rv", "Reviews", p => fmt(p.rv), "num"],
    ["sz", "Lines ±", p => fmt(p.sz), "num dim"],
    ["days", "Ran for", p => p.days === 0 ? "same day" : fmt(p.days) + " days", "num"],
    ["start", "Opened", p => p.start, "num dim"],
  ];
  const rows = D.prs.filter(p => inRange(+p.start.slice(0, 4)) && !(state.hideBots && p.bot)
    && (!state.prState || p.s === state.prState));
  const body = table("#prTable", cols, rows, state.prSort, renderPrTable);
  body(rows.slice(0, state.plimit), "No notable PRs in this period.");
  $("#prMore").hidden = rows.length <= state.plimit;
  $("#prMore").textContent = `Show more (${fmt(rows.length - state.plimit)} left)`;
}

/* -------------------------------------------------------- plumbing */
function setRange(a, b) {
  state.y0 = Math.max(D.years[0], Math.min(a, b));
  state.y1 = Math.min(D.years.at(-1), Math.max(a, b));
  $("#y0").value = state.y0; $("#y1").value = state.y1;
  renderAll();
}

function renderAll() {
  const yrs = V().yearly.filter(y => inRange(y.y));
  $("#rangeNote").textContent =
    `${fmt(yrs.reduce((a, y) => a + y.o, 0))} PRs in ${state.y1 - state.y0 + 1} year${state.y1 > state.y0 ? "s" : ""}`;
  renderTiles(); renderTimeline(); renderPeopleChart(); renderHistogram(); renderStates(); renderTtm(); renderOutcomes();
  renderHeatmap(); renderChurn(); renderGraph(); renderPeopleTable(); renderPrTable();
}

const seg = (sel, fn) => on(sel, "onclick", e => {
  if (!e.target.dataset.v) return;
  $(sel).querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.target));
  fn(e.target.dataset.v);
});

function boot(data) {
  D = data;
  [state.y0, state.y1] = [D.years[0], D.years.at(-1)];
  const m = D.meta;
  $("#subtitle").textContent = `${fmt(m.prs)} pull requests · ${fmt(m.merged)} merged · ${fmt(m.authors)} authors · ` +
    `${fmt(m.people)} people · ${m.first} to ${m.last}`;
  $("#gen").textContent = `Data generated ${m.generated}.`;
  for (const id of ["y0", "y1"]) {
    $("#" + id).innerHTML = D.years.map(y => `<option>${y}</option>`).join("");
    $("#" + id).value = state[id];
    on("#" + id, "onchange", () => setRange(+$("#y0").value, +$("#y1").value));
  }
  const last = D.years.at(-1);
  const presets = [["All", D.years[0], last], ["Last 5 years", last - 4, last], ["Since 3.0", 2018, last],
                   ["2.x era", 2013, 2017], ["This year", last, last]];
  $("#presets").innerHTML = presets.map((p, i) => `<button data-i="${i}">${p[0]}</button>`).join("");
  on("#presets", "onclick", e => { const i = e.target.dataset.i; if (i) setRange(presets[i][1], presets[i][2]); });
  seg("#metric", v => { state.metric = v; renderTimeline(); });
  seg("#topMetric", v => { state.top = +v; renderPeopleChart(); });
  on("#search", "oninput", e => { state.q = e.target.value.trim(); state.limit = 25; renderPeopleTable(); });
  on("#peopleMore", "onclick", () => { state.limit += 50; renderPeopleTable(); });
  on("#prMore", "onclick", () => { state.plimit += 40; renderPrTable(); });
  on("#prState", "onchange", e => { state.prState = e.target.value; state.plimit = 20; renderPrTable(); });
  on("#bots", "onchange", e => { state.hideBots = e.target.checked; renderAll(); });
  on("#marks", "onchange", e => { state.marks = e.target.checked; renderTimeline(); });
  on("#aiMin", "oninput", e => {
    state.aiMin = +e.target.value;
    $("#aiMinVal").textContent = $("#aiMinNote").textContent = state.aiMin;
    renderPeopleTable();
  });
  on("#minEdge", "oninput", e => { state.minEdge = +e.target.value; $("#minEdgeVal").textContent = state.minEdge; renderGraph(); });
  $("#app").hidden = false;
  renderAll();
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 150); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}

$("#theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || "system";
  const next = { system: "light", light: "dark", dark: "system" }[cur];
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  if (D) renderAll();
};
try {
  const s = localStorage.getItem("theme");
  if (s && s !== "system") document.documentElement.dataset.theme = s;
} catch {}

fetch("data/qgis.json")
  .then(r => r.json())
  .then(boot)
  .catch(e => {
    $("#subtitle").textContent = `Could not load the data — ${e.message}. Reload the page if the site was just updated.`;
    console.error(e);
  });
