// Renders the last year of GitHub contributions as an isometric line-art illustration,
// in the style of the VELD landing wordmark: white extruded blocks with ink outlines,
// lime accents, standing on rounded floor tiles over a flat ASCII lattice.
//   GITHUB_TOKEN=... node iso_contrib.mjs --user mzaksana --out profile-iso [--readme README.md]
//   node iso_contrib.mjs --data days.json --out dir      (days.json: [{date, count}, ...])
// Files are named iso-contrib-<theme>-<content hash>.svg so every new render gets a new URL and
// GitHub's image cache can never serve a stale copy; --readme rewrites the references to match.
// Solids are extruded 2D shapes ("prisms") in blueprint units (y-down; 100 units = 1 height unit),
// projected isometrically and emitted back to front. Per prism:
//   side walls (two flat tones, one path each) -> side ink -> top face -> top ink.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) =>
  a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc, []));
const OUT = args.out || '.';

// ---------- data ----------
async function fetchDays(user, token) {
  const query = `query($login: String!) { user(login: $login) { contributionsCollection {
    contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: user } })
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${JSON.stringify(json.errors || json)}`);
  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap(w => w.contributionDays.map(d => ({ date: d.date, count: d.contributionCount })));
}

const days = args.data
  ? JSON.parse(readFileSync(args.data, 'utf8'))
  : await fetchDays(args.user || process.env.GITHUB_REPOSITORY_OWNER, process.env.GITHUB_TOKEN);

// ---------- themes ----------
const THEMES = {
  light: {
    ink: '#161616', white: '#ffffff', tile: '#f1f2f4', light: '#d3d6db', grey: '#8e939b',
    dark: '#4d5158', black: '#161616', lime: '#d4f20b', glyph: '#3a3a44', glyphHi: '#09090b', label: '#6b7079',
    left: 0.9, right: 0.74
  },
  dark: {
    ink: '#e9eaee', white: '#24262b', tile: '#16171a', light: '#3a3d44', grey: '#6b7079',
    dark: '#0e0f11', black: '#0b0b0e', lime: '#d4f20b', glyph: '#787886', glyphHi: '#f3f3f7', label: '#a3a8b2',
    left: 0.8, right: 0.62
  }
};

const CREASE = Math.cos(35 * Math.PI / 180); // sharper corners get a vertical ink line
const B = 0.08;                              // tile thickness
const PX = 100;                              // SVG units per height unit
const STROKE = 2.4;                          // ink width in SVG units

// Isometric projection: +x (weeks) up-right, +y (weekdays) down-right, +z up
const CX = Math.cos(Math.PI / 6), SY = 0.5;
const T = ([x, y], z) => [PX * CX * (x + y) / 100, PX * (SY * (y - x) / 100 - z)];

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v * k));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
const f = v => +v.toFixed(1);
const pt = p => `${f(p[0])} ${f(p[1])}`;

// Rewrites an absolute M/L/Z path as relative commands on a 0.1 grid (no drift): far smaller output
function rel(d) {
  let cx = 0, cy = 0, sx = 0, sy = 0, s = '';
  const num = v => { const t = (v / 10).toString(); return (v < 0 || !s || /[mlz]$/.test(s) ? '' : ' ') + t; };
  for (const [, cmd, body] of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (cmd === 'Z') { s += 'z'; cx = sx; cy = sy; continue; }
    const n = body.trim().split(/[ ,]+/).map(v => Math.round(+v * 10));
    for (let i = 0; i < n.length; i += 2) {
      const dx = n[i] - cx, dy = n[i + 1] - cy;
      if (cmd === 'M' && i === 0) { s += 'm'; sx = n[i]; sy = n[i + 1]; } else if (i === 0) s += 'l';
      s += num(dx);
      s += num(dy);
      cx = n[i]; cy = n[i + 1];
    }
  }
  return s;
}

