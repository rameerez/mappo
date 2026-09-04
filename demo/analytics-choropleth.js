// The choropleth, once: the data, the ramp and the per-country fills that
// demo/analytics.html draws and the landing page's card draws again. They used
// to be two copies, with two datasets and two ramps, and they drifted until the
// card looked nothing like the page. Everything either of them needs to shade
// a country is here; the page keeps its controls, its table and its globe, the
// card keeps its frame.

import { region } from "./countries.js";

// ── the data ──────────────────────────────────────────────────────────────
// ISO 3166-1 alpha-2 → users, the shape a dashboard's query hands its map. A
// plausible month for a developer tool: a third in the United States, then the
// English-speaking and Western European markets, a long tail across the rest
// of the world, and the city-states a real feed always contains and a world
// map usually swallows. Synthetic, like every number on the page.
export const USERS = {
  US: 638, GB: 121, DE: 104, CA: 96, IN: 84, FR: 63, AU: 61, NL: 47, BR: 44, ES: 39,
  JP: 33, SE: 29, PL: 27, IT: 25, CH: 22, KR: 21, MX: 19, SG: 18, IL: 17, DK: 15,
  NO: 14, IE: 14, BE: 13, AT: 12, FI: 11, PT: 11, CZ: 10, NZ: 10, UA: 9, RO: 9, TR: 9,
  AR: 8, ZA: 8, HK: 8, ID: 8, PH: 7, TW: 7, RU: 7, VN: 6, CL: 6, CO: 6, HU: 6,
  GR: 5, TH: 5, MY: 5, NG: 5, PK: 5, AE: 5,
  EG: 4, BG: 4, HR: 4, SK: 4, LT: 4, RS: 4, CN: 4, SA: 4, KE: 4,
  PE: 3, BD: 3, MA: 3, EE: 3, LV: 3, SI: 3, LU: 3,
  CY: 2, IS: 2, GE: 2, AM: 2, KZ: 2, LK: 2, NP: 2, TN: 2, GH: 2, UY: 2, EC: 2, CR: 2, DO: 2, GT: 2, PA: 2, MT: 2,
  BY: 1, MD: 1, AZ: 1, UZ: 1, MN: 1, KH: 1, MM: 1, ET: 1, TZ: 1, UG: 1, RW: 1, ZW: 1, ZM: 1, MZ: 1, AO: 1,
  CM: 1, CI: 1, SN: 1, DZ: 1, JO: 1, LB: 1, QA: 1, KW: 1, BH: 1, OM: 1, BO: 1, PY: 1, VE: 1, HN: 1, SV: 1,
  NI: 1, JM: 1, TT: 1, CU: 1, BS: 1, FJ: 1, PG: 1, MU: 1, MV: 1, BN: 1, MO: 1, LI: 1, AL: 1, MK: 1, BA: 1,
  ME: 1, XK: 1, IQ: 1, LA: 1, MG: 1, NA: 1, BW: 1, SR: 1, GY: 1, BZ: 1
};

// Ranked, with the totals both views quote.
export const ranked = Object.entries(USERS).filter(([ , n ]) => n > 0).sort((a, b) => b[1] - a[1]);
export const total = ranked.reduce((n, [ , v ]) => n + v, 0);
export const pct = (n) => Math.round((n / total) * 100);

// ── the ramp ──────────────────────────────────────────────────────────────
// Linear from the smallest count to the largest, the convention choropleth
// libraries default to: with a long tail of ones, a one is exactly the low end
// of the ramp, one step above the no-data tone. Mixed in CSS from the tokens
// --ramp-lo and --ramp-hi, so a theme change repaints the fills for free.
const values = ranked.map(([ , n ]) => n);
const lo = Math.min(...values), hi = Math.max(...values);
export const t = (n) => (hi === lo ? 1 : (n - lo) / (hi - lo));
export const shade = (n) => `color-mix(in srgb, var(--ramp-hi) ${(t(n) * 100).toFixed(2)}%, var(--ramp-lo))`;

