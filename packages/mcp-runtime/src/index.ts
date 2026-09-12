import express, { type ErrorRequestHandler } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export const contextSchema = z.object({
  weather: z.enum(['clear', 'cloudy', 'rain', 'snow', 'unknown']),
  localHour: z.number().int().min(0).max(23),
  calendarLoad: z.number().min(0).max(1).default(0),
  minutesSinceBreak: z.number().min(0).max(1440).default(60),
  grindSignal: z.number().min(0).max(1).default(0)
}).strict();
export const inputSchema = z.object({ context: contextSchema, text: z.string().max(8000).default('') });
export type SessionInput = z.infer<typeof inputSchema>;
export interface PluginDefinition {
  name: string;
  description: string;
  outputSchema: z.AnyZodObject;
  generate(input: SessionInput): Record<string, unknown>;
}
export function seedOf(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return hash;
}

// MCP is a hot-swappable plugin bus for generative personal content, not
// enterprise tool orchestration. Shared transport contains no generation logic:
// every independent server owns its generator; the orchestrator never imports it.
export function createPluginApp(definition: PluginDefinition) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => response.json({ status: 'ok', plugin: definition.name }));
  app.use('/mcp', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    // Internal server-to-server endpoints are not browser APIs.
    if (request.headers.origin) { response.status(403).json({ error: 'Browser origins are not accepted' }); return; }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.post('/mcp', async (request, response) => {
    const server = new McpServer({ name: definition.name, version: '0.1.0' });
    server.registerTool('generate_session', {
      description: definition.description,
      inputSchema: inputSchema.shape,
      outputSchema: definition.outputSchema.shape
    }, async (input) => {
      const payload = definition.outputSchema.parse(definition.generate(input));
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
    });
    // Fresh SDK state per request; JSON responses need no persistent SSE stream.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      await server.close().catch(() => {});
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Plugin request failed' } });
      else response.end();
    }
  });
  app.all('/mcp', (_request, response) => {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Use POST /mcp' });
  });
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request body' });
  };
  app.use(handleError);
  return app;
}
export function startPlugin(definition: PluginDefinition, defaultPort: number) {
  const port = Number(process.env.PORT ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createPluginApp(definition).listen(port, '0.0.0.0', () => console.info(`${definition.name} listening on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
