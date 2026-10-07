const $ = id => document.getElementById(id)
const page = document.body.dataset.page
const params = new URLSearchParams(location.search)

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// Small DOM builder: h('div', { className: 'x' }, child, 'text', ...)
function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props)
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

function showError(err) {
  const el = $('error')
  el.textContent = err.message
  el.hidden = false
}

const fmt = n => (n == null ? '–' : Number(n).toLocaleString())
const medal = r => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`)
const seasonName = s => new Date(`${s}-01T00:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function daysLeft(ms) {
  const d = Math.max(0, Math.ceil((ms - Date.now()) / 86400000))
  return d === 1 ? '1 day' : `${d} days`
}

// Where to go after logging in or signing up.
function afterAuth(me) {
  if (!me.user.hasAccess) return location.assign('/pay')
  if (params.get('next') === 'arena' || params.get('next') === 'play') {
    const path = params.get('path') || '/'
    return location.assign(me.arenaUrl + (path.startsWith('/') ? path : '/'))
  }
  location.assign('/')
}

function renderNav(me) {
  if (!me.user) return
  const nav = $('nav')
  nav.innerHTML = ''
  const out = h('a', { href: '#', textContent: 'Log out' })
  out.onclick = async e => {
    e.preventDefault()
    await api('/api/logout', {})
    location.assign('/')
  }
  nav.append(h('span', { className: 'muted', textContent: me.user.name }))
  if (me.user.isAdmin) nav.append(h('a', { href: '/admin', textContent: 'Admin' }))
  nav.append(out, h('a', { className: 'btn small', href: me.user.hasAccess ? '/play' : '/pay', textContent: me.user.hasAccess ? 'Play' : 'Get pass' }))
}

// ---------------------------------------------------------------- home

async function home(me) {
  if (me.user) {
    // Logged in: your stuff first, the game list last.
    document.body.classList.add('signed-in')
    $('hero').hidden = true
    $('dash').hidden = false
    document.querySelector('main').append($('showcase'))
  }
  const loads = [loadRewards(), loadBoards(), loadHall()]
  if (me.user) loads.push(loadDashboard(me))
  for (const tab of document.querySelectorAll('#board-tabs .tab')) {
    tab.onclick = () => {
      for (const t of document.querySelectorAll('#board-tabs .tab')) t.classList.toggle('is-on', t === tab)
      loadBoards(tab.dataset.season)
    }
  }
  await Promise.allSettled(loads)
}

// Seasons end at midnight Nepal time (UTC+5:45) on the 1st of next month.
function seasonEnd(season) {
  const [y, m] = season.split('-').map(Number)
  return Date.UTC(y, m, 1) - (5 * 60 + 45) * 60000
}

