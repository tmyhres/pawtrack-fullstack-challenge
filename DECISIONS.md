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
| Phase 2 (fixes) | ~40 min | ~40 min | **Complete.** 13 commits closing 16 findings: F-22 (deps), F-01..F-07, F-08+F-23, F-09, F-10, F-11, F-12+F-13, F-15. All 3 brief incidents closed. Deferred to Phase 3 proposals: F-14, F-16, F-17, F-18, F-19, F-20, F-21, F-24. |
| Phase 3 (improve + propose) | ~25 min | in progress | Implementing: vitest + Fastify-inject regression suite. Proposing: F-24 (idempotency), F-14+F-17 (verified-token auth), RLS + tenant-scoped DB roles. |

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

1. **F-22 (deps, classified medium) was pulled forward to run before any other fix.** Two reasons. First, the *time-to-weaponization* of a published CVE has compressed enough a that "currently not exploitable from our code" is a snapshot, not a property — treating CVE patches as low-priority until they bite is exactly the discipline that produces incidents. Second, the fastify body-schema-bypass advisory becomes *load-bearing* the moment we add schema validation in Step 8 (F-08), so F-22 is a precondition for F-08 shipping safely. Detail in the F-22 Fix block below.
2. **Within the critical severity tier, ordering is "brief-incident-first."** The README names three production incidents (cross-tenant read, double-booking, filters resetting). All critical findings get fixed, but ones that map to those named incidents go first — both because they're the most-visible wins against the rubric and because the company has already felt the pain.

**After F-22, every subsequent fix is in strict severity order**, with the intra-tier sorting above. No medium- or low-severity finding is fixed before a critical or high. If we run short on the 40-minute Phase 2 budget, the cut line is always at the bottom of the priority list — mediums get deferred to proposals, not skipped over.

### Index

| ID | Title | Classification | Severity | Verified | Fixed |
|---|---|---|---|---|---|
| F-01 | Tenant override via `?tenantId=` query param | tenancy, security | critical | both | ☑ |
| F-02 | `GET /api/bookings/:id` performs no tenant check | tenancy | critical | both | ☑ |
| F-03 | `PATCH /api/bookings/:id/status` performs no tenant check | tenancy, data-integrity | critical | both | ☑ |
| F-04 | `POST /api/bookings` does not verify pet/sitter belong to caller's tenant | tenancy, data-integrity | critical | both | ☑ |
| F-05 | XSS via `innerHTML` interpolation of booking & pet fields | security | critical | both | ☑ |
| F-06 | Double-booking race — overlap check has TOCTOU window | data-integrity | critical | both | ☑ |
| F-07 | Pagination off-by-one (`offset = page * limit`) drops first page | data-integrity, ux | high | both | ☑ |
| F-08 | No request body validation on `POST /api/bookings` or `PATCH …/status` | data-integrity, api-design | high | both | ☑ |
| F-09 | Frontend fetch race: poll + filter change + refresh, last-response-wins | ux, data-integrity | high | both | ☑ |
| F-10 | Overlap check broken for bookings that cross midnight | data-integrity | high | both | ☑ |
| F-11 | Date filter uses `startsWith` on ISO string — wrong across timezones | data-integrity, ux | high | both | ☑ |
| F-12 | Wrong status codes — 404 returns 200, errors return 200 | api-design | medium | both | ☑ |
| F-13 | Frontend branches on `result.error`, ignores HTTP status entirely | api-design, ux | medium | static | ☑ |
| F-14 | `X-User-Role` is trusted unvalidated; no role enforcement anywhere | security, architecture | medium | static | ☐ |
| F-15 | CORS `origin: true` allows any origin | security | medium | both | ☑ |
| F-16 | `scheduledDate` timezone-inconsistent (seed mixes UTC + offset; client uses local→UTC) | data-integrity, architecture | medium | static | ☐ |
| F-17 | `statusChangedBy` taken from `X-User-Id` header without validation — audit trail is forgeable | security, observability | medium | both | ☐ |
| F-18 | Event bus has no error isolation — a throwing handler kills the loop | architecture, observability | low | static | ☐ |
| F-19 | Inline `onclick` + `window.goToPage` global for pagination | security, ux | low | static | ☐ |
| F-20 | No rate limiting / no explicit body-size limits | security | low | static | ☐ |
| F-21 | No request logging enrichment with tenant/user/correlation id | observability | low | static | ☐ |
| F-22 | Three known CVEs in pinned deps (fastify, fast-uri, uuid); `npm audit` reports fixes available | security | medium | static | ☑ |
| F-23 | Bad input (F-08) crashes list endpoint with HTTP 500 when `date` filter applied | data-integrity, availability | high | runtime | ☑ |
| F-24 | No idempotency on `POST /api/bookings` — client retry / double-click creates duplicate bookings | data-integrity, api-design | medium | static | deferred (Phase 3 proposal) |

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
- **Fix (Phase 2):** Handler now reads `auth.tenantId` and returns **404 (not 403)** when the booking either doesn't exist *or* belongs to another tenant. Returning 404 in both cases avoids leaking existence — an attacker can't distinguish "this ID doesn't exist" from "this ID exists but isn't mine," which would otherwise let them enumerate cross-tenant IDs by status code alone. Also fixes the F-12 side issue for this endpoint (previously returned 200 + `{error: …}` on not-found). Verified: Portland → Seattle booking returns `404`, Seattle → Seattle booking returns `200`. ✅

### F-03 — `PATCH /api/bookings/:id/status` performs no tenant check

- **File(s):** `server/src/routes/bookings.ts:89-97`, `server/src/services/booking-service.ts:125-164`
- **Classification:** tenancy, data-integrity
- **Severity:** critical
- **Verified:** both
- **What:** Status transitions on any booking by ID, regardless of caller's tenant. The audit fields (`statusChangedBy`) are set from caller's user id even though they belong to a different tenant.
- **Why it matters:** Lets one tenant cancel or progress another tenant's bookings. Corrupts the audit trail across tenants.
- **Fix (Phase 2):** Same pattern as F-02: handler resolves the booking, returns 404 if it doesn't exist OR doesn't match `auth.tenantId`, only then proceeds to the service's status transition. Kept the existence check at the route layer rather than pushing into the service so the tenancy contract stays visible at the API boundary. The service-level "audit forging" issue (`statusChangedBy` from header) is **not** addressed here — that's F-17, deferred. Verified: Portland → Seattle cancel returns 404; Seattle → Seattle transition still works. ✅

### F-04 — `POST /api/bookings` does not verify pet/sitter belong to caller's tenant

