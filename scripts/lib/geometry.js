// Ring geometry the generators share. Points are [a, b] pairs; nothing here
// cares which is latitude, so the same code simplifies the Natural Earth
// polygons and the contours traced from a raster.

// Douglas-Peucker: keep the endpoints, recurse on the farthest interior point.
export function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let maxDistance = 0, index = 0;
  const [ ax, ay ] = points[0];
  const [ bx, by ] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [ px, py ] = points[i];
    const distance = Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
    if (distance > maxDistance) { maxDistance = distance; index = i; }
  }
  if (maxDistance <= epsilon) return [ points[0], points[points.length - 1] ];
  return [
    ...simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplify(points.slice(index), epsilon)
  ];
}

// A CLOSED ring cannot be fed to Douglas-Peucker directly: its first and last
// points coincide, the baseline is degenerate, every distance is zero, and the
// ring collapses to two points. So it is split at the vertex farthest from the
// start, each half is simplified as an open polyline — the second half
// including the closing edge back to the start, so points near the end are
// tested against it too — and the result is re-closed.
export function simplifyRing(ring, epsilon) {
  const closed = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 4) return ring;

  let farthest = 1, best = -1;
  for (let i = 1; i < open.length; i++) {
    const distance = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (distance > best) { best = distance; farthest = i; }
  }
  const first = simplify(open.slice(0, farthest + 1), epsilon);
  const second = simplify([ ...open.slice(farthest), open[0] ], epsilon);
  const merged = [ ...first.slice(0, -1), ...second.slice(0, -1) ];
  if (closed) merged.push([ merged[0][0], merged[0][1] ]);
  return merged;
}

// Shoelace area, unsigned, in the ring's own units.
export function ringArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(a / 2);
}

export function isClosed(ring) {
  return ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
}
