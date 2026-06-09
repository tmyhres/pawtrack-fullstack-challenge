/**
 * Regression suite for the Phase 2 audit fixes.
 *
 * Each test maps to a finding ID (F-NN) in DECISIONS.md. If a test fails, the
 * commit that broke it can be cross-referenced to a documented prior incident.
 *
 * Tests use fastify.inject() — no real HTTP listener, no port collisions,
 * fast. The in-memory store is reset before each test so cases are independent.
 */
import { describe, it, beforeEach, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { store } from '../store/memory-store.js';

const PORTLAND = { 'X-Tenant-Id': 'tenant_portland', 'X-User-Id': 'user_staff_portland' };
const SEATTLE = { 'X-Tenant-Id': 'tenant_seattle', 'X-User-Id': 'user_staff_seattle' };

let app: FastifyInstance;

beforeEach(async () => {
  store.reset();
  app = buildApp({ logger: false });
  await app.ready();
});

describe('F-01 / F-02 / F-03 — cross-tenant reads & writes return 404', () => {
  it('GET /api/bookings ignores ?tenantId= override', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bookings?tenantId=tenant_seattle&limit=20',
      headers: PORTLAND,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const tenants = new Set(body.data.map((b: any) => b.tenantId));
    expect([...tenants]).toEqual(['tenant_portland']);
  });

  it('GET /api/bookings/:id from foreign tenant returns 404 (existence not leaked)', async () => {
    // booking_007 is a Seattle booking
    const res = await app.inject({ method: 'GET', url: '/api/bookings/booking_007', headers: PORTLAND });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/bookings/:id from owning tenant returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bookings/booking_007', headers: SEATTLE });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe('booking_007');
  });

  it('PATCH /api/bookings/:id/status from foreign tenant returns 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/bookings/booking_008/status',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: { status: 'cancelled' },
    });
    expect(res.statusCode).toBe(404);
    // Booking must NOT have been mutated
    const check = await app.inject({ method: 'GET', url: '/api/bookings/booking_008', headers: SEATTLE });
    expect(check.json().data.status).not.toBe('cancelled');
  });
});

describe('F-04 — POST rejects cross-tenant pet/sitter references', () => {
  it('foreign sitter -> 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_001', sitterId: 'sitter_003',  // sitter_003 is Seattle
        scheduledDate: '2027-01-01T10:00:00-08:00',
        startTime: '10:00', endTime: '11:00',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/sitter/i);
  });

  it('foreign pet -> 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_006', sitterId: 'sitter_001',  // pet_006 is Seattle
        scheduledDate: '2027-01-01T10:00:00-08:00',
        startTime: '10:00', endTime: '11:00',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/pet/i);
  });

  it('unknown pet id returns the same 404 as foreign-tenant pet (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_does_not_exist', sitterId: 'sitter_001',
        scheduledDate: '2027-01-01T10:00:00-08:00',
        startTime: '10:00', endTime: '11:00',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Pet not found');
  });
});

describe('F-06 — concurrent POSTs to the same sitter slot produce exactly one booking', () => {
  it('5 parallel POSTs -> 1 success + 4 conflicts', async () => {
    const payload = {
      petId: 'pet_001', sitterId: 'sitter_001',
      scheduledDate: '2027-03-01T10:00:00-08:00',
      startTime: '10:00', endTime: '11:00',
      notes: 'race',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST', url: '/api/bookings',
          headers: { ...PORTLAND, 'Content-Type': 'application/json' },
          payload,
        }),
      ),
    );
    const successes = results.filter(r => r.statusCode === 201);
    const conflicts = results.filter(r => r.statusCode === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
  });
});

describe('F-07 — pagination is 1-indexed and starts at the newest', () => {
  it('page=1 limit=5 returns the newest 5; page=2 has no overlap', async () => {
    const p1 = await app.inject({ method: 'GET', url: '/api/bookings?page=1&limit=5', headers: PORTLAND });
    const p2 = await app.inject({ method: 'GET', url: '/api/bookings?page=2&limit=5', headers: PORTLAND });
    expect(p1.statusCode).toBe(200);
    expect(p2.statusCode).toBe(200);
    const p1Ids = new Set(p1.json().data.map((b: any) => b.id));
    const p2Ids = new Set(p2.json().data.map((b: any) => b.id));
    // No overlap between page 1 and page 2
    for (const id of p1Ids) expect(p2Ids.has(id as string)).toBe(false);
    // Newest in seed is booking_005 (2026-04-12)
    expect(p1Ids.has('booking_005')).toBe(true);
  });
});

