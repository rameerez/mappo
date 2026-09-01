// The cities these pages keep time in.
//
// A map with no ground under it is just geometry, and the fastest way to give
// someone their bearings is a clock they recognise. Twelve, far enough apart to
// read at globe scale, spread widely enough in longitude that some of them are
// always in the dark, and an even number so a two-column list does not end on a
// ragged row.
//
// mappo's own registry has coordinates for a hundred and sixty cities but no
// time zones — a map component has no business shipping the tz database — so
// the zone is named here and Intl does the rest.

export const CLOCK_CITIES = [
  { name: "Los Angeles", lat: 34.05,  lon: -118.24, tz: "America/Los_Angeles" },
  { name: "New York",    lat: 40.71,  lon: -74.01,  tz: "America/New_York" },
  { name: "São Paulo",   lat: -23.55, lon: -46.63,  tz: "America/Sao_Paulo" },
  { name: "London",      lat: 51.51,  lon: -0.13,   tz: "Europe/London" },
  { name: "Lisbon",      lat: 38.72,  lon: -9.14,   tz: "Europe/Lisbon" },
  { name: "Rome",        lat: 41.90,  lon: 12.50,   tz: "Europe/Rome" },
  { name: "Lagos",       lat: 6.52,   lon: 3.37,    tz: "Africa/Lagos" },
  { name: "Moscow",      lat: 55.75,  lon: 37.62,   tz: "Europe/Moscow" },
  { name: "Delhi",       lat: 28.61,  lon: 77.21,   tz: "Asia/Kolkata" },
  { name: "Singapore",   lat: 1.35,   lon: 103.82,  tz: "Asia/Singapore" },
  { name: "Tokyo",       lat: 35.68,  lon: 139.69,  tz: "Asia/Tokyo" },
  { name: "Sydney",      lat: -33.87, lon: 151.21,  tz: "Australia/Sydney" }
];

// A DateTimeFormat is expensive to build and free to reuse, so each city gets
// its two once and keeps them.
export function withClocks(cities = CLOCK_CITIES) {
  return cities.map((c) => ({
    ...c,
    clock: new Intl.DateTimeFormat([], {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: c.tz }),
    date: new Intl.DateTimeFormat([], {
      weekday: "short", day: "numeric", month: "short", timeZone: c.tz })
  }));
}

// Is the sun up where they stand? The same spherical-triangle line the
// terminator is drawn from, kept here so the two pages cannot disagree about
// which cities are in daylight.
const RAD = Math.PI / 180;
export const solarElevation = (lat, lon, dec, subLon) =>
  Math.asin(
    Math.sin(lat * RAD) * Math.sin(dec * RAD) +
    Math.cos(lat * RAD) * Math.cos(dec * RAD) * Math.cos((lon - subLon) * RAD)
  ) / RAD;
