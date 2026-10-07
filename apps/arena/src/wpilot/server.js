//
//  WPilot game server for one Tronix Arena room.
//
//  A port of WPilot's wpilots.js (Copyright (c) 2010 Johan Dahlberg, MIT,
//  see LICENSE) from a Node process with its own HTTP/WebSocket servers to a
//  transport-free class: the WPilotRoom Durable Object hands it connections
//  (anything with send(string) and close()) and their messages. Admin
//  commands are gone, player names come from the arena account, and
//  messages are validated by hand instead of with pattern matching.
//

import {
  World,
  GameLoop,
  GAME_PACKET,
  PING_PACKET,
  OP_PLAYER_SPAWN,
  OP_PLAYER_DIE,
  OP_PLAYER_STATE,
  OP_PLAYER_INFO,
  OP_PLAYER_FIRE,
  OP_PLAYER_CONNECT,
  OP_PLAYER_DISCONNECT,
  OP_POWERUP_SPAWN,
  OP_POWERUP_DIE,
  OP_ROUND_STATE,
  OP_PLAYER_SAY,
  OP_REQ_SERVER_INFO,
  OP_SERVER_INFO,
  OP_DISCONNECT_REASON,
  OP_WORLD_DATA,
  OP_WORLD_STATE,
  OP_WORLD_RECONNECT,
  OP_CLIENT_CONNECT,
  OP_CLIENT_JOIN,
  OP_CLIENT_STATE,
  OP_CLIENT_SET,
  OP_CLIENT_EXEC,
  OP_CLIENT_SAY,
  OP_SERVER_EXEC_RESP,
  ROUND_WARMUP,
  ROUND_STARTING,
  ROUND_RUNNING,
  ROUND_FINISHED,
  round_number,
} from './gameobjects.js'

import battleRoyale from './maps/battle_royale.json' with { type: 'json' }
import closeQuarters from './maps/close_quarters.json' with { type: 'json' }
import diyDie from './maps/diy_die.json' with { type: 'json' }
import fourCorners from './maps/four_corners.json' with { type: 'json' }
import gems from './maps/gems.json' with { type: 'json' }
import homebase from './maps/homebase.json' with { type: 'json' }
import thePassage from './maps/the_passage.json' with { type: 'json' }
import versus from './maps/versus.json' with { type: 'json' }

export const SERVER_VERSION = '1.0'
export const MAX_PLAYERS = 8
const MAX_CONNECTIONS = 12

export const MAPS = [battleRoyale, gems, fourCorners, closeQuarters, thePassage, homebase, versus, diyDie]

// Connection states
const DISCONNECTED = -1,
  CONNECTED = 1,
  HANDSHAKING = 3,
  JOINED = 4

// Default rules (the r_* options of the original server).
const DEFAULT_RULES = {
  ready_ratio: 0.6,
  respawn_time: 400,
  reload_time: 15,
  shoot_cost: 300,
  shield_cost: 30,
  energy_recovery: 30,
  round_limit: 10,
  suicide_penelty: 1,
  kill_score: 1,
  powerup_max: 2,
  powerup_respawn: 600,
  powerup_spread_t: 700,
  powerup_rapid_t: 600,
  powerup_rico_t: 600,
}

const MAX_RATE = 5000

export class WPilotServer {
  /**
   * @param {object} opts
   * @param {string} opts.name     Room name shown to players.
   * @param {(winners: {name: string, userId: string}[]) => void} [opts.onRoundWon]
   */
  constructor(opts = {}) {
    this.name = opts.name || 'Tronix Arena'
    this.onRoundWon = opts.onRoundWon || (() => {})
    this.connections = new Map()
    this.gameloop = null
    this.updateTick = 1
    this.nextMap = 0
    this.world = new World(true)
    this.world.max_players = MAX_PLAYERS
    this.hookWorld()
    this.loadMap()
  }

  get playerCount() {
    return this.world.no_players
  }

  info() {
    const names = []
    this.world.forEachPlayer((p) => names.push(p.name))
    return {
      map: this.world.map_name,
      players: this.world.no_players,
      max: MAX_PLAYERS,
      names,
    }
  }

  // ---- connections -------------------------------------------------------

