import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from './middleware/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { petRoutes } from './routes/pets.js';

export interface BuildAppOptions {
  logger?: boolean;
  corsOrigins?: string[];
}

/**
 * Configure and return a Fastify instance — does NOT call .listen().
 * Used by both the entry point (index.ts) and the test suite, which
 * exercises the app via fastify.inject().
 */
export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  const allowedOrigins = opts.corsOrigins ?? (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Tenant-Id', 'X-User-Id', 'X-User-Role'],
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request, reply);
    }
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  bookingRoutes(app);
  petRoutes(app);

  return app;
}
