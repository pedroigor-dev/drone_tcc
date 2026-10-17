import * as THREE from 'three'

function seeded(seed: number) {
  let value = seed
  return () => {
    value = value * 16807 % 2147483647
    return (value - 1) / 2147483646
  }
}

export function plasterTextures(size = 512) {
  const random = seeded(29)
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = heightCanvas.height = size
  const context = heightCanvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = '#808080'
  context.fillRect(0, 0, size, size)
  for (let index = 0; index < 7000; index++) {
    const shade = Math.floor(70 + random() * 120)
    context.fillStyle = `rgba(${shade},${shade},${shade},${0.25 + random() * 0.5})`
    const radius = 1 + random() * 3.4
    const px = random() * size
    const py = random() * size
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      context.beginPath()
      context.arc(px + ox, py + oy, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  const blurred = document.createElement('canvas')
  blurred.width = blurred.height = size
  const blurContext = blurred.getContext('2d', { willReadFrequently: true })!
  blurContext.filter = 'blur(1.2px)'
  for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) blurContext.drawImage(heightCanvas, ox, oy)
  const pixels = blurContext.getImageData(0, 0, size, size).data
  const heightAt = (x: number, y: number) => pixels[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255

  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = normalCanvas.height = size
  const normalContext = normalCanvas.getContext('2d')!
  const normalImage = normalContext.createImageData(size, size)
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = colorCanvas.height = size
  const colorContext = colorCanvas.getContext('2d')!
  const colorImage = colorContext.createImageData(size, size)
  const strength = 2.4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength
      const length = Math.hypot(dx, dy, 1)
      const offset = (y * size + x) * 4
      normalImage.data[offset] = (-dx / length * 0.5 + 0.5) * 255
      normalImage.data[offset + 1] = (dy / length * 0.5 + 0.5) * 255
      normalImage.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255
      normalImage.data[offset + 3] = 255
      const tone = 196 + (heightAt(x, y) - 0.5) * 34
      colorImage.data[offset] = tone
      colorImage.data[offset + 1] = tone - 2
      colorImage.data[offset + 2] = tone - 7
      colorImage.data[offset + 3] = 255
    }
  }
  normalContext.putImageData(normalImage, 0, 0)
  colorContext.putImageData(colorImage, 0, 0)

  const color = new THREE.CanvasTexture(colorCanvas)
  color.colorSpace = THREE.SRGBColorSpace
  const normal = new THREE.CanvasTexture(normalCanvas)
  for (const texture of [color, normal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = 8
  }
  return { color, normal }
}

export function edgeFade(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = Math.max(16, Math.round(256 * height / width))
  const context = canvas.getContext('2d')!
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const horizontal = context.createLinearGradient(0, 0, canvas.width, 0)
  horizontal.addColorStop(0, '#000')
  horizontal.addColorStop(0.16, '#fff')
  horizontal.addColorStop(0.84, '#fff')
  horizontal.addColorStop(1, '#000')
  context.fillStyle = horizontal
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'multiply'
  const vertical = context.createLinearGradient(0, 0, 0, canvas.height)
  vertical.addColorStop(0, '#000')
  vertical.addColorStop(0.2, '#fff')
  vertical.addColorStop(0.8, '#fff')
  vertical.addColorStop(1, '#000')
  context.fillStyle = vertical
  context.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  return texture
}
