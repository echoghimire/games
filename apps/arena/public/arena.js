// Arena front end: lobby UI, WAD download, and launching the Doom engine
// (engine/websockets-doom.js, built from ../../engine) as host, client or solo.

const WAD_VERSION = '0.13.0'
const SERVER_NAME = 'Tronix Arena'
const $ = id => document.getElementById(id)

const state = { me: null, room: null, role: null, pollTimer: null, started: false }

// ---------- screens ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id
}

function fail(title, text) {
  stopPolling()
  $('game').hidden = true
  $('screens').hidden = false
  document.body.classList.remove('playing')
  $('message-title').textContent = title
  $('message-text').textContent = text || ''
  show('screen-message')
}

function toast(text, ms = 4000) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => (t.hidden = true), ms)
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  if (res.status === 401 || res.status === 402) {
    location.reload() // the Worker will redirect to login / pay
    throw new Error('auth')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

// ---------- boot ----------

async function boot() {
  state.me = await api('/api/me')
  $('who-name').textContent = state.me.name
  $('home-name').textContent = state.me.name
  $('account-link').href = state.me.landingUrl

  for (const b of document.querySelectorAll('[data-back]')) {
    b.onclick = () => {
      history.replaceState(null, '', '/')
      show('screen-home')
    }
  }
  $('go-host').onclick = () => show('screen-host')
  $('go-solo').onclick = () => startSolo()
  $('join-form').onsubmit = e => {
    e.preventDefault()
    const code = $('join-code').value.trim().toUpperCase()
    if (code) openJoin(code)
  }
  $('host-form').onsubmit = e => {
    e.preventDefault()
    hostRoom(Object.fromEntries(new FormData(e.target)))
  }

  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)$/)
  if (m) openJoin(m[1].toUpperCase())
  else show('screen-home')
}

// ---------- host / join / solo ----------

async function hostRoom(form) {
  $('host-submit').disabled = true
  try {
    const { code, settings } = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ ...form, monsters: form.monsters === 'on' }),
    })
    state.room = { code, settings }
    state.role = 'host'
    history.replaceState(null, '', `/r/${code}`)
    await launch(settings.wad, [
      '-server',
      '-privateserver',
      '-dup', '1',
      '-nodes', String(settings.players),
      '-wss', wsUrl(code),
      ...gameArgs(settings),
    ])
    showLobby(code)
  } catch (err) {
    if (err.message !== 'auth') fail('Could not create the room', err.message)
  } finally {
    $('host-submit').disabled = false
  }
}

async function openJoin(code) {
  show('screen-join')
  $('join-title').textContent = code
  $('join-info').textContent = 'Looking up the room…'
  $('join-go').disabled = true
  history.replaceState(null, '', `/r/${code}`)
  let info
  try {
    info = await api(`/api/rooms/${code}`)
  } catch (err) {
    $('join-info').textContent = err.message
    return
  }
  if (info.isHost) {
    $('join-info').textContent = 'This is your room, but its match has ended because you left. Create a new room.'
    return
  }
  const s = info.settings
  $('join-info').innerHTML = ''
  const lines = [
    ['Host', info.hostName],
    ['Mode', { deathmatch: 'Deathmatch', altdeath: 'Deathmatch 2.0', coop: 'Co-op' }[s.mode]],
    ['Maps', { 'freedm.wad': 'FreeDM', 'freedoom1.wad': 'Freedoom: Phase 1', 'freedoom2.wad': 'Freedoom: Phase 2' }[s.wad]],
    ['Players', `${info.players.length} / ${s.players}`],
  ]
  for (const [k, v] of lines) {
    const row = document.createElement('div')
    row.className = 'kv'
    row.append(Object.assign(document.createElement('span'), { textContent: k }))
    row.append(Object.assign(document.createElement('strong'), { textContent: v }))
    $('join-info').append(row)
  }
  if (info.started) return note('This match has already started. Ask the host to make a new room.')
  if (!info.hostOnline) return note('The host is not in the room right now.')
  if (info.players.length >= s.players) return note('This room is full.')

  $('join-go').disabled = false
  $('join-go').onclick = async () => {
    state.room = { code, settings: s }
    state.role = 'client'
    try {
      await launch(s.wad, ['-connect', '1', '-dup', '1', '-wss', wsUrl(code)])
      toast('Connected. Waiting for the host to start the match…', 8000)
    } catch (err) {
      fail('Could not join', err.message)
    }
  }

  function note(text) {
    const p = document.createElement('p')
    p.className = 'warn'
    p.textContent = text
    $('join-info').append(p)
  }
}