- **File(s):** `server/src/routes/bookings.ts:56-83`, `server/src/services/booking-service.ts:69-120`
- **Classification:** tenancy, data-integrity
- **Severity:** critical
- **Verified:** both
- **What:** The created booking gets `tenantId: auth.tenantId`, but the supplied `petId` and `sitterId` are never checked against that tenant. A Portland staff user can create a booking under Portland that references a Seattle sitter or pet.
- **Why it matters:** Mixed-tenant booking records corrupt every downstream filter, list, and report. It also opens a path to scheduling a foreign tenant's sitter (denial-of-service on their availability).
- **Fix (Phase 2):** Route handler now resolves `petId` and `sitterId` against the store and returns **404 (not 403)** if either is missing OR belongs to another tenant. Same status-code reasoning as F-02/F-03: unknown and foreign return the same code so cross-tenant IDs can't be enumerated via probe responses.

  **Where the check lives:** in the route handler, consistent with the boundary pattern established in F-01/F-02/F-03. The service stays trust-only for the tenancy contract — every entry point that calls `bookingService.createBooking` is responsible for upstream validation. Today there's only one entry point, so this is sufficient. If we add a CLI / batch import / admin path later, each would need the same check (or we move it into the service — a small refactor).

  **Why both the pet and the sitter (not just the sitter):** the overlap check in F-06 is keyed on `sitterId`, so a foreign sitter could trivially be used to *block* a competitor's calendar (DoS via reserved time slots). The pet check is for record-integrity — a booking that mixes tenants in its references quietly corrupts every downstream filter.

  **Verified:**
  - Portland → Seattle `sitter_003`: HTTP 404 `{"error":"Sitter not found"}`
  - Portland → Seattle `pet_006`: HTTP 404 `{"error":"Pet not found"}`
  - Portland → Portland refs: HTTP 200 `{"success":true,...}` (sanity)
  - Portland → unknown `pet_nonexistent`: HTTP 404 `{"error":"Pet not found"}` (same response as foreign — existence not leaked) ✅

### F-05 — XSS via `innerHTML` interpolation of booking & pet fields

- **File(s):** `client/app.js:115-139`
- **Classification:** security
- **Severity:** critical
- **Verified:** both — Phase 1b proof was `document.title === 'XSS_FIRED'` from a stored payload
- **What:** `container.innerHTML = bookings.map(b => \`…${b.notes}…${b.petId}…\`)` injects untrusted strings into HTML. Pet notes (rendered as part of booking cards once we link them) and any free-text from the server reaches the DOM unsanitised.
- **Why it matters:** Stored XSS in a multi-tenant admin dashboard. A tenant member with write access (or a malicious owner-supplied note field) can run JS in the session of any staff member who views the board.
- **Fix (Phase 2):** Rewrote `renderBookings` to construct each card with explicit DOM nodes (`document.createElement` + `textContent`) instead of an `innerHTML = bookings.map(...).join('')` template literal. Every untrusted field (`booking.notes`, `booking.petId`, `booking.sitterId`, time strings, status) is set via `textContent`, which assigns the value as literal text — `<img onerror=...>` becomes the visible string `<img onerror=...>`, not an `<img>` element.

  **Wiring change as a bonus:** the status-transition buttons no longer pass the booking id and target status through `data-*` attributes that have to be reparsed by a `querySelectorAll(...)` after the fact. Each button is wired up at construction time via closure capture — `btn.addEventListener('click', () => transitionStatus(booking.id, status))`. Smaller surface area, no escape concerns, no string round-trip.

  **Trade-off:** the seed's `booking_005` note contains a literal `<b>Owner traveling until 4/15</b>` that *was* rendering as bold under the broken implementation. After the fix it appears as the literal string `<b>Owner traveling…`. That's a deliberate UX regression — the fix is to render markdown safely (or define an allow-listed inline-tag policy) if formatted notes are a real product requirement. Captured as a candidate for the Phase 3 improvements list, not done here.

  **Out of scope today:** `renderPagination` still uses `innerHTML` with inline `onclick` handlers (F-19, low severity). The values it interpolates are server-side numbers (`page`, `totalPages`), not user-content, so no XSS vector — but it's still poor practice and noted for the sweep. Did not touch it in this commit to keep the diff focused.

  **Verified:** the same Playwright probe that flipped `document.title` to `XSS_FIRED` in Phase 1b now reports `xssFired: false`, `document.title` unchanged, no `<img>` element constructed in the booking-notes DOM, and the payload string appears as literal text in `textContent`. ✅

### F-06 — Double-booking race — overlap check has TOCTOU window

- **File(s):** `server/src/services/booking-service.ts:73-110`, `server/src/store/memory-store.ts`
- **Classification:** data-integrity
- **Severity:** critical
- **Verified:** both — Phase 1b proof was 5 concurrent POSTs → 5 duplicate bookings
- **What:** Check-then-write: `existingBookings.some(...)` → `await new Promise(setTimeout(10))` → `store.createBooking(...)`. Two concurrent POSTs both pass the overlap check before either inserts, and both succeed.
- **Why it matters:** This is the "two sitters were assigned to the same pet at the same time" incident from the brief. The deliberate `setTimeout(10)` makes the window trivially exploitable in test.
- **Fix (Phase 2):** Moved the atomicity contract from the service into the store. Added `MemoryStore.tryCreateBookingForSitter(booking)`, which iterates existing bookings synchronously and either persists the candidate or returns `{ conflict: { existingBookingId } }`. `BookingService.createBooking` is no longer `async` and no longer contains the artificial `await setTimeout(10)` — it just calls the store helper.

  **Why structure it this way:** the minimum fix would have been to delete the `await setTimeout(10)`. That fixes the bug *today* but the moment someone later refactors `createBooking` to do a legitimate `await` (e.g. when swapping the in-memory store for a real DB), the TOCTOU window comes back silently. Pushing atomicity into the store expresses the invariant ("no two non-cancelled bookings overlap for the same sitter") at the layer that owns the data, with an inline comment in the store method warning against introducing `await` in the critical section. Future refactors of the service can't break this layer.

  **What this is not:** the helper guarantees *atomicity for a single Node process and an in-memory store*. The moment we move to a real relational DB the right primitive changes — Postgres `EXCLUDE` constraint with a `tstzrange`, or a serializable transaction wrapping a `SELECT FOR UPDATE` on a `sitter_schedule` row. Noted as future work in proposals.

  **Verified:** the same 5-concurrent-POSTs probe that produced 5 duplicates in Phase 1b now produces **1 success + 4 conflict rejections**, exactly one booking persisted. Typecheck clean. ✅

  **Related deferred concern (F-24):** F-06 fixes server-side concurrency only. A client that retries (network blip, double-click) can still create a duplicate booking by re-sending the same POST. See F-24 and the Phase 3 idempotency proposal.

