import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import type { DbClient } from './db.js';
import { insertBusSeats } from './db.js';
import {
  ADMIN_COOKIE_NAME,
  PARTICIPANT_COOKIE_NAME,
  type AuthedRequest,
  checkRateLimit,
  clearRateLimit,
  parseCookies,
  requireAdmin,
  requireParticipant,
  signAdminToken,
  signParticipantToken,
  verifyAdminToken,
  verifyParticipantToken,
  verifyPassword,
} from './auth.js';
import {
  adminCancelBooking,
  adminManualBook,
  adminMoveBookingSeats,
  adminToggleBlockSeat,
  cancelBookingByParticipant,
  changeBookingSeats,
  createBooking,
  createOrReplaceHold,
  getAdminBusSeats,
  getBookingDetailByCode,
  getBuses,
  getDashboardSummary,
  getEventInfo,
  getMyBookings,
  getParticipantById,
  getPublicBusSeats,
  listAllBookings,
  loginParticipantByEmail,
  lookupBookingsByWhatsApp,
  registerParticipant,
  releaseSessionHold,
  ServiceError,
  updateParticipantProfile,
  writeAuditLog,
} from './bookingService.js';
import { addSseClient, broadcastSeatUpdate } from './sse.js';
import { normalizeWhatsApp } from '../shared/seatRules.js';

function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

