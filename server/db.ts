import path from 'node:path';
import fs from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { BUS_SEAT_TEMPLATES } from '../shared/seatRules.js';
import { hashPassword, verifyPassword } from './auth.js';

export interface DbClient {
  dialect: 'sqlite' | 'postgres';
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  insertReturningId(sql: string, params?: unknown[]): Promise<number>;
  withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function toPgParams(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function createSqliteClient(rawDb: import('node:sqlite').DatabaseSync): DbClient {
  const client: DbClient = {
    dialect: 'sqlite',
    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const stmt = rawDb.prepare(sql);
      return stmt.all(...(params as never[])) as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const stmt = rawDb.prepare(sql);
      return stmt.get(...(params as never[])) as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []) {
      const stmt = rawDb.prepare(sql);
      const res = stmt.run(...(params as never[]));
      return { changes: Number(res.changes) };
    },
    async insertReturningId(sql: string, params: unknown[] = []) {
      const stmt = rawDb.prepare(sql);
      const res = stmt.run(...(params as never[]));
      return Number(res.lastInsertRowid);
    },
    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>) {
      rawDb.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(client);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          rawDb.exec('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      }
    },
    async close() {
      rawDb.close();
    },
  };
  return client;
}

function createPgQueryWrapper(
  runner: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
  poolOrNull: Pool | null
): DbClient {
  const client: DbClient = {
    dialect: 'postgres',
    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query(toPgParams(sql), params);
      return res.rows as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query(toPgParams(sql), params);
      return res.rows[0] as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []) {
      const res = await runner.query(toPgParams(sql), params);
      return { changes: Number(res.rowCount ?? 0) };
    },
    async insertReturningId(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim().replace(/;$/, '');
      const withReturning = /\bRETURNING\b/i.test(trimmed) ? trimmed : `${trimmed} RETURNING id`;
      const res = await runner.query(toPgParams(withReturning), params);
      const row = res.rows[0] as { id: number | string } | undefined;
      return Number(row?.id ?? 0);
    },
    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>) {
      if (!poolOrNull) {
        return fn(client);
      }
      const pgClient: PoolClient = await poolOrNull.connect();
      try {
        await pgClient.query('BEGIN');
        const txClient = createPgQueryWrapper(pgClient, null);
        const result = await fn(txClient);
        await pgClient.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await pgClient.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        pgClient.release();
      }
    },
    async close() {
      if (poolOrNull) {
        await poolOrNull.end();
      }
    },
  };
  return client;
}