// ---------- 2D shapes (blueprint units) ----------
function rounded(pts, r, seg = 6) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const l0 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const d = Math.min(r, l0 / 2, l2 / 2);
    const a = [p1[0] + (p0[0] - p1[0]) / l0 * d, p1[1] + (p0[1] - p1[1]) / l0 * d];
    const b = [p1[0] + (p2[0] - p1[0]) / l2 * d, p1[1] + (p2[1] - p1[1]) / l2 * d];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]);
    }
  }
  return out;
}
const rrect = (x1, y1, x2, y2, r, seg) => rounded([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], r, seg);
const circle = (x, y, r, n = 48) =>
  Array.from({ length: n }, (_, i) => [x + r * Math.cos(2 * Math.PI * i / n), y + r * Math.sin(2 * Math.PI * i / n)]);
// Consecutive duplicates (roundings meeting mid-edge) would read as sharp creases
const dedupe = pts => pts.filter((p, i) => {
  const q = pts[(i + pts.length - 1) % pts.length];
  return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
});
const area = pts => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0);

// Edges of a loop with the wall normal pointing away from the material
function edgesOf(pts, isOuter) {
  const s = (isOuter ? 1 : -1) * (area(pts) > 0 ? 1 : -1);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const d = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const n = [s * d[1], -s * d[0]];
    return { p, q, d, front: -n[0] + n[1] > 1e-6, left: -n[0] > n[1] };
  });
}
const crease = (a, b) => a.d[0] * b.d[0] + a.d[1] * b.d[1] < CREASE;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = date => MONTHS[+date.slice(5, 7) - 1];
const fmt = n => n.toLocaleString('en-US');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Animation timeline (seconds). Everything uses begin=0 + keyTimes, and the static attributes
// hold the final state, so renderers without SMIL still show the finished picture.
const BUILD = 3.2;                               // drop-in / grow / count-up window
const kt = (...t) => t.map(v => f(Math.min(1, Math.max(0, v)) * 1000) / 1000).join(';');

