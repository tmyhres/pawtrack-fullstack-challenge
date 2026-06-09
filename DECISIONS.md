# Full-Stack Engineering Decisions

> Working document for the PawTrack audit + fix + improve cycle. Findings are
> assigned stable IDs (`F-NN`) so fixes in Phase 2 and proposals in Phase 3 can
> cross-reference them cleanly.

## Progress Log

> Wall-clock budget tracking. Total project budget per README: 90 minutes.

| Phase | Budgeted | Spent | Notes |
|---|---|---|---|
| Phase 1a (static audit) | ~10 min | ~10–12 min | 22 findings catalogued from cold-read of all server + client files. |
| Phase 1b (runtime verification) | ~10–15 min | ~5 min | 12 findings escalated to `Verified: both`; F-23 newly discovered at runtime (input-gap → 500). |
| **Pre-Phase 2: dep upgrade** | ~10 min | ~5 min | Pinned fastify@5.8.5, uuid@11.1.1, fast-uri@3.1.2 (via `overrides`). `npm audit` now reports 0 vulnerabilities. Typecheck + smoke tests all green. F-22 closed. |
| Phase 2 (fixes) | ~40 min | pending | 13 steps, brief-incident-first order. |
| Phase 3 (improve + propose) | ~25 min | pending | One implemented improvement + two written proposals. |

## Conventions

**Classification buckets** (a finding may carry multiple):

| Tag | Meaning |
|---|---|
| `security` | Auth, secret handling, injection, transport |
| `tenancy` | Cross-tenant isolation specifically (called out separately because the brief flags it as primary) |
| `data-integrity` | Concurrency, validation, invariants, referential consistency |
| `api-design` | REST conventions, status codes, error shape, idempotency |
| `ux` | Rendering, stale state, error surfacing in the UI |
| `architecture` | Separation of concerns, coupling, layering |
| `observability` | Logging, audit trail, traceability |
| `performance` | Only when material to the use case |

**Severity:**

| Level | Meaning |
|---|---|
| `critical` | Active data leak, corruption, or auth bypass. Fix before anything else. |
| `high` | Likely to cause user-visible incidents under normal use. |
| `medium` | Wrong behaviour in edge cases, or quality issue compounding over time. |
| `low` | Polish / hygiene. Skip if time-bound. |

**Per-finding block template:**

```
### F-NN — <short title>
- **File(s):** path:line
- **Classification:** tag, tag
- **Severity:** critical | high | medium | low
- **Verified:** static | runtime | both
- **What:** one-line description
- **Why it matters:** production impact in plain terms
- **Fix (Phase 2):** _pending_
```

---

## Audit Findings

### Phase 2 sequencing rationale (read this before the index)

The default rule for Phase 2 is **fix by severity**: critical → high → medium → low. That's what the README asks for and it's the right framing because severity is a proxy for blast radius. The order in which fixes actually shipped deviates from a pure severity sort in two specific, justified ways:

1. **F-22 (deps, classified medium) was pulled forward to run before any other fix.** Two reasons. First, the *time-to-weaponization* of a published CVE has compressed enough over the past few years that "currently not exploitable from our code" is a snapshot, not a property — treating CVE patches as low-priority until they bite is exactly the discipline that produces incidents. Second, the fastify body-schema-bypass advisory becomes *load-bearing* the moment we add schema validation in Step 8 (F-08), so F-22 is a precondition for F-08 shipping safely. Detail in the F-22 Fix block below.
2. **Within the critical severity tier, ordering is "brief-incident-first."** The README names three production incidents (cross-tenant read, double-booking, filters resetting). All critical findings get fixed, but ones that map to those named incidents go first — both because they're the most-visible wins against the rubric and because the company has already felt the pain.

**After F-22, every subsequent fix is in strict severity order**, with the intra-tier sorting above. No medium- or low-severity finding is fixed before a critical or high. If we run short on the 40-minute Phase 2 budget, the cut line is always at the bottom of the priority list — mediums get deferred to proposals, not skipped over.

