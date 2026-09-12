import { useCallback, useEffect, useRef, useState } from 'react';
import { isAmbientSession, type AmbientSession } from '../../shared/session';
import { AmbientAudio, unlockAudio } from './audio';

type Phase = 'idle' | 'loading' | 'playing' | 'finished';

function Mascot({ floating = false }: { floating?: boolean }) {
  return <svg className={`mascot ${floating ? 'floating' : ''}`} viewBox="0 0 280 230" role="img" aria-label="a happily unproductive puddle blob">
    <path className="blob-shadow" d="M43 74C61 26 122 16 159 39C202 12 260 55 246 105C282 159 224 211 169 194C125 225 45 206 46 166C6 144 12 97 43 74Z" transform="translate(7 8)" />
    <path className="blob-body" d="M43 74C61 26 122 16 159 39C202 12 260 55 246 105C282 159 224 211 169 194C125 225 45 206 46 166C6 144 12 97 43 74Z" />
    <circle cx="111" cy="112" r="6" fill="#111" /><circle cx="166" cy="112" r="6" fill="#111" />
    <path d="M125 133Q138 147 152 133" fill="none" stroke="#111" strokeWidth="4" strokeLinecap="round" />
  </svg>;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<AmbientSession | null>(null);
  const [remaining, setRemaining] = useState(120);
  const [volume, setVolume] = useState(45);
  const [muted, setMuted] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState('');
  const audio = useRef<AmbientAudio | null>(null);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const deadline = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  const finish = useCallback(() => {
    audio.current?.dispose();
    audio.current = null;
    setPhase('finished');
  }, []);

  useEffect(() => () => {
    request.current?.abort();
    audio.current?.dispose();
  }, []);

  useEffect(() => {
    audio.current?.setVolume(muted ? 0 : volume / 100);
  }, [volume, muted]);

  useEffect(() => {
    if (phase === 'playing' || phase === 'finished') heading.current?.focus();
    if (phase !== 'playing') return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) finish();
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [phase, finish]);

  async function startSession() {
    if (busy.current) return;
    busy.current = true;
    setPhase('loading');
    setError('');
    setFeedback(null);
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      await unlockAudio();
      if (controller.signal.aborted) throw new Error('cancelled');
      const response = await fetch('/api/sessions', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const data: unknown = await response.json();
      if (!isAmbientSession(data)) throw new Error('Unexpected session payload');
      if (controller.signal.aborted) throw new Error('cancelled');
      audio.current?.dispose();
      audio.current = new AmbientAudio();
      audio.current.setVolume(muted ? 0 : volume / 100);
      audio.current.play(data.payload);
      deadline.current = Date.now() + data.payload.durationSeconds * 1000;
      setSession(data);
      setRemaining(data.payload.durationSeconds);
      setPhase('playing');
    } catch (cause) {
      audio.current?.dispose();
      audio.current = null;
      console.error('puddle.start_failed', cause);
      setError('a little splash in the works. check your connection and browser audio, then try again.');
      setPhase('idle');
    } finally {
      window.clearTimeout(timeout);
      busy.current = false;
      if (request.current === controller) request.current = null;
    }
  }

  function rate(value: 'up' | 'down') {
   