export interface BlobProfile { color: string; amplitude: number; speed: number }
export interface Poke { x: number; y: number; z: number; strength: number }

// Visual-only presets, not new session types or a change to the MCP contract.
// Only ambient-audio exists in Phase 1; future generators can reuse these looks.
export function blobProfile(sessionType?: string, tempo = 60): BlobProfile {
  const pace = Number.isFinite(tempo) ? Math.min(120, Math.max(30, tempo)) / 60 : 1;
  switch (sessionType) {
    case 'ambient-audio': return { color: '#7FD1C4', amplitude: 0.035, speed: 0.42 * pace };
    case 'breathing-game': return { color: '#FF6B4A', amplitude: 0.09, speed: 0.9 * pace };
    case 'blob-visual': return { color: '#C9B8FF', amplitude: 0.065, speed: 0.65 * pace };
    case 'rant-doodle': return { color: '#FFD93D', amplitude: 0.045, speed: 0.5 * pace };
    default: return { color: '#FF6B4A', amplitude: 0.05, speed: 0.55 };
  }
}

// Inputs are unit-sphere coordinates. Pure math keeps deformation testable without
// WebGL. The localized Gaussian dent follows the raycast point in mesh-local space.
export function blobRadius(x: number, y: number, z: number, time: number, profile: BlobProfile, poke: Poke): number {
  const organic = 1 + 0.065 * Math.sin(3 * x + 1) + 0.055 * Math.cos(4 * y - 2 * z);
  const phase = time * profile.speed;
  const wave = profile.amplitude * (0.6 * Math.sin(2 * x + phase) + 0.4 * Math.cos(3 * y - 2 * z + phase * 0.8));
  const distanceSquared = (x - poke.x) ** 2 + (y - poke.y) ** 2 + (z - poke.z) ** 2;
  const dent = Math.min(0.3, Math.max(0, poke.strength)) * Math.exp(-9 * distanceSquared);
  return organic + wave - dent;
}

export const NO_POKE: Readonly<Poke> = { x: 0, y: 0, z: 1, strength: 0 };
