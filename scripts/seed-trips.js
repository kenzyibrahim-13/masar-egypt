// Seeds upcoming trips into the Trips table (1278387).
// Usage: node scripts/seed-trips.js [days=7]
// Cairo time = UTC+2. Skips any departure that already exists or is already in the past.
require("dotenv").config();

const TOKEN = process.env.BASEROW_TOKEN;
const TRIPS_TABLE = 1278387;
const DAYS = Number(process.argv[2] || 7);
const CAIRO_OFFSET_HOURS = 2;

// Each route alternates between two vehicles/drivers
const SCHEDULES = [
  { routeId: 112, capacity: 9999, times: ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"],
    vehicles: [{ label: "Metro Line 3 - M101", driver: 1 }, { label: "Metro Line 3 - M102", driver: 5 }] },
  { routeId: 113, capacity: 9999, times: ["06:30", "08:30", "10:30", "12:30", "14:30", "16:30", "18:30", "20:30", "22:30"],
    vehicles: [{ label: "LRT - L201", driver: 1 }, { label: "LRT - L202", driver: 5 }] },
  { routeId: 117, capacity: 50, times: ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00"],
    vehicles: [{ label: "Public Bus - B301", driver: 3 }, { label: "Public Bus - B302", driver: 6 }] }
];

async function api(path, options = {}) {
  const res = await fetch(`https://api.baserow.io${path}`, {
    ...options,
    headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getExistingKeys() {
  const keys = new Set();
  let page = 1;
  while (true) {
    const d = await api(`/api/database/rows/table/${TRIPS_TABLE}/?user_field_names=true&size=200&page=${page}`);
    d.results.forEach(t => keys.add(`${t.route_id?.[0]?.id}|${new Date(t.departure).toISOString()}`));
    if (!d.next) break;
    page++;
  }
  return keys;
}

(async () => {
  if (!TOKEN) throw new Error("BASEROW_TOKEN missing in .env");
  const existing = await getExistingKeys();
  const now = Date.now();

  // "Today" in Cairo
  const cairoNow = new Date(now + CAIRO_OFFSET_HOURS * 3600000);
  const startY = cairoNow.getUTCFullYear(), startM = cairoNow.getUTCMonth(), startD = cairoNow.getUTCDate();

  const items = [];
  for (let day = 0; day < DAYS; day++) {
    for (const sch of SCHEDULES) {
      sch.times.forEach((hhmm, i) => {
        const [hh, mm] = hhmm.split(":").map(Number);
        const depUtc = new Date(Date.UTC(startY, startM, startD + day, hh - CAIRO_OFFSET_HOURS, mm));
        if (depUtc.getTime() <= now) return;
        const key = `${sch.routeId}|${depUtc.toISOString()}`;
        if (existing.has(key)) return;
        const v = sch.vehicles[i % sch.vehicles.length];
        items.push({
          vehicle_label: v.label,
          capacity: sch.capacity,
          booked_seats: 0,
          departure: depUtc.toISOString(),
          trip_status: "Scheduled",
          route_id: [sch.routeId],
          driver: [v.driver]
        });
      });
    }
  }

  console.log(`Creating ${items.length} trips...`);
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    await api(`/api/database/rows/table/${TRIPS_TABLE}/batch/?user_field_names=true`, {
      method: "POST",
      body: JSON.stringify({ items: batch })
    });
    console.log(`  inserted ${i + batch.length}/${items.length}`);
  }
  console.log("Done.");
})().catch(err => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
