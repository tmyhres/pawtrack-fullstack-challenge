import type { Booking, Pet, Sitter, Tenant } from '../types/index.js';
import { tenants as seedTenants, pets as seedPets, bookings as seedBookings, sitters as seedSitters } from './seed.js';
import { tenantLocalDate } from '../util/dates.js';

/**
 * Build the concrete [start, end) interval for a booking, on its tenant-LOCAL
 * service date. Deriving the day from `tenantLocalDate(...)` rather than
 * `scheduledDate.split('T')[0]` is what makes overlap agree with the list
 * filter: two bookings on the same local night now share a base date even when
 * their `scheduledDate` instants are shaped differently (seed stores the true
 * instant; the client submits a midday anchor). The raw-UTC date-part let a
 * client-shaped overnight slot slip past the conflict check.
 *
 * Overnight bookings — endTime lex-less than startTime (e.g. 23:30 → 00:30) —
 * roll the end into the next day. Lex compare is safe because both fields are
 * validated to strict `HH:MM` in the route schema (F-08). The rollover
 * advances the calendar date (setDate) rather than adding 86_400_000ms, since
 * a DST-transition local day is 23 or 25 hours and a fixed +24h would shift
 * the end's wall-clock by an hour.
 */
function bookingInterval(b: Booking, tz: string): { start: Date; end: Date } {
  const date = tenantLocalDate(b.scheduledDate, tz) ?? b.scheduledDate.split('T')[0];
  const start = new Date(`${date}T${b.startTime}`);
  const end = new Date(`${date}T${b.endTime}`);
  if (b.endTime < b.startTime) {
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

class MemoryStore {
  private tenants: Map<string, Tenant> = new Map();
  private pets: Map<string, Pet> = new Map();
  private bookings: Map<string, Booking> = new Map();
  private sitters: Map<string, Sitter> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.tenants.clear();
    this.pets.clear();
    this.bookings.clear();
    this.sitters.clear();

    for (const tenant of seedTenants) {
      this.tenants.set(tenant.id, { ...tenant });
    }
    for (const pet of seedPets) {
      this.pets.set(pet.id, { ...pet });
    }
    for (const booking of seedBookings) {
      this.bookings.set(booking.id, { ...booking });
    }
    for (const sitter of seedSitters) {
      this.sitters.set(sitter.id, { ...sitter });
    }
  }

  // Tenant operations
  public getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  // Pet operations
  public getPet(id: string): Pet | undefined {
    return this.pets.get(id);
  }

  public getPetsByTenant(tenantId: string): Pet[] {
    return Array.from(this.pets.values()).filter(p => p.tenantId === tenantId);
  }

  // Booking operations
  public getBooking(id: string): Booking | undefined {
    return this.bookings.get(id);
  }

  public getBookingsByTenant(tenantId: string): Booking[] {
    return Array.from(this.bookings.values()).filter(b => b.tenantId === tenantId);
  }

  public getAllBookings(): Booking[] {
    return Array.from(this.bookings.values());
  }

  public createBooking(booking: Booking): Booking {
    this.bookings.set(booking.id, { ...booking });
    return booking;
  }

  /**
   * Atomic check-and-insert: reject if any non-cancelled booking for the same
   * sitter overlaps the candidate's time window, otherwise persist the booking.
   *
   * Must remain synchronous end-to-end — the absence of an `await` between the
   * overlap scan and the `set` is the entire reason a second concurrent caller
   * cannot interleave a duplicate insert. Do not introduce one.
   */
  public tryCreateBookingForSitter(
    booking: Booking,
  ): { created: Booking } | { conflict: { existingBookingId: string } } {
    // A sitter belongs to exactly one tenant (enforced at create, F-04), so
    // every booking scanned here shares the candidate's tenant/timezone.
    const tz = this.tenants.get(booking.tenantId)?.timezone ?? 'UTC';
    const candidate = bookingInterval(booking, tz);

    for (const existing of this.bookings.values()) {
      if (existing.sitterId !== booking.sitterId) continue;
      if (existing.status === 'cancelled') continue;
      const exInterval = bookingInterval(existing, tz);
      if (candidate.start < exInterval.end && candidate.end > exInterval.start) {
        return { conflict: { existingBookingId: existing.id } };
      }
    }

    this.bookings.set(booking.id, { ...booking });
    return { created: booking };
  }

  public updateBooking(booking: Booking): Booking {
    this.bookings.set(booking.id, { ...booking });
    return booking;
  }

  // Sitter operations
  public getSitter(id: string): Sitter | undefined {
    return this.sitters.get(id);
  }

  public getSittersByTenant(tenantId: string): Sitter[] {
    return Array.from(this.sitters.values()).filter(s => s.tenantId === tenantId);
  }
}

// Singleton instance
export const store = new MemoryStore();