### Index

| ID | Title | Classification | Severity | Verified | Fixed |
|---|---|---|---|---|---|
| F-01 | Tenant override via `?tenantId=` query param | tenancy, security | critical | both | ☑ |
| F-02 | `GET /api/bookings/:id` performs no tenant check | tenancy | critical | both | ☐ |
| F-03 | `PATCH /api/bookings/:id/status` performs no tenant check | tenancy, data-integrity | critical | both | ☐ |
| F-04 | `POST /api/bookings` does not verify pet/sitter belong to caller's tenant | tenancy, data-integrity | critical | both | ☐ |
| F-05 | XSS via `innerHTML` interpolation of booking & pet fields | security | critical | both | ☐ |
| F-06 | Double-booking race — overlap check has TOCTOU window | data-integrity | critical | both | ☐ |
| F-07 | Pagination off-by-one (`offset = page * limit`) drops first page | data-integrity, ux | high | both | ☐ |
| F-08 | No request body validation on `POST /api/bookings` or `PATCH …/status` | data-integrity, api-design | high | both | ☐ |
| F-09 | Frontend fetch race: poll + filter change + refresh, last-response-wins | ux, data-integrity | high | static | ☐ |
| F-10 | Overlap check broken for bookings that cross midnight | data-integrity | high | both | ☐ |
| F-11 | Date filter uses `startsWith` on ISO string — wrong across timezones | data-integrity, ux | high | both | ☐ |
| F-12 | Wrong status codes — 404 returns 200, errors return 200 | api-design | medium | both | ☐ |
| F-13 | Frontend branches on `result.error`, ignores HTTP status entirely | api-design, ux | medium | static | ☐ |
| F-14 | `X-User-Role` is trusted unvalidated; no role enforcement anywhere | security, architecture | medium | static | ☐ |
| F-15 | CORS `origin: true` allows any origin | security | medium | static | ☐ |
| F-16 | `scheduledDate` timezone-inconsistent (seed mixes UTC + offset; client uses local→UTC) | data-integrity, architecture | medium | static | ☐ |
| F-17 | `statusChangedBy` taken from `X-User-Id` header without validation — audit trail is forgeable | security, observability | medium | both | ☐ |
| F-18 | Event bus has no error isolation — a throwing handler kills the loop | architecture, observability | low | static | ☐ |
| F-19 | Inline `onclick` + `window.goToPage` global for pagination | security, ux | low | static | ☐ |
| F-20 | No rate limiting / no explicit body-size limits | security | low | static | ☐ |
| F-21 | No request logging enrichment with tenant/user/correlation id | observability | low | static | ☐ |
| F-22 | Three known CVEs in pinned deps (fastify, fast-uri, uuid); `npm audit` reports fixes available | security | medium | static | ☑ |
| F-23 | Bad input (F-08) crashes list endpoint with HTTP 500 when `date` filter applied | data-integrity, availability | high | runtime | ☐ |

<!-- Per-finding blocks below this line -->

### F-01 — Tenant override via `?tenantId=` query param

- **File(s):** `server/src/routes/bookings.ts:21`
- **Classification:** tenancy, security
- **Severity:** critical
- **Verified:** both
- **What:** `const tenantId = query.tenantId || auth.tenantId;` allows any authenticated caller to read another tenant's bookings just by appending `?tenantId=tenant_seattle`.
- **Why it matters:** This is exactly the "customer saw another customer's bookings" incident in the brief. There is no role gate, so a staff (or sitter) account from one tenant can read the entire booking list of another.
- **Fix (Phase 2):** Removed the query-param override outright. `GET /api/bookings` now sources `tenantId` from `auth.tenantId` only. The legitimate "admin cross-tenant view" use case is deferred to Phase 3 proposals — it needs a verified `role=admin` claim before the override can be safely reintroduced (see F-14). Verified: `GET /api/bookings?tenantId=tenant_seattle` from a Portland session returns only `tenant_portland` rows (10 total) instead of leaking Seattle data. ✅