async function startSolo() {
  state.role = 'solo'
  try {
    await launch('freedoom2.wad', [])
  } catch (err) {
    fail('Could not start the game', err.message)
  }
}

function wsUrl(code) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${code}/ws`
}

function gameArgs(s) {
  const args = []
  if (s.mode === 'deathmatch') args.push('-deathmatch')
  if (s.mode === 'altdeath') args.push('-altdeath')
  if (s.wad === 'freedoom1.wad') {
    args.push('-warp', String(Math.min(Math.ceil(s.map / 9), 4)), String(((s.map - 1) % 9) + 1))
  } else {
    args.push('-warp', String(s.map))
  }
  args.push('-skill', String(s.skill))
  if (!s.monsters) args.push('-nomonsters')
  if (s.timelimit > 0) args.push('-timer', String(s.timelimit))
  return args
}

// ---------- lobby (host) ----------

function showLobby(code) {
  $('lobby').hidden = false
  $('lobby-code').textContent = code
  $('copy-link').onclick = async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${code}`)
    toast('Invite link copied')
  }
  const poll = async () => {
    try {
      const info = await api(`/api/rooms/${code}`)
      const list = $('lobby-players')
      list.innerHTML = ''
      for (const p of info.players) {
        list.append(Object.assign(document.createElement('li'), { textContent: p.host ? `${p.name} (host)` : p.name }))
      }
    } catch {}
  }
  poll()
  state.pollTimer = setInterval(poll, 2000)
}

function stopPolling() {
  clearInterval(state.pollTimer)
  state.pollTimer = null
}

// ---------- engine ----------

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    if (total) onProgress(got / total)
  }
  const out = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function randomUid() {
  // 0 is broadcast and 1 is the server; see engine/src/d_loop.c.
  return 2 + (crypto.getRandomValues(new Uint32Array(1))[0] % 0x7ffffff0)
}

function launch(wad, extraArgs) {
  return new Promise((resolve, reject) => {
    show('screen-loading')
    $('loading-title').textContent = state.role === 'host' ? 'Starting your server' : 'Loading the arena'
    const setProgress = (p, text) => {
      $('progress-bar').style.width = `${Math.round(p * 100)}%`
      if (text) $('loading-text').textContent = text
    }

    const files = Promise.all([
      fetchWithProgress(`/wads/${WAD_VERSION}/${wad}`, p => setProgress(p * 0.9, `Downloading maps… ${Math.round(p * 100)}%`)),
      fetch('/default.cfg').then(r => r.arrayBuffer()),
      fetch('/extra.cfg').then(r => r.arrayBuffer()),
    ])

    const canvas = $('canvas')
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      fail('Graphics context lost', 'Reload the page to keep playing.')
    })

    window.Module = {
      noInitialRun: true,
      canvas,
      print: text => onEngineMessage(text),
      printErr: text => console.warn(text),
      onAbort: what => fail('The game stopped unexpectedly', String(what || '')),
      onRuntimeInitialized: async () => {
        try {
          const [wadBytes, cfg, extra] = await files
          setProgress(1, 'Starting…')
          Module.FS.writeFile(`/${wad}`, wadBytes)
          Module.FS.writeFile('/default.cfg', new Uint8Array(cfg))
          Module.FS.writeFile('/extra.cfg', new Uint8Array(extra))
          $('screens').hidden = true
          $('game').hidden = false
          document.body.classList.add('playing')
          setupControls()
          const args = [
            '-iwad', wad,
            '-window',
            '-nogui',
            '-nomusic',
            '-config', 'default.cfg',
            '-extraconfig', 'extra.cfg',
            '-servername', SERVER_NAME,
            '-pet', state.me.name,
            '-uid', String(randomUid()),
            ...extraArgs,
          ]
          resolve()
          // callMain doesn't return until the game exits (Asyncify).
          setTimeout(() => Module.callMain(args), 0)
        } catch (err) {
          reject(err)
        }
      },
    }
    files.catch(reject)

    const s = document.createElement('script')
    s.src = '/engine/websockets-doom.js'
    s.onerror = () => reject(new Error('Could not load the game engine.'))
    document.body.append(s)
  })
}

