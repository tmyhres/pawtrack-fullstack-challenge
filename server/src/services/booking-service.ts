import { v4 as uuid } from 'uuid';
import type { Booking, BookingStatus, PaginatedResult, AuthContext } from '../types/index.js';
import { VALID_TRANSITIONS } from '../types/index.js';
import { store } from '../store/memory-store.js';
import { eventBus } from './event-emitter.js';
import { tenantLocalDate } from '../util/dates.js';

interface ListBookingsParams {
  tenantId: string;
  page: number;
  limit: number;
  date?: string;
  status?: BookingStatus;
}

interface CreateBookingParams {
  tenantId: string;
  petId: string;
  sitterId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  createdBy: string;
}

export class BookingService {
  /**
   * List bookings for a tenant with optional date and status filters.
   * Supports pagination.
   */
  public listBookings(params: ListBookingsParams): PaginatedResult<Booking> {
    const { tenantId, page, limit, date, status } = params;

    let bookings = store.getBookingsByTenant(tenantId);

    // Filter by the tenant-local service date (see util/dates.ts), the same
    // notion the sitter overlap check uses — never the raw UTC string prefix.
    // The schema (F-08) validates `date` as YYYY-MM-DD. `tenantLocalDate`
    // returns null on a malformed scheduledDate, which then fails the equality
    // and excludes the row (belt-and-braces against bad ingestion, F-23). The
    // `typeof` guard keeps that path purely string-typed.
    if (date) {
      const tenant = store.getTenant(tenantId);
      const tz = tenant?.timezone ?? 'UTC';
      bookings = bookings.filter(b => {
        if (typeof b.scheduledDate !== 'string') return false;
        return tenantLocalDate(b.scheduledDate, tz) === date;
      });
    }

    // Filter by status if provided
    if (status) {
      bookings = bookings.filter(b => b.status === status);
    }

    // Sort by scheduled date descending (newest first)
    bookings.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());

    const total = bookings.length;
    const totalPages = Math.ceil(total / limit);

    // Pagination is 1-indexed; the route's querystring schema (F-08) rejects
    // page < 1 at the boundary, so no defensive clamp is needed here anymore.
    const offset = (page - 1) * limit;
    const paginatedBookings = bookings.slice(offset, offset + limit);

    return {
      data: paginatedBookings,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Create a new booking. Overlap detection and persistence are delegated to
   * `store.tryCreateBookingForSitter`, which performs both in a single
   * synchronous call frame — concurrent callers cannot interleave duplicates.
   */
  public createBooking(params: CreateBookingParams): Booking {
    const { tenantId, petId, sitterId, scheduledDate, startTime, endTime, notes, createdBy } = params;

    const now = new Date().toISOString();
    const booking: Booking = {
      id: `booking_${uuid().slice(0, 8)}`,
      tenantId,
      petId,
      sitterId,
      status: 'requested',
      scheduledDate,
      startTime,
      endTime,
      notes,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      statusChangedBy: createdBy,
    };

    const result = store.tryCreateBookingForSitter(booking);
    if ('conflict' in result) {
      throw new Error('Sitter has an overlapping booking for this time slot');
    }

    eventBus.emit('booking.created', {
      bookingId: result.created.id,
      tenantId: result.created.tenantId,
      petId: result.created.petId,
      sitterId: result.created.sitterId,
    });

    return result.created;
  }

  /**
   * Update booking status with transition validation.
   */
  public updateStatus(
    bookingId: string,
    newStatus: BookingStatus,
    changedBy: string,
  ): { success: boolean; booking?: Booking; error?: string } {
    const booking = store.getBooking(bookingId);

    if (!booking) {
      return { success: false, error: 'Booking not found' };
    }

    const allowedTransitions = VALID_TRANSITIONS[booking.status];
    if (!allowedTransitions.includes(newStatus)) {
      return {
        success: false,
        error: `Cannot transition from '${booking.status}' to '${newStatus}'`,
      };
    }

    // Overwrite status — no history kept
    const updatedBooking: Booking = {
      ...booking,
      status: newStatus,
      updatedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      statusChangedBy: changedBy,
    };

    store.updateBooking(updatedBooking);

    // Overwrite status and notify listeners
    eventBus.emit('booking.statusChanged', {
      bookingId: updatedBooking.id,
      previousStatus: booking.status,
      newStatus,
      changedBy,
    });

    return { success: true, booking: updatedBooking };
  }

  /**
   * Get a single booking by ID.
   */
  public getBooking(bookingId: string): Booking | undefined {
    return store.getBooking(bookingId);
  }
}

export const bookingService = new BookingService();