### F-02 — `GET /api/bookings/:id` performs no tenant check

- **File(s):** `server/src/routes/bookings.ts:41-50`
- **Classification:** tenancy
- **Severity:** critical
- **Verified:** both
- **What:** Handler calls `bookingService.getBooking(id)` and returns the booking irrespective of `auth.tenantId`.
- **Why it matters:** Direct enumeration of `booking_001`…`booking_020` across tenants. Pet IDs and notes leak. Compare with `routes/pets.ts:30` which *does* check tenant — the pattern was understood, just not applied here.
- **Fix (Phase 2):** _pending_

### F-03 — `PATCH /api/bookings/:id/status` performs no tenant check

- **File(s):** `server/src/routes/bookings.ts:89-97`, `server/src/services/booking-service.ts:125-164`
- **Classification:** tenancy, data-integrity
- **Severity:** critical
- **Verified:** both
- **What:** Status transitions on any booking by ID, regardless of caller's tenant. The audit fields (`statusChangedBy`) are set from caller's user id even though they belong to a different tenant.
- **Why it matters:** Lets one tenant cancel or progress another tenant's bookings. Corrupts the audit trail across tenants.
- **Fix (Phase 2):** _pending_

### F-04 — `POST /api/bookings` does not verify pet/sitter belong to caller's tenant

- **File(s):** `server/src/routes/bookings.ts:56-83`, `server/src/services/booking-service.ts:69-120`
- **Classification:** tenancy, data-integrity
- **Severity:** critical
- **Verified:** static
- **What:** The created booking gets `tenantId: auth.tenantId`, but the supplied `petId` and `sitterId` are never checked against that tenant. A Portland staff user can create a booking under Portland that references a Seattle sitter or pet.
- **Why it matters:** Mixed-tenant booking records corrupt every downstream filter, list, and report. It also opens a path to scheduling a foreign tenant's sitter (denial-of-service on their availability).
- **Fix (Phase 2):** _pending_

### F-05 — XSS via `innerHTML` interpolation of booking & pet fields

- **File(s):** `client/app.js:115-139`
- **Classification:** security
- **Severity:** critical
- **Verified:** static (seed already contains payload `<img src=x onerror="alert(1)">` in `pet_005.notes`)
- **What:** `container.innerHTML = bookings.map(b => \`…${b.notes}…${b.petId}…\`)` injects untrusted strings into HTML. Pet notes (rendered as part of booking cards once we link them) and any free-text from the server reaches the DOM unsanitised.
- **Why it matters:** Stored XSS in a multi-tenant admin dashboard. A tenant member with write access (or a malicious owner-supplied note field) can run JS in the session of any staff member who views the board.
- **Fix (Phase 2):** _pending_

### F-06 — Double-booking race — overlap check has TOCTOU window

- **File(s):** `server/src/services/booking-service.ts:73-110`
- **Classification:** data-integrity
- **Severity:** critical
- **Verified:** static
- **What:** Check-then-write: `existingBookings.some(...)` → `await new Promise(setTimeout(10))` → `store.createBooking(...)`. Two concurrent POSTs both pass the overlap check before either inserts, and both succeed.
- **Why it matters:** This is the "two sitters were assigned to the same pet at the same time" incident from the brief. The deliberate `setTimeout(10)` makes the window trivially exploitable in test.
- **Fix (Phase 2):** _pending_

### F-07 — Pagination off-by-one (`offset = page * limit`)