async function loadDashboard(me) {
  $('dash-name').textContent = me.user.name
  const d = await api('/api/dashboard')
  $('dash-season').textContent = `${seasonName(d.season)} season · ${daysLeft(d.seasonEndsAt)} left`

  // Pass status.
  const card = $('pass-card')
  card.innerHTML = ''
  const pay = d.pass.payment
  if (d.pass.active) {
    card.append(h('div', {}, h('p', { className: 'eyebrow' }, 'Arena pass'), h('strong', {}, `${daysLeft(d.pass.paidUntil * 1000)} left`)), h('a', { className: 'btn', href: '/play' }, 'Play'))
  } else if (pay?.status === 'submitted') {
    card.append(h('div', {}, h('p', { className: 'eyebrow' }, 'Arena pass'), h('strong', {}, 'Checking payment…'), h('span', { className: 'muted small' }, pay.reference)))
  } else {
    card.append(h('div', {}, h('p', { className: 'eyebrow' }, 'Arena pass'), h('strong', {}, pay?.status === 'rejected' ? 'Payment not found' : 'Not active')), h('a', { className: 'btn', href: '/pay' }, 'Get pass'))
  }

  $('stat-row').replaceChildren(
    stat('Plays', fmt(d.totals.seasonPlays)),
    stat('Games', `${d.totals.gamesPlayed}/${d.games.length}`),
    stat('Top 3', fmt(d.totals.podiums), d.totals.podiums > 0),
    stat('Tickets', fmt(d.drop.seasonTickets), false, 'tickets'),
  )

  const played = d.games.filter(g => g.best != null)
  $('my-games').replaceChildren(
    ...(played.length
      ? played.map(g =>
          h(
            'tr',
            {},
            h('td', {}, g.title),
            h('td', {}, g.seasonBest == null ? '–' : fmt(g.seasonBest), h('span', { className: 'muted small' }, g.seasonBest == null ? '' : ` ${g.unit}`)),
            h('td', { className: g.seasonRank && g.seasonRank <= 3 ? 'podium' : '' }, g.seasonRank ? medal(g.seasonRank) : '–'),
            h('td', { className: 'muted' }, fmt(g.best)),
          ),
        )
      : [h('tr', {}, h('td', { colSpan: 4, className: 'muted' }, 'No scores yet. Play any arcade game to get on the board.'))]),
  )

  $('drop-open').onclick = async () => {
    $('drop-open').disabled = true
    const crate = $('crate')
    crate.className = 'crate shaking'
    try {
      const [r] = await Promise.all([api('/api/drop', {}), new Promise(ok => setTimeout(ok, 1100))])
      renderDrop(r.drop, true, true)
      const t = document.querySelector('#stat-row .tickets strong')
      if (t) t.textContent = fmt(r.seasonTickets)
    } catch (err) {
      crate.className = 'crate'
      $('drop-result').textContent = err.message
      $('drop-open').disabled = false
    }
  }

  renderDrop(d.drop.today, d.pass.active)

  if (d.wins.length) {
    $('trophies').hidden = false
    $('trophies').replaceChildren(
      h('p', { className: 'eyebrow' }, 'Trophies'),
      ...d.wins.map(w =>
        h('span', { className: 'trophy', title: `${seasonName(w.season)} · ${w.prize || 'Prize'} · ${w.status}` }, h('span', { className: 'trophy-medal' }, w.game === 'raffle' ? '🎁' : medal(w.rank)), h('b', {}, w.title), w.prize ? h('span', { className: 'muted' }, `· ${w.prize}${w.status === 'shipped' ? ' ✓' : ''}`) : null),
      ),
    )
  }
}

function stat(label, value, hot, cls = '') {
  return h('div', { className: `stat ${cls}${hot ? ' hot' : ''}` }, h('strong', {}, value), h('span', {}, label))
}

function renderDrop(drop, active, justOpened) {
  const crate = $('crate')
  const btn = $('drop-open')
  if (drop) {
    crate.className = `crate open ${drop.rarity}${justOpened ? ' burst' : ''}`
    $('drop-result').replaceChildren(
      h('span', { className: `rarity ${drop.rarity}` }, drop.rarity.toUpperCase()),
      ` +${drop.tickets} ticket${drop.tickets === 1 ? '' : 's'}`,
    )
    btn.textContent = 'Next crate tomorrow'
    btn.disabled = true
  } else if (!active) {
    btn.textContent = 'Get a pass to open'
    btn.disabled = false
    btn.onclick = () => location.assign('/pay')
  }
}

// Staff announcements from /admin. The prize banner covers the rest.
async function loadRewards() {
  let rewards = []
  try {
    rewards = (await api('/api/rewards')).rewards
  } catch {}
  $('reward-grid').replaceChildren(
    ...rewards.slice(0, 3).map(r =>
      h(
        'article',
        { className: `announcement${r.pinned ? ' pinned' : ''}` },
        r.imageUrl ? h('img', { src: r.imageUrl, alt: '', loading: 'lazy' }) : null,
        h(
          'div',
          {},
          r.prize ? h('span', { className: 'reward-prize' }, r.prize) : null,
          h('strong', {}, r.title),
          h('p', { className: 'muted small' }, r.body),
          r.endsAt ? h('span', { className: 'small ends' }, `Ends in ${daysLeft(r.endsAt * 1000)}`) : null,
        ),
      ),
    ),
  )
}

let boardData = null
let boardGame = null

async function loadBoards(which = 'current') {
  try {
    const q = which === 'all' ? '?season=all' : ''
    let data = await api(`/api/leaderboards${q}`)
    if (which !== 'all') $('season-label').textContent = `${seasonName(data.season)} season · ${daysLeft(seasonEnd(data.season))} left`
    // Nothing this season yet: fall back to all time on first load.
    if (!boardData && !data.games.some(g => g.top.length)) {
      const all = await api('/api/leaderboards?season=all')
      if (!all.games.some(g => g.top.length)) return // nothing anywhere: keep the section hidden
      data = all
      for (const t of document.querySelectorAll('#board-tabs .tab')) t.classList.toggle('is-on', t.dataset.season === 'all')
    }
    boardData = data
    $('boards').hidden = false
    if (!boardGame || !data.games.find(g => g.id === boardGame)?.top.length) boardGame = (data.games.find(g => g.top.length) || data.games[0]).id
    renderBoard()
  } catch (err) {
    $('boards').hidden = false
    $('board-list').replaceChildren(h('li', { className: 'error' }, `Leaderboard unavailable (${err.message}).`))
  }
}

