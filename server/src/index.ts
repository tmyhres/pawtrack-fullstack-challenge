import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from './middleware/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { petRoutes } from './routes/pets.js';

const app = Fastify({ logger: true });

// CORS: allowed origins are a comma-separated env var, default to the dev
// dashboard origin. `origin: true` (reflect any origin) was the prior behavior
// and is what F-15 closes — the API serves tenant data and should not respond
// to cross-origin requests from arbitrary sites. NOTE: this is the *API
// server's* CORS — the static dashboard server (`npx serve --cors` on port
// 3000) is a separate process and its CORS configuration is unrelated.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.register(cors, {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Tenant-Id', 'X-User-Id', 'X-User-Role'],
});

// Auth middleware for all /api routes
app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    await authMiddleware(request, reply);
  }
});

// Health check (no auth required)
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register route handlers
bookingRoutes(app);
petRoutes(app);

// Start server
const start = async () => {
  try {
    await app.listen({ port: 3001, host: '0.0.0.0' });
    console.log('PawTrack API running on http://localhost:3001');
    console.log('Health check: http://localhost:3001/health');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