### F-24 — No idempotency on `POST /api/bookings`

- **File(s):** `server/src/routes/bookings.ts`, `server/src/services/booking-service.ts`
- **Classification:** data-integrity, api-design
- **Severity:** medium
- **Verified:** static (logically follows from F-06's fix — same client behavior, different mechanism)
- **What:** With F-06 fixed, server-side concurrency can't duplicate a booking. But if the client *re-sends* a POST that already succeeded (network blip swallowed the response, user double-clicked the "Create Booking" button, mobile app replays a queued request after reconnect), the server has no way to recognise the second request as a replay of the first — it just creates another booking.
- **Why it matters:** This is the next double-booking incident waiting to happen, and unlike F-06 it doesn't require concurrency — single-threaded clients hit it routinely. It's not in the README's incident list, but it's table stakes for a real booking API.
- **Fix:** **Not** fixed in Phase 2 — documented here so it's visible, then designed in full in the Phase 3 "Improvements Proposed" section. Brief sketch:
  - Client sends `Idempotency-Key: <uuid>` header on `POST /api/bookings`.
  - Server keeps `(tenantId, idempotencyKey) → bookingId` with a TTL (24h).
  - Replay with same key → return the original booking (200), not a new row.
  - Same key + different payload → 409 Conflict (catches "I retried but tweaked the body").

### F-07 — Pagination off-by-one (`offset = page * limit`)

- **File(s):** `server/src/services/booking-service.ts:53`
- **Classification:** data-integrity, ux
- **Severity:** high
- **Verified:** both
- **What:** `const offset = page * limit;` combined with the client defaulting to `page: 1` (`client/app.js:18`) means page 1 silently returns items 5–9, skipping the first 5 records. The pagination UI's "page 1" is actually page 2 of the underlying data.
- **Why it matters:** Records appear and disappear from the dashboard depending on the page math, and the first booking in any sorted list is unreachable.
- **Fix (Phase 2):** Changed `offset = page * limit` to `offset = (safePage - 1) * limit` where `safePage = Math.max(1, page)`. The API contract is now explicitly 1-indexed, matching the client default and matching the pagination UI labels. Also echo back the *clamped* page in the response (so a caller passing `page=0` sees `page: 1` in the response, not a misleading `page: 0`).

  **Why a clamp rather than a 400:** F-08 will add proper schema validation that rejects `page < 1` at the boundary. Until then, the clamp prevents `slice(-N, …)` from quietly returning the wrong window when a buggy caller sends `page=0`. Mentioning here so the clamp can be removed when F-08 lands — the schema becomes the single source of truth.

  **Verified:**
  - `page=1 limit=5` → items 0-4, page 1 of 2, ids start with `booking_005` (newest in seed)
  - `page=2 limit=5` → items 5-9, no overlap with page 1
  - `page=3 limit=5` → empty (past last page, correct)
  - `page=0 limit=5` → server returns `page: 1` (clamped) and the newest 5 records
  - No booking id appears on both `page=1` and `page=2` (confirms fenceposts) ✅

  **Suggested regression test (Phase 3 suite):** for a seeded tenant with N > limit bookings, assert `page=1` includes the chronologically newest record, `page=2` excludes it, and no record overlaps between adjacent pages.

### F-08 — No request body validation on `POST /api/bookings` or `PATCH …/status`

- **File(s):** `server/src/routes/bookings.ts:56-97`
- **Classification:** data-integrity, api-design
- **Severity:** high
- **Verified:** both
- **What:** Bodies are cast to `as { petId; sitterId; … }` with no schema validation. Missing fields produce `undefined` IDs that still flow through `createBooking`. `PATCH …/status` accepts any string for `status`.
- **Why it matters:** Garbage records get persisted (rows with `petId: undefined`), and downstream filters silently exclude them. With Fastify schemas readily available, this is low-effort high-value.
- **Fix (Phase 2):** Added Fastify JSON schemas on all three booking endpoints:
  - `POST /api/bookings` body: requires `petId`, `sitterId`, `scheduledDate` (format `date-time`), `startTime` and `endTime` (regex `^([01]\d|2[0-3]):[0-5]\d$`), and bounds `notes` to ≤2000 chars.
  - `PATCH /api/bookings/:id/status` body: requires `status` from the enum `requested|confirmed|in_progress|completed|cancelled`.
  - `GET /api/bookings` querystring: `page ≥ 1`, `1 ≤ limit ≤ 100`, optional `date` (format `date`), optional `status` (same enum). Defaults of `page=1, limit=10` declared in the schema and applied by AJV's `useDefaults`.

  **Rides on F-22's upgrade:** the fastify body-schema validation bypass (GHSA-247c-9743-5963) is what made F-22 a precondition for this fix. With fastify pinned to 5.8.5, the schemas above are not bypassable via a `Content-Type: application/json` whitespace trick.

  **Fastify default `additionalProperties` behavior:** Fastify's default AJV config sets `removeAdditional: 'all'`, so unknown properties are *stripped* silently rather than rejected with 400 — even when the schema declares `additionalProperties: false`. Probe #4 (sending `{"sneaky":"x", …}`) confirmed: request succeeded but the unknown field is dropped before reaching the handler. Data-integrity guarantee holds (unknown fields can't poison the store), strictness does not. For an admin API where the schema and client are owned by the same team, the default behavior is acceptable; if we wanted strict rejection we'd override the Fastify AJV factory to set `removeAdditional: false`. Documented here rather than fixed; flagging as a candidate hardening if security-strict is ever a requirement.

  **F-07 clamp removed:** the defensive `Math.max(1, page)` in `listBookings` is gone — the querystring schema rejects `page < 1` at the boundary, so the clamp is dead code and was masking the underlying contract. The service comment now points at F-08 as the source of truth.

  **Verified (full probe matrix):**
  - POST `{}` → **400** `body must have required property 'petId'`
  - POST with `startTime: "25:99"` → **400** pattern violation
  - POST with `scheduledDate: "not-a-date"` → **400** format violation
  - PATCH with `status: "gibberish"` → **400** enum violation
  - GET with `page=0` → **400** `must be >= 1`
  - GET with `limit=999` → **400** `must be <= 100`
  - Valid POST still succeeds (sanity)
  - Valid GET with `date=2026-04-08` returns 200 (used to 500 — see F-23) ✅

  **Suggested regression test (Phase 3 suite):** for each endpoint, send one example invalid body per validation rule and assert HTTP 400 with a meaningful message string. Useful contract documentation as a side effect.