// The engine reports events on stdout as "doom: <id>, <message>"
// (see engine/README.md, "stdout protocol").
function onEngineMessage(text) {
  console.log(text)
  const m = /^doom: (\d+),\s*(.*)$/.exec(text)
  if (!m) return
  const id = Number(m[1])
  switch (id) {
    case 1:
    case 7:
      return fail('Could not reach the room', 'Check your connection and try again.')
    case 2:
      if (state.role === 'host') toast('Room is live. Share the code with your friends.')
      return
    case 5:
    case 9:
      if (state.role !== 'solo') {
        return fail('Disconnected', state.role === 'host' ? 'Your server lost its connection.' : 'The host left or the connection dropped.')
      }
      return
    case 10:
      state.started = true
      $('lobby').hidden = true
      stopPolling()
      toast(
        matchMedia('(pointer: coarse)').matches
          ? 'Fight! Left stick moves and turns. MENU opens the game menu.'
          : 'Fight! Click the game to capture the mouse. Esc for the menu.',
        6000,
      )
      if (state.role === 'host') api(`/api/rooms/${state.room.code}/start`, { method: 'POST' }).catch(() => {})
      return
    case 12:
      return toast(m[2].replace(/'/g, ''))
  }
}

// ---------- controls ----------

const KEYCODES = { Space: 32, KeyE: 69, Enter: 13, Escape: 27, KeyW: 87, KeyS: 83, KeyA: 65, KeyD: 68, KeyO: 79, KeyP: 80 }

function sendKey(code, type) {
  const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true })
  Object.defineProperty(e, 'keyCode', { get: () => KEYCODES[code] })
  Object.defineProperty(e, 'which', { get: () => KEYCODES[code] })
  $('canvas').dispatchEvent(e)
}

function setupControls() {
  const canvas = $('canvas')
  canvas.focus()
  canvas.addEventListener('click', () => {
    canvas.focus()
    if (!matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock?.()
  })
  $('fullscreen').onclick = () => $('game').requestFullscreen?.()

  if (!matchMedia('(pointer: coarse)').matches || !window.nipplejs) return
  $('touch').hidden = false
  for (const b of document.querySelectorAll('#touch [data-key]')) {
    b.addEventListener('touchstart', e => (e.preventDefault(), sendKey(b.dataset.key, 'keydown')))
    b.addEventListener('touchend', e => (e.preventDefault(), sendKey(b.dataset.key, 'keyup')))
  }
  // One stick: up/down walks, left/right turns.
  const stick = nipplejs.create({ zone: $('stick'), mode: 'static', position: { left: '50%', top: '50%' }, color: '#ff5a1f' })
  const held = new Set()
  const set = wanted => {
    for (const k of held) if (!wanted.has(k)) (sendKey(k, 'keyup'), held.delete(k))
    for (const k of wanted) if (!held.has(k)) (sendKey(k, 'keydown'), held.add(k))
  }
  stick.on('move', (_, d) => {
    const wanted = new Set()
    if (d.distance > 15) {
      const a = d.angle.degree
      if (a > 30 && a < 150) wanted.add('KeyW')
      if (a > 210 && a < 330) wanted.add('KeyS')
      if (a > 120 && a < 240) wanted.add('KeyO')
      if (a < 60 || a > 300) wanted.add('KeyP')
    }
    set(wanted)
  })
  stick.on('end', () => set(new Set()))
}

boot().catch(err => {
  if (err.message !== 'auth') fail('Something went wrong', err.message)
})
