/*
 * Padel / tennis scoring engine.
 * The match state is derived by replaying the list of point winners,
 * which makes undo and network sync trivial (only the history is shared).
 */
(function (root) {
  const OTHER = { A: 'B', B: 'A' }
  const LABELS = ['0', '15', '30', '40']

  function compute(config, history) {
    const cfg = Object.assign({ golden: true, sets: 3, firstServer: 'A' }, config)
    const setsToWin = Math.ceil(cfg.sets / 2)
    const s = {
      sets: [], // finished sets: [{A, B, tb: {A,B}|null}]
      games: { A: 0, B: 0 },
      points: { A: 0, B: 0 },
      tiebreak: false,
      server: cfg.firstServer,
      winner: null,
      setsWon: { A: 0, B: 0 },
      changeSides: false,
      lastEvent: null // 'point' | 'game' | 'set' | 'match'
    }
    let gameServer = cfg.firstServer // team serving the current (non tie-break) game
    let tbFirstServer = null

    for (const p of history) {
      if (s.winner) break
      const w = p.t
      s.changeSides = false
      s.lastEvent = 'point'
      s.points[w]++

      if (s.tiebreak) {
        const n = s.points.A + s.points.B
        if (s.points[w] >= 7 && s.points[w] - s.points[OTHER[w]] >= 2) {
          s.games[w]++
          finishSet(w)
          // the team that served first in the tie-break receives first in the next set
          gameServer = OTHER[tbFirstServer]
          s.server = gameServer
        } else {
          // first point by tbFirstServer, then alternate every two points
          s.server = Math.floor((n + 1) / 2) % 2 === 0 ? tbFirstServer : OTHER[tbFirstServer]
          if (n % 6 === 0) s.changeSides = true
        }
        continue
      }

      const pw = s.points[w]
      const pl = s.points[OTHER[w]]
      let gameWon = false
      if (cfg.golden) gameWon = pw >= 4
      else gameWon = pw >= 4 && pw - pl >= 2
      if (!gameWon) continue

      s.points = { A: 0, B: 0 }
      s.games[w]++
      s.lastEvent = 'game'
      gameServer = OTHER[gameServer]
      s.server = gameServer
      const gw = s.games[w]
      const gl = s.games[OTHER[w]]
      if ((gw >= 6 && gw - gl >= 2) || gw === 7) {
        const total = s.games.A + s.games.B
        finishSet(w)
        if (total % 2 === 1) s.changeSides = true
      } else if (s.games.A === 6 && s.games.B === 6) {
        s.tiebreak = true
        tbFirstServer = gameServer
        s.server = gameServer
      } else if ((s.games.A + s.games.B) % 2 === 1) {
        s.changeSides = true
      }
    }
    return s

    function finishSet(w) {
      const tb = s.tiebreak ? { A: s.points.A, B: s.points.B } : null
      s.sets.push({ A: s.games.A, B: s.games.B, tb })
      s.setsWon[w]++
      s.games = { A: 0, B: 0 }
      s.points = { A: 0, B: 0 }
      s.tiebreak = false
      s.lastEvent = 'set'
      if (s.setsWon[w] >= setsToWin) {
        s.winner = w
        s.lastEvent = 'match'
      }
    }
  }

  /** Point labels for display, e.g. {A:'40', B:'AD'} */
  function pointLabels(state, config) {
    const { A, B } = state.points
    if (state.tiebreak) return { A: String(A), B: String(B) }
    const golden = config.golden !== false
    if (A >= 3 && B >= 3 && !golden) {
      if (A === B) return { A: '40', B: '40' }
      return A > B ? { A: 'AD', B: '40' } : { A: '40', B: 'AD' }
    }
    return { A: LABELS[Math.min(A, 3)], B: LABELS[Math.min(B, 3)] }
  }

  /** True when the next point decides the game under golden point rules */
  function isGoldenPoint(state, config) {
    return config.golden !== false && !state.tiebreak && state.points.A === 3 && state.points.B === 3
  }

  const api = { compute, pointLabels, isGoldenPoint, OTHER }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.Scoring = api
})(this)