function renderBoard() {
  const games = boardData.games
  $('board-games').replaceChildren(
    ...games.map(g => {
      const b = h('button', { className: `chip${g.id === boardGame ? ' is-on' : ''}${g.top.length ? '' : ' empty'}`, textContent: g.title, role: 'tab' })
      b.onclick = () => {
        boardGame = g.id
        renderBoard()
      }
      return b
    }),
  )
  const g = games.find(x => x.id === boardGame)
  $('board-list').replaceChildren(
    ...(g.top.length
      ? g.top.slice(0, 10).map((r, i) => h('li', { className: i < 3 ? `top top-${i + 1}` : '' }, h('span', { className: 'pos' }, i < 3 ? medal(i + 1) : i + 1), h('span', { className: 'who' }, r.name), h('b', {}, fmt(r.best), h('small', {}, ` ${g.unit}`))))
      : [h('li', { className: 'muted empty-row' }, `No ${g.title} scores yet. The top spot is open.`)]),
  )
}

async function loadHall() {
  try {
    const { seasons } = await api('/api/hall')
    if (!seasons.length) return
    $('hall-section').hidden = false
    $('hall').replaceChildren(
      ...seasons.slice(0, 3).map(s =>
        h(
          'div',
          { className: 'hall-season' },
          h('h3', {}, seasonName(s.season)),
          h(
            'div',
            { className: 'hall-grid' },
            s.winners
              .filter(w => w.rank === 1 || w.game === 'raffle')
              .map(w =>
                h(
                  'div',
                  { className: 'legend' },
                  h('span', { className: 'legend-medal' }, w.game === 'raffle' ? '🎁' : '🥇'),
                  h('div', {}, h('strong', {}, w.name), h('span', { className: 'muted small' }, w.title), w.prize ? h('span', { className: 'legend-prize' }, w.prize + (w.status === 'shipped' ? ' · delivered' : '')) : null),
                ),
              ),
          ),
        ),
      ),
    )
  } catch {}
}

// ---------------------------------------------------------------- pay

async function pay(me) {
  if (!me.user) return location.assign('/signup')
  if (me.user.hasAccess) return location.assign('/play')
  $('cancelled').hidden = !params.get('cancelled')
  const opts = await api('/api/pay/options')
  $('price').textContent = `NPR ${fmt(opts.price)} · ${opts.days} days`

  if (opts.fonepay) {
    $('fonepay').hidden = false
    const status = await api('/api/pay/status')
    $('fp-start').onclick = () => startFonepay()
    if (status.payment && ['awaiting', 'submitted', 'rejected'].includes(status.payment.status)) await startFonepay(status.payment)
  }
  if (opts.stripe) {
    $('buy').hidden = false
    $('buy').onclick = async () => {
      $('buy').disabled = true
      try {
        const { url } = await api('/api/checkout', {})
        location.assign(url)
      } catch (err) {
        showError(err)
        $('buy').disabled = false
      }
    }
  }
  if (!opts.fonepay && !opts.stripe) showError(new Error('Payments are not set up yet. Please check back soon.'))
  if (me.devMode) {
    $('dev-grant').hidden = false
    $('dev-grant').onclick = async () => {
      await api('/api/dev/grant', {})
      location.assign('/play')
    }
  }
}

async function startFonepay(previous) {
  $('fp-start').disabled = true
  try {
    const { payment } = await api('/api/pay/fonepay/start', {})
    $('fp-start').hidden = true
    $('fp-box').hidden = false
    $('fp-amount').textContent = `NPR ${payment.amount}`
    $('fp-ref').textContent = payment.reference
    $('fp-qr').innerHTML = payment.svg // generated by our own Worker
    showFonepayStatus(previous?.status === 'rejected' ? previous : payment)
    $('fp-form').onsubmit = async e => {
      e.preventDefault()
      const btn = e.target.querySelector('button')
      btn.disabled = true
      try {
        await api('/api/pay/fonepay/submit', { reference: payment.reference, txnCode: $('fp-txn').value })
        showFonepayStatus({ status: 'submitted' })
        pollPayment()
      } catch (err) {
        showError(err)
        btn.disabled = false
      }
    }
    if (payment.status === 'submitted') pollPayment()
  } catch (err) {
    showError(err)
    $('fp-start').disabled = false
  }
}

