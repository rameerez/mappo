// Colour parsing and mixing for the globe's fog: a fog colour is blended into
// every dot by depth, which needs actual channel values rather than CSS
// strings. Only the globe does this, so it lives with the globe module rather
// than in the core (see src/color.js for the helpers every renderer shares).

// Parse a colour the way a canvas hands one back: #rgb, #rgba, #rrggbb,
// #rrggbbaa, or rgb()/rgba() with numbers. Returns [r, g, b, a] or null.
export function parseColor(value) {
  const s = value?.trim?.() ?? "";
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = hex.replace(/./g, (ch) => ch + ch);
    const n = [ 0, 2, 4, 6 ].map((i) => hex.length > i ? parseInt(hex.slice(i, i + 2), 16) : 255);
    return [ n[0], n[1], n[2], n[3] / 255 ];
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [ +m[1], +m[2], +m[3], a ];
  }
  return null;
}

// `color` mixed `t` of the way toward `tint`, numerically in sRGB — the way a
// WebGL fog blends in its framebuffer — keeping `color`'s own alpha. A colour
// the parser does not know (a name, an oklch()) is normalised through a canvas
// context when one is given; failing that the mix is left to CSS color-mix().
export function mixColor(color, tint, t, ctx) {
  const norm = (v) => {
    let p = parseColor(v);
    if (!p && ctx) {
      const was = ctx.fillStyle;
      ctx.fillStyle = "#010203";
      ctx.fillStyle = v;
      if (ctx.fillStyle !== "#010203") p = parseColor(ctx.fillStyle);
      ctx.fillStyle = was;
    }
    return p;
  };
  const a = norm(color), b = norm(tint);
  if (!a || !b) return `color-mix(in srgb, ${color} ${Math.round((1 - t) * 100)}%, ${tint})`;
  const ch = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
  return a[3] >= 1 ? `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})` : `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${+a[3].toFixed(3)})`;
}
