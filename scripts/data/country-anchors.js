// Anchors for the codes a GeoIP database reports that Natural Earth has no
// feature for at 110m, not even in its tiny-countries layer: city-states inside
// another country's polygon, small dependencies, and the departments GeoIP keys
// apart from their metropole. [lat, lon] of the main settlement to two
// decimals, which is all a dot on a world map can use.
//
// Edit this file, then `node scripts/generate-countries.js` rewrites demo/countries.js.

export default [
  { id: "HK", name: "Hong Kong", lat: 22.32, lon: 114.17 },
  { id: "MO", name: "Macao", lat: 22.20, lon: 113.54 },
  { id: "LI", name: "Liechtenstein", lat: 47.14, lon: 9.52 },
  { id: "MC", name: "Monaco", lat: 43.73, lon: 7.42 },
  { id: "AD", name: "Andorra", lat: 42.51, lon: 1.52 },
  { id: "SM", name: "San Marino", lat: 43.94, lon: 12.46 },
  { id: "VA", name: "Vatican City", lat: 41.90, lon: 12.45 },
  { id: "GI", name: "Gibraltar", lat: 36.14, lon: -5.35 },
  { id: "JE", name: "Jersey", lat: 49.21, lon: -2.13 },
  { id: "GG", name: "Guernsey", lat: 49.46, lon: -2.58 },
  { id: "IM", name: "Isle of Man", lat: 54.24, lon: -4.55 },
  { id: "AW", name: "Aruba", lat: 12.52, lon: -69.97 },
  { id: "CW", name: "Curaçao", lat: 12.17, lon: -68.99 },
  { id: "SX", name: "Sint Maarten", lat: 18.04, lon: -63.06 },
  { id: "KY", name: "Cayman Islands", lat: 19.31, lon: -81.25 },
  { id: "VG", name: "British Virgin Islands", lat: 18.42, lon: -64.64 },
  { id: "VI", name: "U.S. Virgin Islands", lat: 18.34, lon: -64.93 },
  { id: "AI", name: "Anguilla", lat: 18.22, lon: -63.07 },
  { id: "GF", name: "French Guiana", lat: 4.94, lon: -52.33 },
  { id: "GP", name: "Guadeloupe", lat: 16.25, lon: -61.55 },
  { id: "MQ", name: "Martinique", lat: 14.64, lon: -61.02 },
  { id: "RE", name: "Réunion", lat: -21.12, lon: 55.53 },
  { id: "YT", name: "Mayotte", lat: -12.83, lon: 45.17 }
];
