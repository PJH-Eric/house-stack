'use strict';

const { DatabaseSync } = require('node:sqlite');
const { deserialize, serialize } = require('node:v8');
const T = require('../public/js/rules.js');

function openCheckpoints(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, checkpoint BLOB NOT NULL);
  `);
  const list = db.prepare('SELECT checkpoint FROM rooms');
  const save = db.prepare('INSERT INTO rooms VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET checkpoint = excluded.checkpoint');
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');
  return {
    load() {
      return list.all().map(({ checkpoint }) => {
        const { format, room, savedAt } = deserialize(checkpoint);
        if (format !== 1) throw new Error('不支援的房間快照版本');
        if (room.game) room.game = T.createGame({
          seed: room.game.state.seed, difficulty: room.settings.difficulty, mode: 'versus',
          shapes: room.settings.shapes, turnLimit: room.settings.turnLimit, players: room.game.state.players,
        }, room.game);
        return { room, savedAt };
      });
    },
    write(room, savedAt) {
      const { timers, turnTimer, recoveryTimer, ...state } = room;
      const members = new Map([...room.members].map(([id, { disconnectTimer, ...member }]) => [id, member]));
      save.run(room.id, serialize({ format: 1, room: { ...state, members, game: room.game?.checkpoint() }, savedAt }));
    },
    remove(id) { remove.run(id); },
  };
}

module.exports = { openCheckpoints };