- **File(s):** `server/src/services/booking-service.ts:53`
- **Classification:** data-integrity, ux
- **Severity:** high
- **Verified:** static
- **What:** `const offset = page * limit;` combined with the client defaulting to `page: 1` (`client/app.js:18`) means page 1 silently returns items 5–9, skipping the first 5 records. The pagination UI's "page 1" is actually page 2 of the underlying data.
- **Why it matters:** Records appear and disappear from the dashboard depending on the page math, and the first booking in any sorted list is unreachable.
- **Fix (Phase 2):** _pending_

### F-08 — No request body validation on `POST /api/bookings` or `PATCH …/status`

- **File(s):** `server/src/routes/bookings.ts:56-97`
- **Classification:** data-integrity, api-design
- **Severity:** high
- **Verified:** static
- **What:** Bodies are cast to `as { petId; sitterId; … }` with no schema validation. Missing fields produce `undefined` IDs that still flow through `createBooking`. `PATCH …/status` accepts any string for `status`.
- **Why it matters:** Garbage records get persisted (rows with `petId: undefined`), and downstream filters silently exclude them. With Fastify schemas readily available, this is low-effort high-value.
- **Fix (Phase 2):** _pending_

### F-09 — Frontend fetch race: poll + filter change + refresh, last-response-wins

- **File(s):** `client/app.js:33-36, 52-65, 100`
- **Classification:** ux, data-integrity
- **Severity:** high
- **Verified:** static
- **What:** `setInterval` polls every 15s while filter changes also fire `fetchBookings`. No request id, no cancellation. A slow poll response that resolves after a fast filter response will overwrite the filtered list — this maps directly to the "filters seem to reset randomly" complaint in the brief.
- **Why it matters:** Most-recent intent must win; right now most-recent *response* wins. Combined with F-12/F-13, errors compound silently.
- **Fix (Phase 2):** _pending_

### F-10 — Overlap check broken for bookings that cross midnight

- **File(s):** `server/src/services/booking-service.ts:78-84`
- **Classification:** data-integrity
- **Severity:** high
- **Verified:** static (seed `booking_006` and `booking_011` have `startTime: '23:30'`, `endTime: '00:30'`)
- **What:** Overlap computes `new Date(\`${date}T${endTime}\`)` for an end time that is on the next day, producing `existingEnd < existingStart`. The `newStart < existingEnd && newEnd > existingStart` predicate then misbehaves.
- **Why it matters:** Overnight care is a real use case (already in the seed) and overlap checking silently fails for it.
- **Fix (Phase 2):** _pending_

### F-11 — Date filter uses `startsWith` on ISO string — wrong across timezones

- **File(s):** `server/src/services/booking-service.ts:39`
- **Classification:** data-integrity, ux
- **Severity:** high
- **Verified:** static (`booking_006` stored as `'2026-04-09T06:30:00Z'` but is 23:30 Pacific on 4/8)
- **What:** `b.scheduledDate.startsWith(date)` only matches the literal UTC date prefix. A booking written in UTC for "April 8 evening Pacific" appears under April 9 in the filter.
- **Why it matters:** Day-view of the dashboard mis-buckets evening bookings — the very ones a sitter most needs to see before their shift.
- **Fix (Phase 2):** _pending_

### F-12 — Wrong status codes — 404 returns 200, errors return 200

- **File(s):** `server/src/routes/bookings.ts:46, 79-82, 96`
- **Classification:** api-design
- **Severity:** medium
- **Verified:** static
- **What:** Not-found returns `code(200).send({ error: 'Booking not found' })`. Create-conflict returns `code(200).send({ success: false, error })`. Status update returns `code(200)` regardless of outcome.
- **Why it matters:** Breaks HTTP semantics — caches, monitoring, fetch error branches, and retry middleware all key off status codes. Couples API consumers to a custom envelope.
- **Fix (Phase 2):** _pending_

### F-13 — Frontend branches on `result.error`, ignores HTTP status entirely