describe('F-08 — schema validation rejects invalid input with 400', () => {
  it('empty POST body -> 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('malformed scheduledDate -> 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_001', sitterId: 'sitter_001',
        scheduledDate: 'not-a-date',
        startTime: '10:00', endTime: '11:00',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with status not in enum -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/bookings/booking_001/status',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: { status: 'gibberish' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET with page=0 -> 400 (schema enforces page >= 1)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bookings?page=0&limit=5', headers: PORTLAND });
    expect(res.statusCode).toBe(400);
  });
});

describe('F-10 — overnight bookings (endTime < startTime) overlap correctly', () => {
  it('identical overnight slot, same sitter -> 409', async () => {
    // Seed booking_006 is 2026-04-09T06:30:00Z 23:30->00:30 sitter_002 (Portland)
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_002', sitterId: 'sitter_002',
        scheduledDate: '2026-04-09T06:30:00Z',
        startTime: '23:30', endTime: '00:30',
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('F-11 — date filter respects the tenant timezone, not UTC prefix', () => {
  it('booking_006 buckets under 2026-04-08 in Portland TZ, not 2026-04-09', async () => {
    // booking_006: scheduledDate 2026-04-09T06:30:00Z = 2026-04-08 23:30 PT
    const apr8 = await app.inject({ method: 'GET', url: '/api/bookings?date=2026-04-08&page=1&limit=20', headers: PORTLAND });
    const apr9 = await app.inject({ method: 'GET', url: '/api/bookings?date=2026-04-09&page=1&limit=20', headers: PORTLAND });
    const apr8Ids = apr8.json().data.map((b: any) => b.id);
    const apr9Ids = apr9.json().data.map((b: any) => b.id);
    expect(apr8Ids).toContain('booking_006');
    expect(apr9Ids).not.toContain('booking_006');
  });

  it('a corrupted tenant timezone falls back to UTC instead of 500ing', async () => {
    // No API writes tenant.timezone, but guard the list endpoint against bad
    // data: an invalid IANA zone must not crash the date filter (Copilot review).
    const tenant = store.getTenant('tenant_portland')!;
    tenant.timezone = 'Mars/Phobos';
    const res = await app.inject({ method: 'GET', url: '/api/bookings?date=2026-04-09&page=1&limit=20', headers: PORTLAND });
    expect(res.statusCode).toBe(200);
  });
});

describe('client-shaped dates: service date is consistent across submit/filter/overlap', () => {
  // Replicates exactly what client/app.js submits for an <input type="date">:
  // the picked day anchored at noon UTC. A regression here (e.g. reverting to
  // UTC-midnight) would refile the booking under the previous local day and
  // re-open the overlap gap.
  const clientScheduledDate = (pickedDate: string) => `${pickedDate}T12:00:00.000Z`;

  it('POST a picked date, then GET ?date=<picked> includes it (Portland)', async () => {
    const picked = '2027-04-08';
    const post = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_001', sitterId: 'sitter_001',
        scheduledDate: clientScheduledDate(picked),
        startTime: '10:00', endTime: '11:00',
      },
    });
    expect(post.statusCode).toBe(201);
    const id = post.json().data.id;

    const sameDay = await app.inject({ method: 'GET', url: `/api/bookings?date=${picked}&limit=50`, headers: PORTLAND });
    const prevDay = await app.inject({ method: 'GET', url: '/api/bookings?date=2027-04-07&limit=50', headers: PORTLAND });
    expect(sameDay.json().data.map((b: any) => b.id)).toContain(id);
    expect(prevDay.json().data.map((b: any) => b.id)).not.toContain(id);
  });

  it('client-shaped overnight collides with a same-local-night booking -> 409', async () => {
    // booking_006 (seed): 2026-04-09T06:30:00Z = 2026-04-08 23:30 PT, sitter_002.
    // The client picks 2026-04-08 for the same 23:30->00:30 overnight slot.
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_001', sitterId: 'sitter_002',
        scheduledDate: clientScheduledDate('2026-04-08'),
        startTime: '23:30', endTime: '00:30',
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('F-12 — HTTP status codes express outcome', () => {
  it('successful POST -> 201 with {data}', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/bookings',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: {
        petId: 'pet_001', sitterId: 'sitter_001',
        scheduledDate: '2027-04-01T14:00:00-07:00',
        startTime: '14:00', endTime: '15:00',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('data.id');
    expect(res.json()).not.toHaveProperty('success');
  });

  it('successful PATCH -> 200 with {data}; invalid transition -> 409', async () => {
    // booking_001 is in status "confirmed" — can transition to in_progress or cancelled
    const good = await app.inject({
      method: 'PATCH', url: '/api/bookings/booking_001/status',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: { status: 'in_progress' },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.status).toBe('in_progress');

    // in_progress -> requested is not a valid transition
    const bad = await app.inject({
      method: 'PATCH', url: '/api/bookings/booking_001/status',
      headers: { ...PORTLAND, 'Content-Type': 'application/json' },
      payload: { status: 'requested' },
    });
    expect(bad.statusCode).toBe(409);
  });
});
