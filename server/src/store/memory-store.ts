import type { Booking, Pet, Sitter, Tenant } from '../types/index.js';
import { tenants as seedTenants, pets as seedPets, bookings as seedBookings, sitters as seedSitters } from './seed.js';

/**
 * Build the concrete [start, end) instant interval for a booking. Overnight
 * bookings — where endTime is lex-less than startTime (e.g. 23:30 → 00:30) —
 * roll the end into the next day. Lex comparison is safe because both fields
 * are validated to the strict `HH:MM` format in the route's body schema (F-08).
 *
 * The rollover advances the calendar date (setDate) rather than adding a fixed
 * 24h in milliseconds: across a DST transition a local day is 23 or 25 hours,
 * so `+86_400_000ms` would shift the end's wall-clock time by an hour and
 * skew overlap detection on those nights.
 */
function bookingInterval(b: Booking): { start: Date; end: Date } {
  const [date] = b.scheduledDate.split('T');
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
    const candidate = bookingInterval(booking);

    for (const existing of this.bookings.values()) {
      if (existing.sitterId !== booking.sitterId) continue;
      if (existing.status === 'cancelled') continue;
      const exInterval = bookingInterval(existing);
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