function showFonepayStatus(p) {
  const el = $('fp-status')
  if (p.status === 'submitted') {
    el.textContent = 'Thanks! KTM Tronix is checking your payment. This page updates as soon as your pass is active.'
    $('fp-form').hidden = true
  } else if (p.status === 'rejected') {
    el.textContent = `We could not confirm the last code: ${p.note || 'please check it and try again.'}`
    $('fp-form').hidden = false
  } else {
    el.textContent = ''
  }
  el.hidden = !el.textContent
}

async function pollPayment() {
  for (;;) {
    await new Promise(r => setTimeout(r, 10000))
    const s = await api('/api/pay/status').catch(() => null)
    if (s?.hasAccess) return location.assign('/welcome?fonepay=1')
    if (s?.payment?.status === 'rejected') return showFonepayStatus(s.payment)
  }
}

// ---------------------------------------------------------------- admin

async function admin(me) {
  if (!me.user) return location.assign('/login')
  if (!me.user.isAdmin) return showError(new Error('This page is for KTM Tronix staff.'))
  $('admin').hidden = false
  const refresh = async () => renderAdmin(await api('/api/admin/overview'))
  const act = async (path, body, msg) => {
    try {
      const r = await api(path, body)
      if (msg) msg(r)
      await refresh()
    } catch (err) {
      alert(err.message)
    }
  }

  $('reward-form').onsubmit = e => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.target))
    f.pinned = !!f.pinned
    act('/api/admin/reward', f, () => e.target.reset())
  }
  $('reward-clear').onclick = () => $('reward-form').reset()
  $('finalize-form').onsubmit = e => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.target))
    act('/api/admin/finalize', { season: f.season, places: f.places, force: !!f.force, prizes: { 1: f.p1, 2: f.p2, 3: f.p3 } }, r => alert(`Added ${r.added} winners to the Hall of Legends.`))
  }
  $('raffle-form').onsubmit = e => {
    e.preventDefault()
    act('/api/admin/raffle', Object.fromEntries(new FormData(e.target)), r => {
      $('raffle-result').hidden = false
      $('raffle-result').textContent = `Winner: ${r.winner.name} (${r.winner.tickets} of ${r.winner.of} tickets)`
    })
  }
  setupQrUpload(act)
  window.mbAdminAct = act
  await refresh()
}

// ---- payment QR upload: decode in the browser, check, save

const EMV_NAMES = { '59': 'merchant', '60': 'city', '53': 'currency', '54': 'amount', '01': 'type' }

// Browser-side mirror of shared/emvqr.js, for an instant preview.
function inspectQr(text) {
  const fields = {}
  let i = 0
  while (i < text.length) {
    const id = text.slice(i, i + 2)
    const len = Number(text.slice(i + 2, i + 4))
    if (!/^\d\d$/.test(id) || !Number.isInteger(len) || i + 4 + len > text.length) throw new Error('This QR is not a payment QR (EMVCo format).')
    fields[id] = text.slice(i + 4, i + 4 + len)
    i += 4 + len
  }
  if (fields['00'] !== '01') throw new Error('This QR is not a payment QR (EMVCo format).')
  if (!Object.keys(fields).some(k => k >= '26' && k <= '51')) throw new Error('No merchant account in this QR.')
  let crc = 0xffff
  const body = text.slice(0, -4)
  for (const b of new TextEncoder().encode(body)) {
    crc ^= b << 8
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  const crcOk = body.endsWith('6304') && crc.toString(16).toUpperCase().padStart(4, '0') === text.slice(-4).toUpperCase()
  return { merchant: fields['59'] || '', city: fields['60'] || '', currency: fields['53'] || '', amount: fields['54'] || '', dynamic: fields['01'] === '12', crcOk }
}

let jsQRPromise = null
function loadJsQR() {
  jsQRPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/vendor/jsQR.js'
    s.onload = () => resolve(window.jsQR)
    s.onerror = () => reject(new Error('Could not load the QR reader.'))
    document.head.append(s)
  })
  return jsQRPromise
}

async function decodeQrImage(file) {
  const bitmap = await createImageBitmap(file)
  if ('BarcodeDetector' in window) {
    try {
      const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap)
      if (found[0]?.rawValue) return found[0].rawValue
    } catch {}
  }
  const jsQR = await loadJsQR()
  // Try a few sizes: big photos are slow, tiny QRs in big photos need detail.
  for (const max of [1200, 2000, 800]) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' })
    if (hit?.data) return hit.data
  }
  throw new Error('No QR code found in that picture. Try a sharper, straight-on photo or a screenshot.')
}

