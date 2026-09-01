// <mappo-world> — the zero-JS way in. Every renderer option that makes
// sense as markup is an attribute; change an attribute, the map re-renders.
//
//   <mappo-world cities="London, Lagos, Singapore" tilt="40"
//                 dot-shape="circle" marker-color="#2262fe"></mappo-world>
//
// Callbacks aren't attributes (functions don't serialize) — listen for the
// bubbling CustomEvents instead: mappo:cityclick, :cityenter,
// :dotclick, :dotenter. For full control, use the Mappo class.

import { Mappo, DEFAULTS } from "./renderer.js";

const ATTR_MAP = {
  // attribute      → [option, parser]
  "mode":             ["mode", String],
  "body":             ["body", String],
  "globe-ring":       ["globeRing", (v) => v !== "false"],
  "land":             ["land", String],
  "land-color":       ["landColor", String],
  "land-stroke":      ["landStroke", String],
  "land-stroke-width":["landStrokeWidth", Number],
  "land-source":      ["landSource", String],
  "borders":          ["borders", (v) => v !== "false"],
  "borders-color":    ["bordersColor", String],
  "borders-width":    ["bordersWidth", Number],
  "borders-opacity":  ["bordersOpacity", Number],
  "roll":             ["roll", Number],
  "graticule":        ["graticule", (v) => v !== "false"],
  "meridians":        ["meridians", Number],
  "parallels":        ["parallels", Number],
  "graticule-color":  ["graticuleColor", String],
  "equator-color":    ["equatorColor", String],
  "graticule-opacity":["graticuleOpacity", Number],
  "equator-opacity":  ["equatorOpacity", Number],
  "overlays":         ["overlays", (v) => v !== "false"],
  "max-dpr":          ["maxDpr", Number],
  "background":       ["background", String],
  "ocean-color":      ["oceanColor", String],
  "rotate-speed":     ["rotateSpeed", Number],
  "cols":             ["cols", Number],
  "lat-min":          ["latMin", Number],   // folded into latRange below
  "lat-max":          ["latMax", Number],
  "dot-shape":        ["dotShape", String],
  "dot-size":         ["dotSize", Number],
  "dot-color":        ["dotColor", String],
  "dot-hover-color":  ["dotHoverColor", String],
  "dot-hover-scale":  ["dotHoverScale", Number],
  "cities":           ["cities", (v) => v.split(",").map((s) => s.trim()).filter(Boolean)],
  // Coordinate markers, no gazetteer: "48.2,16.4;Vienna@48.2,16.4" —
  // semicolon-separated, optional Name@ prefix. Feeds the same pipeline
  // as cities (resolveCity already passes {lat, lon, name} through).
  "markers":          ["markers", (v) => v.split(";").map((tok) => {
                        const m = tok.trim().match(/^(?:(.*)@)?(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                        return m ? { name: m[1] || "", lat: Number(m[2]), lon: Number(m[3]) } : null;
                      }).filter(Boolean)],
  // "lat,lon" the globe starts FACING (and the flat map centers its
  // marker composition around visually) — rotate-speed 0 holds it there.
  "focus":            ["focus", (v) => {
                        const m = v.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                        return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
                      }],
  // Region highlight (globe mode): JSON rings of [lat, lon] pairs —
  // either one ring or an array of rings. The CONSUMER supplies the
  // shape (Natural Earth etc.); mappo ships no boundary data.
  "highlight-polygon": ["highlightPolygon", (v) => {
                        try {
                          const parsed = JSON.parse(v);
                          if (!Array.isArray(parsed) || !parsed.length) return null;
                          return Array.isArray(parsed[0][0]) ? parsed : [ parsed ];
                        } catch { return null; }
                      }],
  "highlight-color":  ["highlightColor", String],
  "marker-shape":     ["markerShape", String],
  "marker-color":     ["markerColor", String],
  "marker-scale":     ["markerScale", Number],
  "marker-pulse":     ["markerPulse", (v) => v !== "false"],
  "tilt":             ["tilt", Number],
  "rotate":           ["rotate", Number],
  "perspective":      ["perspective", Number],
  "animation":          ["animation", String],
  "animation-period": ["animationPeriod", Number],
  "animation-height": ["animationHeight", Number],
  "animation-width": ["animationWidth", Number],
  "cursor":           ["cursor", String],
  "marker-cursor":    ["markerCursor", String],
  "interactive":      ["interactive", (v) => v !== "false"]
};

// Conditional class expression, not a declaration: `extends HTMLElement`
// evaluates at definition time, and this module must stay importable where
// no DOM exists (Node tests, SSR pipelines). There, the element export is
// null and register() no-ops — the data/geometry APIs still work.
export const MappoElement = typeof HTMLElement === "undefined" ? null :
class MappoElement extends HTMLElement {
  static observedAttributes = Object.keys(ATTR_MAP);
  // Set by the subclasses defineBodyElement() makes. The tag becomes a
  // DEFAULT, never an override: <mappo-moon body="mars"> is a strange thing
  // to write but it should mean Mars, because the attribute is the truth and
  // the tag is only a nicer way to say the usual case.
  static defaultBody = null;

  connectedCallback() {
    // Light DOM on purpose: consumers restyle .mappo-dot/.mappo-marker with plain
    // CSS — a shadow root would wall that off for zero benefit here.
    this.map = new Mappo(this, this.#optionsFromAttributes());
  }

  disconnectedCallback() {
    this.map?.destroy();
    this.map = null;
  }

  attributeChangedCallback() {
    // Fires before connect for initial attributes; only re-render when live.
    this.map?.update(this.#optionsFromAttributes());
  }

  #optionsFromAttributes() {
    const options = {};
    for (const [attr, [key, parse]] of Object.entries(ATTR_MAP)) {
      const raw = this.getAttribute(attr);
      // An ABSENT attribute must mean "the default", not "whatever it was set
      // to last time". update() merges, so without this branch removing an
      // attribute never un-sets its option — `graticule`, `borders`,
      // `globe-ring` and every other boolean would latch on forever once
      // switched on. (Found by clicking the demo page toggles, which is
      // exactly the bug a unit test on a fresh instance cannot see.)
      if (raw !== null) options[key] = parse(raw);
      else if (key in DEFAULTS) options[key] = DEFAULTS[key];
    }
    if (options.latMin !== undefined || options.latMax !== undefined) {
      options.latRange = [options.latMin ?? -58, options.latMax ?? 84];
      delete options.latMin;
      delete options.latMax;
    }
    // Not `=== undefined`: an absent attribute is reset to its DEFAULT here,
    // and the default body is null. The tag fills in for "nobody said".
    if (!options.body && this.constructor.defaultBody) {
      options.body = this.constructor.defaultBody;
    }
    return options;
  }
};

// A tag per body, for pages that only ever draw one. <mappo-moon> is easier
// to read than <mappo-world body="moon">, and easier to get wrong in exactly
// one way — so the tag sets the default and the attribute still wins.
//
//   registerBody(MOON);
//   defineBodyElement("mappo-moon", "moon");
//
// mappo-earth is the same idea for the body that ships in the box.
export function defineBodyElement(tag, bodyId) {
  if (!MappoElement || typeof customElements === "undefined" || customElements.get(tag)) return;
  hideOverlaysUntilDefined(tag);
  customElements.define(tag, class extends MappoElement { static defaultBody = bodyId; });
}

export function register(tag = "mappo-world") {
  if (!MappoElement || customElements.get(tag)) return;
  hideOverlaysUntilDefined(tag);
  // A subclass per tag, because a constructor can only be handed to the
  // registry once — registering mappo-earth with the same class threw and
  // took mappo-world down with it. Same component, different constructors.
  customElements.define(tag, class extends MappoElement {});
}

// Overlay children are ordinary markup, which means the browser lays them out
// the moment it parses them — before this module has loaded and long before
// the map knows where they belong. Without this they appear stacked in the
// corner of the element for a frame or two and then jump to their coordinates,
// which reads as broken. `:not(:defined)` holds them until the element upgrades;
// after that mappo owns their transform and the rule stops matching.
function hideOverlaysUntilDefined(tag) {
  if (typeof document === "undefined" || document.getElementById("mappo-upgrade-style")) return;
  const style = document.createElement("style");
  style.id = "mappo-upgrade-style";
  style.textContent = `${tag}:not(:defined) [data-lat][data-lon]{visibility:hidden}`;
  document.head?.prepend(style);
}
