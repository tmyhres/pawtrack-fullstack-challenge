import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthContext, BookingStatus } from '../types/index.js';
import { bookingService } from '../services/booking-service.js';

export function bookingRoutes(app: FastifyInstance): void {
  /**
   * GET /api/bookings
   * List bookings with optional filters and pagination.
   */
  app.get('/api/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const query = request.query as {
      page?: string;
      limit?: string;
      date?: string;
      status?: string;
    };

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);

    const result = bookingService.listBookings({
      tenantId: auth.tenantId,
      page,
      limit,
      date: query.date,
      status: query.status as BookingStatus | undefined,
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
  app.post('/api/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as any).auth as AuthContext;
    const body = request.body as {
      petId: string;
      sitterId: string;
      scheduledDate: string;
      startTime: string;
      endTime: string;
      notes?: string;
    };

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
  app.patch('/api/bookings/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
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