  /**
   * Registers a new socket. `socket` needs send(string) and close().
   * Returns the connection; pass it to message() and closed().
   */
  connect(socket, user) {
    const conn = {
      socket,
      id: 0,
      state: CONNECTED,
      player: null,
      userId: user.id,
      playerName: cleanName(user.name),
      rate: MAX_RATE,
      updateRate: 2,
      lastRateCheck: Date.now(),
      lastPing: 0,
      ping: 0,
      dataSent: 0,
      queue: [],
      reason: 'Closed by client',
    }
    if (this.connections.size >= MAX_CONNECTIONS) {
      this.kill(conn, 'Server is busy')
      return conn
    }
    let id = 0
    while (this.connections.has(++id));
    conn.id = id
    this.connections.set(id, conn)
    return conn
  }

  closed(conn) {
    if (conn.state === DISCONNECTED) return
    conn.state = DISCONNECTED
    if (!this.connections.has(conn.id)) return
    this.connections.delete(conn.id)
    if (conn.player) {
      this.world.remove_player(conn.player.id, conn.reason)
      conn.player = null
    }
    if (this.world.no_players === 0) this.stopLoop()
  }

  message(conn, data) {
    if (conn.state === DISCONNECTED) return
    let packet
    try {
      packet = JSON.parse(data)
    } catch {
      return this.kill(conn, 'Malformed message sent by client')
    }
    if (!Array.isArray(packet)) return this.kill(conn, 'Bad message')

    switch (packet[0]) {
      case GAME_PACKET:
        if (conn.state === JOINED && conn.player && Array.isArray(packet[1])) this.gameMessage(conn, packet[1])
        return
      case PING_PACKET:
        conn.ping = Date.now() - conn.lastPing
        return
      default:
        this.controlMessage(conn, packet)
    }
  }

  controlMessage(conn, packet) {
    const [op, arg, value] = packet
    if (op === OP_REQ_SERVER_INFO && conn.state === CONNECTED) {
      return this.post(conn, [OP_SERVER_INFO, this.serverState()])
    }
    if (op === OP_CLIENT_CONNECT && conn.state === CONNECTED) {
      if (arg !== SERVER_VERSION) return this.kill(conn, 'Wrong version')
      return this.setState(conn, HANDSHAKING)
    }
    if (op === OP_CLIENT_JOIN && conn.state === HANDSHAKING && arg && typeof arg === 'object') {
      if (typeof arg.rate === 'number' && arg.rate > 0) conn.rate = Math.min(arg.rate, MAX_RATE)
      return this.setState(conn, JOINED)
    }
    if (op === OP_CLIENT_SAY && conn.state === JOINED) {
      if (typeof arg !== 'string' || arg.length > 200) return this.kill(conn, 'Bad chat message')
      if (conn.player) this.broadcast(OP_PLAYER_SAY, conn.player.id, arg)
      return
    }
    if (op === OP_CLIENT_SET && arg === 'rate' && conn.state === JOINED) {
      if (typeof value === 'number' && value > 0) conn.rate = Math.min(value, MAX_RATE)
      return
    }
    if (op === OP_CLIENT_EXEC && conn.state === JOINED) {
      return this.post(conn, [OP_SERVER_EXEC_RESP, 'Server commands are disabled in Tronix Arena'])
    }
    // Messages for an older state can race a state change (e.g. a map change);
    // only drop the connection for messages that are never valid.
    if (![OP_REQ_SERVER_INFO, OP_CLIENT_CONNECT, OP_CLIENT_JOIN, OP_CLIENT_SAY, OP_CLIENT_SET].includes(op)) {
      this.kill(conn, 'Bad control message')
    }
  }

  gameMessage(conn, msg) {
    const player = conn.player
    if (msg[0] === OP_CLIENT_SET && msg[1] === 'ready') {
      this.world.set_player_ready(player.id)
    } else if (msg[0] === OP_CLIENT_SET && msg[1] === 'name') {
      // Names come from the arena account.
    } else if (msg[0] === OP_CLIENT_STATE) {
      const action = msg[1],
        angle = msg[2]
      if (!Number.isInteger(action) || action < 0 || action > 7) return
      if (typeof angle !== 'number' || !Number.isFinite(angle)) return
      player.action = action
      if (!player.dead && player.entity) player.entity.angle = Math.max(-Math.PI, Math.min(Math.PI, angle))
    } else {
      this.kill(conn, 'Bad game message')
    }
  }

