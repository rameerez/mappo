// One color utility: the auto hover shade. When dot-hover-color isn't set,
// hovers derive from dot-color itself — darker for light dots, lighter for
// dark dots — so a custom-colored map never falls back to somebody else's
// gray. Hex in, hex out; non-hex inputs (named colors, rgb()) fall back to
// a CSS color-mix() string, which every browser that runs this component
// already supports.

export function hoverShade(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim?.() ?? "");
  if (!m) return `color-mix(in srgb, ${color} 65%, black)`;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (ch) => ch + ch);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const shade = luminance > 140
    ? (v) => Math.round(v * 0.62)                    // light dot → darker shade
    : (v) => Math.round(v + (255 - v) * 0.45);       // dark dot → lighter tint
  return `#${[r, g, b].map((v) => shade(v).toString(16).padStart(2, "0")).join("")}`;
}

// Resolve a CSS custom property to a concrete colour.
//
// `dot-color="var(--color-border-100)"` should Just Work: the host already
// keeps its palette in CSS variables, and asking it to duplicate those hex
// values into map attributes guarantees the two drift — most visibly the
// moment someone adds a dark mode. Accepts `var(--x)` and `var(--x, #fallback)`;
// anything else passes through untouched.
export function resolveColor(value, el) {
  if (typeof value !== "string") return value;
  const m = /^var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value;
  if (typeof getComputedStyle !== "function") return (m[2] ?? "").trim() || "#000";

  const root = el?.ownerDocument?.documentElement
    ?? (typeof document !== "undefined" ? document.documentElement : null);
  const resolved = root ? getComputedStyle(root).getPropertyValue(m[1]).trim() : "";
  return resolved || (m[2] ?? "").trim() || "#000";
}

// Does this option bundle reference any CSS variable? Renderers use this to
// decide whether it's worth watching the document for theme changes at all —
// a map with literal hex colours pays nothing.
export function usesCssVars(...values) {
  return values.some((v) => typeof v === "string" && v.includes("var(--"));
}