- **File(s):** `client/app.js:87-106, 168-186, 292-310`
- **Classification:** api-design, ux
- **Severity:** medium
- **Verified:** static
- **What:** `const result = await response.json()` regardless of `response.ok`. 401/500/aborted responses with non-JSON bodies will throw silently or render misleading errors.
- **Why it matters:** Auth errors look like "no bookings"; server crashes look like a transient blip. Must align with the F-12 fix.
- **Fix (Phase 2):** _pending_

### F-14 — `X-User-Role` is trusted unvalidated; no role enforcement anywhere

- **File(s):** `server/src/middleware/auth.ts:21, 38-42`
- **Classification:** security, architecture
- **Severity:** medium
- **Verified:** static
- **What:** Role is read from header, cast unchecked to `'admin' | 'staff' | 'sitter'`, and never used to gate anything. The "admin tenant override" pattern hinted at in `bookings.ts:21` was never enforced.
- **Why it matters:** Even when we add `requireAdmin`-style checks later, the header is forgeable. For a header-auth stub this is fine as documented, but it must be replaced with claims from a verified token before any real deployment.
- **Fix (Phase 2):** _pending_

### F-15 — CORS `origin: true` allows any origin

- **File(s):** `server/src/index.ts:10-14`
- **Classification:** security
- **Severity:** medium
- **Verified:** static
- **What:** `origin: true` reflects the request origin → any browser tab on any site can call the API.
- **Why it matters:** Combined with header-auth (no cookies / `credentials: 'include'`), the practical attack surface is smaller, but a hostile site can still issue cross-origin requests if it knows or guesses identifiers. Should be locked to the dashboard origin(s).
- **Fix (Phase 2):** _pending_

### F-16 — `scheduledDate` timezone-inconsistent across seed and client

- **File(s):** `server/src/store/seed.ts:42,75,109,…`, `client/app.js:286`
- **Classification:** data-integrity, architecture
- **Severity:** medium
- **Verified:** static
- **What:** Seed mixes `'…-07:00'` offsets with bare `'Z'` UTC. Client computes `new Date(value).toISOString()` from an `<input type=date>` value, producing midnight-UTC, which is the previous evening in Pacific.
- **Why it matters:** Same root cause as F-11 — the data model treats a date+time-of-day as a single ISO instant while also storing `startTime`/`endTime` as wall-clock strings. The two never reconcile.
- **Fix (Phase 2):** _pending_

### F-17 — `statusChangedBy` taken from `X-User-Id` header without validation

- **File(s):** `server/src/middleware/auth.ts`, `server/src/services/booking-service.ts:150`
- **Classification:** security, observability
- **Severity:** medium
- **Verified:** static
- **What:** Audit fields record whatever string the client sent in `X-User-Id`. No check that the user belongs to the tenant, exists, or has any meaningful identity.
- **Why it matters:** The audit trail is the next thing anyone reaches for after an incident, and right now it is unreliable. Same caveat as F-14 — for a header-auth stub, document the limitation and gate it behind a real auth layer for prod.
- **Fix (Phase 2):** _pending_

### F-18 — Event bus has no error isolation

- **File(s):** `server/src/services/event-emitter.ts:12-17`
- **Classification:** architecture, observability
- **Severity:** low
- **Verified:** static
- **What:** A throwing handler aborts the `for` loop; subsequent handlers do not run.
- **Why it matters:** Coupling between unrelated subscribers. Easy to fix with `try/catch` per handler and a logger.
- **Fix (Phase 2):** _pending_

### F-19 — Inline `onclick` + `window.goToPage` global for pagination

- **File(s):** `client/app.js:202, 205, 208, 330`
- **Classification:** security, ux
- **Severity:** low
- **Verified:** static
- **What:** Pagination buttons use inline `onclick` attributes with a global function. Works today; brittle if anything in the interpolated context is ever attacker-controlled.
- **Why it matters:** Mostly hygiene, but it overlaps with the F-05 XSS surface — same template, same trust assumptions.
- **Fix (Phase 2):** _pending_

