/* Round-trip test: build a small GTFS-RT VehiclePositions feed matching the
   REAL OTD wire layout (see live-bus.mjs) and verify decodeGtfsRt extracts
   what we expect. Run: npm run test:livebus */
import { decodeGtfsRt, normRoute } from './live-bus.mjs';

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

/* mirrors the wire layout of the real OTD feed */
function buildSample() {
  const position = msg([
    key(1, 5), f32(28.6139),
    key(2, 5), f32(77.2090),
    key(5, 5), f32(0),            // speed — always 0 in the real feed
  ]);
  const trip = msg([key(1, 2), s('T-5231'), key(5, 2), s('GL-23')]);
  const vehicle = msg([key(1, 2), s('DL1PC1234'), key(2, 2), s('bus-77')]);
  const vp = msg([
    key(1, 2), len(trip),
    key(2, 2), len(position),
    key(4, 0), varint(2),          // current_status IN_TRANSIT_TO
    key(5, 0), varint(1754567890), // vehicle timestamp
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
  b.id === 'DL1PC1234' &&          // from vehicle descriptor
  b.route === 'GL-23' && b.trip === 'T-5231' &&
  Math.abs(b.lat - 28.6139) < 2e-6 && Math.abs(b.lon - 77.209) < 2e-6 &&
  b.status === 2 && b.ts === 1754567890000 &&
  feedTs === 1754567891000 &&
  b.label === undefined;           // feed has no label — client derives display

console.log(ok ? 'PASS ✓' : 'FAIL ✗');
if (!ok) console.log(JSON.stringify(buses, null, 2));

/* normalisation makes route ids comparable across datasets */
const normOk =
  normRoute('0740') === '740' &&
  normRoute('740EXT') === '740EXT' &&
  normRoute('OMS(+)') === 'OMS' &&
  normRoute('0118EXT(NS) Ext') === '118EXT' &&
  normRoute('0118EXT') === '118EXT' &&
  normRoute('  034  ') === '34' &&
  normRoute('OMS STL') === 'OMS' &&
  normRoute(null) === null;
console.log(normOk ? 'NORM ✓' : 'NORM ✗');
if (!normOk) console.log(normRoute('0740'), normRoute('740EXT'), normRoute('OMS(+)'), normRoute('0118EXT(NS) Ext'), normRoute('OMS STL'));
