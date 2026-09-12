import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { resolve } from 'node:path';
import { generateSession } from './session.js';

export function createApp(frontendDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // No context or user data is collected in this anonymous Phase 1 demo.
  app.post('/api/sessions', (_req, res) => res.status(201).json(generateSession()));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

  if (frontendDirectory) {
    app.use(express.static(frontendDirectory));
    app.get('*', (_req, res) => res.sendFile(resolve(frontendDirectory, 'index.html')));
  }
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('puddle.request_failed', error);
    res.status(500).json({ error: 'Something splashed. Please try again.' });
  };
  app.use(handleError);
  return app;
}