function setupQrUpload(act) {
  const text = $('qr-text')
  const check = $('qr-check')
  const save = $('qr-save')
  const show = () => {
    const v = text.value.trim()
    save.disabled = true
    check.className = 'small'
    if (!v) return (check.textContent = '')
    try {
      const q = inspectQr(v)
      const notes = []
      if (q.currency && q.currency !== '524') notes.push(`currency code ${q.currency} is not NPR (524)`)
      if (q.dynamic || q.amount) notes.push(`this looks like a one-off payment QR${q.amount ? ` for ${q.amount}` : ''}; use the shop's fixed (static) QR if you can`)
      if (!q.crcOk) {
        check.className = 'small error'
        check.textContent = 'Checksum is wrong — the text was not read or copied exactly.'
        return
      }
      check.className = notes.length ? 'small warn' : 'small ok'
      check.textContent = `✓ ${q.merchant || 'Merchant'}${q.city ? `, ${q.city}` : ''} · checksum OK` + (notes.length ? ` · Note: ${notes.join('; ')}.` : '')
      save.disabled = false
    } catch (err) {
      check.className = 'small error'
      check.textContent = err.message
    }
  }
  text.oninput = show
  $('qr-file').onchange = async e => {
    const file = e.target.files[0]
    if (!file) return
    const prev = $('qr-preview')
    prev.src = URL.createObjectURL(file)
    prev.hidden = false
    check.className = 'small'
    check.textContent = 'Reading QR…'
    try {
      text.value = await decodeQrImage(file)
    } catch (err) {
      text.value = ''
      check.className = 'small error'
      check.textContent = err.message
      return
    }
    show()
  }
  $('qr-form').onsubmit = e => {
    e.preventDefault()
    if (!confirm('Players will pay to this merchant account from now on. Save this QR?')) return
    act('/api/admin/qr', { payload: text.value.trim() }, () => {
      text.value = ''
      $('qr-file').value = ''
      $('qr-preview').hidden = true
      check.className = 'small ok'
      check.textContent = 'Saved. New payments use this QR.'
      save.disabled = true
    })
  }
  $('qr-clear').onclick = () =>
    confirm('Remove the uploaded QR? Payments will use the FONEPAY_QR secret if one is set, otherwise Fonepay payments turn off.') &&
    act('/api/admin/qr', { clear: true })
}

