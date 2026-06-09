import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthContext, BookingStatus } from '../types/index.js';
import { bookingService } from '../services/booking-service.js';
import { store } from '../store/memory-store.js';

const BOOKING_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const;
const TIME_HHMM = '^([01]\\d|2[0-3]):[0-5]\\d$';

export function bookingRoutes(app: FastifyInstance): void {
  /**
   * GET /api/bookings
   * List bookings with optional filters and pagination.
   */
  app.get('/api/bookings', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          date: { type: 'string', format: 'date' },
          status: { type: 'string', enum: BOOKING_STATUSES as unknown as string[] },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const query = request.query as {
      page: number;
      limit: number;
      date?: string;
      status?: BookingStatus;
    };

    const result = bookingService.listBookings({
      tenantId: auth.tenantId,
      page: query.page,
      limit: query.limit,
      date: query.date,
      status: query.status,
    });

    return reply.code(200).send(result);
  });

  /**
   * GET /api/bookings/:id
   * Get a single booking by ID.
   */
  app.get('/api/bookings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const { id } = request.params as { id: string };
    const booking = bookingService.getBooking(id);

    // 404 (not 403) on tenant mismatch to avoid leaking existence
    if (!booking || booking.tenantId !== auth.tenantId) {
      return reply.code(404).send({ error: 'Booking not found' });
    }

    return reply.code(200).send({ data: booking });
  });

  /**
   * POST /api/bookings
   * Create a new booking.
   */
  app.post('/api/bookings', {
    schema: {
      body: {
        type: 'object',
        required: ['petId', 'sitterId', 'scheduledDate', 'startTime', 'endTime'],
        additionalProperties: false,
        properties: {
          petId: { type: 'string', minLength: 1, maxLength: 64 },
          sitterId: { type: 'string', minLength: 1, maxLength: 64 },
          scheduledDate: { type: 'string', format: 'date-time' },
          startTime: { type: 'string', pattern: TIME_HHMM },
          endTime: { type: 'string', pattern: TIME_HHMM },
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const body = request.body as {
      petId: string;
      sitterId: string;
      scheduledDate: string;
      startTime: string;
      endTime: string;
      notes?: string;
    };

    // Tenancy boundary: pet and sitter must belong to caller's tenant.
    // 404 (not 403) for both missing and foreign so existence can't be probed.
    const pet = store.getPet(body.petId);
    if (!pet || pet.tenantId !== auth.tenantId) {
      return reply.code(404).send({ error: 'Pet not found' });
    }

    const sitter = store.getSitter(body.sitterId);
    if (!sitter || sitter.tenantId !== auth.tenantId) {
      return reply.code(404).send({ error: 'Sitter not found' });
    }

    try {
      const booking = await bookingService.createBooking({
        tenantId: auth.tenantId,
        petId: body.petId,
        sitterId: body.sitterId,
        scheduledDate: body.scheduledDate,
        startTime: body.startTime,
        endTime: body.endTime,
        notes: body.notes || '',
        createdBy: auth.userId,
      });

      return reply.code(200).send({ success: true, data: booking });
    } catch (error: any) {
      return reply.code(200).send({ success: false, error: error.message });
    }
  });

  /**
   * PATCH /api/bookings/:id/status
   * Update the status of a booking.
   */
  app.patch('/api/bookings/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: BOOKING_STATUSES as unknown as string[] },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: BookingStatus };

    const existing = bookingService.getBooking(id);
    if (!existing || existing.tenantId !== auth.tenantId) {
      return reply.code(404).send({ error: 'Booking not found' });
    }

    const result = bookingService.updateStatus(id, status, auth.userId);

    return reply.code(200).send(result);
  });
}
