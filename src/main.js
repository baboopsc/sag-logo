import './style.css'

const SETTINGS_KEY = 'sag-logo-ayarlar'
const LOGO_KEY = 'sag-logo-ozel'
const COLORS = { yesil: '#049a35', beyaz: '#ffffff', siyah: '#111111' }
const DEFAULTS = { size: 35, opacity: 90, color: 'beyaz', shadow: true, shadowStr: 50, x: 0.75, y: 0.88 }
const PREVIEW_MAX = 1400             // ekranda gösterilen önizleme boyutu
const EXPORT_MAX_PIXELS = 16_000_000 // iPhone canvas sınırı

const $ = (id) => document.getElementById(id)
const canvas = $('canvas')
const ctx = canvas.getContext('2d')
const ui = {
  empty: $('empty'), hint: $('hint'), save: $('saveBtn'),
  size: $('size'), sizeOut: $('sizeOut'),
  opacity: $('opacity'), opacityOut: $('opacityOut'),
  shadow: $('shadow'), shadowStr: $('shadowStr'),
  colors: $('colors'), photoInput: $('photoInput'),
  logoInput: $('logoInput'), reset: $('resetBtn'),
}

let s = loadSettings()
let photo = null
let photoUrl = null
let photoName = 'foto'
let logo = null          // beyaz, şeffaf zeminli, kırpılmış logo
const tintCache = new Map()
let pendingFile = null   // iOS: hazırlanan ama henüz paylaşılmayan dosya
const isTouch = matchMedia('(pointer: coarse)').matches
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ---------------- Ayarlar ----------------
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) } }
  catch { return { ...DEFAULTS } }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}
function storedLogo() {
  try { return localStorage.getItem(LOGO_KEY) } catch { return null }
}

function syncUI() {
  ui.size.value = s.size; ui.sizeOut.textContent = `%${s.size}`
  ui.opacity.value = s.opacity; ui.opacityOut.textContent = `%${s.opacity}`
  ui.shadow.checked = s.shadow
  ui.shadowStr.value = s.shadowStr
  ui.shadowStr.disabled = !s.shadow
  ui.colors.querySelectorAll('[data-color]').forEach((b) =>
    b.classList.toggle('active', b.dataset.color === s.color))
}

function update() {
  clampPos(); syncUI(); saveSettings(); requestDraw()
}

// ---------------- Logo ----------------
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

// Beyaz zemini siler, logoyu tek renk maskeye çevirir, boşlukları kırpar
function prepareLogo(img) {
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * k)
  const h = Math.round(img.naturalHeight * k)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(img, 0, 0, w, h)
  const data = x.getImageData(0, 0, w, h)
  const p = data.data

  // PNG zaten şeffafsa onun şeffaflığını kullan, değilse beyazı sil
  let transparent = false
  for (let i = 3; i < p.length; i += 4) if (p[i] < 250) { transparent = true; break }

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let i = 0; i < p.length; i += 4) {
    const a = transparent ? p[i + 3] : 255 - Math.min(p[i], p[i + 1], p[i + 2])
    p[i] = p[i + 1] = p[i + 2] = 255
    p[i + 3] = a
    if (a > 30) {
      const n = i / 4, px = n % w, py = (n / w) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }
  x.putImageData(data, 0, 0)
  if (maxX < 0) return c

  const ow = maxX - minX + 1, oh = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = ow; out.height = oh
  out.getContext('2d').drawImage(c, minX, minY, ow, oh, 0, 0, ow, oh)
  return out
}

function tinted(color) {
  if (!tintCache.has(color)) {
    const c = document.createElement('canvas')
    c.width = logo.width; c.height = logo.height
    const x = c.getContext('2d')
    x.drawImage(logo, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = COLORS[color]
    x.fillRect(0, 0, c.width, c.height)
    tintCache.set(color, c)
  }
  return tintCache.get(color)
}

async function setLogo(src) {
  logo = prepareLogo(await loadImage(src))
  tintCache.clear()
  update()
}

// ---------------- Çizim ----------------
function logoBox(W, H) {
  const lw = W * s.size / 100
  const lh = lw * logo.height / logo.width
  return { lw, lh, x: s.x * W - lw / 2, y: s.y * H - lh / 2 }
}

function paint(c, x) {
  x.clearRect(0, 0, c.width, c.height)
  x.drawImage(photo, 0, 0, c.width, c.height)
  if (!logo) return
  const b = logoBox(c.width, c.height)
  x.save()
  x.globalAlpha = s.opacity / 100
  if (s.shadow && s.shadowStr > 0) {
    const k = s.shadowStr / 100
    const a = (0.3 + 0.5 * k).toFixed(2)
    x.shadowColor = s.color === 'siyah' ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
    x.shadowBlur = b.lw * 0.05 * k
    x.shadowOffsetY = b.lw * 0.012 * k
  }
  x.drawImage(tinted(s.color), b.x, b.y, b.lw, b.lh)
  x.restore()
}

let raf = 0
function requestDraw() {
  if (pendingFile) { pendingFile = null; resetSaveLabel() }
  if (raf || !photo) return
  raf = requestAnimationFrame(() => { raf = 0; paint(canvas, ctx) })
}

// Logo fotoğrafın dışına taşmasın
function clampPos() {
  if (!photo || !logo) return
  const hw = Math.min(0.5, s.size / 200)
  const hh = Math.min(0.5, hw * (logo.height / logo.width) * (canvas.width / canvas.height))
  s.x = clamp(s.x, hw, 1 - hw)
  s.y = clamp(s.y, hh, 1 - hh)
}

// ---------------- Fotoğraf yükleme ----------------
ui.photoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const url = URL.createObjectURL(file)
  try {
    photo = await loadImage(url)
  } catch {
    URL.revokeObjectURL(url)
    alert('Bu fotoğraf açılamadı. JPG veya PNG deneyin.')
    return
  }
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  photoUrl = url
  photoName = file.name.replace(/\.[^.]+$/, '') || 'foto'

  const k = Math.min(1, PREVIEW_MAX / Math.max(photo.naturalWidth, photo.naturalHeight))
  canvas.width = Math.round(photo.naturalWidth * k)
  canvas.height = Math.round(photo.naturalHeight * k)
  canvas.hidden = false
  ui.empty.hidden = true
  ui.hint.hidden = false
  ui.save.disabled = false
  update()
})

