import * as Tone from 'tone';
import type { AmbientSession } from '../../shared/session';

export function unlockAudio(): Promise<void> {
  // Must execute directly inside the click handler, before the network request.
  return Tone.start();
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class AmbientAudio {
  private volume = new Tone.Gain(0.45).toDestination();
  private gate = new Tone.Gain(1).connect(this.volume);
  private synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 1.2, decay: 0.5, sustain: 0.35, release: 2 },
    volume: -20
  }).connect(this.gate);
  private loop: Tone.Loop | null = null;
  private disposed = false;

  play(payload: AmbientSession['payload']) {
    const random = seededRandom(payload.seed);
    const chords = [['C3', 'E4', 'G4'], ['F3', 'A3', 'C4'], ['A2', 'C4', 'E4'], ['G2', 'D4', 'G4']];
    // Phase 1 owns a single transport, never multiple overlapping sessions.
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.position = 0;
    transport.bpm.value = payload.tempo;
    this.loop = new Tone.Loop((time) => {
      const chord = chords[Math.floor(random() * chords.length)];
      this.synth.triggerAttackRelease(chord, '2n', time, 0.45 + random() * 0.15);
    }, '1m').start(0).stop(payload.durationSeconds);
    const start = Tone.now() + 0.05;
    // Web Audio clock enforces silence even if background-tab JS timers stall.
    // Separate gate keeps slider automation from cancelling this deadline.
    this.gate.gain.setValueAtTime(1, start);
    this.gate.gain.setValueAtTime(1, start + payload.durationSeconds - 1);
    this.gate.gain.linearRampToValueAtTime(0, start + payload.durationSeconds);
    transport.start(start);
  }

  setVolume(value: number) {
    if (!this.disposed) this.volume.gain.rampTo(Math.min(1, Math.max(0, value)), 0.08);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loop?.dispose();
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.synth.dispose();
    this.gate.dispose();
    this.volume.dispose();
  }
}