function render(theme, name) {
  const P = THEMES[theme];
  const out = [];
  let clipId = 0;
  const loopD = (loops, z) => loops.map(pts => 'M' + pts.map(p => pt(T(p, z))).join('L') + 'Z').join('');
  const fillPath = (d, color, rule) => out.push(`<path d="${rel(d)}" fill="${color}"${rule ? ` fill-rule="${rule}"` : ''}/>`);
  const inkPath = (d, cls = 'k') => d && out.push(`<path class="${cls}" d="${rel(d)}"/>`);
  function clipped(loop, z, body) {
    const id = `${name}-c${clipId++}`;
    out.push(`<clipPath id="${id}"><path d="${rel(loopD([loop], z))}"/></clipPath><g clip-path="url(#${id})">`);
    body();
    out.push('</g>');
  }
  // Floor-plane group at height z: children use blueprint coordinates directly
  const M = `${f(CX * 1000) / 1000} ${-SY} ${f(CX * 1000) / 1000} ${SY}`;
  const plane = (z, inner) => `<g transform="matrix(${M} 0 ${f(-z * PX)})">${inner}</g>`;

  // Visible walls of a loop: right tone under everything, left-facing walls on top (one path each)
  const quads = (list, z0, z1) => list.map(e => `M${pt(T(e.p, z0))}L${pt(T(e.q, z0))}L${pt(T(e.q, z1))}L${pt(T(e.p, z1))}Z`).join('');
  function walls(edges, z0, z1, color) {
    const front = edges.filter(e => e.front);
    if (!front.length) return;
    fillPath(quads(front, z0, z1), shade(color, P.right));
    const left = front.filter(e => e.left);
    if (left.length) fillPath(quads(left, z0, z1), shade(color, P.left));
  }

  // Side ink: continuous bottom polyline per visible run + verticals at silhouettes/creases
  function sideInk(edges, z0, z1, cls) {
    const n = edges.length, start = Math.max(edges.findIndex(e => !e.front), 0);
    let d = '', open = false;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n, e = edges[i], prev = edges[(i + n - 1) % n];
      if (prev.front !== e.front || (e.front && crease(prev, e))) {
        d += `M${pt(T(e.p, z0))}L${pt(T(e.p, z1))}`;
        open = false;
      }
      if (!e.front) { open = false; continue; }
      if (!open) { d += `M${pt(T(e.p, z0))}`; open = true; }
      d += `L${pt(T(e.q, z0))}`;
    }
    inkPath(d, cls);
  }

  // ink: 'k' (full), 'kt' (thin, for small parts) or false (fill only)
  function prism(outer, z0, h, color, { holes = [], top = color, ink = 'k' } = {}) {
    outer = dedupe(outer);
    holes = holes.map(dedupe);
    const z1 = z0 + h, outerEdges = edgesOf(outer, true);
    walls(outerEdges, z0, z1, color);
    if (ink) sideInk(outerEdges, z0, z1, ink);
    fillPath(loopD([outer, ...holes], z1), top, 'evenodd');
    holes.forEach(hole => clipped(hole, z1, () => {
      const he = edgesOf(hole, false);
      walls(he, z0, z1, color);
      if (ink) sideInk(he, z0, z1, ink);
    }));
    if (ink) inkPath(loopD([outer, ...holes], z1), ink);
  }

  const flat = (pts, z, color) => fillPath(loopD([pts], z), color);

  // Contents seen through an opening at height z: clip, draw, re-ink the rim
  function inside(opening, z, body) {
    clipped(opening, z, body);
    inkPath(loopD([opening], z));
  }

  // Hemisphere: top = sphere silhouette (circle), bottom = front half of the base ellipse
  function dome(cx, cy, z0, r, color) {
    const [px, py] = T([cx, cy], z0);
    const R = T([cx + r * Math.SQRT1_2, cy + r * Math.SQRT1_2], z0)[0] - px;
    const pts = [];
    for (let i = 0; i <= 32; i++) pts.push([px + R * Math.cos(Math.PI * i / 32), py - R * Math.sin(Math.PI * i / 32)]);
    for (let i = 0; i <= 32; i++) {
      const th = 5 * Math.PI / 4 - Math.PI * i / 32;
      pts.push(T([cx + r * Math.cos(th), cy + r * Math.sin(th)], z0));
    }
    const d = 'M' + pts.map(pt).join('L') + 'Z';
    fillPath(d, color);
    inkPath(d);
  }

  // Text printed flat on a surface at height z (reads along +x, lines stack along +y)
  const print = (x, y, z, str, size, color, extra = '') =>
    plane(z, `<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="${color}"${extra}>${esc(str)}</text>`);

  // Number that counts up to its final value (discrete frames; the last frame is the static one)
  function countUp(x, y, z, value, size, color, start, extra = '') {
    const steps = 14, frames = [];
    for (let i = 1; i <= steps; i++) {
      const e = 1 - Math.pow(1 - i / steps, 3), t0 = (start + 1.2 * (i - 1) / steps) / BUILD;
      const t1 = (start + 1.2 * i / steps) / BUILD, last = i === steps;
      const anim = last
        ? `<animate attributeName="opacity" values="0;1" keyTimes="${kt(0, t0)}" calcMode="discrete" dur="${BUILD}s" fill="freeze"/>`
        : `<animate attributeName="opacity" values="0;1;0" keyTimes="${kt(0, t0, t1)}" calcMode="discrete" dur="${BUILD}s" fill="freeze"/>`;
      frames.push(`<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="${color}"${extra}${last ? '' : ' opacity="0"'}>${fmt(Math.round(value * e))}${anim}</text>`);
    }
    return plane(z, frames.join(''));
  }
  const fadeIn = (start, len = 0.5) =>
    `<animate attributeName="opacity" values="0;0;1;1" keyTimes="${kt(0, start / BUILD, (start + len) / BUILD, 1)}" dur="${BUILD}s" fill="freeze"/>`;

  // ---------- layout ----------
  // Weeks run along +x, weekdays along +y. The year is split into four quarter plates
  // (like the four VELD letter tiles); a nameplate with the year's total sits in front.
  const CELL = 40, BLOCK = 30, GAP = 28, PAD = 20;
  const first = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  const cells = days.map((d, i) => ({ ...d, week: Math.floor((i + first) / 7), wd: (i + first) % 7 }));
  const weeks = cells[cells.length - 1].week + 1;
  const quarter = w => Math.min(3, Math.floor(w * 4 / weeks));
  const qStart = [0, 1, 2, 3].map(q => cells.find(c => quarter(c.week) === q).week);
  const cellX = w => PAD + w * CELL + quarter(w) * (GAP + 2 * PAD);
  const DEPTH = 6 * CELL + BLOCK + 2 * PAD;    // weekday rows
  const STRIP = 120;                           // console strip along each plate's front edge
  const NAME = [-330, -GAP];                   // nameplate x range

  const counts = cells.map(c => c.count).filter(Boolean).sort((a, b) => a - b);
  const max = counts[counts.length - 1] || 1;
  const hot = counts[Math.floor(counts.length * 0.92)] ?? Infinity; // top ~8% days get a lime cap
  const height = c => 0.05 + 1.15 * Math.log1p(c) / Math.log1p(max);
  const busiest = cells.reduce((a, b) => (b.count > a.count ? b : a));
  const total = cells.reduce((s, c) => s + c.count, 0);
  const weekTotals = Array.from({ length: weeks }, (_, w) =>
    cells.filter(c => c.week === w).reduce((s, c) => s + c.count, 0));
  const weekMax = Math.max(1, ...weekTotals);
  const dropStart = w => 0.15 + 1.9 * w / weeks;  // blocks land front-left to back-right

  // ---------- ASCII floor: glyphs laid flat on the iso floor; three wave frames crossfade ----------
  const x0f = NAME[0] - 200, x1f = cellX(weeks - 1) + CELL + 240, y0f = -220, y1f = DEPTH + STRIP + 260, step = 22;
  const glyphs = '·:;+*?%$&#@';
  const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
  const FRAMES = 3, WAVE = 4.5;
  const floorFrames = Array.from({ length: FRAMES }, (_, fr) => {
    const t = 2 * Math.PI * fr / FRAMES, rows = { lo: [], hi: [] };
    for (let by = y0f; by <= y1f; by += step) {
      const lo = [], hi = [];
      for (let bx = x0f; bx <= x1f; bx += step) {
        const u = (bx - x0f) / (x1f - x0f), v = (by - y0f) / (y1f - y0f);
        const phase = u * 11.2 - t + Math.sin(u * 5.4) * 0.72;
        const crest = Math.max(
          Math.max(0, 1 - Math.abs(v - (0.5 + Math.sin(phase) * 0.3)) / 0.22),
          Math.max(0, 1 - Math.abs(v - (0.5 + Math.sin(phase + 1.42) * 0.22)) / 0.17) * 0.76);
        const texture = hash(bx * 0.037, by * 0.053);
        const value = Math.max(0, crest * (0.42 + texture * 0.58) - 0.16);
        const ch = glyphs[Math.min(glyphs.length - 1, Math.floor(value * (glyphs.length - 1)))];
        (texture > 0.6 && value > 0.25 ? hi : lo).push([bx, ch]);
      }
      if (lo.length) rows.lo.push([by, lo]);
      if (hi.length) rows.hi.push([by, hi]);
    }
    const textRows = list => list.map(([by, gs]) =>
      `<text y="${by}" x="${gs.map(g => g[0]).join(' ')}">${esc(gs.map(g => g[1]).join(''))}</text>`).join('');
    // Frame fr is fully visible at fr/FRAMES of the cycle and crossfades into the next one
    const vals = Array.from({ length: FRAMES + 1 }, (_, i) => (i % FRAMES === fr ? 1 : 0)).join(';');
    const keys = Array.from({ length: FRAMES + 1 }, (_, i) => f(i / FRAMES * 1000) / 1000).join(';');
    return `<g${fr ? ' opacity="0"' : ''}><animate attributeName="opacity" values="${vals}" keyTimes="${keys}" dur="${WAVE}s" repeatCount="indefinite"/>` +
      `<g fill="${P.glyph}" opacity="0.7">${textRows(rows.lo)}</g><g fill="${P.glyphHi}" opacity="0.85">${textRows(rows.hi)}</g></g>`;
  });

  // ---------- console on each plate's front strip ----------
  // A raised unit with a recessed lime screen whose bars are that quarter's weekly totals,
  // one gadget per plate (fan, tube, buttons, adapter), and the quarter's label and total.
  function consoleUnit(q, w0, w1) {
    const x1 = cellX(w0), y1 = DEPTH + 8, y2 = DEPTH + STRIP - 14;
    const n = w1 - w0 + 1, bw = 9, gap = 5, sx2 = x1 + 26 + n * (bw + gap);
    const screen = rrect(x1 + 14, y1 + 12, sx2, y2 - 12, 8);
    const ux2 = cellX(w1) + BLOCK;
    const unitTop = B + 0.14, screenZ = unitTop - 0.1;
    prism(rrect(x1, y1, ux2, y2, 12), B, 0.14, P.white, { holes: [screen] });
    inside(screen, unitTop, () => {
      flat(screen, screenZ, P.lime);
      // Bars: flat on the screen, grow in once (staggered), then bob like an equalizer
      const base = y2 - 22, bars = [];
      for (let w = w0; w <= w1; w++) {
        const bx = x1 + 22 + (w - w0) * (bw + gap), hg = 8 + (y2 - y1 - 50) * weekTotals[w] / weekMax;
        const s = 0.6 + 0.04 * (w - w0) + 0.25 * q, lo = hg * (0.55 + 0.3 * hash(w, 1)), d = f(0.9 + hash(w, 2) * 0.9);
        bars.push(`<rect x="${bx}" y="${f(base - hg)}" width="${bw}" height="${f(hg)}" rx="4.5" fill="${P.black}">` +
          `<animate attributeName="height" values="0;0;${f(hg)};${f(hg)}" keyTimes="${kt(0, s / BUILD, (s + 0.5) / BUILD, 1)}" dur="${BUILD}s"/>` +
          `<animate attributeName="y" values="${base};${base};${f(base - hg)};${f(base - hg)}" keyTimes="${kt(0, s / BUILD, (s + 0.5) / BUILD, 1)}" dur="${BUILD}s"/>` +
          `<animate attributeName="height" values="${f(hg)};${f(lo)};${f(hg)}" begin="${BUILD}s" dur="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="y" values="${f(base - hg)};${f(base - lo)};${f(base - hg)}" begin="${BUILD}s" dur="${d}s" repeatCount="indefinite"/></rect>`);
      }
      out.push(plane(screenZ, bars.join('')));
    });

    const gx = sx2 + 20, gy = y1 + 8, gcx = gx + 40, gcy = (y1 + y2) / 2;
    if (q === 0) { // fan box: blades spin flat inside the opening, no ink on the small parts
      const hole = circle(gcx, gcy, 20, 32);
      prism(rrect(gx + 8, gy, gx + 72, y2 - 8, 8), unitTop, 0.16, P.dark, { holes: [hole] });
      inside(hole, unitTop + 0.16, () => {
        flat(hole, unitTop + 0.02, P.black);
        const blades = Array.from({ length: 6 }, (_, i) =>
          `<path d="M${gcx} ${gcy - 3}l17 -4q2 4 0 8l-17 3z" fill="${P.grey}" transform="rotate(${i * 60} ${gcx} ${gcy})"/>`).join('');
        out.push(plane(unitTop + 0.07, `<g>${blades}<animateTransform attributeName="transform" type="rotate" from="0 ${gcx} ${gcy}" to="360 ${gcx} ${gcy}" dur="1.4s" repeatCount="indefinite"/></g>` +
          `<circle cx="${gcx}" cy="${gcy}" r="6" fill="${shade(P.grey, 0.8)}"/>`));
      });
    } else if (q === 1) { // lime tube with grooves that scroll up the wall
      const outer = circle(gcx, gcy, 17, 48), z0 = unitTop, th = 0.26;
      prism(outer, z0, th, P.lime, { holes: [circle(gcx, gcy, 10, 32)] });
      const wall = quads(edgesOf(dedupe(outer), true).filter(e => e.front), z0, z0 + th);
      const id = `${name}-c${clipId++}`, sp = 0.06;
      const arc = z => 'M' + Array.from({ length: 25 }, (_, i) => {
        const a = Math.PI / 4 + Math.PI * i / 24;
        return pt(T([gcx + 17 * Math.cos(a), gcy + 17 * Math.sin(a)], z));
      }).join('L');
      const grooves = Array.from({ length: Math.ceil(th / sp) + 2 }, (_, i) => arc(z0 + (i - 1) * sp)).join('');
      out.push(`<clipPath id="${id}"><path d="${rel(wall)}"/></clipPath><g clip-path="url(#${id})">` +
        `<g><path d="${rel(grooves)}" fill="none" stroke="${shade(P.lime, 0.72)}" stroke-width="2"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-sp * PX}" dur="0.8s" repeatCount="indefinite"/></g></g>`);
    } else if (q === 2) { // three-button panel, thin ink on the keys
      prism(rrect(gx, gcy - 14, gx + 96, gcy + 14, 7), unitTop, 0.03, P.white);
      for (let i = 0; i < 3; i++) prism(rrect(gx + 8 + i * 29, gcy - 8, gx + 30 + i * 29, gcy + 8, 5, 3), unitTop + 0.03, 0.025, P.light, { ink: 'kt' });
    } else { // adapter block with the live (blinking) light
      prism(rrect(gx, gy, gx + 52, y2 - 8, 9), unitTop, 0.18, P.white);
      out.push('<g>');
      prism(rrect(gx + 16, gcy - 4, gx + 36, gcy + 4, 4, 3), unitTop + 0.18, 0.02, P.lime, { ink: false });
      out.push('<animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite"/></g>');
    }

    // Label: quarter + months, and the quarter's total counting up
    const qc = cells.filter(c => quarter(c.week) === q);
    const qTotal = qc.reduce((s, c) => s + c.count, 0);
    const lx = gx + (q === 3 ? 92 : 112), start = 1.2 + 0.3 * q;
    out.push(`<g opacity="1">${fadeIn(start)}${print(lx, y1 + 36, unitTop, `Q${q + 1} · ${month(qc[0].date)}–${month(qc[qc.length - 1].date)}`, 17, P.label, ' letter-spacing="1"')}</g>`);
    out.push(countUp(lx, y1 + 76, unitTop, qTotal, 34, P.ink, start, ' font-weight="700"'));
  }

  // ---------- nameplate: the year's total ----------
  function nameplate() {
    const [nx0, nx1] = NAME, y1 = 20, y2 = DEPTH + STRIP - 20;
    prism(rrect(nx0, 0, nx1, DEPTH + STRIP, 22), 0, B, P.tile);
    const top = B + 0.16;
    prism(rrect(nx0 + 20, y1, nx1 - 20, y2, 14), B, 0.16, P.white);
    // lime light + dot grille along the back edge
    prism(rrect(nx0 + 40, y1 + 22, nx0 + 64, y1 + 32, 5, 3), top, 0.02, P.lime, { ink: false });
    for (let i = 0; i < 8; i++) flat(circle(nx1 - 50 - i * 16, y1 + 27, 3.2, 12), top, P.black);
    out.push(countUp(nx0 + 40, y1 + 190, top, total, 64, P.ink, 0.3, ' font-weight="700" letter-spacing="-2"'));
    out.push(`<g>${fadeIn(0.6)}${print(nx0 + 42, y1 + 232, top, 'contributions', 26, P.ink)}` +
      `${print(nx0 + 42, y1 + 292, top, `${month(days[0].date)} ${days[0].date.slice(0, 4)} — ${month(days[days.length - 1].date)} ${days[days.length - 1].date.slice(0, 4)}`, 15, P.label, ' letter-spacing="1"')}</g>`);
    // lime screen strip at the front with the busiest day
    const screen = rrect(nx0 + 40, y2 - 74, nx1 - 40, y2 - 24, 8);
    out.push('<g>');
    prism(rrect(nx0 + 30, y2 - 84, nx1 - 30, y2 - 14, 10), top, 0.03, P.light, { ink: 'kt' });
    flat(screen, top + 0.03, P.lime);
    out.push(print(nx0 + 54, y2 - 43, top + 0.03, `PEAK ${fmt(busiest.count)} · ${month(busiest.date)} ${+busiest.date.slice(8, 10)}`, 15, P.black, ' font-weight="700" letter-spacing="1"'));
    out.push('</g>');
  }

  // ---------- scene: back (high x, low y) to front ----------
  for (let q = 3; q >= 0; q--) {
    const w0 = qStart[q], w1 = q < 3 ? qStart[q + 1] - 1 : weeks - 1;
    prism(rrect(cellX(w0) - PAD, 0, cellX(w1) + BLOCK + PAD, DEPTH + STRIP, 22), 0, B, P.tile);
    cells.filter(c => quarter(c.week) === q)
      .sort((a, b) => (a.wd - a.week * 1.001) - (b.wd - b.week * 1.001))
      .forEach(c => {
        const x = cellX(c.week), y = PAD + c.wd * CELL;
        const cx = x + BLOCK / 2, cy = y + BLOCK / 2;
        if (!c.count) { // empty day: a socket in the plate
          flat(circle(cx, cy, 4.5, 12), B, P.black);
          return;
        }
        const h = height(c.count), top = B + h, s = dropStart(c.week) + c.wd * 0.02;
        // Block drops onto its plate and fades in
        const k = kt(0, s / BUILD, (s + 0.45) / BUILD, 1);
        out.push(`<g><animate attributeName="opacity" values="0;0;1;1" keyTimes="${k}" dur="${BUILD}s"/>` +
          `<animateTransform attributeName="transform" type="translate" values="0 -60;0 -60;0 0;0 0" keyTimes="${k}" calcMode="spline" keySplines="0 0 1 1;0.3 0.6 0.4 1;0 0 1 1" dur="${BUILD}s"/>`);
        if (c === busiest) { // busiest day: lime dome in a well on top
          const well = circle(cx, cy, 11, 32);
          prism(rrect(x - 3, y - 3, x + BLOCK + 3, y + BLOCK + 3, 8), B, h, P.white, { holes: [well] });
          inside(well, top, () => { flat(well, top - 0.05, P.black); dome(cx, cy, top - 0.05, 9.5, P.lime); });
        } else {
          prism(rrect(x, y, x + BLOCK, y + BLOCK, 7, 3), B, h, P.white, { top: c.count >= hot ? P.lime : P.white });
        }
        out.push('</g>');
      });
    consoleUnit(q, w0, w1);
  }
  nameplate();

  // ---------- document: crop to the plates plus a margin of floor ----------
  const ys = [];
  cells.forEach(c => { if (c.count) ys.push(T([cellX(c.week), PAD + c.wd * CELL], B + height(c.count))[1]); });
  const xr = [NAME[0], cellX(weeks - 1) + BLOCK + PAD], yr = [0, DEPTH + STRIP];
  const px = xr.flatMap(x => yr.map(y => T([x, y], 0))), m = 50;
  const vx0 = Math.min(...px.map(p => p[0])) - m, vx1 = Math.max(...px.map(p => p[0])) + m;
  const vy0 = Math.min(...ys, ...px.map(p => p[1])) - m - 40;
  const vy1 = Math.max(...px.map(p => p[1])) + m;
  const w = vx1 - vx0, h = vy1 - vy0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx0)} ${f(vy0)} ${f(w)} ${f(h)}" width="${Math.round(w)}" height="${Math.round(h)}" role="img" aria-label="${fmt(total)} GitHub contributions in the last year, as an isometric illustration">
