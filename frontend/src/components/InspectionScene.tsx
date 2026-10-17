import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls, Grid, Html, Line } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type CameraControlsImpl from 'camera-controls'
import type { Detection, LayerState, MissionData, PathPoint, Vector2 } from '../types'
import { edgeFade, plasterTextures } from './sceneMaterials'
import { positionAt } from '../utils/format'

export type CameraView = 'inspection' | 'frontal' | 'follow'

const SEVERITY_COLOR: Record<Detection['severity'], string> = { alta: '#ff5d4d', moderada: '#f5b544', baixa: '#d9d9d9' }

function pathBounds(path: PathPoint[], detections: Detection[]) {
  const xs = [...path.map((p) => p[1]), ...detections.map((d) => d.position[0])]
  const ys = [...path.map((p) => p[2]), ...detections.map((d) => d.position[1])]
  if (!xs.length) return { cx: 0, cy: 0, span: 2 }
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span: Math.max(1.6, maxX - minX + 1, (maxY - minY + 1) * 1.5) }
}

function Wall({ width, height }: { width: number; height: number }) {
  const maps = useMemo(() => plasterTextures(), [])
  const fade = useMemo(() => edgeFade(width, height), [width, height])
  useEffect(() => {
    maps.color.repeat.set(width / 0.9, height / 0.9)
    maps.normal.repeat.set(width / 0.9, height / 0.9)
  }, [maps, width, height])
  return <mesh receiveShadow>
    <planeGeometry args={[width, height]} />
    <meshStandardMaterial map={maps.color} normalMap={maps.normal} normalScale={new THREE.Vector2(0.9, 0.9)} alphaMap={fade} transparent roughness={0.96} metalness={0} color="#9c9a96" />
  </mesh>
}

function MosaicLayer({ url, width, height }: { url: string; width: number; height: number }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let cancelled = false
    new THREE.TextureLoader().load(url, (loaded) => {
      if (cancelled) { loaded.dispose(); return }
      loaded.colorSpace = THREE.SRGBColorSpace
      loaded.anisotropy = 8
      setTexture((previous) => { previous?.dispose(); return loaded })
    }, undefined, () => undefined)
    return () => { cancelled = true }
  }, [url])
  useEffect(() => () => texture?.dispose(), [texture])
  if (!texture) return null
  return <mesh position={[0, 0, 0.004]}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} color="#e6e6e6" />
  </mesh>
}

function EvidenceTiles({ detections, footprint }: { detections: Detection[]; footprint: Vector2 }) {
  return <>{detections.map((detection) => <EvidenceTile key={detection.id} detection={detection} footprint={footprint} />)}</>
}

function EvidenceTile({ detection, footprint }: { detection: Detection; footprint: Vector2 }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const fade = useMemo(() => edgeFade(footprint[0], footprint[1]), [footprint])
  useEffect(() => {
    let cancelled = false
    new THREE.TextureLoader().load(detection.frameUrl, (loaded) => {
      if (cancelled) return
      loaded.colorSpace = THREE.SRGBColorSpace
      setTexture(loaded)
    })
    return () => { cancelled = true }
  }, [detection.frameUrl])
  if (!texture) return null
  const centerX = detection.frameCenter?.[0] ?? detection.position[0] - ((detection.bbox.x + detection.bbox.width / 2) / 100 - 0.5) * footprint[0]
  const centerY = detection.frameCenter?.[1] ?? detection.position[1] + ((detection.bbox.y + detection.bbox.height / 2) / 100 - 0.5) * footprint[1]
  return <mesh position={[centerX, centerY, 0.003]}>
    <planeGeometry args={footprint} />
    <meshBasicMaterial map={texture} alphaMap={fade} transparent depthWrite={false} toneMapped={false} color="#e0e0e0" />
  </mesh>
}

