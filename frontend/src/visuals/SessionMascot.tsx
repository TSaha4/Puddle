import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AmbientSession } from '../../../shared/session';

// No runtime imports of Three, R3F, or drei above this lazy boundary.
const BlobScene = lazy(() => import('./BlobScene'));

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function SessionMascot({ session, active, fallback }: {
  session: AmbientSession | null;
  active: boolean;
  fallback: ReactNode;
}) {
  const [flat, setFlat] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(!document.hidden);
  const [poke, setPoke] = useState(0);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  // Preserve the fast flat landing page. Mount/download 3D only once a session opens.
  if (!session) return <>{fallback}</>;
  const show3d = !flat && !failed;
  return <div className="blob-visual">
    <div className="blob-frame">
      {show3d ? <SceneBoundary fallback={fallback} onFailure={fail}>
        <Suspense fallback={fallback}>
          <BlobScene sessionType={active ? session.sessionType : undefined}
            tempo={session.payload.tempo} reducedMotion={reducedMotion}
            paused={!visible} pokeRequest={poke} onFailure={fail} fallback={fallback} />
        </Suspense>
      </SceneBoundary> : fallback}
    </div>
    <div className="blob-actions">
      {show3d && <button className="small-button" disabled={reducedMotion} onClick={() => setPoke((value) => value + 1)}>poke the blob</button>}
      {!failed && <button className="text-button" aria-pressed={flat} onClick={() => setFlat(!flat)}>{flat ? 'back to 3d' : 'keep it flat'}</button>}
    </div>
    <p className="fine-print blob-caption" role="status">{failed ? 'flat today. your sound keeps going.' : flat ? 'less dimension. same puddle.' : reducedMotion ? 'a still little blob. motion preference respected.' : 'hover, drag, or tap “poke the blob”.'}</p>
  </div>;
}