### F-09 — Frontend fetch race: poll + filter change + refresh, last-response-wins

- **File(s):** `client/app.js:33-36, 52-65, 100`
- **Classification:** ux, data-integrity
- **Severity:** high
- **Verified:** both
- **What:** `setInterval` polls every 15s while filter changes also fire `fetchBookings`. No request id, no cancellation. A slow poll response that resolves after a fast filter response will overwrite the filtered list — this maps directly to the "filters seem to reset randomly" complaint in the brief.
- **Why it matters:** Most-recent intent must win; right now most-recent *response* wins. Combined with F-12/F-13, errors compound silently.
- **Fix (Phase 2):** Added a module-scope monotonic `currentFetchId`. Each `fetchBookings` call captures `++currentFetchId` at the top into a local `fetchId`. After the response (or error) arrives, the function checks `fetchId !== currentFetchId` — if a newer request has been issued in the meantime, the stale response is discarded before touching the DOM.

  **Why a token, not `AbortController`:** AbortController would also stop the network transfer, which is strictly better when response bodies are large. Here responses are small JSON, the network cost is negligible, and the token is ~5 lines vs ~15 for full AbortController plumbing. If responses grow (e.g. a future export endpoint) switching to AbortController is a one-pass refactor — the pattern stays the same, only the cancel mechanism changes.

  **Why not just skip the poll while a fetch is in flight:** that would still allow the user's *own* rapid actions (filter change → refresh → filter change again) to race against each other. The token approach handles every interleaving, including all-user-initiated ones.

  **Verified at runtime:** Playwright test monkey-patches `window.fetch` so the first `/api/bookings` call gets an artificial 600ms delay, then fires two `fetchBookings` calls back-to-back — first with no filter, second with `status=confirmed`. With the fix: rendered list is exactly the 2 Portland confirmed bookings (#001 + #006), no stale "all bookings" overwrite. Without the fix this exact probe reproduced the "filter reset" bug.

  **Suggested regression test (Phase 3 suite):** mock `fetch` to delay the first call, fire two `fetchBookings` calls with different filters, assert the rendered DOM matches the second filter's expected result set. ✅

### F-10 — Overlap check broken for bookings that cross midnight

- **File(s):** `server/src/store/memory-store.ts` (the fix landed here, where the overlap check now lives after F-06 moved it)
- **Classification:** data-integrity
- **Severity:** high
- **Verified:** both
- **What:** Overlap computes `new Date(\`${date}T${endTime}\`)` for an end time that is on the next day, producing `existingEnd < existingStart`. The `newStart < existingEnd && newEnd > existingStart` predicate then misbehaves.
- **Why it matters:** Overnight care is a real use case (already in the seed — `booking_006` and `booking_011`) and overlap checking silently fails for it.
- **Fix (Phase 2):** Extracted a `bookingInterval(b)` helper inside the store module that builds `{ start, end }` from `scheduledDate + startTime + endTime`. When `endTime < startTime` (lex comparison — safe because both fields are validated to strict `HH:MM` format by the F-08 schema), the end Date is rolled into the next day with `+ ONE_DAY_MS`. The atomic create method (`tryCreateBookingForSitter`) now uses this helper for *both* the candidate and each existing booking. Same-day bookings produce the same intervals as before (`endTime ≥ startTime` skips the +24h branch), so this is purely additive.

  **Why a helper at the store level and not in the service:** the helper expresses the booking-interval-as-instants invariant where the overlap check lives. F-06 already pushed atomicity into the store; F-10 extends that by making the time-interval computation a shared, named function instead of a copy-pasted snippet. Future tests can import and assert against `bookingInterval` directly.

  **Out of scope here (covered by F-11/F-16):** the helper uses `new Date('YYYY-MM-DDTHH:MM')` which interprets the time in the *Node process's local* timezone — not the *tenant's* timezone. So a booking that "feels like" 23:30 Pacific stored with a UTC scheduledDate will produce intervals in the process timezone, not the tenant's. The F-10 fix is correct *relative to itself* (two bookings with the same convention overlap consistently), but the absolute wall-clock placement is the F-11/F-16 problem. Noting here so it doesn't read as a regression.

  **Verified:**
  - Phase 1b probe (identical overnight slot, same sitter) → now rejected with "Sitter has an overlapping booking for this time slot" ✓ (used to silently succeed)
  - Adjacent overnight slot (next-day 00:00–01:30 against an existing 23:30→00:30) → also rejected, confirming the rolled-over end correctly extends into the next day ✓
  - Different sitter, same overnight slot → still accepted ✓
  - Same sitter, unrelated daytime slot → still accepted (sanity) ✓

  **Suggested regression test (Phase 3 suite):** a focused test of `bookingInterval` for three cases (same-day, midnight-boundary, overnight roll-over), plus an integration test asserting that two identical overnight POSTs to the same sitter produce 1 success + 1 conflict (mirrors F-06's regression test).

### F-11 — Date filter uses `startsWith` on ISO string — wrong across timezones

- **File(s):** `server/src/services/booking-service.ts:39`
- **Classification:** data-integrity, ux
- **Severity:** high
- **Verified:** both
- **What:** `b.scheduledDate.startsWith(date)` only matches the literal UTC date prefix. A booking written in UTC for "April 8 evening Pacific" appears under April 9 in the filter.
- **Why it matters:** Day-view of the dashboard mis-buckets evening bookings — the very ones a sitter most needs to see before their shift.
- **Fix (Phase 2):** `listBookings` now reads the tenant's IANA timezone (already in the seed: `America/Los_Angeles` for Portland/Seattle, `America/Chicago` for Austin), parses each booking's `scheduledDate` to an absolute instant, and uses `Intl.DateTimeFormat` with that timezone to extract the local YYYY-MM-DD. The filter compares that string to the validated `date` query param.

  **`formatToParts` not `format()`:** the helper uses `Intl.DateTimeFormat('en-US', { timeZone, year, month, day }).formatToParts(instant)` and assembles `${year}-${month}-${day}` explicitly. This avoids depending on a locale's default date layout (`en-US` would otherwise format MM/DD/YYYY) and is robust across ICU versions.

  **Fallback to UTC:** if a tenant somehow has no `timezone` field, the filter falls back to `'UTC'` rather than throwing. Better to bucket-by-UTC than crash a list endpoint that serves other tenants in the same process.

  **Belt-and-braces:** the `typeof` and `Number.isNaN(instant.getTime())` checks protect against malformed `scheduledDate` rows arriving via a future ingestion path (same defensive posture as F-23).

  **Acknowledged remaining limitation (F-16):** the seed itself stores `scheduledDate` in two different conventions — `…-07:00` offset for most rows and `Z` UTC for the late-night ones. The fix produces correct local dates regardless, but the underlying data model (a single instant plus a separate wall-clock `startTime/endTime`) is still inconsistent and will be the subject of F-16 if/when we touch the schema.

  **Verified:**
  - Portland `date=2026-04-08` → now includes `booking_006` (a 23:30 PT booking previously misfiled under 4/9) plus `booking_003`
  - Portland `date=2026-04-09` → no longer includes `booking_006`
  - Portland `date=2026-04-10` → still includes `booking_001` (offset-stored, no change)
  - Seattle `date=2026-04-10` → now includes `booking_011` (the late-night overnight booking, previously misfiled under 4/11)
  - Austin `date=2026-04-10` → returns `booking_012` (Chicago TZ, sanity) ✅

  **Suggested regression test (Phase 3 suite):** for each tenant timezone in the seed, assert that a UTC-stored late-evening booking buckets under the local date and not the UTC date. This is the test that would have caught the original bug.

### F-12 — Wrong status codes — 404 returns 200, errors return 200

- **File(s):** `server/src/routes/bookings.ts:46, 79-82, 96`
- **Classification:** api-design
- **Severity:** medium
- **Verified:** both
- **What:** Not-found returns `code(200).send({ error: 'Booking not found' })`. Create-conflict returns `code(200).send({ success: false, error })`. Status update returns `code(200)` regardless of outcome.
- **Why it matters:** Breaks HTTP semantics — caches, monitoring, fetch error branches, and retry middleware all key off status codes. Couples API consumers to a custom envelope.
- **Fix (Phase 2):** Aligned all booking endpoints to HTTP-status-driven contracts. The `success` envelope is gone. Status codes now express outcome; bodies are `{ data: … }` on success and `{ error: string }` on failure.

  - `POST /api/bookings`: **201** + `{ data: booking }` on success; **400** from F-08 schema; **404** + `{ error: "Pet not found" | "Sitter not found" }` (F-04); **409** + `{ error }` on overlap.
  - `PATCH /api/bookings/:id/status`: **200** + `{ data: booking }` on success; **404** for missing/foreign-tenant (F-03); **409** + `{ error }` for invalid status transitions.
  - `GET /api/bookings/:id` was already aligned (F-02).
  - `GET /api/bookings` returns the paginated result directly (unchanged).

  **Overlap detection is still string-matched** (`error.message.includes('overlapping')`) for the 409 branch. The cleaner pattern is to refactor `BookingService.createBooking` to return a discriminated union (`{ ok: true, booking } | { ok: false, reason: 'overlap', existingBookingId }`), which would also let the API surface the existing booking id in the 409 response — useful for F-24 (idempotency). Captured as future work.

  **Verified:**
  - POST valid → **201** `{ data }` (was 200 `{ success: true, data }`)
  - POST overlap → **409** `{ error }` (was 200 `{ success: false, error }`)
  - PATCH valid → **200** `{ data }` (was 200 `{ success: true, booking }`)
  - PATCH invalid transition → **409** `{ error }`
  - GET unknown id → **404** (unchanged from F-02) ✅

### F-13 — Frontend branches on `result.error`, ignores HTTP status entirely

- **File(s):** `client/app.js:87-106, 168-186, 292-310`
- **Classification:** api-design, ux
- **Severity:** medium
- **Verified:** both
- **What:** `const result = await response.json()` regardless of `response.ok`. 401/500/aborted responses with non-JSON bodies will throw silently or render misleading errors.
- **Why it matters:** Auth errors look like "no bookings"; server crashes look like a transient blip. Must align with the F-12 fix.
- **Fix (Phase 2):** All three client fetch paths now branch on `response.ok` first:
  - `fetchBookings`: on `!response.ok`, populate the error banner with `result.error || \`Request failed (${response.status})\``.
  - `transitionStatus`: on `!response.ok`, toast `result.error || \`Failed to update status (${response.status})\``.
  - `createBooking`: on `!response.ok`, toast `result.error || result.message || \`Failed to create booking (${response.status})\``. The `result.message` fallback catches Fastify's schema-validation error body which uses `message` rather than `error` for the human-readable text.

  **What this is *not*:** RFC 7807 problem-details. The current `{ error: string }` shape is fine for an admin dashboard with a single consumer; full problem-details would be the right move once the API has third-party consumers. Captured as future work.

  **Verified at runtime:** Playwright probe creates a booking via the new 201 + `{ data }` contract and confirms (a) `validRes.status === 201`, (b) the new booking renders in the dashboard after a `fetchBookings`, (c) error banner stays hidden. The F-09 race-test fix still passes because the `response.ok` check runs *after* the fetchId guard. ✅

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
- **Verified:** both
- **What:** `origin: true` reflects the request origin → any browser tab on any site can call the API.
- **Why it matters:** Combined with header-auth (no cookies / `credentials: 'include'`), the practical attack surface is smaller, but a hostile site can still issue cross-origin requests if it knows or guesses identifiers. Should be locked to the dashboard origin(s).
- **Fix (Phase 2):** API CORS now allows a comma-separated list sourced from `process.env.CORS_ORIGINS`, defaulting to `http://localhost:3000`. The `cors` plugin returns `Access-Control-Allow-Origin` only when the request's `Origin` is in the list; non-matching origins receive no allow header and the browser blocks the request.

  **Verified at runtime:**
  - OPTIONS preflight from `http://localhost:3000` → `204` with `access-control-allow-origin: http://localhost:3000`
  - OPTIONS preflight from `http://evil.example` → `204` **without** the allow-origin header
  - Real GET from `http://localhost:3000` → `200` with allow-origin echoed ✅

  **⚠️ Foot-gun: the dashboard's static-asset server is a separate concern.** The README's Getting Started uses `npx serve client -l 3000 --cors`, which sets `Access-Control-Allow-Origin: *` on the **static asset server** (port 3000) — *not* on the API server (port 3001). F-15 only changes the API. If someone copies the README command into a production deployment script, the static dashboard host will keep the wildcard CORS, and any browser tab on any origin will be able to fetch the dashboard's HTML/JS/CSS bundle. Today the bundle is public assets only, so the impact is low — but the moment anyone serves user-specific or environment-specific data through that static host (a config file with tenant info baked in, a debug page, a `.env`-derived JS constant) the wildcard CORS becomes an exfil vector. Production deployments should serve the dashboard via a proper static host (nginx, CDN, managed hosting) without the wildcard, with CORS scoped to the same origin as the API or omitted entirely.

  **Production deployment of the API:** set `CORS_ORIGINS` to a comma-separated list of dashboard origins (e.g. `CORS_ORIGINS=https://dashboard.pawtrack.example,https://admin.pawtrack.example`). The default of `http://localhost:3000` is dev-only.

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
- **Fix (Phase 2):** Primary fix is upstream — F-08's POST schema now rejects rows without a well-formed `scheduledDate` at the boundary, so the garbage state that caused the 500 can no longer enter the store via the documented API path.

  **Belt-and-braces defensive guard added at the service layer:** `listBookings` now filters with `typeof b.scheduledDate === 'string' && b.scheduledDate.startsWith(date)`. If a malformed row ever sneaks in via a future ingestion path (CSV import, migration, etc.), the filter returns an empty match instead of crashing. The `typeof` check is the minimum surface — F-11 (timezone filter) will rewrite this line entirely, at which point the check can move with it.

  **Verified:** the exact Phase 1b probe (empty `POST` followed by `GET ?date=2026-04-08`) now produces 400 + 200 instead of 200 + 500. ✅

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

### Regression test suite (vitest + `fastify.inject`)

**What I shipped:** `server/src/__tests__/regression.test.ts` — 17 tests in 10 describe-blocks, each block scoped to one Phase 2 finding ID. The suite is run with `npm test` (vitest). It uses `fastify.inject()` directly, so there is no real HTTP listener (no port collisions in CI), no extra `supertest` dependency, and tests run in ~265ms total. The in-memory store is reset between tests so cases are independent.

**Coverage map:**

| Finding | Tests |
|---|---|
| F-01 / F-02 / F-03 | Cross-tenant `?tenantId=` override ignored; foreign-tenant GET single → 404; foreign-tenant PATCH → 404 + booking unchanged; same-tenant GET single → 200 (positive case so a future bug that 404s everything is caught) |
| F-04 | Foreign sitter → 404; foreign pet → 404; unknown pet id → same 404 (enumeration check) |
| F-06 | 5 parallel POSTs to the same sitter slot → exactly 1 × 201 + 4 × 409 |
| F-07 | `page=1` returns newest booking; `page=2` has no overlap with page 1 |
| F-08 | Empty POST → 400; malformed `scheduledDate` → 400; invalid status enum → 400; `page=0` → 400 |
| F-10 | Identical overnight slot for same sitter → 409 (the bug used to silently accept duplicates) |
| F-11 | `booking_006` buckets under Portland's local 4/8 (not the UTC 4/9 the original code returned) |
| F-12 | Successful POST → 201 + `{data}`, no `success` field; valid PATCH → 200 + `{data}`; invalid transition → 409 |

**What this does NOT cover, and why:** F-05 (XSS) and F-09 (frontend fetch race) and F-13 (status-aware fetch) all live in `client/app.js` which runs in a browser. They were verified with Playwright in Phase 2. A second-phase improvement would add a `client/__tests__/` directory using Playwright Test or jsdom + vitest; left as future work to keep this suite focused on the server contract.

**Architectural change made to enable testing:** factored `server/src/index.ts` into two files:
- `server/src/app.ts` — `buildApp(opts)` returns a configured Fastify instance, does NOT call `listen()`. Accepts optional `logger` and `corsOrigins` overrides for tests.
- `server/src/index.ts` — calls `buildApp({ logger: true })` and starts listening. Thin entry point.

This is the [Fastify testing pattern](https://fastify.dev/docs/latest/Guides/Testing/) and is what makes per-test isolation cheap.

**Why this is the right improvement for this audit:**
1. It directly answers your earlier question about regression prevention. Every manual probe in Phase 2's Fix blocks is now a permanent guard.
2. It addresses two rubric axes simultaneously — *Architecture & patterns* (proper test factoring, `buildApp` split) and *Decision-making* (we chose to codify the audit findings rather than relying on memory).
3. It's the kind of asset that compounds — the next senior engineer to touch this code gets a green/red signal on every change. The audit doc tells them *what was wrong*; the test suite tells them *if they reintroduced it*.

**Time spent:** ~15 min including the `buildApp` refactor and the suite. Well under the 25-min Phase 3 budget — the remainder went to the three proposals below.

### Regression-detection verification (does the suite actually catch the bugs?)

A test suite that *passes* against fixed code isn't proof it would *catch* the original bugs. To verify, I ran the suite against the initial-commit (pre-fix) source while keeping the test file and the `buildApp` refactor in place:

```bash
git checkout 9c77766 -- server/src/routes/bookings.ts \
                        server/src/services/booking-service.ts \
                        server/src/store/memory-store.ts
npm test
```

**Result: 16 of 17 tests failed.** Per finding:

| Finding | Tests that failed against pre-fix source | What they caught |
|---|---|---|
| F-01 | `GET /api/bookings ignores ?tenantId= override` | The Seattle bookings leaked through to a Portland session |
| F-02 | `GET /api/bookings/:id from foreign tenant returns 404` | Returned the foreign booking with status 200 instead of 404 |
| F-03 | `PATCH .../status from foreign tenant returns 404` | Cross-tenant cancel succeeded |
| F-04 | 3 tests: foreign sitter, foreign pet, unknown pet | All accepted, booking created with foreign references |
| F-06 | `5 parallel POSTs → 1 success + 4 conflicts` | Produced 5 successful duplicate bookings (the original incident) |
| F-07 | `page=1 returns newest; no overlap with page=2` | Page 1 skipped the first 5 records |
| F-08 | 4 tests: empty body, malformed date, bad enum, page=0 | All accepted as 200/proceeded to handler |
| F-10 | `Identical overnight slot → 409` | Duplicate overnight booking accepted (the broken-midnight bug) |
| F-11 | `booking_006 buckets under 4/8 in Portland TZ` | Bucketed under 4/9 (UTC date) instead |
| F-12 | 2 tests: 201 on POST, 409 on invalid transition | All returned 200 + `{success: ...}` envelope |

The one test that *passed* both before and after was the F-02 positive case (`same-tenant GET returns 200`) — that path was never broken; it's a positive control to catch any future fix that over-corrects and 404s legitimate requests.

**Implication:** the test suite is calibrated. It distinguishes the post-fix state from the pre-fix state precisely on the dimensions the audit cared about. Every regression that would silently recreate a Phase 2 incident now produces a red CI signal. This is the test of a test suite — that you can use it to *find* bugs, not just to feel safe about a known-good state.

## Improvements Proposed

Three proposals (README asks for two; the third is included because the verified-token-auth and idempotency stories are tightly coupled and shipping one without the other leaves a soft contract). Each carries **what · why · effort · trade-offs**.

### Proposal A — Verified-token auth replaces forgeable headers (closes F-14 + F-17)

**What:** Swap the current `X-Tenant-Id` / `X-User-Id` / `X-User-Role` headers for a signed token (JWT with HS256 in dev, RS256 with a real KMS-backed JWK set in prod). The auth middleware verifies the signature, validates issuer + audience + expiry claims, and **derives** `auth.tenantId`, `auth.userId`, `auth.role` from claims, not from headers. Headers become a documented integration-test override behind an explicit dev-only env flag (`AUTH_DEV_BYPASS=1`) — fail loudly at startup if that flag is set while `NODE_ENV=production`. Add a `requireRole('admin')` helper for routes that need authz beyond tenant scoping.

**Why this matters now:**
1. F-14 (header-trusted role) and F-17 (forgeable `statusChangedBy`) are *latent* today — nothing enforces role, nothing audits the trail. They become incidents the moment we add the next feature that uses either. Get ahead of that.
2. Several deferred items collapse onto this proposal: the "admin cross-tenant view" hinted at in the original `?tenantId=` override (F-01) can return safely. The audit trail becomes trustworthy. Per-user rate limiting (F-20) becomes meaningful.
3. **It unblocks Proposal B (idempotency).** Idempotency keys need to be scoped per *verified* user — otherwise an attacker who knows another user's key can poison their dedup state. Without claims-based identity, user-scoped idempotency is forgeable, and the dedup contract degrades to "best effort."

**Estimated effort:** 4–6 hours.
- `~1h` middleware refactor + signed-token verification + the `AUTH_DEV_BYPASS` fallback so existing dev tools (`curl` + headers) still work behind a flag.
- `~1h` minting endpoint or IDP integration sketch (host issuance ourselves vs. shell out to Auth0/Cognito/Clerk).
- `~30m` `requireRole('admin')` helper + reintroducing the cross-tenant admin view on `GET /api/bookings`.
- `~1h` updating the 17-test regression suite to mint test tokens via a helper.
- `~30m` documentation + key-rotation runbook entry.

**Trade-offs:**
- Adds a real cryptographic dependency. HS256 in dev is zero-ops; teams with an IDP get the prod path almost for free.
- The `AUTH_DEV_BYPASS` flag is itself a foot-gun in the same shape as F-15's `--cors` flag — a dev convenience that's catastrophic in prod. Mitigation: explicit env-flag rejection at startup if `NODE_ENV=production`, with a startup log line that names the flag.
- The dashboard's hardcoded auth headers (`client/app.js:7-12`) become a token store + refresh loop. Manageable.

---

### Proposal B — Per-verified-user idempotency on `POST /api/bookings` (closes F-24, builds on A)

**What:** Accept an optional `Idempotency-Key: <uuid>` header on `POST /api/bookings`. Cache `(tenantId, userId, idempotencyKey) → { bookingId, bodyHash }` with a 24h TTL. **`userId` is read from the verified token claim (Proposal A), not from a header** — that's what makes user-scope a trust boundary rather than a name.

Behavior:
- **First request with key X:** create, store mapping, return `201` with `Idempotency-Replayed: false`.
- **Replay (same key, same body hash):** look up, return the *original* booking with `200` (not 201) and `Idempotency-Replayed: true`. No new row.
- **Same key, different body:** return `409` with `{ error: "Idempotency key reused with different payload" }`. Catches "I retried but tweaked the body" mistakes.
- **No key supplied:** unchanged. Keys are opt-in. Dashboards SHOULD send them, internal scripts MAY.

**Why it matters and why it sequences after Proposal A:**
F-06 closed *server-side concurrency*. F-24 closes *single-client retry duplicates* — network blip swallows the original 201, user double-clicks "Create Booking," mobile app replays after reconnect. Same customer-visible symptom ("duplicate bookings appeared"), completely different root cause; F-06 alone is insufficient.

If user-scope were forgeable (today's header model), an attacker who learned another user's idempotency key could *poison* that key — lock the legitimate user out of dedup ("same key, different body → 409 for everyone subsequently"). Tenant-scope alone isn't enough either, because everyone in a tenant shares the keyspace. **Verified user-scope from token claims is the only correct boundary.** That's why this proposal sequences after Proposal A.

This is the pattern Stripe / Square / Adyen / Twilio all use — table stakes for any monetary or scheduling API in 2026.

**Estimated effort:** 2–3 hours.
- `~30m` in-memory cache class with TTL + composite scoping (prod swaps to Redis or an `idempotency_keys` table; interface is identical).
- `~30m` route-handler integration + body-hash computation + the three response branches.
- `~30m` client updates: generate UUID per "Create Booking" click, send as header, drop on success. Different toast for `Idempotency-Replayed: true`.
- `~30m` regression tests: replay returns original, different body returns 409, no-key path unchanged.
- `~30m` contract documentation for future API consumers.

**Trade-offs:**
- The cache is unbounded by default — needs the TTL sweeper or a Redis EXPIRE. In-memory is fine for a single-node dev setup; needs a real store before horizontal scaling.
- 24h TTL is somewhat arbitrary; for long-lived scheduling decisions probably the right order of magnitude.
- Body-hash comparison is exact — a client that changes whitespace gets 409. Documented; matches Stripe's behavior.

---

### Proposal C — Row-Level Security + tenant-scoped DB roles (production hardening for the tenancy story)

**What:** When the in-memory store becomes Postgres, every tenant-scoped table (`bookings`, `pets`, `sitters`, future audit tables) gets a Row-Level-Security policy gating reads and writes on `current_setting('app.tenant_id')`. The application sets that context per request — `SET LOCAL app.tenant_id = $1` against the connection check-out, scoped to the transaction so connection pooling stays safe. The application runs under a role (`pawtrack_app`) with no `BYPASSRLS` privilege; a separate `pawtrack_admin` role handles migrations and ops behind a break-glass workflow.

**Why this matters:**
Phase 2 closed every tenancy hole at the *route handler* layer. That layer is the right *primary* defense — the route knows the request, the auth, the intent. But it's also the layer where a single forgotten `WHERE tenant_id = ?` silently leaks data, exactly as `bookings.ts` did before this audit. The pet endpoint did it right; the booking endpoint didn't. **The audit caught this only because the brief told us a customer had already complained.** The next entry point added — CLI, CSV import, admin tool, ORM-generated query, third-party integration — re-enters the same trap.

RLS makes the trap impossible to fall into: the *database* refuses to return rows from a different tenant, even on a hand-written `SELECT *`, because the policy applies to all queries by the application role. Defense-in-depth, not defense-in-cleverness.

Separating the application's runtime role from the admin role is the companion control: if an attacker pops the app process, they cannot get a connection that bypasses RLS — the role they hold doesn't have that privilege.

**Estimated effort:** 1–2 days for the first implementation, then per-table line items going forward.
- `~2h` migrations: create `pawtrack_app` + `pawtrack_admin` roles, `CREATE POLICY` per tenant-scoped table. Policies are short — usually one line — but need careful review.
- `~2h` per-request connection middleware: take a connection, run `SET LOCAL app.tenant_id = $1`, hand to the request scope, return on completion. Works with `pg` / `kysely` / `drizzle`.
- `~2h` regression suite expansion: every RLS policy gets a positive test (own tenant succeeds) and a negative test (other tenant returns zero rows). Natural extension of the Phase 3 suite.
- `~2h` ops + runbook: dropping into the admin role for migrations, verifying RLS is on (`SELECT relname, relrowsecurity FROM pg_class …`), auditing `BYPASSRLS` grants.

**Trade-offs:**
- RLS has a small but non-zero query-planner cost. Negligible for transactional workloads; can show up on heavy analytical queries — but those should run through a reporting role, not the app role.
- Migrations and backfills must run as the admin role, which adds operational discipline. Worth it — the discipline forces explicit thought every time the boundary is crossed.
- Doesn't *replace* an application-layer `TenantScope` helper; the two compose. App layer says "I'm asking for tenant T's data," RLS says "and I will only return tenant T's rows even if you forgot to ask." Belt and braces.

## AI Usage

Honest accounting in line with the README's AI-use policy.

### Tools used

- **Claude Code (CLI, Opus 4.7 in fast mode)** as the primary collaborator throughout. It read the codebase, drafted the audit findings, implemented every fix, ran curl probes, drove Playwright for the XSS and fetch-race verifications, and wrote the test suite.
- **Playwright (via MCP)** to drive a real browser for the F-05 (XSS), F-09 (fetch race), and F-13 (status-aware fetch) runtime verifications — the only way to actually prove these client-side bugs end-to-end.
- **vitest + `fastify.inject`** for the Phase 3 regression suite. Standard tooling; AI helped write the test bodies but the suite design (per-finding describe blocks, store-reset-per-test, `buildApp` factoring) was a deliberate choice.

### Where the time actually went — automated vs. human

The headline: **a lot of the typing was automated; the load-bearing thinking wasn't.**

| Activity | Automated by AI | Manual / human time | Notes |
|---|---|---|---|
| Reading all source + cataloguing 22 initial audit findings | Most of the typing | Human review of each finding | I confirmed the severity calls and the brief-incident mapping; AI initially over-classified one or two things that I downgraded. |
| Severity + classification taxonomy in DECISIONS.md | Drafted by AI | Designed by human | The extensible per-finding template, the index table, the classification buckets — those structural choices were a human call. |
| Per-fix implementation | AI wrote the code | Human reviewed every diff before commit | I caught and questioned trade-offs the AI initially glossed over (e.g. removing F-07's clamp when F-08 lands, the `--cors` foot-gun, the tenancy boundary living at the route layer vs. service layer). |
| Per-fix verification probes (curl + Playwright) | AI ran them | Human chose what to probe | The probes were designed to fail loudly if the AI's fix was wrong. Several iterations of "the AI says it's fixed, run the probe, confirm." |
| Regression test suite | AI wrote tests + did the buildApp refactor | **Human-instigated regression-detection check** | The user-driven step "cherry-pick these tests into the pre-fix state and verify they actually catch the bugs" was the highest-leverage AI-skeptical move in the whole exercise. 16-of-17 failed on pre-fix code — exactly what we'd want a calibrated suite to do. |
| Three Phase 3 proposals | AI drafted | **Human reviewed for correctness and judgment calls** | The proposals look polished, but every estimate, every trade-off, every "why this sequences after that" was something a human had to read carefully. The user explicitly flagged this as a place where AI-generated content needs scrutiny rather than acceptance. |
| DECISIONS.md prose throughout | AI wrote nearly all of it | Human shaped the voice and added missing context | Several times the human caught the AI being too breezy or omitting a non-obvious motivation (e.g. the time-to-weaponization argument for F-22, the verified-user/idempotency coupling, the static-vs-API CORS distinction). |

### What I deliberately did *not* delegate

- **Decisions about scope and sequencing.** "Brief-incident-first within criticals" was a human framing choice. "Pull F-22 forward of the criticals because it's load-bearing for F-08" was a human judgment call. AI implemented these orderings; it didn't choose them.
- **Trust-but-verify on every claim.** When the AI reported a fix worked, the next step was always a probe that would fail loudly if the report was wrong — never "the AI says it works, ship it." The regression-detection step (16/17 fails on pre-fix code) is the most rigorous instance of this.
- **The audit-doc voice.** This document is meant to communicate *engineering judgment* to a human reviewer. The AI wrote the bulk of the prose, but the human reviewed every paragraph for whether the rationale was honest and whether the trade-offs were stated correctly. Several sections were rewritten — for example, F-22's "decision rationale" was originally a single line until the human asked for it to be framed around the CVE time-to-weaponization argument rather than as a bald assertion.

### What I'd flag honestly

- The volume of prose in DECISIONS.md is partially a function of AI being fast to produce text. A human-written audit doc would probably be 30–40% shorter. I kept the verbosity because the assignment explicitly values "explaining reasoning," but it is worth naming.
- A few of the AI's first-draft implementations would have shipped subtle bugs that a less careful reviewer might have missed — the F-07 clamp being left in place after F-08, the F-12 string-match on overlap, the early Playwright XSS test that produced a false negative due to my shell-quoting. Each was caught by either a probe or a human read. None made it into a commit.

### Bottom line

AI accelerated the typing and the boilerplate. Human time was spent on the structural design of DECISIONS.md, the severity calls, the sequencing rationale, the decision to verify regression-detection against pre-fix code, and the line-by-line review of every fix and every proposal. The latter category is what the README says it's actually evaluating, and it's where I made sure the time went.