function Drone({ position, distance, follow }: { position: Vector2; distance: number; follow: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const rotors = useRef<THREE.Group[]>([])
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }, delta) => {
    if (!ref.current) return
    target.set(position[0], position[1] + Math.sin(clock.elapsedTime * 2.2) * 0.008, distance)
    ref.current.position.lerp(target, 1 - Math.pow(0.0005, delta))
    rotors.current.forEach((rotor, index) => { if (rotor) rotor.rotation.y += delta * (index % 2 ? -38 : 38) })
  })
  return <group ref={ref} position={[position[0], position[1], distance]} visible={!follow}>
    <group scale={0.42}>
      <mesh castShadow><boxGeometry args={[0.2, 0.07, 0.3]} /><meshStandardMaterial color="#1d1f21" metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 0.045, 0]}><boxGeometry args={[0.14, 0.03, 0.2]} /><meshStandardMaterial color="#2a2d30" metalness={0.5} roughness={0.4} /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], index) => <group key={index}>
        <mesh position={[sx * 0.13, 0, sz * 0.13]} rotation={[0, Math.atan2(sz, sx) * -1, 0]}><boxGeometry args={[0.24, 0.025, 0.03]} /><meshStandardMaterial color="#26292c" metalness={0.6} roughness={0.35} /></mesh>
        <mesh position={[sx * 0.22, 0.03, sz * 0.22]}><cylinderGeometry args={[0.028, 0.028, 0.05, 16]} /><meshStandardMaterial color="#111" metalness={0.7} roughness={0.3} /></mesh>
        <group position={[sx * 0.22, 0.06, sz * 0.22]} ref={(node) => { if (node) rotors.current[index] = node }}>
          <mesh><cylinderGeometry args={[0.1, 0.1, 0.004, 40]} /><meshBasicMaterial color="#9aa0a6" transparent opacity={0.16} depthWrite={false} /></mesh>
          <mesh><boxGeometry args={[0.2, 0.006, 0.018]} /><meshStandardMaterial color="#3a3d40" /></mesh>
        </group>
      </group>)}
      <mesh position={[0, -0.02, -0.17]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.03, 0.034, 0.05, 20]} /><meshStandardMaterial color="#0c0c0c" metalness={0.8} roughness={0.2} /></mesh>
      <mesh position={[0, -0.02, -0.196]} rotation={[0, Math.PI, 0]}><circleGeometry args={[0.022, 24]} /><meshBasicMaterial color="#5ab0ff" toneMapped={false} /></mesh>
      <mesh position={[0.08, 0.04, 0.14]}><sphereGeometry args={[0.008, 8, 8]} /><meshBasicMaterial color="#ff4d4d" toneMapped={false} /></mesh>
    </group>
  </group>
}

function Frustum({ position, distance, footprint }: { position: Vector2; distance: number; footprint: Vector2 }) {
  const [x, y] = position
  const [w, h] = [footprint[0] / 2, footprint[1] / 2]
  const lens: [number, number, number] = [x, y, distance - 0.06]
  const corners: [number, number, number][] = [[x - w, y - h, 0.01], [x + w, y - h, 0.01], [x + w, y + h, 0.01], [x - w, y + h, 0.01]]
  return <group>
    {corners.map((corner, index) => <Line key={index} points={[lens, corner]} color="#7cc4ff" lineWidth={0.8} transparent opacity={0.35} />)}
    <Line points={[...corners, corners[0]]} color="#7cc4ff" lineWidth={1.4} transparent opacity={0.9} />
    <mesh position={[x, y, 0.009]}><planeGeometry args={footprint} /><meshBasicMaterial color="#7cc4ff" transparent opacity={0.07} depthWrite={false} /></mesh>
    <WallSpot x={x} y={y} distance={distance} />
  </group>
}

function WallSpot({ x, y, distance }: { x: number; y: number; distance: number }) {
  const light = useRef<THREE.SpotLight>(null)
  useEffect(() => {
    if (!light.current) return
    light.current.target.position.set(x, y, 0)
    light.current.target.updateMatrixWorld()
  }, [x, y])
  return <spotLight ref={light} position={[x, y, distance]} angle={0.55} penumbra={0.9} intensity={2.2} distance={distance * 4} decay={1} color="#ffffff" />
}

function Trajectory({ path, distance }: { path: PathPoint[]; distance: number }) {
  const points = useMemo(() => path.map(([, x, y]) => new THREE.Vector3(x, y, distance)), [path, distance])
  const shadow = useMemo(() => path.map(([, x, y]) => new THREE.Vector3(x, y, 0.012)), [path])
  if (points.length < 2) return null
  return <group>
    <Line points={points} color="#ffffff" lineWidth={1.2} transparent opacity={0.55} />
    <Line points={shadow} color="#7cc4ff" lineWidth={1} dashed dashSize={0.04} gapSize={0.03} transparent opacity={0.5} />
    <mesh position={points[0]}><sphereGeometry args={[0.022, 16, 16]} /><meshBasicMaterial color="#ffffff" /></mesh>
  </group>
}