<style>.k{fill:none;stroke:${P.ink};stroke-width:${STROKE}}.kt{fill:none;stroke:${P.ink};stroke-width:${STROKE / 2};stroke-opacity:.7}text{font-family:${FONT}}</style>
<defs><radialGradient id="${name}-fade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="${name}-mask"><rect x="${f(vx0)}" y="${f(vy0)}" width="${f(w)}" height="${f(h)}" fill="url(#${name}-fade)"/></mask></defs>
<g mask="url(#${name}-mask)" font-size="16">${plane(0, floorFrames.join(''))}</g>
<g stroke-linejoin="round" stroke-linecap="round">
${out.join('\n')}
</g>
</svg>`;
}

const NAME = /iso-contrib-(light|dark)(-[0-9a-f]{8})?\.svg(\?v=[0-9a-f]+)?/g;
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (/^iso-contrib-.*\.svg$/.test(file)) unlinkSync(join(OUT, file));
const names = {};
for (const theme of Object.keys(THEMES)) {
  const svg = render(theme, `iso-${theme}`);
  names[theme] = `iso-contrib-${theme}-${createHash('sha256').update(svg).digest('hex').slice(0, 8)}.svg`;
  writeFileSync(join(OUT, names[theme]), svg);
  console.log(`wrote ${join(OUT, names[theme])}`);
}
if (args.readme) {
  writeFileSync(args.readme, readFileSync(args.readme, 'utf8').replace(NAME, (_, theme) => names[theme]));
  console.log(`updated ${args.readme}`);
}
