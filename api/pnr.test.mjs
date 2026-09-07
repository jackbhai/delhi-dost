/** Unit tests for the PNR fallback chain — hermetic, no network, no keys. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePnr, fromRailKit, fromRapid, statusTone } from './pnr.mjs';

const RK_SAMPLE = {
  success: true,
  data: {
    pnr: '6948325823',
    train: { number: '18021', name: 'KGP KUR EXP' },
    journey: {
      dateOfJourney: 'Sep 4, 2026 4:40:00 AM', class: 'CC', quota: 'GN',
      source: { code: 'KGP', name: 'KHARAGPUR JN' },
      destination: { code: 'KUR', name: 'KHURDA ROAD JN' },
      boardingPoint: { code: 'KGP', name: 'KHARAGPUR JN' }, distance: 366,
      arrivalDate: 'Sep 4, 2026 1:50:00 PM',
    },
    chart: { status: 'Chart Not Prepared' },
    booking: { fare: 1050, bookingDate: 'Aug 18, 2026 8:04:06 PM' },
    passengers: [
      { serialNumber: 1, booking: { status: 'CNF', coach: 'C1', berthNo: 30, berthCode: 'WS', details: 'CNF/C1/30/WS' },
        current: { status: 'CNF', coach: 'C1', berthNo: 30, berthCode: 'WS', details: 'CNF/C1/30/WS' } },
      { serialNumber: 2, booking: { status: 'WL', coach: 'C1', berthNo: 12, berthCode: null, details: 'WL 12' },
        current: { status: 'RAC', coach: 'C1', berthNo: 44, berthCode: 'LB', details: 'RAC/C1/44/LB' } },
    ],
  },
};

test('fromRailKit normalizes the canonical shape', () => {
  const o = fromRailKit(RK_SAMPLE);
  assert.equal(o.train.no, '18021');
  assert.equal(o.journey.from.code, 'KGP');
  assert.equal(o.chart, 'not');
  assert.equal(o.fare, 1050);
  assert.equal(o.passengers.length, 2);
  assert.equal(o.passengers[0].c.st, 'CNF');
  assert.equal(o.passengers[1].b.st, 'WL');
  assert.equal(o.passengers[1].c.st, 'RAC');
});

test('statusTone buckets statuses', () => {
  assert.equal(statusTone('CNF'), 'ok');
  assert.equal(statusTone('RAC'), 'wait');
  assert.equal(statusTone('WL 34'), 'muted');
  assert.equal(statusTone('CAN'), 'bad');
});

test('chain: first source wins; second never runs', async () => {
  let ran2 = false;
  const sources = [
    { id: 'a', label: 'a', run: async () => ({ train: { no: '1', name: 'X' }, passengers: [] }) },
    { id: 'b', label: 'b', run: async () => { ran2 = true; throw new Error('should not run'); } },
  ];
  const out = await resolvePnr('1000000001', { sources });
  assert.equal(out.via, 'a');
  assert.equal(ran2, false);
});

test('chain: falls through a dead source to the next healthy one', async () => {
  const sources = [
    { id: 'dead', label: 'dead', run: async () => { throw new Error('down'); } },
    { id: 'ok', label: 'ok', run: async () => ({ train: { no: '2', name: 'Y' }, passengers: [] }) },
  ];
  const out = await resolvePnr('1000000002', { sources });
  assert.equal(out.via, 'ok');
});

test('chain: everything down -> upstream error', async () => {
  const sources = [
    { id: 'd1', label: 'd1', run: async () => { throw new Error('down'); } },
    { id: 'd2', label: 'd2', run: async () => { throw new Error('down too'); } },
  ];
  await assert.rejects(() => resolvePnr('1000000003', { sources }), /upstream/);
});

test('chain: no sources configured -> setup error', async () => {
  await assert.rejects(() => resolvePnr('1000000004', { sources: [] }), /setup/);
});

test('chain: cache serves the same PNR without calling sources twice', async () => {
  let calls = 0;
  const mk = () => ({ id: 's', label: 's', run: async () => { calls++; return { train: { no: '9' }, passengers: [] }; } });
  const now = 1_000_000_000_000;
  await resolvePnr('1111111111', { sources: [mk()], now });
  const out = await resolvePnr('1111111111', { sources: [mk()], now });
  assert.equal(calls, 1);
  assert.equal(out.cached, true);
});

test('fromRapid tolerates the common irctc1 wire shape', () => {
  const o = fromRapid({
    data: {
      pnr: '2534567890', train_number: '12301', train_name: 'RJDHANI EXP',
      doj: '15-09-2026', class: '3A', quota: 'GN', chart_prepared: 'Y',
      from_station: { station_code: 'NDLS', station_name: 'NEW DELHI' },
      to_station: { station_code: 'HWH', station_name: 'HOWRAH JN' },
      boarding_point: { station_code: 'NDLS', station_name: 'NEW DELHI' },
      total_fare: 2380,
      passengers: [{ passenger_serial_number: 1, booking_status: 'CNF', booking_coach_id: 'B1',
        booking_berth_no: 22, current_status: 'CNF', current_coach_id: 'B1', current_berth_no: 22 }],
    },
  });
  assert.equal(o.train.no, '12301');
  assert.equal(o.journey.to.code, 'HWH');
  assert.equal(o.chart, 'prepared');
  assert.equal(o.fare, 2380);
  assert.equal(o.passengers[0].c.coach, 'B1');
});
