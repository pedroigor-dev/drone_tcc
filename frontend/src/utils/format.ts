import type { PathPoint, Vector2 } from '../types'

export const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function positionAt(path: PathPoint[], time: number): Vector2 {
  if (!path.length) return [0, 0]
  if (time <= path[0][0]) return [path[0][1], path[0][2]]
  for (let index = 1; index < path.length; index++) {
    const [t1, x1, y1] = path[index]
    if (t1 >= time) {
      const [t0, x0, y0] = path[index - 1]
      const k = t1 === t0 ? 1 : (time - t0) / (t1 - t0)
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]
    }
  }
  const last = path[path.length - 1]
  return [last[1], last[2]]
}
