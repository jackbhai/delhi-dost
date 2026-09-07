/* Round-trip test: build a small GTFS-RT VehiclePositions feed by hand and
   verify decodeGtfsRt extracts what we expect.
   Run: npm run test:livebus   (or: node api/live-bus.test.mjs)                */
import { decodeGtfsRt } from './live-bus.mjs';

/* ------------------------------ tiny encoder ----------------------------- */
function varint(n) {
  const out = [];
  let v = BigInt(n);
  for (;;) {
    let b = Number(v & 127n);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
    if (!v) break;
  }
  return Buffer.from(out);
}
function key(f, w) { return varint((BigInt(f) << 3n) | BigInt(w)); }
function len(m) { const b = Buffer.from(m); return Buffer.concat([varint(b.length), b]); }
function f32(x) { const b = Buffer.alloc(4); b.writeFloatLE(x); return b; }
function s(strv) { return len(Buffer.from(strv, 'utf8')); }
function msg(fields) { return Buffer.concat(fields); }

function buildSample() {
  // mirrors the wire layout of the real OTD feed (see live-bus.mjs)
  const position = msg([
    key(1, 5), f32(28.6139),
    key(2, 5), f32(77.2090),
    key(3, 5), f32(90),
    key(5, 5), f32(11.0),        // m/s (~40 km/h)
  ]);
  const trip = msg([key(1, 2), s('T-5231'), key(5, 2), s('GL-23')]);
  const vehicle = msg([key(1, 2), s('DL1PC1234'), key(2, 2), s('bus-77')]);
  const vp = msg([
    key(1, 2), len(trip),
    key(2, 2), len(position),
    key(4, 0), varint(2),
    key(5, 0), varint(1754567890),
    key(7, 2), s('Nehru Place'),
    key(8, 2), len(vehicle),
  ]);
  const ent1 = msg([key(1, 2), s('v1'), key(4, 2), len(vp)]);
  const header = msg([key(1, 2), s('2.0'), key(2, 0), varint(0), key(3, 0), varint(1754567891)]);
  return msg([
    key(1, 2), len(header),
    key(2, 2), len(ent1),
  ]);
}

const { feedTs, buses } = decodeGtfsRt(buildSample());
const b = buses[0];
const ok =
  buses.length === 1 &&
  b.id === 'DL1PC1234' && b.label === 'bus-77' &&
  b.route === 'GL-23' && b.trip === 'T-5231' &&
  Math.abs(b.lat - 28.6139) < 2e-6 && Math.abs(b.lon - 77.209) < 2e-6 &&
  b.bearing === 90 && b.speed === 40 &&
  b.status === 2 && b.stop === 'Nehru Place' && b.ts === 1754567890000 &&
  feedTs === 1754567891000;

console.log(ok ? 'PASS ✓' : 'FAIL ✗');
if (!ok) console.log(JSON.stringify({ feedTs, buses }, null, 1));
process.exit(ok ? 0 : 1);
