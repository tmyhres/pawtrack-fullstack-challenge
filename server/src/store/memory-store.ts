import type { Booking, Pet, Sitter, Tenant } from '../types/index.js';
import { tenants as seedTenants, pets as seedPets, bookings as seedBookings, sitters as seedSitters } from './seed.js';

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
    const [candidateDate] = booking.scheduledDate.split('T');
    const candidateStart = new Date(`${candidateDate}T${booking.startTime}`);
    const candidateEnd = new Date(`${candidateDate}T${booking.endTime}`);

    for (const existing of this.bookings.values()) {
      if (existing.sitterId !== booking.sitterId) continue;
      if (existing.status === 'cancelled') continue;
      const [existingDate] = existing.scheduledDate.split('T');
      const existingStart = new Date(`${existingDate}T${existing.startTime}`);
      const existingEnd = new Date(`${existingDate}T${existing.endTime}`);
      if (candidateStart < existingEnd && candidateEnd > existingStart) {
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
