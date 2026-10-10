/* SetPoint – padel/tennis scorekeeper with phone-to-phone sync (WebRTC via PeerJS)
 * and watch / headphone control through the Media Session API. */
;(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const PREFIX = 'setpoint-'
  const POINT_LOCK_MS = 2000 // a second press within this window is treated as a duplicate
  const STORE_KEY = 'setpoint.match'

  // ---------- storage (never required) ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} },
    del(k) { try { localStorage.removeItem(k) } catch (e) {} }
  }

  // ---------- i18n ----------
  let lang = store.get('setpoint.lang') || ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en')
  const t = (key, vars) => {
    let s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N[lang]) || key
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k])
    return s
  }
  function applyI18n() {
    document.documentElement.lang = lang
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)))
    $('langBtn').textContent = lang === 'tr' ? 'EN' : 'TR'
    $('setupGo').textContent = t(role === 'solo' ? 'startSolo' : 'createRoom')
    if (!$('nameA').value || $('nameA').dataset.auto) {
      const saved = store.get('setpoint.name')
      $('nameA').value = saved || t('us')
      if (saved) delete $('nameA').dataset.auto
      else $('nameA').dataset.auto = 1
    }
    if (!$('nameB').value || $('nameB').dataset.auto) { $('nameB').value = t('them'); $('nameB').dataset.auto = 1 }
    updateVoiceBtn()
    if (match) render()
  }

  // ---------- state ----------
  let role = null // 'host' | 'guest' | 'solo'
  let myTeam = 'A'
  let match = null // { config, names, history, startedAt, endedAt }
  let state = null
  let peer = null
  let conn = null
  let joinCode = null
  let voice = store.get('setpoint.voice') !== false
  let wakeLock = null

  // ---------- navigation ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id))
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)))

  // ---------- segmented controls ----------
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
      if (seg.dataset.name === 'sport') {
        // padel defaults to golden point, tennis to advantage
        const g = document.querySelector('.seg[data-name="golden"]')
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === (b.dataset.v === 'padel' ? '1' : '0')))
      }
    })
  })
  const segVal = (name) => document.querySelector(`.seg[data-name="${name}"] .on`).dataset.v

  // ---------- home ----------
  $('langBtn').onclick = () => { lang = lang === 'tr' ? 'en' : 'tr'; store.set('setpoint.lang', lang); applyI18n() }
  $('hostBtn').onclick = () => { role = 'host'; document.body.classList.remove('solo'); applyI18n(); show('setup') }
  $('soloBtn').onclick = () => { role = 'solo'; document.body.classList.add('solo'); applyI18n(); show('setup') }
  $('joinBtn').onclick = () => { $('joinName').value = $('joinName').value || store.get('setpoint.name') || t('us'); show('joinScreen') }
  ;['nameA', 'nameB'].forEach((id) => $(id).addEventListener('input', () => delete $(id).dataset.auto))

  $('setupForm').onsubmit = (e) => {
    e.preventDefault()
    match = {
      config: {
        sport: segVal('sport'),
        golden: segVal('golden') === '1',
        sets: Number(segVal('sets')),
        firstServer: segVal('firstServer')
      },
      names: { A: $('nameA').value.trim() || t('us'), B: role === 'solo' ? ($('nameB').value.trim() || t('them')) : t('opponent') },
      history: [],
      startedAt: null,
      endedAt: null
    }
    myTeam = 'A'
    if ($('nameA').value.trim() && !$('nameA').dataset.auto) store.set('setpoint.name', $('nameA').value.trim())
    if (role === 'solo') { startMatch(); return }
    startHosting()
  }

  // ---------- networking ----------
  function peerOptions() {
    // ?peer=host:port lets you use your own PeerJS server (used for local testing)
    const p = new URLSearchParams(location.search).get('peer')
    if (!p) return { debug: 0 }
    const [host, port] = p.split(':')
    return { host, port: Number(port || 443), path: '/', secure: location.protocol === 'https:', debug: 0 }
  }
  function randomCode() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let s = ''
    const r = crypto.getRandomValues(new Uint8Array(6))
    for (const n of r) s += abc[n % abc.length]
    return s
  }
  function inviteUrl(code) {
    const u = new URL(location.href)
    u.search = ''
    const p = new URLSearchParams(location.search).get('peer')
    if (p) u.searchParams.set('peer', p)
    u.searchParams.set('m', code)
    u.hash = ''
    return u.toString()
  }

  function startHosting(existingCode) {
    joinCode = existingCode || randomCode()
    show('wait')
    $('codeText').textContent = joinCode
    $('waitStatus').textContent = t('connecting')
    const url = inviteUrl(joinCode)
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
    $('shareInvite').onclick = () => shareOrCopy({ title: 'SetPoint', text: t('join'), url })

    if (peer) peer.destroy()
    peer = new Peer(PREFIX + joinCode, peerOptions())
    peer.on('open', () => { $('waitStatus').textContent = t('waiting'); saveMatch() })
    peer.on('connection', (c) => {
      if (conn && conn.open && conn !== c) conn.close()
      conn = c
      c.on('data', (msg) => onHostMessage(msg))
      c.on('open', () => { setConn(true); sendState() })
      c.on('close', () => { if (conn === c) { setConn(false); toast(t('opponentLeft')) } })
    })
    peer.on('disconnected', () => { try { peer.reconnect() } catch (e) {} })
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // id still registered (e.g. after a reload) – retry shortly
        setTimeout(() => startHosting(joinCode), 3000)
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        $('waitStatus').textContent = t('netError')
      }
    })
  }
  $('cancelHost').onclick = () => { if (peer) peer.destroy(); peer = null; match = null; store.del(STORE_KEY); show('home') }

  function onHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'hello') {
      const first = match.names.B === t('opponent') || !match.startedAt
      match.names.B = String(msg.name || t('opponent')).slice(0, 20)
      if (first) toast(t('opponentJoined', { name: match.names.B }))
      if (!match.startedAt) startMatch()
      else { sendState(); render() }
    } else if (msg.type === 'point') {
      applyPoint('B')
    } else if (msg.type === 'undo') {
      applyUndo('B')
    }
  }

  function sendState(extra) {
    if (role !== 'host' || !conn || !conn.open) return
    conn.send(Object.assign({ type: 'state', match }, extra || {}))
  }

  function startJoining(code, name) {
    role = 'guest'
    myTeam = 'B'
    joinCode = code
    $('joinStatus').textContent = t('connecting')
    if (peer) peer.destroy()
    peer = new Peer(undefined, peerOptions())
    const connect = () => {
      conn = peer.connect(PREFIX + code, { reliable: true })
      const c = conn
      c.on('open', () => { setConn(true); c.send({ type: 'hello', name }) })
      c.on('data', (msg) => onGuestMessage(msg))
      c.on('close', () => {
        if (conn !== c) return
        setConn(false)
        if (match && !match.endedAt) { toast(t('disconnected')); setTimeout(connect, 2500) }
      })
    }
    peer.on('open', connect)
    peer.on('disconnected', () => { try { peer.reconnect() } catch (e) {} })
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        if (match) setTimeout(connect, 3000)
        else $('joinStatus').textContent = t('notFound')
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        $('joinStatus').textContent = t('netError')
      }
    })
  }

  function onGuestMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'state') {
      const prevLen = match ? match.history.length : 0
      const wasActive = !!match
      match = msg.match
      if (!wasActive || !$('match').classList.contains('active')) {
        if (!match.endedAt) { show('match'); render(); return }
      }
      onScoreChanged(prevLen)
      if (match.endedAt && !$('done').classList.contains('active')) setTimeout(showDone, 1200)
    } else if (msg.type === 'rejected') {
      toast(t(msg.reason === 'undo' ? 'undoDenied' : 'rejected'))
      buzz([40, 60, 40])
    }
  }

  $('joinForm').onsubmit = (e) => {
    e.preventDefault()
    const code = $('joinCode').value.trim().toUpperCase()
    if (code.length !== 6) return
    const name = $('joinName').value.trim() || t('us')
    store.set('setpoint.name', name)
    startJoining(code, name)
  }

  // ---------- match logic ----------
  function startMatch() {
    match.startedAt = match.startedAt || Date.now()
    show('match')
    render()
    sendState()
    saveMatch()
  }

  /** Called on the host (or solo device). Returns false when rejected. */
  function applyPoint(team) {
    if (!match || match.endedAt) return false
    const last = match.history[match.history.length - 1]
    if (last && Date.now() - last.ts < POINT_LOCK_MS) {
      reject(team, 'point')
      return false
    }
    if (state && state.winner) return false
    const prevLen = match.history.length
    match.history.push({ t: team, ts: Date.now() })
    sendState()
    onScoreChanged(prevLen)
    return true
  }

  function applyUndo(team) {
    if (!match || match.endedAt) return
    const last = match.history[match.history.length - 1]
    if (!last || (role !== 'solo' && last.t !== team)) { reject(team, 'undo'); return }
    const prevLen = match.history.length
    match.history.pop()
    sendState()
    onScoreChanged(prevLen)
  }

  function reject(team, reason) {
    if (team === myTeam || role === 'solo') { toast(t(reason === 'undo' ? 'undoDenied' : 'rejected')); buzz([40, 60, 40]) }
    else if (conn && conn.open) conn.send({ type: 'rejected', reason })
  }

  // local user actions (tap or watch button)
  function myPoint() {
    if (!match || match.endedAt) return
    if (role === 'guest') { if (conn && conn.open) conn.send({ type: 'point' }); else toast(t('disconnected')) }
    else applyPoint(myTeam)
  }
  function myUndo() {
    if (!match || match.endedAt) return
    if (role === 'guest') { if (conn && conn.open) conn.send({ type: 'undo' }); else toast(t('disconnected')) }
    else applyUndo(myTeam)
  }

  $('sideMe').onclick = () => myPoint()
  $('sideOpp').onclick = () => { if (role === 'solo') applyPoint('B') }
  $('undoBtn').onclick = () => myUndo()

  function onScoreChanged(prevLen) {
    render()
    saveMatch()
    if (!match.history.length || match.history.length === prevLen) return
    if (match.history.length < prevLen) { buzz(30); return } // undo
    announce()
    if (state.winner && !match.endedAt) finishMatch()
  }

  function finishMatch() {
    match.endedAt = Date.now()
    sendState()
    saveMatch()
    setTimeout(showDone, 1200)
  }

  // ---------- rendering ----------
  const opp = () => (myTeam === 'A' ? 'B' : 'A')

  function render() {
    if (!match) return
    state = Scoring.compute(match.config, match.history)
    const me = myTeam
    const o = opp()
    const lbl = Scoring.pointLabels(state, match.config)
    $('nameMe').textContent = role === 'solo' ? match.names[me] : `${match.names[me]} (${t('you')})`
    $('nameOpp').textContent = match.names[o]
    $('ptsMe').textContent = lbl[me]
    $('ptsOpp').textContent = lbl[o]
    $('gamesMe').textContent = state.games[me]
    $('gamesOpp').textContent = state.games[o]
    $('serveMe').classList.toggle('on', state.server === me && !state.winner)
    $('serveOpp').classList.toggle('on', state.server === o && !state.winner)
    $('sideOpp').classList.toggle('tappable', role === 'solo')

    let badge = ''
    if (state.tiebreak) badge = t('tiebreak')
    else if (Scoring.isGoldenPoint(state, match.config)) badge = t('goldenPoint')
    $('badge').textContent = badge
    $('badge').classList.toggle('show', !!badge)

    // sets table
    const rows = [me, o].map((team) => {
      const cells = state.sets.map((s) => `<td>${s[team]}${s.tb ? `<sup>${s.tb[team]}</sup>` : ''}</td>`).join('')
      return `<tr><th>${esc(team === me && role !== 'solo' ? t('you') : match.names[team])}</th>${cells}<td class="cur">${state.games[team]}</td></tr>`
    })
    $('setsTable').innerHTML = rows.join('')
    updateMediaMetadata(lbl)
  }

  function showDone() {
    state = Scoring.compute(match.config, match.history)
    const w = state.winner
    $('winnerText').textContent = w ? t('wins', { name: match.names[w] }) : t('endMatch')
    $('finalSets').innerHTML = state.sets
      .map((s) => `<span>${s.A}-${s.B}${s.tb ? `<sup>(${Math.min(s.tb.A, s.tb.B)})</sup>` : ''}</span>`)
      .join('') || `<span>${state.games.A}-${state.games.B}</span>`
    const mins = Math.max(1, Math.round(((match.endedAt || Date.now()) - match.startedAt) / 60000))
    $('durationText').textContent = `${match.names.A} vs ${match.names.B} · ${t('duration', { m: mins })}`
    stopMedia()
    show('done')
  }

  function setConn(ok) {
    $('conn').className = 'conn ' + (role === 'solo' ? 'solo' : ok ? 'ok' : 'bad')
  }

  let toastTimer
  function toast(msg) {
    const el = $('toast')
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) {} }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  // ---------- voice ----------
  function speak(text) {
    if (!voice || !('speechSynthesis' in window)) return
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang === 'tr' ? 'tr-TR' : 'en-US'
      u.rate = 1.05
      speechSynthesis.speak(u)
    } catch (e) {}
  }
  function spokenPoint(v) {
    if (v === '0') return lang === 'tr' ? 'sıfır' : 'love'
    return v
  }
  function announce() {
    const me = myTeam
    const o = opp()
    const name = (team) => (team === me && role !== 'solo' ? t('you') : match.names[team])
    const last = match.history[match.history.length - 1].t
    let text
    if (state.lastEvent === 'match') { text = t('say.match', { name: name(last) }); buzz([200, 100, 200, 100, 400]) }
    else if (state.lastEvent === 'set') {
      const s = state.sets[state.sets.length - 1]
      text = t('say.set', { name: name(last), a: s[me], b: s[o] })
      buzz([200, 100, 200])
    } else if (state.lastEvent === 'game') {
      text = t('say.game', { name: name(last), a: state.games[me], b: state.games[o] })
      buzz([150, 80, 150])
    } else {
      const lbl = Scoring.pointLabels(state, match.config)
      if (Scoring.isGoldenPoint(state, match.config)) text = t('say.golden')
      else if (lbl.A === '40' && lbl.B === '40') text = t('say.deuce')
      else if (lbl.A === 'AD' || lbl.B === 'AD') text = t('say.adv', { name: name(lbl.A === 'AD' ? 'A' : 'B') })
      else text = t('say.score', { me: spokenPoint(lbl[me]), opp: spokenPoint(lbl[o]) })
      buzz(80)
    }
    if (state.changeSides) { text += '. ' + t('say.sides'); toast(t('changeSides')) }
    speak(text)
  }
  function updateVoiceBtn() { $('voiceBtn').textContent = '🔊 ' + t(voice ? 'voiceOn' : 'voiceOff') }
  $('voiceBtn').onclick = () => { voice = !voice; store.set('setpoint.voice', voice); updateVoiceBtn() }

  // ---------- watch / headphone control via Media Session ----------
  let mediaOn = false
  let silentUrl = null
  function silentWav(seconds) {
    const rate = 8000
    const n = rate * seconds
    const buf = new ArrayBuffer(44 + n)
    const v = new DataView(buf)
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
    w(36, 'data'); v.setUint32(40, n, true)
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
  }

  async function startMedia() {
    const audio = $('media')
    if (!silentUrl) silentUrl = silentWav(10)
    audio.src = silentUrl
    try { await audio.play() } catch (e) { toast(String(e.message || e)); return }
    mediaOn = true
    $('watchBtn').textContent = t('watchActive')
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const keepPlaying = () => { audio.play().catch(() => {}); ms.playbackState = 'playing' }
    const handlers = {
      nexttrack: () => myPoint(),
      play: () => { keepPlaying(); myPoint() },
      pause: () => { keepPlaying(); myPoint() },
      previoustrack: () => myUndo(),
      seekforward: () => myPoint(),
      seekbackward: () => myUndo()
    }
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, fn) } catch (e) {}
    }
    ms.playbackState = 'playing'
    render()
  }
  function stopMedia() {
    if (!mediaOn) return
    mediaOn = false
    $('media').pause()
    $('watchBtn').textContent = t('watchOn')
  }
  $('watchBtn').onclick = () => (mediaOn ? stopMedia() : startMedia())

  function updateMediaMetadata(lbl) {
    if (!mediaOn || !('mediaSession' in navigator) || !window.MediaMetadata) return
    const me = myTeam
    const o = opp()
    const setsStr = state.sets.map((s) => `${s[me]}-${s[o]}`).join(' ')
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${lbl[me]} - ${lbl[o]}`,
      artist: `${t('gamesLbl')} ${state.games[me]}-${state.games[o]}${setsStr ? ' · ' + setsStr : ''}`,
      album: 'SetPoint'
    })
  }

  // ---------- menu ----------
  $('menuBtn').onclick = () => $('menu').classList.add('open')
  $('closeMenu').onclick = () => $('menu').classList.remove('open')
  $('helpBtn').onclick = () => { $('menu').classList.remove('open'); $('help').classList.add('open') }
  $('closeHelp').onclick = () => $('help').classList.remove('open')
  $('endBtn').onclick = () => {
    $('menu').classList.remove('open')
    if (!confirm(t('endConfirm'))) return
    match.endedAt = Date.now()
    sendState()
    saveMatch()
    showDone()
  }
  $('wakeBtn').onclick = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      $('wakeBtn').textContent = t('awakeOn')
    } catch (e) { toast(String(e.message || e)) }
    $('menu').classList.remove('open')
  }
  document.addEventListener('visibilitychange', async () => {
    if (wakeLock && document.visibilityState === 'visible') {
      try { wakeLock = await navigator.wakeLock.request('screen') } catch (e) {}
    }
  })

  $('newMatch').onclick = () => {
    if (peer) peer.destroy()
    peer = null; conn = null; match = null; state = null
    store.del(STORE_KEY)
    history.replaceState(null, '', location.pathname + (new URLSearchParams(location.search).get('peer') ? '?peer=' + new URLSearchParams(location.search).get('peer') : ''))
    show('home')
  }

  // ---------- share card ----------
  $('shareCard').onclick = async () => {
    const blob = await drawCard()
    const file = new File([blob], 'setpoint-score.png', { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SetPoint' }); return } catch (e) { if (e.name === 'AbortError') return }
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = file.name
    a.click()
  }

  function drawCard() {
    const W = 1080, H = 1350
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, '#11161c'); grad.addColorStop(1, '#0b0d10')
    g.fillStyle = grad; g.fillRect(0, 0, W, H)
    g.strokeStyle = '#c6f432'; g.lineWidth = 6
    g.strokeRect(60, 60, W - 120, H - 120)
    g.fillStyle = '#c6f432'
    g.font = '800 64px system-ui, sans-serif'
    g.fillText('SetPoint', 110, 190)
    g.fillStyle = '#8a929c'
    g.font = '500 40px system-ui, sans-serif'
    const sport = match.config.sport === 'padel' ? 'PADEL' : (lang === 'tr' ? 'TENİS' : 'TENNIS')
    g.fillText(`${sport} · ${new Date(match.startedAt).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US')}`, 110, 250)

    const st = Scoring.compute(match.config, match.history)
    const sets = st.sets.length ? st.sets : [{ A: st.games.A, B: st.games.B }]
    const rowY = { A: 520, B: 760 }
    for (const team of ['A', 'B']) {
      const win = st.winner === team
      g.fillStyle = win ? '#ffffff' : '#8a929c'
      g.font = `${win ? 800 : 600} 64px system-ui, sans-serif`
      g.fillText(fit(g, match.names[team], 470), 110, rowY[team])
      sets.forEach((s, i) => {
        g.font = `${s[team] > s[team === 'A' ? 'B' : 'A'] ? 800 : 500} 110px system-ui, sans-serif`
        g.fillStyle = s[team] > s[team === 'A' ? 'B' : 'A'] ? '#c6f432' : '#5b636d'
        g.fillText(String(s[team]), 620 + i * 140, rowY[team] + 20)
      })
      if (win) {
        g.fillStyle = '#c6f432'
        g.beginPath()
        g.arc(80, rowY[team] - 22, 10, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.fillStyle = '#2a3038'; g.fillRect(110, 620, W - 220, 4)
    const mins = Math.max(1, Math.round(((match.endedAt || Date.now()) - match.startedAt) / 60000))
    g.fillStyle = '#8a929c'; g.font = '500 44px system-ui, sans-serif'
    g.fillText(`⏱ ${t('duration', { m: mins })}   ·   ${match.history.length} ${lang === 'tr' ? 'sayı' : 'points'}`, 110, 980)
    g.fillStyle = '#5b636d'; g.font = '500 36px system-ui, sans-serif'
    g.fillText(location.host + location.pathname.replace(/index\.html$/, ''), 110, H - 120)
    return new Promise((res) => c.toBlob(res, 'image/png'))
  }
  function fit(g, text, max) {
    let s = text
    while (g.measureText(s).width > max && s.length > 1) s = s.slice(0, -1)
    return s === text ? s : s + '…'
  }

  async function shareOrCopy(data) {
    if (navigator.share) { try { await navigator.share(data); return } catch (e) { if (e.name === 'AbortError') return } }
    try { await navigator.clipboard.writeText(data.url); toast('✓ ' + data.url) } catch (e) { prompt('', data.url) }
  }

  // ---------- persistence (host / solo can resume after a reload) ----------
  function saveMatch() {
    if (!match || role === 'guest') return
    store.set(STORE_KEY, { role, match, joinCode })
  }
  function resume() {
    const saved = store.get(STORE_KEY)
    if (!saved || !saved.match || saved.match.endedAt) return false
    role = saved.role
    match = saved.match
    myTeam = 'A'
    document.body.classList.toggle('solo', role === 'solo')
    if (role === 'host') {
      startHosting(saved.joinCode)
      if (match.startedAt) { show('match'); setConn(false) }
    } else {
      setConn(true)
      show('match')
    }
    render()
    return true
  }

  // ---------- boot ----------
  applyI18n()
  const codeParam = new URLSearchParams(location.search).get('m')
  if (codeParam) {
    $('joinCode').value = codeParam.toUpperCase()
    $('joinName').value = store.get('setpoint.name') || t('us')
    show('joinScreen')
  } else if (!resume()) {
    show('home')
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  // test hook
  window.__setpoint = { get match() { return match }, get state() { return state }, myPoint, myUndo }
})()
