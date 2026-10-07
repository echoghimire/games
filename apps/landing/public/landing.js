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

function showError(err) {
  const el = $('error')
  el.textContent = err.message
  el.hidden = false
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

async function main() {
  const me = await api('/api/me')

  if (me.user) {
    $('nav').innerHTML = ''
    const name = Object.assign(document.createElement('span'), { className: 'muted', textContent: me.user.name })
    const out = Object.assign(document.createElement('a'), { href: '#', textContent: 'Log out' })
    out.onclick = async e => {
      e.preventDefault()
      await api('/api/logout', {})
      location.assign('/')
    }
    const play = Object.assign(document.createElement('a'), {
      className: 'btn small',
      href: '/play',
      textContent: me.user.hasAccess ? 'Play' : 'Get access',
    })
    $('nav').append(name, out, play)
  }

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

  if (page === 'pay') {
    if (!me.user) return location.assign('/signup')
    if (me.user.hasAccess) return location.assign('/play')
    $('cancelled').hidden = !params.get('cancelled')
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
    if (me.devMode) {
      $('dev-grant').hidden = false
      $('dev-grant').onclick = async () => {
        await api('/api/dev/grant', {})
        location.assign('/play')
      }
    }
  }

  if (page === 'welcome') {
    // The Stripe webhook may land a moment after the redirect; poll briefly.
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