async function initSchema(db: DbClient) {
  const isPg = db.dialect === 'postgres';
  const pk = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const bigint = isPg ? 'BIGINT' : 'INTEGER';

  const statements = [
    `CREATE TABLE IF NOT EXISTS admins (
      id ${pk},
      nama TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id ${pk},
      nama TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      jam_berangkat TEXT NOT NULL,
      lokasi_berangkat TEXT NOT NULL,
      titik_kumpul_detail TEXT NOT NULL DEFAULT '',
      deskripsi TEXT NOT NULL DEFAULT '',
      status_pendaftaran TEXT NOT NULL DEFAULT 'buka' CHECK (status_pendaftaran IN ('buka', 'tutup')),
      batas_waktu_pendaftaran TEXT,
      batas_pesanan_per_wa INTEGER NOT NULL DEFAULT 1,
      durasi_hold_detik INTEGER NOT NULL DEFAULT 300
    )`,
    `CREATE TABLE IF NOT EXISTS buses (
      id ${pk},
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      nama TEXT NOT NULL,
      plat_nomor TEXT NOT NULL DEFAULT '',
      tipe_armada TEXT NOT NULL DEFAULT 'Executive Coach',
      posisi_sopir TEXT NOT NULL DEFAULT 'kanan' CHECK (posisi_sopir IN ('kanan', 'kiri')),
      aktif INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
      urutan INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS seats (
      id ${pk},
      bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      tipe TEXT NOT NULL CHECK (tipe IN ('leg_rest', 'belakang')),
      baris TEXT NOT NULL,
      posisi INTEGER NOT NULL,
      sisi TEXT NOT NULL CHECK (sisi IN ('kiri', 'kanan', 'belakang')),
      posisi_desc TEXT NOT NULL,
      adjacent_labels TEXT NOT NULL,
      UNIQUE(bus_id, label)
    )`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id ${pk},
      kode_booking TEXT NOT NULL UNIQUE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('sendiri', 'suami_istri')),
      nama_pemesan TEXT NOT NULL,
      no_whatsapp TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'dibatalkan')),
      dibuat_pada TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dibatalkan_pada TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_wa_status ON bookings(no_whatsapp, status)`,
    `CREATE TABLE IF NOT EXISTS booking_seats (
      id ${pk},
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      seat_id INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      nama_penumpang TEXT NOT NULL,
      jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
      peran_pasangan TEXT CHECK (peran_pasangan IN ('suami', 'istri') OR peran_pasangan IS NULL),
      active_flag INTEGER DEFAULT 1 CHECK (active_flag = 1 OR active_flag IS NULL),
      UNIQUE(seat_id, active_flag)
    )`,
    `CREATE TABLE IF NOT EXISTS seat_holds (
      id ${pk},
      bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
      seat_id INTEGER NOT NULL UNIQUE REFERENCES seats(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('sendiri', 'suami_istri')),
      gender TEXT NOT NULL CHECK (gender IN ('L', 'P')),
      expires_at ${bigint} NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_seat_holds_session ON seat_holds(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_seat_holds_expires ON seat_holds(expires_at)`,
    `CREATE TABLE IF NOT EXISTS seat_blocks (
      id ${pk},
      seat_id INTEGER NOT NULL UNIQUE REFERENCES seats(id) ON DELETE CASCADE,
      alasan TEXT NOT NULL DEFAULT 'Diblokir Panitia',
      dibuat_oleh INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      dibuat_pada TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id ${pk},
      admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      admin_nama TEXT NOT NULL,
      aksi TEXT NOT NULL,
      objek TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      waktu TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS participants (
      id ${pk},
      email TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL DEFAULT '',
      no_whatsapp TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_seats_bus ON seats(bus_id)`,
    `CREATE INDEX IF NOT EXISTS idx_booking_seats_booking ON booking_seats(booking_id)`,
    `CREATE INDEX IF NOT EXISTS idx_buses_event ON buses(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_seat_holds_bus ON seat_holds(bus_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_bus_status ON bookings(bus_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_event_status ON bookings(event_id, status)`,
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }

  // Safely add participant_id column to bookings for existing databases
  if (isPg) {
    await db.execute(
      'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL'
    );
  } else {
    const cols = await db.queryAll<{ name: string }>('PRAGMA table_info(bookings)');
    if (!cols.some((c) => c.name === 'participant_id')) {
      await db.execute(
        'ALTER TABLE bookings ADD COLUMN participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL'
      );
    }
  }

  await db.execute('CREATE INDEX IF NOT EXISTS idx_bookings_participant ON bookings(participant_id)');
  await db.execute('DROP TABLE IF EXISTS registered_phones');
}

export async function insertBusSeats(db: DbClient, busId: number) {
  // Satu query multi-baris (bukan 38 query terpisah) supaya cepat dan atomik.
  const values: string[] = [];
  const params: unknown[] = [];
  for (const s of BUS_SEAT_TEMPLATES) {
    values.push('(?, ?, ?, ?, ?, ?, ?, ?)');
    params.push(
      busId,
      s.label,
      s.tipe,
      s.baris,
      s.posisi,
      s.sisi,
      s.posisiDesc,
      JSON.stringify(s.adjacentLabels)
    );
  }
  await db.execute(
    `INSERT INTO seats (bus_id, label, tipe, baris, posisi, sisi, posisi_desc, adjacent_labels)
     VALUES ${values.join(', ')}`,
    params
  );
}

async function seedDatabase(db: DbClient) {
  const adminEmail = 'Selangkahtourtravel@gmail.com';
  const existingAdmin = await db.queryOne<{ id: number | string; password_hash: string }>(
    'SELECT id, password_hash FROM admins WHERE LOWER(email) = LOWER(?)',
    [adminEmail]
  );

  if (!existingAdmin) {
    const adminPasswordHash = hashPassword('hafizhganteng');
    await db.execute(
      'INSERT INTO admins (nama, email, password_hash, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING',
      ['Admin Selangkah', adminEmail, adminPasswordHash, 'admin']
    );
  } else if (!verifyPassword('hafizhganteng', existingAdmin.password_hash)) {
    const adminPasswordHash = hashPassword('hafizhganteng');
    await db.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [
      adminPasswordHash,
      Number(existingAdmin.id),
    ]);
  }

  // Ensure only the single designated admin account exists
  await db.execute('DELETE FROM admins WHERE LOWER(email) <> LOWER(?)', [adminEmail]);
  await db.execute(
    "UPDATE admins SET nama = 'Admin Selangkah', role = 'admin' WHERE LOWER(email) = LOWER(?) AND (nama <> 'Admin Selangkah' OR role <> 'admin')",
    [adminEmail]
  );

  const firstAdmin = await db.queryOne<{ id: number | string }>(
    'SELECT id FROM admins ORDER BY id ASC LIMIT 1'
  );
  const seedAdminId = firstAdmin ? Number(firstAdmin.id) : null;

  // Remove any legacy default/testing participant accounts & test bookings
  await db.execute(
    "DELETE FROM participants WHERE LOWER(email) IN ('tes', 'tes@gmail.com', 'test@gmail.com') OR nama = 'Peserta Testing'"
  );
  await db.execute(
    `DELETE FROM booking_seats
     WHERE booking_id IN (
       SELECT id FROM bookings
       WHERE nama_pemesan IN ('fgf & fg', 'sd', 'er & er', 'Peserta Testing')
     )`
  );
  await db.execute(
    "DELETE FROM bookings WHERE nama_pemesan IN ('fgf & fg', 'sd', 'er & er', 'Peserta Testing')"
  );

  const eventRow = await db.queryOne<{ c: number | string }>('SELECT COUNT(*) as c FROM events');
  if (Number(eventRow?.c ?? 0) === 0) {
    const eventId = await db.insertReturningId(
      `INSERT INTO events (
        nama, tanggal, jam_berangkat, lokasi_berangkat, titik_kumpul_detail, deskripsi,
        status_pendaftaran, batas_pesanan_per_wa, durasi_hold_detik
      ) VALUES (?, ?, ?, ?, ?, ?, 'buka', 1, 300)`,
      [
        'Rombongan Silaturahmi Akbar 2026',
        'Sabtu, 14 Nov 2026',
        '06.30 WIB',
        'Masjid Agung Hubbul Wathan',
        'Pintu Gerbang Barat (Area Drop-zone Bus 1) • Boarding 06.00 WIB',
        'Keberangkatan rombongan bersama menuju lokasi Silaturahmi Akbar 2026. Harap hadir 30 menit sebelum keberangkatan untuk presensi panitia.',
      ]
    );

    const busId = await db.insertReturningId(
      `INSERT INTO buses (event_id, nama, plat_nomor, tipe_armada, posisi_sopir, aktif, urutan)
       VALUES (?, 'BUS 1', 'B 7890 TAA', 'Scania K410IB • Executive Coach', 'kanan', 1, 1)`,
      [eventId]
    );

    await insertBusSeats(db, busId);

    await db.execute(
      `INSERT INTO audit_logs (admin_id, admin_nama, aksi, objek, detail)
       VALUES (?, 'Sistem', 'INIT_EVENT', 'Event & Bus 1', 'Inisialisasi event awal beserta 38 kursi Bus 1')`,
      [seedAdminId]
    );
  } else {
    // Cleanup legacy dummy seed bookings/block if still present on existing databases
    await db.execute(
      `DELETE FROM booking_seats
       WHERE booking_id IN (
         SELECT id FROM bookings
         WHERE (kode_booking = 'TRS-A101' AND nama_pemesan = 'Ahmad Fauzi')
            OR (kode_booking = 'TRS-B102' AND nama_pemesan = 'Aisyah Putri')
            OR (kode_booking = 'TRS-C103' AND nama_pemesan = 'Rahmat & Nur Aini')
       )`
    );
    await db.execute(
      `DELETE FROM bookings
       WHERE (kode_booking = 'TRS-A101' AND nama_pemesan = 'Ahmad Fauzi')
          OR (kode_booking = 'TRS-B102' AND nama_pemesan = 'Aisyah Putri')
          OR (kode_booking = 'TRS-C103' AND nama_pemesan = 'Rahmat & Nur Aini')`
    );
    await db.execute(
      `DELETE FROM seat_blocks WHERE alasan = 'Cadangan / Logistik Panitia'`
    );
  }
}

export async function createDatabase(options?: { dbPath?: string; connectionString?: string }): Promise<DbClient> {
  const connectionString =
    options?.connectionString ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;

  if (connectionString && !options?.dbPath) {
    const useSsl = !/localhost|127\.0\.0\.1/i.test(connectionString);
    const pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // Tanpa handler ini, error pada koneksi idle bisa mematikan seluruh proses.
    pool.on('error', (err) => {
      console.error('Postgres pool error:', err.message);
    });

    // Migrasi + seed hanya dijalankan bila SKIP_DB_INIT bukan "1".
    // Di produksi (Vercel) set SKIP_DB_INIT=1 setelah tabel selesai dibuat, agar
    // cold start tidak menjalankan puluhan query DDL dan menahan lock di tiap instance.
    if (process.env.SKIP_DB_INIT !== '1') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(727001)');
        const tx = createPgQueryWrapper(client, null);
        await initSchema(tx);
        await seedDatabase(tx);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    return createPgQueryWrapper(pool, pool);
  }

  const { DatabaseSync } = await import('node:sqlite');
  const resolvedPath =
    options?.dbPath ?? process.env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'transit.db');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const rawDb = new DatabaseSync(resolvedPath);
  rawDb.exec('PRAGMA journal_mode = WAL;');
  rawDb.exec('PRAGMA foreign_keys = ON;');
  rawDb.exec('PRAGMA busy_timeout = 5000;');

  const db = createSqliteClient(rawDb);
  await initSchema(db);
  await seedDatabase(db);
  return db;
}

let cachedDbPromise: Promise<DbClient> | null = null;

export function getDatabase(): Promise<DbClient> {
  if (!cachedDbPromise) {
    cachedDbPromise = createDatabase().catch((err) => {
      cachedDbPromise = null;
      throw err;
    });
  }
  return cachedDbPromise;
}
