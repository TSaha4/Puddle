import { useCallback, useEffect, useRef, useState } from 'react';
import { isAmbientSession, type AmbientSession } from '../../shared/session';
import { AmbientAudio, unlockAudio } from './audio';
import { SessionMascot } from './visuals/SessionMascot';

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
  const ratedSession = useRef<string | null>(null);
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
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) finish();
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, finish]);

  async function startSession() {
    if (busy.current) return;
    busy.current = true;
    setPhase('loading');
    setError('');
    setFeedback(null);
    ratedSession.current = null;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      // Bound audio-context unlocking too: browsers may leave resume() pending.
      await Promise.race([
        unlockAudio(),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Session request cancelled or timed out')), { once: true });
        })
      ]);
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
    if (!session || ratedSession.current === session.id) return;
    ratedSession.current = session.id;
    setFeedback(value);
    // Phase 1 only. No inference, tracking, network request, or bandit update.
    console.info('puddle.feedback', { sessionId: session.id, feedback: value });
  }

  const active = phase === 'playing';
  const finished = phase === 'finished';
  const loading = phase === 'loading';

  return <div className="app-shell">
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="puddle home"><span className="mini-blob" aria-hidden="true">··</span> puddle<span className="wordmark-dot">.</span></a>
      <span className="badge header-badge">a little less everything</span>
    </header>

    <main>
      <section className="intro" aria-labelledby="intro-title">
        <div className="eyebrow"><span aria-hidden="true">✳</span> your next two minutes, reclaimed.</div>
        <h1 id="intro-title">stop scrolling.<br /><span className="highlight">start puddling.</span></h1>
        <p>no streaks. no self-improvement homework.<br />just a tiny pocket of nothing much.</p>
      </section>

      <section className={`session-card ${active ? 'is-playing' : ''}`} aria-label="your puddle session" aria-busy={loading}>
        <div className="card-top"><span className="badge yellow">{active ? 'currently: off-duty' : finished ? 'tiny break, big yes.' : 'permission to do less'}</span><span className="edition">vol. 001 / sound</span></div>
        <div className="session-layout">
          <div className="mascot-stage">
            <span className="scribble top-scribble" aria-hidden="true">{active ? 'nothing to achieve here.' : 'hey. take a breather.'}</span>
            <SessionMascot session={session} active={active} fallback={<Mascot floating={active} />} />
            <div className="ground-line" aria-hidden="true" />
            <span className="badge lavender mascot-label">100% unproductive. proudly.</span>
          </div>

          <div className="session-content">
            {(!active && !finished) ? <>
              <span className="eyebrow">one small escape</span>
              <h2>your tabs can wait.</h2>
              <p>a soft, slow wash of sound.<br />two minutes. zero things to get right.</p>
              <div className="session-tags"><span>♫ ambient audio</span><span>◷ 2 minutes</span></div>
              <button className="primary-button" onClick={() => void startSession()} disabled={loading}>
                {loading ? 'making a little space…' : 'puddle now'} <span aria-hidden="true">↗</span>
              </button>
              <p className="fine-print" role="status">{loading ? 'waking up the sound. hang tight.' : 'sound on. shoulders optional. starts when you tap.'}</p>
              {error && <div className="error-message" role="alert">{error}</div>}
            </> : <>
              <span className="eyebrow">{active ? 'you are officially on a break' : 'welcome back, human'}</span>
              <h2 ref={heading} tabIndex={-1}>{active ? session?.payload.title : 'that was enough.'}</h2>
              <p>{active ? 'let the sound do its thing. you don’t have to.' : 'no achievement unlocked. just a little room to be.'}</p>
              {active && <>
                <div className="timer-row"><span className="timer" role="timer" aria-label={`${remaining} seconds remaining`}>{formatTime(remaining)}</span><span>of absolutely nothing urgent</span></div>
                <progress max={session?.payload.durationSeconds ?? 120} value={(session?.payload.durationSeconds ?? 120) - remaining} aria-label="session progress" />
                <div className="audio-controls">
                  <button className="small-button" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'unmute' : 'mute'}</button>
                  <label htmlFor="volume">volume</label>
                  <input id="volume" type="range" min="0" max="100" value={volume} aria-valuetext={`${volume} percent`} disabled={muted} onChange={(event) => setVolume(Number(event.target.value))} />
                </div>
                <button className="text-button" onClick={finish}>that’s enough for now ↗</button>
              </>}
              {finished && <button className="primary-button" onClick={() => void startSession()}>another little puddle <span aria-hidden="true">↗</span></button>}
            </>}
          </div>
        </div>
        {(active || finished) && <div className="feedback-row">
          <div><strong>your kind of nothing?</strong><p className="fine-print">prototype: feedback stays in your browser console.</p></div>
          <div className="feedback-buttons" role="group" aria-label="rate this session">
            <button className={`feedback-button ${feedback === 'up' ? 'selected' : ''}`} aria-label="thumbs up, liked this session" aria-pressed={feedback === 'up'} disabled={feedback !== null} onClick={() => rate('up')}>👍</button>
            <button className={`feedback-button ${feedback === 'down' ? 'selected' : ''}`} aria-label="thumbs down, not for me" aria-pressed={feedback === 'down'} disabled={feedback !== null} onClick={() => rate('down')}>👎</button>
          </div>
          <span className="feedback-status" role="status">{feedback ? 'noted. no wrong answers.' : ''}</span>
        </div>}
      </section>

      <div className="bottom-notes"><p><span aria-hidden="true">↳</span> not a productivity tool. that’s the point.</p><span className="badge teal">less feed. more float.</span></div>
    </main>

    <footer><span>puddle — a small rebellion against more.</span><span>phase 01 · same little sound for everyone</span></footer>
  </div>;
}
