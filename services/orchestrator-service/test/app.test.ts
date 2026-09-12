import request from 'supertest';
import { createApp } from '../src/app.js';
import { isAmbientSession } from '../../../shared/session.js';

const app = createApp();

describe('Phase 1 orchestrator routing', () => {
  it('reports health', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a canned ambient session with the shared contract', async () => {
    const response = await request(app).post('/api/sessions').expect(201);
    expect(isAmbientSession(response.body)).toBe(true);
    expect(response.body.payload).toEqual({
      title: 'a tiny tide of nothing', durationSeconds: 120, seed: 2718,
      tempo: 60, key: 'C major', texture: 'soft-sine'
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('gives each interaction a distinct id', async () => {
    const first = await request(app).post('/api/sessions');
    const second = await request(app).post('/api/sessions');
    expect(first.body.id).not.toBe(second.body.id);
    expect(Number.isFinite(Date.parse(first.body.createdAt))).toBe(true);
  });

  it('does not expose feedback persistence or other session routes', async () => {
    await request(app).post('/api/feedback').expect(404);
    await request(app).get('/api/sessions').expect(404);
    await request(app).get('/api/missing').expect(404);
  });

  it('rejects malformed, unsupported, and unbounded payloads', async () => {
    const { body } = await request(app).post('/api/sessions');
    for (const value of [null, {}, { ...body, sessionType: 'unknown' },
      { ...body, createdAt: 'yesterday' },
      { ...body, payload: { ...body.payload, durationSeconds: Infinity } },
      { ...body, payload: { ...body.payload, tempo: 0 } },
      { ...body, payload: { ...body.payload, seed: 0.5 } },
      { ...body, payload: { ...body.payload, texture: 'unsupported' } }]) {
      expect(isAmbientSession(value)).toBe(false);
    }
  });
});