### F-20 — No rate limiting / no explicit body-size limits

- **File(s):** `server/src/index.ts`
- **Classification:** security
- **Severity:** low
- **Verified:** static
- **What:** No `@fastify/rate-limit`, no `bodyLimit` override. Defaults are sane (1 MB) but a production deployment should set explicit values per route.
- **Why it matters:** Pre-prod hardening. Not exploitable in any specific way given the rest of the surface.
- **Fix (Phase 2):** _pending_

### F-21 — No request logging enrichment with tenant/user/correlation id

- **File(s):** `server/src/index.ts:7`, `server/src/middleware/auth.ts`
- **Classification:** observability
- **Severity:** low
- **Verified:** static
- **What:** Fastify default logger is on, but logs are not tagged with `tenantId`, `userId`, or a request id correlating across services.
- **Why it matters:** Debugging the next "customer X saw customer Y's bookings" complaint becomes log-archaeology without these.
- **Fix (Phase 2):** _pending_

### F-23 — Bad input (F-08) crashes list endpoint with HTTP 500 when `date` filter applied

- **File(s):** `server/src/services/booking-service.ts:39`, root cause `routes/bookings.ts:56-83` (no validation)
- **Classification:** data-integrity, availability
- **Severity:** high
- **Verified:** runtime — `POST /api/bookings` with `{}` body succeeded; subsequent `GET /api/bookings?date=2026-04-08` returned `500 "Cannot read properties of undefined (reading 'startsWith')"`.
- **What:** Because there is no schema (F-08), a single bad POST persists a booking with `scheduledDate: undefined`. The list endpoint's `startsWith` then throws, taking the date-filter feature down for every user of that tenant — including users who never made a bad request.
- **Why it matters:** Escalates F-08 from "garbage data" to "API outage." A misbehaving client (or an attacker) can DoS the day-view for everyone. This is the kind of cross-customer blast radius the audit was set up to surface.
- **Fix (Phase 2):** _pending_ — handled by F-08's schema fix at the boundary; defensive guard in the service is also worth adding.

### F-22 — Three known CVEs in pinned dependencies

