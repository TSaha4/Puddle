import { seedOf, type PluginDefinition, type SessionInput } from '@puddle/mcp-runtime';
import { z } from 'zod';
export function generate({ context }: SessionInput) {
  const night = context.localHour < 7 || context.localHour >= 21;
  const offset = { clear: 4, cloudy: 0, rain: -4, snow: -2, unknown: 0 }[context.weather];
  return {
    title: 'a tiny tide of nothing', durationSeconds: 120,
    seed: seedOf(`${context.weather}:${context.localHour}`), tempo: (night ? 48 : 60) + offset,
    // Preserve the existing Tone.js renderer's supported key/texture contract.
    key: 'C major' as const, texture: 'soft-sine' as const
  };
}
export const plugin: PluginDefinition = {
  name: 'mcp-ambient-audio', description: 'Generate ambient audio parameters from weather and local hour. No audio data is transmitted.',
  outputSchema: z.object({ title: z.string(), durationSeconds: z.literal(120), seed: z.number().int().nonnegative(), tempo: z.number().min(30).max(120), key: z.literal('C major'), texture: z.literal('soft-sine') }).strict(),
  generate
};
