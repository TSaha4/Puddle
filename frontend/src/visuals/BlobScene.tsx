import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { BackSide, DataTexture, Group, IcosahedronGeometry, Mesh, NearestFilter, RGBAFormat } from 'three';
import { blobProfile, blobRadius, NO_POKE, type BlobProfile, type Poke } from './blobMath';

interface SceneProps {
  sessionType?: string;
  tempo: number;
  reducedMotion: boolean;
  paused: boolean;
  pokeRequest: number;
  onFailure: () => void;
  fallback: ReactNode;
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [canvas, onFailure]);
  return null;
}

function Blob({ profile, reducedMotion, pokeRequest, onFailure }: {
  profile: BlobProfile; reducedMotion: boolean; pokeRequest: number; onFailure: () => void;
}) {
  const mesh = useRef<Mesh>(null);
  const face = useRef<Group>(null);
  const group = useRef<Group>(null);
  const pointer = useRef<Poke>({ ...NO_POKE });
  const hover = useRef(false);
  const dragging = useRef(false);
  const impulse = useRef(0);
  const time = useRef(0);
  const pending = useRef(0);
  const geometry = useMemo(() => new IcosahedronGeometry(1, 3), []);
  const base = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  const gradient = useMemo(() => {
    // Three hard lighting steps, not photorealistic reflections or postprocessing.
    const texture = new DataTexture(new Uint8Array([
      95, 95, 95, 255, 175, 175, 175, 255, 255, 255, 255, 255
    ]), 3, 1, RGBAFormat);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }, []);

  function deform(t: number, strength: number) {
    const positions = geometry.attributes.position;
    const appearance = reducedMotion ? { ...profile, amplitude: 0 } : profile;
    const poke = { ...pointer.current, strength: reducedMotion ? 0 : strength };
    for (let i = 0; i < positions.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const radius = blobRadius(x, y, z, t, appearance, poke);
      positions.setXYZ(i, x * radius * 1.08, y * radius * 0.92, z * radius);
    }
    positions.needsUpdate = true;
    // Non-indexed ico triangles retain the faceted, hand-drawn/toon look.
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    if (face.current) face.current.position.z = blobRadius(0, 0, 1, t, appearance, poke) + 0.07;
  }

  useEffect(() => {
    deform(0, 0);
    if (group.current) {
      group.current.position.y = 0;
      group.current.rotation.z = -0.05;
    }
  }, [profile, reducedMotion]);

  useEffect(() => {
    if (pokeRequest && !reducedMotion) {
      pointer.current = { ...NO_POKE };
      impulse.current = 0.3;
    }
  }, [pokeRequest, reducedMotion]);

  useEffect(() => {
    const release = () => { dragging.current = false; hover.current = false; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      geometry.dispose();
      gradient.dispose();
    };
  }, [geometry, gradient]);

  useFrame((_state, delta) => {
    if (reducedMotion) return;
    pending.current += Math.min(delta, 0.1);
    if (pending.current < 1 / 30) return;
    const step = pending.current;
    pending.current = 0;
    time.current += step;
    impulse.current *= Math.exp(-step * 3.5);
    const target = Math.max(impulse.current, dragging.current ? 0.27 : hover.current ? 0.12 : 0);
    pointer.current.strength += (target - pointer.current.strength) * (1 - Math.exp(-step * 10));
    // Frame callbacks run outside React's error boundary: keep audio alive on failure.
    try {
      deform(time.current, pointer.current.strength);
      if (group.current) {
        group.current.position.y = Math.sin(time.current * profile.speed) * 0.045;
        group.current.rotation.z = -0.05 + Math.sin(time.current * profile.speed * 0.7) * 0.03;
      }
    } catch {
      onFailure();
    }
  });

  function point(event: ThreeEvent<PointerEvent>) {
    if (reducedMotion || !mesh.current) return;
    event.stopPropagation();
    const local = mesh.current.worldToLocal(event.point.clone());
    local.set(local.x / 1.08, local.y / 0.92, local.z).normalize();
    pointer.current.x = local.x;
    pointer.current.y = local.y;
    pointer.current.z = local.z;
    hover.current = true;
  }

  return <group ref={group}>
    <mesh ref={mesh} geometry={geometry}
      onPointerOver={point} onPointerMove={point}
      onPointerOut={() => { hover.current = false; }}
      onPointerDown={(event) => {
        if (reducedMotion) return;
        point(event);
        dragging.current = true;
        (event.target as Element).setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        const target = event.target as Element;
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      }}>
      <meshToonMaterial color={profile.color} gradientMap={gradient} />
    </mesh>
    <mesh geometry={geometry} scale={1.028}>
      <meshBasicMaterial color="#111111" side={BackSide} />
    </mesh>
    <group ref={face} position={[0, 0, 1.12]}>
      {[-0.25, 0.25].map((x) => <mesh key={x} position={[x, 0.09, 0]} scale={[0.065, 0.085, 0.04]}>
        <sphereGeometry args={[1, 12, 8]} /><meshBasicMaterial color="#111111" />
      </mesh>)}
      <mesh position={[0, -0.12, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.115, 0.019, 6, 16, Math.PI]} /><meshBasicMaterial color="#111111" />
      </mesh>
    </group>
  </group>;
}

export default function BlobScene(props: SceneProps) {
  const profile = useMemo(() => blobProfile(props.sessionType, props.tempo), [props.sessionType, props.tempo]);
  return <Canvas dpr={[1, 2]} frameloop={props.paused ? 'never' : props.reducedMotion ? 'demand' : 'always'}
    gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
    fallback={props.fallback} aria-label="three-dimensional puddle mascot">
    <OrthographicCamera makeDefault position={[0, 0, 6]} zoom={85} near={0.1} far={20} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[-3, 4, 5]} intensity={2} />
    <ContextGuard onFailure={props.onFailure} />
    <Blob profile={profile} reducedMotion={props.reducedMotion} pokeRequest={props.pokeRequest} onFailure={props.onFailure} />
  </Canvas>;
}
