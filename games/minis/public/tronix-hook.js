/*
 * Tronix Arena hook for adopted open-source games (plain script, no build).
 * Adds the "Arena" back bar and a score card that saves to the leaderboard:
 *   Tronix.bar('Coil')
 *   Tronix.submit('coil', 1234, { unit: 'points', onRetry: fn })
 */
(function () {
  var css =
    '.tx-bar{position:fixed;top:10px;left:10px;z-index:99999;display:flex;gap:10px;align-items:center;pointer-events:none}' +
    ".tx-back{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;border-radius:999px;background:rgba(10,10,16,.75);border:1px solid rgba(255,255,255,.15);color:#fff;text-decoration:none;font:700 13px 'Chakra Petch',Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase}" +
    '.tx-back img{width:22px;height:22px}' +
    ".tx-title{font:700 15px 'Chakra Petch',Inter,sans-serif;color:#fff;text-shadow:0 2px 6px #000;letter-spacing:.06em}" +
    '.tx-ov{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)}' +
    ".tx-card{width:min(400px,100%);padding:24px;border-radius:20px;background:rgba(18,18,26,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 60px rgba(255,90,31,.15);text-align:center;color:#f1f0f7;font:15px/1.45 Inter,system-ui,sans-serif}" +
    ".tx-k{font:700 12px 'Chakra Petch',sans-serif;letter-spacing:.28em;color:#ffc93c}" +
    ".tx-s{font:700 56px/1 'Chakra Petch',sans-serif;margin:10px 0 2px;text-shadow:0 0 30px rgba(255,140,40,.5)}" +
    '.tx-u{color:#a3a1b4;font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:10px}' +
    '.tx-st{color:#ffc93c;font-weight:600;margin-bottom:8px}' +
    '.tx-b{list-style:none;padding:0;margin:0 0 6px;text-align:left}' +
    '.tx-b li{display:flex;justify-content:space-between;padding:4px 10px;border-radius:8px}' +
    '.tx-b li:nth-child(odd){background:rgba(255,255,255,.04)}' +
    '.tx-btns{display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap}' +
    ".tx-btn{font:700 15px 'Chakra Petch',sans-serif;padding:11px 20px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;text-decoration:none}" +
    '.tx-btn.p{background:linear-gradient(135deg,#ff5a1f,#ffc93c);color:#1a0700;border:0}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Inter:wght@400;600&display=swap';
  document.head.appendChild(font);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var me = null;
  fetch('/api/me')
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (m) {
      me = m;
    })
    .catch(function () {});

  window.Tronix = {
    bar: function (title, opts) {
      var bar = el('div', 'tx-bar');
      if (opts && opts.bottom) {
        bar.style.top = 'auto';
        bar.style.bottom = '10px';
      }
      var back = el('a', 'tx-back');
      back.href = '/';
      back.innerHTML = '<img src="/logo.svg" alt=""><span>Arena</span>';
      bar.appendChild(back);
      if (title) bar.appendChild(el('div', 'tx-title', title));
      document.body.appendChild(bar);
    },

    submit: function (game, score, opts) {
      opts = opts || {};
      score = Math.max(0, Math.floor(score));
      var ov = el('div', 'tx-ov');
      var card = el('div', 'tx-card');
      card.appendChild(el('div', 'tx-k', opts.kicker || 'GAME OVER'));
      card.appendChild(el('div', 'tx-s', String(score)));
      card.appendChild(el('div', 'tx-u', opts.unit || 'points'));
      var st = el('div', 'tx-st', 'Saving score…');
      card.appendChild(st);
      var list = el('ol', 'tx-b');
      card.appendChild(list);
      var btns = el('div', 'tx-btns');
      var again = el('button', 'tx-btn p', 'Play again');
      again.onclick = function () {
        ov.remove();
        if (opts.onRetry) opts.onRetry();
      };
      var home = el('a', 'tx-btn', 'Back to arena');
      home.href = '/';
      btns.appendChild(again);
      btns.appendChild(home);
      card.appendChild(btns);
      ov.appendChild(card);
      document.body.appendChild(ov);
      again.focus();
      fetch('/api/scores/' + game, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ score: score }) })
        .then(function (r) {
          return r.json();
        })
        .then(function (b) {
          st.textContent = b.me ? 'Your best: ' + b.me.best + ' · Rank #' + b.me.rank : 'Could not save your score (' + (b.error || 'unknown error') + ').';
          (b.top || []).slice(0, 5).forEach(function (row, i) {
            var li = el('li');
            li.appendChild(el('span', '', '#' + (i + 1) + ' ' + row.name));
            li.appendChild(el('b', '', String(row.best)));
            if (me && row.name === me.name) li.style.background = 'rgba(255,90,31,.18)';
            list.appendChild(li);
          });
        })
        .catch(function () {
          st.textContent = 'Could not save your score.';
        });
    },
  };
})();