function renderAdmin(o) {
  const act = window.mbAdminAct
  const when = t => (t ? new Date(t * 1000).toLocaleString() : '')
  const qr = o.config.qr
  const from = qr?.source === 'admin' ? `uploaded${qr.updatedBy ? ` by ${qr.updatedBy}` : ''}${qr.updatedAt ? ` ${when(qr.updatedAt)}` : ''}` : 'from the FONEPAY_QR secret'
  $('cfg').textContent = o.config.fonepay
    ? qr?.error
      ? `Payment QR is invalid: ${qr.error}`
      : `Fonepay QR: ${qr.merchantName || 'merchant'} (${qr.crcOk ? 'checksum OK' : 'checksum wrong!'}) · NPR ${o.config.price} for ${o.config.passDays} days`
    : 'No payment QR yet — upload one above'
  $('qr-current').textContent = o.config.fonepay ? `In use: ${qr?.merchantName || 'merchant'}, ${from}` : 'Not set — Fonepay payments are off'
  $('qr-clear').hidden = qr?.source !== 'admin'

  $('pending').replaceChildren(
    ...(o.pending.length
      ? o.pending.map(p => {
          const approve = h('button', { className: 'btn small', textContent: 'Approve' })
          approve.onclick = () => confirm(`Approve ${p.reference} (${p.txnCode}) for ${p.name}?`) && act('/api/admin/payment', { id: p.id, action: 'approve' })
          const reject = h('button', { className: 'btn small ghost', textContent: 'Reject' })
          reject.onclick = () => {
            const note = prompt('Reason shown to the player:', 'We could not find this transaction code.')
            if (note !== null) act('/api/admin/payment', { id: p.id, action: 'reject', note })
          }
          return h('tr', {}, h('td', {}, `${p.name} `, h('span', { className: 'muted small' }, p.email)), h('td', { className: 'mono' }, p.reference), h('td', {}, `NPR ${p.amount}`), h('td', { className: 'mono' }, p.txnCode), h('td', {}, when(p.submittedAt)), h('td', {}, approve, ' ', reject))
        })
      : [h('tr', {}, h('td', { colSpan: 6, className: 'muted' }, 'Nothing to check right now.'))]),
  )
  $('recent').replaceChildren(
    ...o.recent.map(p => h('tr', {}, h('td', {}, p.name), h('td', { className: 'mono' }, p.reference), h('td', { className: 'mono' }, p.txnCode || ''), h('td', {}, p.status), h('td', {}, when(p.reviewedAt)), h('td', { className: 'muted small' }, p.reviewedBy || ''))),
  )

  const sel = $('reward-game')
  if (sel.options.length === 1) for (const g of o.games) sel.append(h('option', { value: g.id, textContent: g.title }))
  $('rewards').replaceChildren(
    ...o.rewards.map(r => {
      const edit = h('button', { className: 'btn small ghost', textContent: 'Edit' })
      edit.onclick = () => {
        const f = $('reward-form')
        for (const [k, v] of Object.entries({ id: r.id, title: r.title, body: r.body, prize: r.prize, game: r.game || '', season: r.season || '', imageUrl: r.image_url || '', endsAt: r.ends_at ? new Date(r.ends_at * 1000).toISOString().slice(0, 10) : '' })) f.elements[k].value = v
        f.elements.pinned.checked = !!r.pinned
        f.scrollIntoView({ behavior: 'smooth' })
      }
      const del = h('button', { className: 'btn small ghost', textContent: 'Delete' })
      del.onclick = () => confirm(`Delete "${r.title}"?`) && act('/api/admin/reward/delete', { id: r.id })
      return h('tr', {}, h('td', {}, r.pinned ? '📌 ' : '', r.title), h('td', {}, r.prize), h('td', {}, r.season || ''), h('td', {}, edit, ' ', del))
    }),
  )

  $('seasons').replaceChildren(
    ...o.seasons.map(s => h('tr', {}, h('td', {}, s.season === o.season ? `${s.season} (current)` : s.season), h('td', {}, s.players), h('td', {}, s.plays), h('td', {}, s.winners || '–'), h('td', {}, s.raffleWinners || '–'))),
  )
  $('winners').replaceChildren(
    ...o.winners.map(w => {
      const status = h('select', {}, ...['pending', 'contacted', 'shipped'].map(s => h('option', { value: s, textContent: s, selected: s === w.status })))
      status.onchange = () => act('/api/admin/winner', { id: w.id, status: status.value })
      const prize = h('input', { value: w.prize, placeholder: 'Prize' })
      prize.onchange = () => act('/api/admin/winner', { id: w.id, prize: prize.value })
      return h('tr', {}, h('td', {}, w.season), h('td', {}, w.game), h('td', {}, w.rank), h('td', {}, `${w.name} `, h('span', { className: 'muted small' }, w.email || '')), h('td', {}, fmt(w.score)), h('td', {}, prize), h('td', {}, status))
    }),
  )
  $('tickets').replaceChildren(...o.tickets.map(t => h('tr', {}, h('td', {}, t.name), h('td', { className: 'muted small' }, t.email), h('td', {}, `${t.tickets} tickets`))))
}

// ---------------------------------------------------------------- main

async function main() {
  const me = await api('/api/me')
  renderNav(me)

  if (page === 'home') return home(me)
  if (page === 'pay') return pay(me)
  if (page === 'admin') return admin(me)

  if (page === 'signup' || page === 'login') {
    if (me.user) return afterAuth(me)
    $('auth-form').onsubmit = async e => {
      e.preventDefault()
      const btn = e.target.querySelector('button')
      btn.disabled = true
      try {
        await api(`/api/${page}`, Object.fromEntries(new FormData(e.target)))
        afterAuth(await api('/api/me'))
      } catch (err) {
        showError(err)
        btn.disabled = false
      }
    }
  }

  if (page === 'welcome') {
    // Card payments: the Stripe webhook may land a moment after the redirect.
    for (let i = 0; i < 20; i++) {
      const now = await api('/api/me')
      if (now.user?.hasAccess) {
        $('welcome-title').textContent = "You're in."
        $('welcome-text').textContent = 'Your pass is active. See you in the arena.'
        $('welcome-go').hidden = false
        return
      }
      await new Promise(r => setTimeout(r, 1500))
    }
    $('welcome-title').textContent = 'Still confirming…'
    $('welcome-text').textContent = 'Your payment is being processed. Refresh this page in a minute, or contact support if it doesn’t activate.'
  }
}

main().catch(err => console.error(err))