function DetectionMarker({ detection, active, onSelect }: { detection: Detection; active: boolean; onSelect: () => void }) {
  const ring = useRef<THREE.Mesh>(null)
  const color = detection.status === 'descartada' ? '#5c5c5c' : SEVERITY_COLOR[detection.severity]
  const width = Math.max(0.05, detection.sizeM.width)
  const height = Math.max(0.05, detection.sizeM.height)
  const [x, y] = detection.position
  useFrame(({ clock }) => {
    if (!ring.current) return
    const pulse = (clock.elapsedTime * 0.9) % 1
    ring.current.scale.setScalar(1 + pulse * 1.6)
    ;(ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * (active ? 0.8 : 0.4)
  })
  const corners: [number, number, number][] = [[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, height / 2, 0], [-width / 2, -height / 2, 0]]
  return <group position={[x, y, 0.016]} onClick={(event) => { event.stopPropagation(); onSelect() }} onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
    <Line points={corners} color={color} lineWidth={active ? 2 : 1.2} transparent opacity={active ? 1 : 0.75} />
    <mesh><planeGeometry args={[width, height]} /><meshBasicMaterial color={color} transparent opacity={active ? 0.12 : 0.05} depthWrite={false} /></mesh>
    <mesh position={[0, 0, 0.002]}><circleGeometry args={[0.018, 24]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
    <mesh ref={ring} position={[0, 0, 0.001]}><ringGeometry args={[0.028, 0.034, 40]} /><meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} /></mesh>
    {active && <Html position={[width / 2, height / 2, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="scene-tag"><b>{detection.id}</b><span>{Math.round(detection.confidence * 100)}% · {(detection.sizeM.diagonal * 100).toFixed(0)} cm</span></div>
    </Html>}
  </group>
}

function CameraDirector({ view, focus, dronePosition, distance, fitKey }: { view: CameraView; focus: { x: number; y: number; span: number }; dronePosition: Vector2; distance: number; fitKey: number }) {
  const controls = useRef<CameraControlsImpl>(null)
  const { size } = useThree()
  const aspect = size.width / Math.max(size.height, 1)
  useEffect(() => {
    const control = controls.current
    if (!control || view === 'follow') return
    const reach = focus.span / Math.min(aspect, 1.6) * 1.55 + 0.6
    if (view === 'frontal') control.setLookAt(focus.x, focus.y, reach, focus.x, focus.y, 0, true)
    else control.setLookAt(focus.x + reach * 0.42, focus.y + reach * 0.2, reach * 0.95, focus.x, focus.y, 0, true)
  }, [view, focus.x, focus.y, focus.span, aspect, fitKey])
  useFrame(() => {
    if (view !== 'follow' || !controls.current) return
    const [x, y] = dronePosition
    controls.current.setLookAt(x + 0.18, y + 0.12, distance + 0.55, x, y, 0, true)
  })
  return <CameraControls ref={controls} makeDefault smoothTime={0.6} minDistance={0.25} maxDistance={18} dollySpeed={0.6} />
}

type Props = {
  data: MissionData
  time: number
  selected: Detection | null
  onSelect: (detection: Detection) => void
  layers: LayerState
  view: CameraView
  fitKey: number
  live: boolean
  distance: number
  footprint: Vector2
}

export function InspectionScene({ data, time, selected, onSelect, layers, view, fitKey, live, distance, footprint }: Props) {
  const path = useMemo(() => live ? data.path : data.path.filter((point) => point[0] <= time), [data.path, time, live])
  const visible = useMemo(() => live ? data.detections : data.detections.filter((d) => d.firstSeen <= time), [data.detections, time, live])
  const dronePosition = useMemo<Vector2>(() => live && data.telemetry.position ? data.telemetry.position : positionAt(data.path, time), [live, data.telemetry.position, data.path, time])
  const bounds = useMemo(() => pathBounds(data.path, data.detections), [data.path, data.detections])
  const focus = useMemo(() => selected ? { x: selected.position[0], y: selected.position[1], span: Math.max(0.9, selected.sizeM.diagonal * 3) } : { x: bounds.cx, y: bounds.cy, span: bounds.span }, [selected, bounds])
  const wallWidth = Math.max(data.mosaic.width || 10, 6)
  const wallHeight = Math.max(data.mosaic.height || 6, 4)

  return <Canvas shadows dpr={[1, 2]} camera={{ position: [2.5, 1, 5.5], fov: 34, near: 0.02, far: 80 }} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }} onPointerMissed={() => undefined}>
    <color attach="background" args={['#070708']} />
    <fog attach="fog" args={['#070708', 9, 26]} />
    <hemisphereLight args={['#dfe6ee', '#0a0a0a', 0.55]} />
    <directionalLight position={[-6, 4.5, 2.2]} intensity={1.6} color="#fff6ea" />
    <directionalLight position={[5, -2, 6]} intensity={0.25} color="#9fc6ff" />
    <Wall width={wallWidth + 4} height={wallHeight + 3} />
    {layers.mosaic && data.mosaicUrl && <MosaicLayer url={data.mosaicUrl} width={data.mosaic.width} height={data.mosaic.height} />}
    {layers.mosaic && !data.mosaicUrl && <EvidenceTiles detections={visible} footprint={footprint} />}
    {layers.grid && <Grid position={[0, 0, 0.008]} rotation={[Math.PI / 2, 0, 0]} args={[wallWidth, wallHeight]} cellSize={0.1} cellThickness={0.5} cellColor="#3c3f44" sectionSize={0.5} sectionThickness={0.9} sectionColor="#5b6068" fadeDistance={14} fadeStrength={1.2} side={THREE.DoubleSide} />}
    {layers.trajectory && <Trajectory path={path} distance={distance} />}
    {layers.frustum && <Frustum position={dronePosition} distance={distance} footprint={footprint} />}
    <Drone position={dronePosition} distance={distance} follow={view === 'follow'} />
    {layers.detections && visible.map((detection) => <DetectionMarker key={detection.id} detection={detection} active={selected?.id === detection.id} onSelect={() => onSelect(detection)} />)}
    <CameraDirector view={view} focus={focus} dronePosition={dronePosition} distance={distance} fitKey={fitKey} />
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.4} mipmapBlur />
      <Vignette eskil={false} offset={0.22} darkness={0.7} />
    </EffectComposer>
  </Canvas>
}