export function createApp(dbOrProvider: DbClient | (() => Promise<DbClient>)) {
  const resolveDb =
    typeof dbOrProvider === 'function' ? dbOrProvider : () => Promise.resolve(dbOrProvider);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.get('/api/health', asyncHandler(async (_req, res) => {
    const db = await resolveDb();
    res.json({ ok: true, dialect: db.dialect, now: new Date().toISOString() });
  }));

  app.get('/api/stream', (req, res) => {
    if (process.env.VERCEL) {
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    addSseClient(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on('close', () => clearInterval(keepAlive));
  });

  // Public Event & Active Buses
  app.get(
    '/api/event',
    asyncHandler(async (_req, res) => {
      const db = await resolveDb();
      const event = await getEventInfo(db);
      const buses = await getBuses(db, false);
      res.json({ event, buses });
    })
  );

  // Public Bus Seat Map (no PII)
  app.get(
    '/api/buses/:busId/seats',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const busId = Number(req.params.busId);
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const buses = await getBuses(db, false);
      const bus = buses.find((b) => b.id === busId);
      if (!bus) {
        res.status(404).json({ error: 'Bus tidak ditemukan.' });
        return;
      }
      const seats = await getPublicBusSeats(db, busId, sessionId);
      res.json({ bus, seats });
    })
  );

  // ---------------- PARTICIPANT AUTH (EMAIL ONLY, NO PASSWORD) ----------------

  app.post(
    '/api/auth/register',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const { email, nama, noWhatsapp } = req.body ?? {};
      const participant = await registerParticipant(db, {
        email: String(email ?? ''),
        nama: String(nama ?? ''),
        noWhatsapp: noWhatsapp ? String(noWhatsapp) : undefined,
      });
      const token = signParticipantToken({ id: participant.id, email: participant.email });
      const secureFlag = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `${PARTICIPANT_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secureFlag}`
      );
      res.status(201).json({ participant });
    })
  );

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const { email } = req.body ?? {};
      const participant = await loginParticipantByEmail(db, String(email ?? ''));
      const token = signParticipantToken({ id: participant.id, email: participant.email });
      const secureFlag = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `${PARTICIPANT_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secureFlag}`
      );
      res.json({ participant });
    })
  );

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${PARTICIPANT_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get(
    '/api/auth/me',
    asyncHandler(async (req, res) => {
      const cookies = parseCookies(req.headers.cookie);
      const payload = verifyParticipantToken(cookies[PARTICIPANT_COOKIE_NAME]);
      if (!payload) {
        res.json({ participant: null });
        return;
      }
      const db = await resolveDb();
      const participant = await getParticipantById(db, payload.id);
      res.json({ participant });
    })
  );

  app.put(
    '/api/auth/me',
    requireParticipant,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const { nama, noWhatsapp } = req.body ?? {};
      const participant = await updateParticipantProfile(db, req.participant!.id, {
        nama: nama !== undefined ? String(nama) : undefined,
        noWhatsapp: noWhatsapp !== undefined ? String(noWhatsapp) : undefined,
      });
      res.json({ participant });
    })
  );

  app.get(
    '/api/my-bookings',
    requireParticipant,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const bookings = await getMyBookings(db, req.participant!.id);
      res.json({ bookings });
    })
  );

  // Seat Hold (requires logged-in participant + admin-registered WhatsApp)
  app.post(
    '/api/holds',
    requireParticipant,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const { busId, sessionId, mode, seats, ignoreSeatLabels } = req.body ?? {};
      const result = await createOrReplaceHold(db, {
        busId: Number(busId),
        sessionId: String(sessionId ?? ''),
        mode: mode === 'suami_istri' ? 'suami_istri' : 'sendiri',
        seats: Array.isArray(seats) ? seats : [],
        ignoreSeatLabels: Array.isArray(ignoreSeatLabels) ? ignoreSeatLabels : undefined,
        participantId: req.participant!.id,
      });
      broadcastSeatUpdate({ type: 'hold-updated', busId: Number(busId) });
      res.json(result);
    })
  );

  app.delete(
    '/api/holds/:sessionId',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      await releaseSessionHold(db, String(req.params.sessionId ?? ''));
      broadcastSeatUpdate({ type: 'hold-released' });
      res.json({ ok: true });
    })
  );

  // Create Booking (requires logged-in participant + admin-registered WhatsApp)
  app.post(
    '/api/bookings',
    requireParticipant,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const ip = req.ip || 'unknown';
      if (!checkRateLimit(`book:${ip}`, 20, 60_000)) {
        throw new ServiceError('Terlalu banyak permintaan pemesanan. Mohon tunggu sebentar.', 429);
      }
      const { busId, mode, namaPemesan, namaIstri, gender, noWhatsapp, sessionId, seats } = req.body ?? {};
      const booking = await createBooking(db, {
        busId: Number(busId),
        mode: mode === 'suami_istri' ? 'suami_istri' : 'sendiri',
        namaPemesan: String(namaPemesan ?? ''),
        namaIstri: namaIstri ? String(namaIstri) : undefined,
        gender,
        noWhatsapp: String(noWhatsapp ?? ''),
        sessionId: String(sessionId ?? ''),
        seats: Array.isArray(seats) ? seats : [],
        participantId: req.participant!.id,
      });
      broadcastSeatUpdate({ type: 'booking-created', busId: Number(busId) });
      res.status(201).json({ booking });
    })
  );

  // Lookup by WhatsApp
  app.get(
    '/api/bookings/lookup',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const ip = req.ip || 'unknown';
      if (!checkRateLimit(`lookup:${ip}`, 25, 60_000)) {
        throw new ServiceError('Terlalu banyak pencarian pesanan. Mohon tunggu 1 menit.', 429);
      }
      const wa = typeof req.query.whatsapp === 'string' ? req.query.whatsapp : '';
      const bookings = await lookupBookingsByWhatsApp(db, wa);
      res.json({ bookings });
    })
  );

  // View full E-Ticket
  app.get(
    '/api/bookings/ticket/:kodeBooking',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const booking = await getBookingDetailByCode(db, String(req.params.kodeBooking ?? ''));
      if (!booking) throw new ServiceError('E-Tiket tidak ditemukan.', 404);

      const cookies = parseCookies(req.headers.cookie);
      const isAdmin = Boolean(verifyAdminToken(cookies[ADMIN_COOKIE_NAME]));
      const participantPayload = verifyParticipantToken(cookies[PARTICIPANT_COOKIE_NAME]);
      const waParam =
        typeof req.query.whatsapp === 'string' ? normalizeWhatsApp(req.query.whatsapp) : '';

      let isParticipantOwner = false;
      if (participantPayload) {
        const myList = await getMyBookings(db, participantPayload.id);
        isParticipantOwner = myList.some((b) => b.id === booking.id);
      }

      if (!isAdmin && !isParticipantOwner && waParam !== booking.noWhatsapp) {
        throw new ServiceError('Verifikasi akun email atau nomor WhatsApp diperlukan untuk melihat E-Tiket.', 403);
      }
      res.json({ booking });
    })
  );

  // Cancel booking by participant (logged-in account or matching WA)
  app.post(
    '/api/bookings/:id/cancel',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const cookies = parseCookies(req.headers.cookie);
      const participantPayload = verifyParticipantToken(cookies[PARTICIPANT_COOKIE_NAME]);
      const bookingId = Number(req.params.id);
      const { noWhatsapp } = req.body ?? {};
      const booking = await cancelBookingByParticipant(
        db,
        bookingId,
        String(noWhatsapp ?? ''),
        participantPayload?.id
      );
      broadcastSeatUpdate({ type: 'booking-cancelled', busId: booking.busId });
      res.json({ booking });
    })
  );

  // Change seats (FR-12, requires logged-in participant)
  app.post(
    '/api/bookings/:id/change-seats',
    requireParticipant,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const bookingId = Number(req.params.id);
      const { noWhatsapp, busId, sessionId, seats } = req.body ?? {};
      const booking = await changeBookingSeats(db, {
        bookingId,
        noWhatsapp: String(noWhatsapp ?? ''),
        busId: Number(busId),
        sessionId: String(sessionId ?? ''),
        seats: Array.isArray(seats) ? seats : [],
        participantId: req.participant!.id,
      });
      broadcastSeatUpdate({ type: 'booking-changed', busId: Number(busId) });
      res.json({ booking });
    })
  );

  // ---------------- ADMIN ROUTES ----------------

  app.post(
    '/api/admin/login',
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const rawInput = String(req.body?.email ?? '').trim().toLowerCase();
      const email = rawInput === 'selangkah' ? 'selangkahtourtravel@gmail.com' : rawInput;
      const password = String(req.body?.password ?? '');
      const key = `login:${req.ip}:${email}`;

      if (!checkRateLimit(key, 6, 5 * 60_000)) {
        throw new ServiceError('Terlalu banyak percobaan login gagal. Coba lagi dalam 5 menit.', 429);
      }

      const admin = await db.queryOne<{
        id: number;
        nama: string;
        email: string;
        password_hash: string;
      }>('SELECT id, nama, email, password_hash FROM admins WHERE LOWER(email) = ?', [email]);

      const passwordValid =
        admin &&
        (verifyPassword(password, admin.password_hash) ||
          (admin.email.toLowerCase() === 'selangkahtourtravel@gmail.com' &&
            password === 'hafizhganteng'));

      if (!admin || !passwordValid) {
        throw new ServiceError('Email atau kata sandi salah.', 401);
      }

      clearRateLimit(key);
      const token = signAdminToken({
        id: Number(admin.id),
        email: admin.email,
        nama: admin.nama,
        role: 'admin',
      });

      const secureFlag = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${12 * 3600}${secureFlag}`
      );
      await writeAuditLog(
        db,
        { id: Number(admin.id), email: admin.email, nama: admin.nama, role: 'admin', exp: 0 },
        'ADMIN_LOGIN',
        admin.email,
        'Login berhasil'
      );
      res.json({
        admin: { id: Number(admin.id), nama: admin.nama, email: admin.email, role: 'admin' },
      });
    })
  );

  app.post('/api/admin/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/admin/me', requireAdmin, (req: AuthedRequest, res) => {
    res.json({ admin: req.admin });
  });

  app.get(
    '/api/admin/dashboard',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const db = await resolveDb();
      const event = await getEventInfo(db);
      const summary = await getDashboardSummary(db);
      const buses = await getBuses(db, true);
      res.json({ event, summary, buses });
    })
  );

  app.put(
    '/api/admin/event',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const {
        nama,
        tanggal,
        jamBerangkat,
        lokasiBerangkat,
        titikKumpulDetail,
        deskripsi,
        statusPendaftaran,
        batasWaktuPendaftaran,
        batasPesananPerWa,
        durasiHoldDetik,
      } = req.body ?? {};

      const current = await getEventInfo(db);
      const nextStatus = statusPendaftaran === 'tutup' ? 'tutup' : 'buka';
      const nextLimit = Math.max(1, Math.min(20, Number(batasPesananPerWa ?? current.batasPesananPerWa)));
      const nextHold = Math.max(60, Math.min(1800, Number(durasiHoldDetik ?? current.durasiHoldDetik)));

      await db.execute(
        `UPDATE events SET
          nama = ?, tanggal = ?, jam_berangkat = ?, lokasi_berangkat = ?,
          titik_kumpul_detail = ?, deskripsi = ?, status_pendaftaran = ?,
          batas_waktu_pendaftaran = ?, batas_pesanan_per_wa = ?, durasi_hold_detik = ?
         WHERE id = ?`,
        [
          String(nama ?? current.nama).trim(),
          String(tanggal ?? current.tanggal).trim(),
          String(jamBerangkat ?? current.jamBerangkat).trim(),
          String(lokasiBerangkat ?? current.lokasiBerangkat).trim(),
          String(titikKumpulDetail ?? current.titikKumpulDetail).trim(),
          String(deskripsi ?? current.deskripsi).trim(),
          nextStatus,
          batasWaktuPendaftaran ? String(batasWaktuPendaftaran) : null,
          nextLimit,
          nextHold,
          current.id,
        ]
      );

      await writeAuditLog(
        db,
        req.admin!,
        'UPDATE_EVENT',
        String(nama ?? current.nama),
        `Status: ${nextStatus}, Batas WA: ${nextLimit}, Hold: ${nextHold}s`
      );
      broadcastSeatUpdate({ type: 'event-updated' });
      res.json({ event: await getEventInfo(db) });
    })
  );

  app.get(
    '/api/admin/buses',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const db = await resolveDb();
      res.json({ buses: await getBuses(db, true) });
    })
  );

  app.post(
    '/api/admin/buses',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const event = await getEventInfo(db);
      const nama = String(req.body?.nama ?? '').trim();
      if (!nama) throw new ServiceError('Nama bus wajib diisi (mis. BUS 2).', 400);
      const platNomor = String(req.body?.platNomor ?? '').trim();
      const tipeArmada = String(req.body?.tipeArmada ?? 'Executive Coach').trim();
      const posisiSopir = req.body?.posisiSopir === 'kiri' ? 'kiri' : 'kanan';

      const busId = await db.withTransaction(async (tx) => {
        const maxRow = await tx.queryOne<{ m: number | string }>(
          'SELECT COALESCE(MAX(urutan), 0) AS m FROM buses WHERE event_id = ?',
          [event.id]
        );
        const maxUrutan = Number(maxRow?.m ?? 0);
        const newBusId = await tx.insertReturningId(
          `INSERT INTO buses (event_id, nama, plat_nomor, tipe_armada, posisi_sopir, aktif, urutan)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [event.id, nama, platNomor, tipeArmada, posisiSopir, maxUrutan + 1]
        );
        await insertBusSeats(tx, newBusId);
        await writeAuditLog(
          tx,
          req.admin!,
          'CREATE_BUS',
          nama,
          `Plat: ${platNomor || '-'}, Sopir: ${posisiSopir}`
        );
        return newBusId;
      });

      broadcastSeatUpdate({ type: 'bus-updated', busId });
      res.status(201).json({ buses: await getBuses(db, true), busId });
    })
  );

  app.put(
    '/api/admin/buses/:busId',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const busId = Number(req.params.busId);
      const existing = await db.queryOne<Record<string, unknown>>('SELECT * FROM buses WHERE id = ?', [busId]);
      if (!existing) throw new ServiceError('Bus tidak ditemukan.', 404);

      const nama = String(req.body?.nama ?? existing.nama).trim();
      if (!nama) throw new ServiceError('Nama bus wajib diisi.', 400);
      const platNomor = String(req.body?.platNomor ?? existing.plat_nomor ?? '').trim();
      const tipeArmada = String(req.body?.tipeArmada ?? existing.tipe_armada ?? '').trim();
      const posisiSopir =
        req.body?.posisiSopir === 'kiri'
          ? 'kiri'
          : req.body?.posisiSopir === 'kanan'
          ? 'kanan'
          : String(existing.posisi_sopir);
      const aktif = req.body?.aktif === undefined ? Number(existing.aktif) : req.body.aktif ? 1 : 0;

      await db.execute(
        `UPDATE buses SET nama = ?, plat_nomor = ?, tipe_armada = ?, posisi_sopir = ?, aktif = ? WHERE id = ?`,
        [nama, platNomor, tipeArmada, posisiSopir, aktif, busId]
      );

      await writeAuditLog(
        db,
        req.admin!,
        'UPDATE_BUS',
        nama,
        `Aktif: ${aktif === 1 ? 'Ya' : 'Tidak'}, Sopir: ${posisiSopir}`
      );
      broadcastSeatUpdate({ type: 'bus-updated', busId });
      res.json({ buses: await getBuses(db, true) });
    })
  );

  app.get(
    '/api/admin/buses/:busId/seats',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const busId = Number(req.params.busId);
      const buses = await getBuses(db, true);
      const bus = buses.find((b) => b.id === busId);
      if (!bus) throw new ServiceError('Bus tidak ditemukan.', 404);
      const seats = await getAdminBusSeats(db, busId);
      res.json({ bus, seats });
    })
  );

  app.post(
    '/api/admin/seats/:seatId/block',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const seatId = Number(req.params.seatId);
      const block = Boolean(req.body?.block);
      const alasan = req.body?.alasan ? String(req.body.alasan) : undefined;
      await adminToggleBlockSeat(db, req.admin!, { seatId, block, alasan });
      broadcastSeatUpdate({ type: 'seat-block-updated' });
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/admin/bookings/manual',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const { busId, mode, namaPemesan, namaIstri, gender, noWhatsapp, seats, override, overrideReason } =
        req.body ?? {};
      const booking = await adminManualBook(db, req.admin!, {
        busId: Number(busId),
        mode: mode === 'suami_istri' ? 'suami_istri' : 'sendiri',
        namaPemesan: String(namaPemesan ?? ''),
        namaIstri: namaIstri ? String(namaIstri) : undefined,
        gender,
        noWhatsapp: String(noWhatsapp ?? ''),
        seats: Array.isArray(seats) ? seats : [],
        override: Boolean(override),
        overrideReason: overrideReason ? String(overrideReason) : undefined,
      });
      broadcastSeatUpdate({ type: 'booking-created', busId: Number(busId) });
      res.status(201).json({ booking });
    })
  );

  app.post(
    '/api/admin/bookings/:id/move',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const bookingId = Number(req.params.id);
      const { busId, seats, override, overrideReason } = req.body ?? {};
      const booking = await adminMoveBookingSeats(db, req.admin!, {
        bookingId,
        busId: Number(busId),
        seats: Array.isArray(seats) ? seats : [],
        override: Boolean(override),
        overrideReason: overrideReason ? String(overrideReason) : undefined,
      });
      broadcastSeatUpdate({ type: 'booking-moved', busId: Number(busId) });
      res.json({ booking });
    })
  );

  app.post(
    '/api/admin/bookings/:id/cancel',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const bookingId = Number(req.params.id);
      const reason = req.body?.reason ? String(req.body.reason) : undefined;
      const booking = await adminCancelBooking(db, req.admin!, bookingId, reason);
      broadcastSeatUpdate({ type: 'booking-cancelled', busId: booking.busId });
      res.json({ booking });
    })
  );

  app.get(
    '/api/admin/bookings',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const busId = req.query.busId ? Number(req.query.busId) : undefined;
      const bookings = await listAllBookings(db, busId);
      res.json({ bookings });
    })
  );

  app.get(
    '/api/admin/manifest/export',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const busId = req.query.busId ? Number(req.query.busId) : undefined;
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT
          b.nama AS bus_nama,
          s.label AS seat_label,
          s.tipe AS seat_tipe,
          bs.nama_penumpang,
          bs.jenis_kelamin,
          bs.peran_pasangan,
          bk.mode,
          bk.kode_booking,
          bk.no_whatsapp,
          bk.dibuat_pada
         FROM booking_seats bs
         JOIN bookings bk ON bk.id = bs.booking_id
         JOIN seats s ON s.id = bs.seat_id
         JOIN buses b ON b.id = bk.bus_id
         WHERE bk.status = 'aktif' AND bs.active_flag = 1
         ${busId ? 'AND b.id = ?' : ''}
         ORDER BY b.urutan ASC,
           CASE WHEN s.baris = 'R' THEN 1 ELSE 0 END ASC,
           s.baris ASC,
           s.posisi ASC`,
        busId ? [busId] : []
      );

      const escapeCsv = (v: unknown) => {
        const str = String(v ?? '');
        if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
        return str;
      };

      const header = [
        'Bus',
        'Kursi',
        'Tipe Kursi',
        'Nama Penumpang',
        'Jenis Kelamin',
        'Status Pasangan',
        'Kode Booking',
        'No WhatsApp',
        'Waktu Pesan',
      ];

      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.bus_nama,
            r.seat_label,
            r.seat_tipe === 'leg_rest' ? 'Leg Rest' : 'Belakang',
            r.nama_penumpang,
            r.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan',
            r.mode === 'suami_istri' ? `Pasangan (${r.peran_pasangan ?? '-'})` : 'Sendiri',
            r.kode_booking,
            r.no_whatsapp,
            r.dibuat_pada,
          ]
            .map(escapeCsv)
            .join(',')
        ),
      ];

      await writeAuditLog(
        db,
        req.admin!,
        'EXPORT_MANIFEST',
        busId ? `Bus #${busId}` : 'Semua Bus',
        `Ekspor ${rows.length} baris manifest CSV`
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="manifest-penumpang.csv"');
      res.send('\uFEFF' + lines.join('\r\n'));
    })
  );

  app.get(
    '/api/admin/audit-logs',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const db = await resolveDb();
      const logs = await db.queryAll<Record<string, unknown>>(
        'SELECT id, admin_id, admin_nama, aksi, objek, detail, waktu FROM audit_logs ORDER BY id DESC LIMIT 200'
      );
      res.json({
        logs: logs.map((l) => ({
          id: Number(l.id),
          adminId: l.admin_id ? Number(l.admin_id) : null,
          adminNama: String(l.admin_nama),
          aksi: String(l.aksi),
          objek: String(l.objek),
          detail: String(l.detail ?? ''),
          waktu: String(l.waktu),
        })),
      });
    })
  );

  app.delete(
    '/api/admin/audit-logs/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await resolveDb();
      const logId = Number(req.params.id);
      if (!Number.isFinite(logId)) {
        throw new ServiceError('ID log tidak valid.', 400);
      }
      await db.execute('DELETE FROM audit_logs WHERE id = ?', [logId]);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/admin/audit-logs',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const db = await resolveDb();
      await db.execute('DELETE FROM audit_logs');
      res.json({ ok: true });
    })
  );

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });

  app.get('/favicon.ico', (_req, res) => {
    const svgPath = path.resolve(process.cwd(), 'public', 'favicon.svg');
    if (fs.existsSync(svgPath)) {
      res.type('image/svg+xml').sendFile(svgPath);
      return;
    }
    res.status(404).end();
  });

  // Serve built Vite frontend in non-Vercel local production mode
  if (!process.env.VERCEL) {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('/{*path}', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  return app;
}
