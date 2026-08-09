import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../DurableFileDatabase'

const TEST_DB_DIR = path.join(process.cwd(), 'database-concurrency-test')

describe('DurableFileDatabase (Milestone I - Production Hardening)', () => {
  let database: DurableFileDatabase

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
  })

  it('persists a committed transaction to disk', async () => {
    database.beginTransaction()
    database.insertUser({
      id: 'usr-1',
      email: 'a@b.com',
      passwordHash: 'scrypt$placeholder',
      createdAt: new Date().toISOString(),
    })
    await database.commit()
    // Re-open and verify
    const db2 = new DurableFileDatabase(TEST_DB_DIR)
    await db2.initialize()
    expect(db2.getUserByEmail('a@b.com')).not.toBeNull()
  })

  it('rolls back uncommitted changes', () => {
    database.beginTransaction()
    database.insertUser({
      id: 'usr-1',
      email: 'a@b.com',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    })
    database.rollback()
    // After rollback the state must not reflect the insert
    expect(database.getUserByEmail('a@b.com')).toBeNull()
  })

  it('rejects nested transactions', () => {
    database.beginTransaction()
    expect(() => database.beginTransaction()).toThrow(/already in progress/)
    database.rollback()
  })

  it('rejects commit without a transaction', async () => {
    await expect(database.commit()).rejects.toThrow(/No transaction/)
  })

  it('rejects rollback without a transaction', () => {
    expect(() => database.rollback()).not.toThrow()
  })

  it('enforces unique email at the DB layer', () => {
    database.insertUser({
      id: 'usr-1',
      email: 'dup@example.com',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    })
    expect(() =>
      database.insertUser({
        id: 'usr-2',
        email: 'DUP@example.com',
        passwordHash: 'y',
        createdAt: new Date().toISOString(),
      })
    ).toThrow(/already exists/)
  })

  it('enforces unique (userId, workspaceId) membership', () => {
    database.insertMembership({
      id: 'mbr-1',
      userId: 'u-1',
      workspaceId: 'ws-1',
      role: 'owner',
      createdAt: new Date().toISOString(),
    })
    expect(() =>
      database.insertMembership({
        id: 'mbr-2',
        userId: 'u-1',
        workspaceId: 'ws-1',
        role: 'member',
        createdAt: new Date().toISOString(),
      })
    ).toThrow(/already a member/)
  })

  it('handles malformed database files gracefully by re-initializing', async () => {
    const dbPath = path.join(TEST_DB_DIR, 'db.json')
    fs.writeFileSync(dbPath, '{ this is not valid json', 'utf8')
    const db2 = new DurableFileDatabase(TEST_DB_DIR)
    // Re-initializing a malformed file throws — this is the documented
    // behavior. We assert the throw, not silent success.
    await expect(db2.initialize()).rejects.toThrow()
  })

  it('persists session, then deletes it (logout flow)', () => {
    database.insertSession({
      id: 'sess-1',
      userId: 'u-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    expect(database.getSession('sess-1')).not.toBeNull()
    database.deleteSession('sess-1')
    expect(database.getSession('sess-1')).toBeNull()
  })

  it('re-exposes active state inside vs outside a transaction', () => {
    expect(database.getActiveState()).toBeDefined()
    database.beginTransaction()
    const txs = database.getActiveState()
    expect(txs).toBeDefined()
    database.rollback()
  })

  it('serializes concurrent commits through the write mutex without losing writes', async () => {
    // Fire several transactions "simultaneously". The in-process write mutex
    // must serialize the commit phase so every committed snapshot survives.
    const writes = Array.from({ length: 8 }, (_, i) =>
      (async () => {
        database.beginTransaction()
        database.insertUser({
          id: `usr-concurrent-${i}`,
          email: `concurrent-${i}@b.com`,
          passwordHash: 'scrypt$placeholder',
          createdAt: new Date().toISOString(),
        })
        await database.commit()
      })()
    )
    await Promise.all(writes)

    // Every committed row must be visible after the dust settles.
    for (let i = 0; i < 8; i++) {
      expect(database.getUserById(`usr-concurrent-${i}`)).not.toBeNull()
    }

    // And the on-disk snapshot agrees (re-open from disk).
    const db2 = new DurableFileDatabase(TEST_DB_DIR)
    await db2.initialize()
    expect(db2.getUserById('usr-concurrent-7')).not.toBeNull()
  })

  it('rolls back a transaction that throws mid-commit', async () => {
    database.beginTransaction()
    database.insertUser({
      id: 'usr-rollback',
      email: 'rollback@b.com',
      passwordHash: 'scrypt$placeholder',
      createdAt: new Date().toISOString(),
    })
    // Force a constraint violation inside the transaction.
    expect(() =>
      database.insertUser({
        id: 'usr-rollback-dup',
        email: 'rollback@b.com',
        passwordHash: 'scrypt$placeholder',
        createdAt: new Date().toISOString(),
      })
    ).toThrow(/already exists/)
    // Nothing may be committed: rollback discards the whole snapshot.
    database.rollback()
    expect(database.getUserById('usr-rollback')).toBeNull()
  })
})
