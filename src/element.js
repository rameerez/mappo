// <mappo-world> — the zero-JS way in. Every renderer option that makes sense
// as markup is an attribute; change an attribute, the map re-renders.
//
//   <mappo-world places="London, Lagos, Singapore" tilt="40"
//                dot-shape="circle" marker-color="#2262fe"></mappo-world>
//
// Every registered body also gets its own tag — <mappo-earth>, <mappo-moon>,
// <mappo-mars> — which is the same element with that body as its default.
//
// Callbacks aren't attributes (functions don't serialize) — listen for the
// bubbling CustomEvents instead: mappo:placeclick, :placeenter, :dotclick,
// :dotenter. For full control, use the Mappo class.

import { Mappo, DEFAULTS } from "./renderer.js";
import { knownBodies, onBodyRegistered, registerBody } from "./body.js";

const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
const flag = (v) => v !== "false";

const ATTR_MAP = {
  // attribute        → [option, parser]
  "mode":               [ "mode", String ],
  "body":               [ "body", String ],
  "cols":               [ "cols", Number ],
  "lat-min":            [ "latMin", Number ],
  "lat-max":            [ "latMax", Number ],
  // The flat map's projection and central meridian; the globe ignores both.
  "projection":         [ "projection", (v) => v.trim().toLowerCase() ],
  "center-lon":         [ "centerLon", Number ],
  // The figure and the ground
  "figure":             [ "figure", String ],
  "figure-color":       [ "figureColor", String ],
  "figure-stroke":      [ "figureStroke", String ],
  "figure-stroke-width":[ "figureStrokeWidth", Number ],
  "figure-source":      [ "figureSource", String ],
  "ground-color":       [ "groundColor", String ],
  "background":         [ "background", String ],
  "borders":            [ "borders", flag ],
  "borders-color":      [ "bordersColor", String ],
  "borders-width":      [ "bordersWidth", Number ],
  "borders-opacity":    [ "bordersOpacity", Number ],
  // Dots
  "dot-shape":          [ "dotShape", String ],
  "dot-size":           [ "dotSize", Number ],
  "dot-hover-color":    [ "dotHoverColor", String ],
  "dot-hover-scale":    [ "dotHoverScale", Number ],
  // Places: gazetteer names, comma-separated. Coordinates without the
  // gazetteer go in `markers`: "48.2,16.4;Vienna@48.2,16.4" — semicolon-
  // separated because the coordinates need the comma, optional Name@ prefix.
  // Both land in the one `places` option and fire the same events.
  "places":             [ "places", list ],
  "markers":            [ "markers", (v) => v.split(";").map((tok) => {
                          const m = tok.trim().match(/^(?:(.*)@)?(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                          return m ? { name: m[1] || "", lat: Number(m[2]), lon: Number(m[3]) } : null;
                        }).filter(Boolean) ],
  "marker-shape":       [ "markerShape", String ],
  "marker-color":       [ "markerColor", String ],
  "marker-scale":       [ "markerScale", Number ],
  "marker-pulse":       [ "markerPulse", flag ],
  "marker-cursor":      [ "markerCursor", String ],
  // "lat,lon" the globe starts FACING (and keeps facing at rotate-speed 0).
  "focus":              [ "focus", (v) => {
                          const m = v.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
                          return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
                        } ],
  // Region highlight: JSON rings of [lat, lon] pairs — one ring or an array of
  // rings. The CONSUMER supplies the shape; mappo ships no boundary data for it.
  "highlight-polygon":  [ "highlightPolygon", (v) => {
                          try {
                            const parsed = JSON.parse(v);
                            if (!Array.isArray(parsed) || !parsed.length) return null;
                            return Array.isArray(parsed[0][0]) ? parsed : [ parsed ];
                          } catch { return null; }
                        } ],
  "highlight-color":    [ "highlightColor", String ],
  // The globe
  "rotate-speed":       [ "rotateSpeed", Number ],
  "roll":               [ "roll", Number ],
  "globe-ring":         [ "globeRing", flag ],
  "graticule":          [ "graticule", flag ],
  "meridians":          [ "meridians", Number ],
  "parallels":          [ "parallels", Number ],
  "graticule-color":    [ "graticuleColor", String ],
  "equator-color":      [ "equatorColor", String ],
  "graticule-opacity":  [ "graticuleOpacity", Number ],
  "equator-opacity":    [ "equatorOpacity", Number ],
  "graticule-width":    [ "graticuleWidth", Number ],
  "overlays":           [ "overlays", flag ],
  // Globe-only: "appear vanish" facings with hysteresis for data-mappo-behind
  // (one number means both), and the spin in °/s above which overlays are
  // data-mappo-moving.
  "overlay-horizon":    [ "overlayHorizon", (v) => {
                          const m = v.trim().split(/[\s,]+/).map(Number);
                          return m.every(Number.isFinite) && (m.length === 1 || m.length === 2) ? (m.length === 1 ? [ m[0], m[0] ] : m) : null;
                        } ],
  "overlay-still":      [ "overlayStill", Number ],
  "max-dpr":            [ "maxDpr", Number ],
  // How far layers (addLayer, mappo/links) may draw past the box, as a fraction of it.
  "layer-bleed":        [ "layerBleed", Number ],
  // The globe's camera and atmosphere (the flat map ignores both): the camera's
  // distance in body radii, and fog as "near far" in radii from the centre plane.
  "distance":           [ "distance", Number ],
  "fog":                [ "fog", (v) => {
                          const m = v.trim().split(/[\s,]+/).map(Number);
                          return m.length === 2 && m.every(Number.isFinite) && m[0] < m[1] ? m : null;
                        } ],
  // The fog's colour: unset, the fog fades to transparent; set, it mixes.
  "fog-color":          [ "fogColor", String ],
  // How the globe's dots sample the sphere: "grid" (default) or "uniform".
  "distribution":       [ "distribution", String ],
  // The hero look and motion
  "tilt":               [ "tilt", Number ],
  "rotate":             [ "rotate", Number ],
  "perspective":        [ "perspective", Number ],
  "animation":          [ "animation", String ],
  "animation-period":   [ "animationPeriod", Number ],
  "animation-height":   [ "animationHeight", Number ],
  "animation-width":    [ "animationWidth", Number ],
  // Interaction
  "cursor":             [ "cursor", String ],
  "interactive":        [ "interactive", flag ]
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
    // Light DOM on purpose: consumers restyle .mappo-dot/.mappo-marker with
    // plain CSS — a shadow root would wall that off for zero benefit here.
    this.map = new Mappo(this, this.#optionsFromAttributes());
  }

  disconnectedCallback() {
    // destroy() hands overlay children back untouched, so an element that is
    // moved in the DOM (Turbo, a framework re-parenting it) finds them again
    // when connectedCallback runs a second time.
    this.map?.destroy();
    this.map = null;
  }

  attributeChangedCallback() {
    // Fires before connect for initial attributes; only re-render when live.
    this.map?.update(this.#optionsFromAttributes());
  }

  #optionsFromAttributes() {
    const options = {};
    for (const [ attr, [ key, parse ] ] of Object.entries(ATTR_MAP)) {
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
    // `markers` is attribute sugar for coordinates; the option is `places`.
    options.places = [ ...(options.places ?? []), ...(options.markers ?? []) ];
    delete options.markers;
    // Partial latitude bounds stay partial: Mappo combines each null bound
    // with the selected body's own range, including when that body registers
    // after this element upgraded.
    // Not `=== undefined`: an absent attribute is reset to its DEFAULT here,
    // and the default body is null. The tag fills in for "nobody said".
    if (!options.body && this.constructor.defaultBody) options.body = this.constructor.defaultBody;
    return options;
  }
};

// A tag whose default body is `body` — an id, or a body object, which is
// registered for you. Every registerBody() already defines <mappo-{id}>; this
// is for a page that wants a name of its own:
//
//   defineBodyElement("moon-map", MOON);     <moon-map mode="globe">
export function defineBodyElement(tag, body) {
  const id = typeof body === "object" ? registerBody(body).id : String(body);
  if (!MappoElement || typeof customElements === "undefined" || customElements.get(tag)) return;
  hideOverlaysUntilDefined(tag);
  // A subclass per tag, because a constructor can only be handed to the
  // registry once — registering a second tag with the same class throws and
  // takes the first down with it. Same component, different constructors.
  customElements.define(tag, class extends MappoElement { static defaultBody = id; });
}

let bodyTagsWired = false;

// Define <mappo-world> (or a tag of your choosing) and one tag per body, now
// and for every body registered from here on. Called automatically on import.
export function register(tag = "mappo-world") {
  if (!MappoElement || typeof customElements === "undefined") return;
  if (!customElements.get(tag)) {
    hideOverlaysUntilDefined(tag);
    customElements.define(tag, class extends MappoElement {});
  }
  if (bodyTagsWired) return;
  bodyTagsWired = true;
  for (const body of knownBodies()) defineBodyElement(`mappo-${body.id}`, body.id);
  onBodyRegistered((body) => defineBodyElement(`mappo-${body.id}`, body.id));
}

// Overlay children are ordinary markup, which means the browser lays them out
// the moment it parses them — before this module has loaded and long before
// the map knows where they belong. Without this they appear stacked in the
// corner of the element for a frame or two and then jump to their coordinates,
// which reads as broken. `:not(:defined)` holds them until the element
// upgrades; after that mappo owns their position and the rule stops matching.
// One <style> for all tags, one rule per tag.
function hideOverlaysUntilDefined(tag) {
  if (typeof document === "undefined") return;
  let style = document.getElementById("mappo-upgrade-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "mappo-upgrade-style";
    (document.head ?? document.documentElement).prepend(style);
  }
  const rule = `${tag}:not(:defined) [data-lat][data-lon]{visibility:hidden}`;
  if (!style.textContent.includes(rule)) style.append(rule);
}