// The flat frame both views draw the default map in: Natural Earth's coast
// and borders through mappo, in this latitude band, at this resolution.
export const FLAT = { band: [ -56, 84 ], cols: 240 };
export const landAttrs = (band = FLAT.band, cols = FLAT.cols) => ({
  mode: "flat", cols, "lat-min": band[0], "lat-max": band[1],
  figure: "solid", "figure-source": "vector", "figure-color": "var(--nodata)",
  "ground-color": "none", background: "none", interactive: "false", overlays: "false"
});
export const seamsAttrs = (band = FLAT.band, cols = FLAT.cols) => ({
  mode: "flat", cols, "lat-min": band[0], "lat-max": band[1],
  figure: "solid", "figure-color": "transparent", "figure-source": "vector",
  borders: "", "borders-color": "var(--seam)", "borders-width": "2", "borders-opacity": "1",
  "ground-color": "none", background: "none", interactive: "false", overlays: "false"
});

// ── the fills ─────────────────────────────────────────────────────────────
// One SVG path per country, projected through the same projection instance
// mappo draws with, into a 1000 × 1000 unit box stretched over the same
// element, so a fill can only ever land where the land is. A vertex past the
// latitude band is clamped to its edge: the ring stays closed, and the part
// of Chile below the frame becomes a run along the frame's edge that draws
// nothing. Returns the paths it made, keyed by country, for whoever wants to
// light one up. `regions` is the list from ./countries.js; `onPath` sees each
// element as it is appended.
export function fillCountries(svg, regions, proj, band, { onPath } = {}) {
  const [ latMin, latMax ] = band;
  const inBand = (lat) => lat >= latMin && lat <= latMax;
  const at = (lat, lon) => {
    const p = proj.forward(Math.max(latMin, Math.min(latMax, lat)), lon);
    return p ? `${(p.x * 1000).toFixed(1)} ${(p.y * 1000).toFixed(1)}` : null;
  };
  const made = new Map();
  for (const r of regions) {
    if (!r.rings.some((ring) => ring.some(([ lat ]) => inBand(lat)))) continue;   // Antarctica, on most maps
    const d = r.rings.map((ring) => {
      const pts = ring.map(([ lat, lon ]) => at(lat, lon)).filter(Boolean);
      return pts.length > 2 ? `M${pts.join("L")}Z` : "";
    }).join("");
    if (!d) continue;
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    // evenodd rather than nonzero: Natural Earth promises no winding
    // direction, and evenodd punches holes without anyone trusting the order.
    el.setAttribute("fill-rule", "evenodd");
    el.dataset.id = r.id;
    const n = USERS[r.id];
    if (n > 0) { el.style.setProperty("--c", shade(n)); el.classList.add("has"); }
    svg.append(el);
    made.set(r.id, el);
    onPath?.(r.id, el);
  }
  return made;
}

// Countries with users and no shape at this scale: a dot on the anchor,
// positioned in percent of the frame. Returns the marks, keyed by country.
export function markUnshaped(container, proj, band, { onMark } = {}) {
  const [ latMin, latMax ] = band;
  const made = new Map();
  for (const [ id, n ] of ranked) {
    const r = region(id);
    if (!r || r.rings.length || r.anchor[0] < latMin || r.anchor[0] > latMax) continue;
    const p = proj.forward(r.anchor[0], r.anchor[1]);
    if (!p) continue;
    const el = document.createElement("span");
    el.className = "mark";
    el.dataset.id = id;
    el.style.left = `${(p.x * 100).toFixed(3)}%`;
    el.style.top = `${(p.y * 100).toFixed(3)}%`;
    el.style.setProperty("--c", shade(n));
    container.append(el);
    made.set(id, el);
    onMark?.(id, el);
  }
  return made;
}

// The styles the fills and marks need, as one string, so a page that frames
// the map can adopt them without copying the page's stylesheet.
export const FILL_CSS = `
.fills,.seams,.marks{position:absolute;inset:0}
.fills{width:100%;height:100%;overflow:hidden}
.seams,.marks{pointer-events:none}
.fills path{fill:transparent}
.fills path.has{fill:var(--c)}
.mark{position:absolute;width:1.1cqw;height:1.1cqw;margin:-.55cqw 0 0 -.55cqw;border-radius:50%;background:var(--c);
  box-shadow:0 0 0 1.5px var(--seam)}`;