  setState(conn, state) {
    switch (state) {
      case HANDSHAKING:
        if (!this.gameloop) this.startLoop()
        if (this.world.no_players >= this.world.max_players) return this.kill(conn, 'Room is full')
        conn.state = state
        this.post(conn, [OP_WORLD_DATA, this.world.map_data, this.world.rules])
        return

      case JOINED: {
        let id = 0
        while (this.world.players[++id]);
        conn.player = this.world.add_player(id, conn.playerName)
        conn.player.userId = conn.userId
        conn.player.accountName = conn.playerName
        conn.state = state
        this.post(conn, [OP_WORLD_STATE, conn.player.id].concat(this.world.get_repr()))
        return
      }
    }
  }

  kill(conn, reason) {
    conn.reason = reason || 'Unknown reason'
    try {
      this.post(conn, [OP_DISCONNECT_REASON, conn.reason])
      conn.socket.close(1000, conn.reason.slice(0, 100))
    } catch {
      // already closed
    }
    conn.queue = []
    this.closed(conn)
  }

  post(conn, data) {
    this.send(conn, JSON.stringify(data))
  }

  send(conn, text) {
    try {
      conn.socket.send(text)
    } catch {
      // The close event will clean up.
    }
  }

  serverState() {
    return {
      server_name: this.name,
      region: 'Tronix Arena',
      version: SERVER_VERSION,
      map_name: this.world.map_name,
      max_players: MAX_PLAYERS,
      no_players: this.world.no_players,
      no_ready_players: this.world.no_ready_players,
      rules: this.world.rules,
    }
  }

  stop(reason) {
    for (const conn of [...this.connections.values()]) this.kill(conn, reason || 'Room closed')
    this.stopLoop()
  }

  // ---- world -------------------------------------------------------------

  hookWorld() {
    const world = this.world
    world.on_round_state_changed = (state, winners) => {
      this.broadcast(OP_ROUND_STATE, state, winners)
      if (state === ROUND_FINISHED && winners) {
        const won = winners.map((id) => world.players[id]).filter(Boolean)
        this.onRoundWon(won.map((p) => ({ name: p.accountName || p.name, userId: p.userId })))
      }
    }
    world.on_player_join = (player) => {
      player.name = uniqueName(world.players, player.id, player.name)
      for (const conn of this.connections.values()) {
        if (conn.state === JOINED && !(conn.player && conn.player.id === player.id)) {
          conn.queue.push([OP_PLAYER_CONNECT, player.id, player.name])
        }
      }
    }
    world.on_player_spawn = (player, pos) => this.broadcast(OP_PLAYER_SPAWN, player.id, pos)
    world.on_player_died = (player, old, cause, killer) =>
      this.broadcast(OP_PLAYER_DIE, player.id, cause, killer ? killer.id : -1)
    world.on_player_ready = (player) => this.broadcast(OP_PLAYER_INFO, player.id, 0, true)
    world.on_player_name_changed = (player, name) => {
      player.name = uniqueName(world.players, player.id, name)
      this.broadcast(OP_PLAYER_INFO, player.id, 0, 0, player.name)
    }
    world.on_player_fire = (player, angle, pos, vel, powerup) =>
      this.broadcast(OP_PLAYER_FIRE, player.id, angle, pos, vel, powerup)
    world.on_player_leave = (player, reason) => this.broadcast(OP_PLAYER_DISCONNECT, player.id, reason)
    world.on_powerup_spawn = (p) => this.broadcast(OP_POWERUP_SPAWN, p.powerup_id, p.powerup_type, p.pos)
    world.on_powerup_die = (p, player) => this.broadcast(OP_POWERUP_DIE, p.powerup_id, player.id)
  }

  loadMap() {
    const map = MAPS[this.nextMap++ % MAPS.length]
    const running = !!this.gameloop
    this.stopLoop()
    this.world.build(map, { ...DEFAULT_RULES, ...(map.rules || {}) })
    if (running) this.startLoop(false)
  }

