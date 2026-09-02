// Mars's gazetteer. Coordinates are IAU 2000 planetocentric latitude and east
// longitude in mappo's −180…180 convention (subtract 360 from a 0–360°E
// figure above 180). Landing sites are the published ones; the prospects are
// regions repeatedly discussed for human landings, not commitments.
//
// Edit this file, then `npm run generate:mars` rewrites src/bodies/mars.js.

export default [
  // Successful landings
  { name: "Viking 1", lat: 22.27, lon: -48.22, kind: "landed" },
  { name: "Viking 2", lat: 47.64, lon: 134.29, kind: "landed" },
  { name: "Pathfinder", lat: 19.13, lon: -33.22, kind: "landed" },
  { name: "Spirit", lat: -14.57, lon: 175.47, kind: "landed" },
  { name: "Opportunity", lat: -1.95, lon: -5.53, kind: "landed" },
  { name: "Phoenix", lat: 68.22, lon: -125.75, kind: "landed" },
  { name: "Curiosity", lat: -4.59, lon: 137.44, kind: "landed" },
  { name: "InSight", lat: 4.50, lon: 135.62, kind: "landed" },
  { name: "Perseverance", lat: 18.44, lon: 77.45, kind: "landed" },
  { name: "Zhurong", lat: 25.07, lon: 109.93, kind: "landed" },
  // Human-exploration prospects
  { name: "Arcadia Planitia", lat: 46.7, lon: -168.0, kind: "prospect" },
  { name: "Amazonis Planitia", lat: 24.8, lon: -164.0, kind: "prospect" },
  { name: "Deuteronilus Mensae", lat: 43.9, lon: 23.0, kind: "prospect" },
  // Reference features
  { name: "Olympus Mons", lat: 18.65, lon: -133.8, kind: "feature" },
  { name: "Valles Marineris", lat: -13.9, lon: -59.2, kind: "feature" },
  { name: "Hellas Planitia", lat: -42.4, lon: 70.5, kind: "feature" }
];
