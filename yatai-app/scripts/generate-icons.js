// Generate PWA icons using Canvas API
const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const { name, size, maskable } of sizes) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#111827'
  if (maskable) {
    // Maskable: fill entire canvas, content in safe zone (80%)
    ctx.fillRect(0, 0, size, size)
  } else {
    // Rounded rect
    const r = size * 0.2
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(size - r, 0)
    ctx.quadraticCurveTo(size, 0, size, r)
    ctx.lineTo(size, size - r)
    ctx.quadraticCurveTo(size, size, size - r, size)
    ctx.lineTo(r, size)
    ctx.quadraticCurveTo(0, size, 0, size - r)
    ctx.lineTo(0, r)
    ctx.quadraticCurveTo(0, 0, r, 0)
    ctx.closePath()
    ctx.fill()
  }

  // "Y" letter
  const fontSize = maskable ? size * 0.4 : size * 0.55
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Orange Y
  ctx.fillStyle = '#FB923C'
  ctx.fillText('Y', size / 2, size / 2)

  const buf = canvas.toBuffer('image/png')
  const outPath = path.join(__dirname, '..', 'public', 'icons', name)
  fs.writeFileSync(outPath, buf)
  console.log(`Generated ${name} (${size}x${size})`)
}