// ---------------- Sürükleme + iki parmakla büyütme ----------------
const pointers = new Map()
let drag = null
let pinch = null

const rel = (e) => {
  const r = canvas.getBoundingClientRect()
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
}
const dist = () => {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

canvas.addEventListener('pointerdown', (e) => {
  if (!photo || !logo) return
  canvas.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size === 2) {
    pinch = { d: dist(), size: s.size }
    drag = null
    return
  }
  const p = rel(e)
  const hw = s.size / 200
  const hh = hw * (logo.height / logo.width) * (canvas.width / canvas.height)
  const inside = Math.abs(p.x - s.x) < hw && Math.abs(p.y - s.y) < hh
  // Logoya dokunduysa tuttuğu yerden sürükle, boş yere dokunduysa logo oraya gelsin
  drag = inside ? { dx: s.x - p.x, dy: s.y - p.y } : { dx: 0, dy: 0 }
  moveTo(p)
})

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && pointers.size === 2) {
    s.size = clamp(Math.round(pinch.size * dist() / pinch.d), 5, 90)
    clampPos(); syncUI(); requestDraw()
  } else if (drag) {
    moveTo(rel(e))
  }
})

function endPointer(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 0) { drag = null; saveSettings() }
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

function moveTo(p) {
  s.x = p.x + drag.dx
  s.y = p.y + drag.dy
  clampPos()
  requestDraw()
}

// ---------------- Ayar kontrolleri ----------------
ui.size.addEventListener('input', () => { s.size = +ui.size.value; update() })
ui.opacity.addEventListener('input', () => { s.opacity = +ui.opacity.value; update() })
ui.shadow.addEventListener('change', () => { s.shadow = ui.shadow.checked; update() })
ui.shadowStr.addEventListener('input', () => { s.shadowStr = +ui.shadowStr.value; update() })
ui.colors.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color]')
  if (!btn) return
  s.color = btn.dataset.color
  update()
})

// Farklı logo yükle (telefonda hatırlanır)
ui.logoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const url = URL.createObjectURL(file)
  try {
    logo = prepareLogo(await loadImage(url))
    tintCache.clear()
    try { localStorage.setItem(LOGO_KEY, logo.toDataURL('image/png')) }
    catch { alert('Logo kullanılıyor ama kalıcı olarak kaydedilemedi.') }
    update()
  } catch {
    alert('Logo açılamadı.')
  } finally {
    URL.revokeObjectURL(url)
  }
})

ui.reset.addEventListener('click', async () => {
  if (!confirm('Ayarlar ve logo varsayılana dönsün mü?')) return
  s = { ...DEFAULTS }
  try { localStorage.removeItem(LOGO_KEY) } catch {}
  await setLogo('/logo.png')
})

// ---------------- Kaydetme / İndirme ----------------
function resetSaveLabel() { ui.save.textContent = '⬇ Kaydet' }

function exportBlob() {
  const W = photo.naturalWidth, H = photo.naturalHeight
  const k = Math.min(1, Math.sqrt(EXPORT_MAX_PIXELS / (W * H)))
  const c = document.createElement('canvas')
  c.width = Math.round(W * k)
  c.height = Math.round(H * k)
  paint(c, c.getContext('2d'))
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Görsel oluşturulamadı'))), 'image/jpeg', 0.92))
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

async function shareFile(file) {
  try {
    await navigator.share({ files: [file] })
    pendingFile = null
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      // iOS hazırlık uzun sürünce paylaşımı engeller: ikinci dokunuşta açılır
      pendingFile = file
      ui.save.textContent = '📲 Hazır! Kaydetmek için dokun'
    } else if (err.name !== 'AbortError') {
      download(file, file.name)
    }
  }
}

ui.save.addEventListener('click', async () => {
  if (!photo) return
  if (pendingFile) {
    await shareFile(pendingFile)
    if (!pendingFile) resetSaveLabel()
    return
  }
  ui.save.disabled = true
  ui.save.textContent = 'Hazırlanıyor…'
  try {
    const blob = await exportBlob()
    const name = `${photoName}-logolu.jpg`
    const file = new File([blob], name, { type: 'image/jpeg' })
    if (isTouch && navigator.canShare?.({ files: [file] })) {
      await shareFile(file)
    } else {
      download(blob, name)
    }
  } catch (err) {
    alert('Kaydedilemedi: ' + err.message)
  } finally {
    ui.save.disabled = false
    if (!pendingFile) resetSaveLabel()
  }
})

// ---------------- Başlat ----------------
syncUI()
setLogo(storedLogo() || '/logo.png').catch(() => setLogo('/logo.png'))