- **File(s):** `server/package.json`, `server/package-lock.json`
- **Classification:** security
- **Severity:** medium
- **Verified:** static (output of `npm audit`)
- **What:**
  - `fastify@5.8.4` was in the `5.3.2 – 5.8.4` range with a body-schema validation bypass (GHSA-247c-9743-5963).
  - `fast-uri@3.1.0` (transitive via fastify's ajv compiler and fast-json-stringify) ≤3.1.1 has path-traversal + host-confusion CVEs (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc).
  - `uuid@11.1.0` <11.1.1 has a missing buffer-bounds check in v3/v5/v6 (GHSA-w5hq-g745-h8pq).
- **Why it matters:** Audit hygiene. None were exploitable end-to-end in this codebase as-is (we don't use uuid v3/v5/v6, we don't yet rely on body schema validation, and `fast-uri` is internal to fastify routing) — but they would have made any future schema-based input validation (F-08) sit on top of a still-vulnerable fastify. Resolving F-22 first removes that dependency.
- **Fix (Phase 2):** Pinned `fastify` to `5.8.5` and `uuid` to `11.1.1` (exact, no caret). Added an `overrides` block in `server/package.json` to pin transitive `fast-uri` to `3.1.2`. `npm audit` now reports `found 0 vulnerabilities`, `npm run typecheck` passes, and post-restart smoke tests on `/health`, `/api/bookings` (list + single), `/api/pets`, and `/api/sitters` all returned `200`. Pre-Phase-2 sanity preserved: store seeds to 10 Portland bookings as before. ✅

  **Decision rationale (not-currently-exploitable ≠ not-worth-fixing):** Two of the three CVEs (fast-uri host confusion, uuid bounds check) aren't reachable from this codebase today, and the fastify body-schema bypass only becomes live once we add schemas in Step 8. The conservative call would be to defer. I chose to upgrade and verify *now* anyway, because:
  - The window between a CVE being published and being weaponised has compressed sharply over the past few years. "Not exploitable from our code today" is a property of *this* code at *this* moment; a refactor next sprint can flip that without anyone noticing.
  - Upgrading and reverifying *while the change is small and the affected code is in active context* is dramatically cheaper than discovering, upgrading, and reverifying *after* an incident or under time pressure.
  - The cost was concretely small here: three version pins, a one-line `overrides` block, a typecheck, and five smoke probes — under five minutes. That is well below the bar for "speculative work."
  - Resolving F-22 before Step 8 means the schema-validation hardening (F-08) lands on a non-vulnerable fastify, so we don't briefly create a state where the *new* security feature is itself bypassable.

  Bias: when the upgrade is patch-version-only, the regression surface is small, and the audit context is fresh, default to upgrading. Reserve "defer" for when a fix forces a major-version bump with real breaking changes.

---

## API Design
<!-- Status codes, validation, error envelope, idempotency. How this API should evolve for production. -->

## Architecture Observations

### Tenancy model — what was present, where it failed, and what good looks like

Tenancy was the single biggest concern I came into this audit with, and the codebase confirmed why: there is a clear tenancy *intent* but its enforcement is inconsistent. Documenting the picture explicitly because (a) it answers "how is tenancy handled and what could leak?" in one place, and (b) Phase 3's role-based admin override and audit-trail work both build on top of it.

**The intended model (as I read the code):**

```
client request
  │  X-Tenant-Id, X-User-Id, X-User-Role headers
  ▼
authMiddleware  (server/src/middleware/auth.ts)
  │  validates the tenantId exists in the store
  │  stamps request.auth = { tenantId, userId, role }
  ▼
route handler   (server/src/routes/*.ts)
  │  is supposed to scope every read & write to auth.tenantId
  ▼
service layer   (server/src/services/booking-service.ts)
  │  business logic — assumes the route did the scoping
  ▼
store           (server/src/store/memory-store.ts)
   tenant-scoped helpers exist (getBookingsByTenant, getPetsByTenant)
   AND tenant-blind helpers exist (getBooking, getAllBookings) — these are where leaks happen
```

**The intended contract:** the *route handler* is the tenancy boundary. The store offers both scoped and unscoped accessors; the route picks the right one and is responsible for cross-checking when it can't.

**Where it was actually enforced before my fixes:**

| Endpoint | Tenancy enforced? | Why / how |
|---|---|---|
| `GET /api/pets` | ✅ | Uses `getPetsByTenant(auth.tenantId)`. |
| `GET /api/pets/:id` | ✅ | Calls `getPet(id)` then explicit `pet.tenantId !== auth.tenantId → 404`. The *correct* pattern. |
| `GET /api/sitters` | ✅ | Uses `getSittersByTenant(auth.tenantId)`. |
| `GET /api/bookings` | ❌ | Honored `?tenantId=` query override before falling back to auth (F-01). |
| `GET /api/bookings/:id` | ❌ | No check at all — returned any booking by ID (F-02). |
| `POST /api/bookings` | ⚠️ Partial | Stamped `tenantId: auth.tenantId` on the new row, but never checked that `petId`/`sitterId` belonged to that tenant (F-04). Also no tenant scope on the overlap check (`getAllBookings()`), which is correct *for* the overlap check but bypasses the boundary contract. |
| `PATCH /api/bookings/:id/status` | ❌ | No check at all (F-03). Worse, `statusChangedBy` came from `X-User-Id` without verification — corrupting another tenant's audit trail was a single curl away. |

**The pattern was understood, just not applied uniformly.** `pets.ts:30` shows the engineer who wrote pets knew exactly how to do this; bookings was written without the same care.

**Leakage classes I confirmed at runtime in Phase 1b:**

1. **Cross-tenant read (list).** `GET /api/bookings?tenantId=tenant_seattle` from a Portland session returned 5 Seattle bookings. → F-01.
2. **Cross-tenant read (single).** `GET /api/bookings/booking_007` from a Portland session returned the Seattle booking in full. → F-02.
3. **Cross-tenant write (audit poisoning).** `PATCH /api/bookings/booking_008/status` from a Portland session with `X-User-Id: hacker_user` set Seattle's booking to `cancelled` and recorded "hacker_user" as the actor. → F-03 + F-17.
4. **Cross-tenant create (data poisoning).** Portland session created a Portland booking referencing `sitter_003` (Seattle). This is the most insidious: subsequent list queries return the corrupt record under Portland forever. → F-04.

**Defense-in-depth gaps that aren't strictly tenancy but compound it:**

- **F-05 (XSS).** With cross-tenant data already reaching the dashboard via F-01/F-02, a stored XSS payload in *any* tenant could exfiltrate session data from *every* tenant's staff that views the dashboard.
- **F-14 (role header trusted).** The role header was supposed to gate an "admin cross-tenant view" (the `?tenantId=` override looked designed for that). Header-trust makes that gate forgeable.
- **F-17 (X-User-Id trusted).** The audit trail records whatever the client claims. Even *within* a tenant, you can't trust who did what.

**Target state after the F-01, F-02, F-03 fixes land:**

The route layer becomes the consistent boundary for the booking endpoints. F-04 will close the create-side gap. After all four ship, every endpoint either reads via `…ByTenant(auth.tenantId)` or does a `resource.tenantId !== auth.tenantId → 404` check at the route — never both, never neither.

**What still leaks (deferred):**

- F-14 — `role` is still header-trusted; "admin cross-tenant view" cannot be safely reintroduced until role comes from a verified token.
- F-17 — `statusChangedBy` is still header-trusted.

**What good looks like for production:**

- Auth middleware validates a signed token (JWT or session) and **derives** tenantId, userId, role from claims — headers become an integration-test-only override behind an explicit dev flag.
- A `TenantScope` helper that wraps store access and refuses to return a row whose `tenantId` doesn't match — making the boundary impossible to forget rather than relying on convention.
- Tenancy is asserted at the test layer too: every endpoint has a "X reads Y's data → 404" test as a permanent guard against the regression we just lived through.
- **Postgres RLS as the floor under the application layer.** When the in-memory store is replaced with a relational DB, every tenant-scoped table (`bookings`, `pets`, `sitters`, future audit tables) gets a row-level-security policy keyed on a `current_setting('app.tenant_id')` or `auth.uid()`-style claim. The application sets the tenant context on every connection check-out (e.g. `SET LOCAL app.tenant_id = $1` per request), and policies refuse to return — or write — rows from a different tenant. This means a forgotten `WHERE tenant_id = ?` clause in *application* code can no longer cause a leak: the database itself rejects the query. RLS is **defense-in-depth, not a replacement** for the application-layer checks above — it catches the inevitable human error in the WHERE-clause, and it also protects against ORM-generated queries that bypass our `TenantScope` helper. Pair it with separate DB roles for the app vs. admin/maintenance access so that even raw-SQL access from the application role is bound by the same policies.

These together are the F-17/F-14 + improvement work I'd propose in Phase 3 if the budget allows; otherwise they go in the proposals section.

### Other architecture observations
<!-- Layering, coupling, where business logic lives, audit trail / event story. -->

## Frontend Approach
<!-- State management, error handling, what framework / pattern is appropriate at next stage. -->

## Improvement Implemented
<!-- What I built in Phase 3, why this one, what it costs/buys. -->

## Improvements Proposed
<!-- Two further proposals. Each: what · why · estimated effort · trade-offs. -->

## AI Usage
<!-- Tools used, what I validated or changed, what I deliberately did not delegate to AI. -->
