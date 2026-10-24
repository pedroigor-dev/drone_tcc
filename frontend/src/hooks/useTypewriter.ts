import { useEffect, useRef, useState } from 'react'

export function useTypewriter(target: string, enabled = true, charsPerSecond = 70) {
  const [count, setCount] = useState(enabled ? 0 : target.length)
  const countRef = useRef(count)
  const previous = useRef(target)

  useEffect(() => {
    if (!target.startsWith(previous.current.slice(0, countRef.current))) countRef.current = 0
    previous.current = target
    if (!enabled) {
      countRef.current = target.length
      setCount(target.length)
      return
    }
    setCount(countRef.current)
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const backlog = target.length - countRef.current
      if (backlog <= 0) return
      const rate = charsPerSecond * (backlog > 400 ? 4 : backlog > 120 ? 2 : 1)
      const step = Math.floor((now - last) / 1000 * rate)
      if (step >= 1) {
        countRef.current = Math.min(target.length, countRef.current + step)
        last = now
        setCount(countRef.current)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, enabled, charsPerSecond])

  return { text: target.slice(0, count), typing: count < target.length }
}
