import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import path from 'node:path';
import {D1ApprovalStore} from '../src/approval-store.mjs';

// SQLite exercises the same conditional SQL as hosted D1. The file belongs in
// ignored data/, survives local server restarts, and contains no API credentials.
export class LocalApprovalStore extends D1ApprovalStore {
  #sqlite;
  constructor(filename) {
    if (typeof filename !== 'string' || !filename) throw new TypeError('An approval database filename is required.');
    if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), {recursive: true, mode: 0o700});
    const sqlite = new DatabaseSync(filename);
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('PRAGMA journal_mode = WAL');
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    const d1 = {
      prepare(sql) {
        const execute = values => ({
          async run() {
            const result = sqlite.prepare(sql).run(...values);
            return {success: true, meta: {changes: Number(result.changes)}};
          },
          async first() { return sqlite.prepare(sql).get(...values) ?? null; }
        });
        return {...execute([]), bind: (...values) => execute(values)};
      }
    };
    super(d1);
    this.#sqlite = sqlite;
  }
  close() { this.#sqlite.close(); }
}
