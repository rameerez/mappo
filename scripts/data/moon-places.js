// The Moon's gazetteer. Coordinates in the IAU Mean Earth/polar axis frame,
// east longitude positive. Landing sites are the published ones; the Artemis
// entries are four of the nine candidate regions NASA announced on 28 October
// 2024 for Artemis III (Peak near Cabeus B, Haworth, Malapert Massif, Mons
// Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2,
// Slater Plain) — only the four whose coordinates are pinned down here.
//
// Edit this file, then `npm run generate:moon` rewrites src/bodies/moon.js.

export default [
  // Apollo
  { name: "Apollo 11", lat: 0.67, lon: 23.47, kind: "apollo" },
  { name: "Apollo 12", lat: -3.01, lon: -23.42, kind: "apollo" },
  { name: "Apollo 14", lat: -3.65, lon: -17.47, kind: "apollo" },
  { name: "Apollo 15", lat: 26.13, lon: 3.63, kind: "apollo" },
  { name: "Apollo 16", lat: -8.97, lon: 15.50, kind: "apollo" },
  { name: "Apollo 17", lat: 20.19, lon: 30.77, kind: "apollo" },
  // Robotic
  { name: "Luna 9", lat: 7.13, lon: -64.37, kind: "robotic" },
  { name: "Chang'e 4", lat: -45.44, lon: 177.60, kind: "robotic" },
  { name: "Chang'e 6", lat: -41.64, lon: -153.99, kind: "robotic" },
  // Artemis III candidate regions (NASA, 28 Oct 2024)
  { name: "Malapert Massif", lat: -86.0, lon: -2.7, kind: "artemis" },
  { name: "Nobile Rim 1", lat: -85.4, lon: 31.5, kind: "artemis" },
  { name: "Peak near Cabeus B", lat: -82.2, lon: -58.0, kind: "artemis" },
  { name: "Haworth", lat: -87.5, lon: -5.0, kind: "artemis" },
  // Reference features
  { name: "Shackleton", lat: -89.7, lon: 129.2, kind: "feature" }
];