  startLoop(rebuild = true) {
    if (rebuild) this.world.build(this.world.map_data, this.world.rules)
    // GameLoop keeps calling the ontick it started with until its current
    // batch ends, so ignore ticks from a loop that has been replaced.
    const loop = new GameLoop()
    loop.ontick = (t, dt) => {
      if (this.gameloop === loop) this.tick(t, dt)
    }
    this.gameloop = loop
    loop.start()
  }

  stopLoop() {
    if (this.gameloop) {
      this.gameloop.ontick = null
      this.gameloop.kill()
      this.gameloop = null
    }
  }

  tick(t, dt) {
    this.world.update(t, dt)
    this.checkRules(t)
    this.postUpdate()
    this.flushQueues()
  }

  checkRules(t) {
    const world = this.world
    switch (world.r_state) {
      // Warmup: the round starts once enough players have pressed "ready".
      case ROUND_WARMUP:
        if (world.no_players > 1 && world.no_ready_players >= world.no_players * world.rules.ready_ratio) {
          world.set_round_state(ROUND_STARTING)
        }
        break
      case ROUND_STARTING:
        if (t >= world.r_timer) world.set_round_state(ROUND_RUNNING)
        break
      case ROUND_RUNNING: {
        const winners = []
        world.forEachPlayer((p) => {
          if (p.score >= world.rules.round_limit) winners.push(p.id)
        })
        if (winners.length) world.set_round_state(ROUND_FINISHED, winners)
        break
      }
      // Round over: next map, and every player re-handshakes into it.
      case ROUND_FINISHED:
        if (t >= world.r_timer) {
          this.loadMap()
          for (const conn of this.connections.values()) {
            if (conn.state === JOINED) {
              conn.player = null
              conn.queue = []
              this.post(conn, [OP_WORLD_RECONNECT])
              this.setState(conn, HANDSHAKING)
            }
          }
        }
        break
    }
  }

  postUpdate() {
    this.updateTick++
    const now = Date.now()
    for (const conn of this.connections.values()) {
      if (conn.state !== JOINED) continue
      if (conn.lastPing + 2000 < now) {
        conn.lastPing = now
        this.post(conn, [PING_PACKET])
      }
      if (this.updateTick % conn.updateRate !== 0) continue
      for (const id in this.world.players) {
        const player = this.world.players[id]
        if (player.entity) {
          conn.queue.push([OP_PLAYER_STATE, player.id, packVector(player.entity.pos), player.entity.angle, player.entity.action])
        }
        if (this.updateTick % 200 === 0) {
          const pc = this.connectionFor(player)
          if (pc) conn.queue.push([OP_PLAYER_INFO, player.id, pc.ping])
        }
      }
    }
  }

  flushQueues() {
    const now = Date.now()
    for (const conn of this.connections.values()) {
      if (conn.state !== JOINED) continue
      const parts = conn.queue.map((m) => JSON.stringify(m))
      conn.queue = []
      const text = '[' + GAME_PACKET + ',[' + parts.join(',') + ']]'
      this.send(conn, text)
      conn.dataSent += text.length
      // Adapt the update rate to the client's bandwidth setting.
      if (now - conn.lastRateCheck >= 1000) {
        if (conn.dataSent < conn.rate && conn.updateRate > 1) conn.updateRate--
        else if (conn.dataSent > conn.rate) conn.updateRate++
        conn.dataSent = 0
        conn.lastRateCheck = now
      }
    }
  }

  broadcast(...msg) {
    for (const conn of this.connections.values()) {
      if (conn.state === JOINED) conn.queue.push(msg)
    }
  }

  connectionFor(player) {
    for (const conn of this.connections.values()) {
      if (conn.player && conn.player.id === player.id) return conn
    }
    return null
  }
}

function cleanName(name) {
  const n = String(name || 'Pilot')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 16)
  return n || 'Pilot'
}

function uniqueName(players, playerId, name) {
  let unique = name
  const taken = (n) => Object.keys(players).some((id) => id != playerId && players[id].name === n)
  for (let i = 2; taken(unique); i++) unique = name + ' ' + i
  return unique
}

function packVector(v) {
  return [round_number(v[0], 2), round_number(v[1], 2)]
}
