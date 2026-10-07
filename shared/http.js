export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { location, ...headers } })
}

// Cross-site request forgery guard for state-changing requests: browsers always
// send Origin on POST/DELETE, so require it to be one of our own sites.
export function sameOrigin(request, env) {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  const allowed = [env.LANDING_URL, env.ARENA_URL].filter(Boolean).map(u => new URL(u).origin)
  return allowed.includes(origin) || origin === new URL(request.url).origin
}

export function withSecurityHeaders(response) {
  const r = new Response(response.body, response)
  r.headers.set('X-Content-Type-Options', 'nosniff')
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  r.headers.set('X-Frame-Options', 'DENY')
  return r
}
