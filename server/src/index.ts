import { buildApp } from './app.js';

const app = buildApp({ logger: true });

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
