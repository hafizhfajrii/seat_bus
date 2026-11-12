import crypto from 'node:crypto';
import type { DbClient } from './db.js';
import type {
  AdminSeat,
  BookingDetail,
  BookingMode,
  BusInfo,
  CoupleRole,
  DashboardSummary,
  EventInfo,
  Gender,
  ParticipantUser,
  PublicLookupBooking,
  PublicSeat,
} from '../shared/types.js';
import {
  getSeatEligibilityForSingle,
  isValidWhatsApp,
  maskPersonName,
  maskWhatsApp,
  normalizeWhatsApp,
  validateCoupleSelection,
} from '../shared/seatRules.js';
import type { AdminSessionPayload } from './auth.js';

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function purgeExpiredHolds(db: DbClient): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  const res = await db.execute('DELETE FROM seat_holds WHERE expires_at <= ?', [nowSec]);
  return res.changes;
}

export async function getEventInfo(db: DbClient): Promise<EventInfo> {
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM events LIMIT 1');
  if (!row) throw new ServiceError('Event belum dikonfigurasi.', 404);
  return {
    id: Number(row.id),
    nama: String(row.nama),
    tanggal: String(row.tanggal),
    jamBerangkat: String(row.jam_berangkat),
    lokasiBerangkat: String(row.lokasi_berangkat),
    titikKumpulDetail: String(row.titik_kumpul_detail ?? ''),
    deskripsi: String(row.deskripsi ?? ''),
    statusPendaftaran: row.status_pendaftaran as 'buka' | 'tutup',
    batasWaktuPendaftaran: row.batas_waktu_pendaftaran ? String(row.batas_waktu_pendaftaran) : null,
    batasPesananPerWa: Number(row.batas_pesanan_per_wa),
    durasiHoldDetik: Number(row.durasi_hold_detik),
  };
}

export async function getBuses(db: DbClient, includeInactive = false): Promise<BusInfo[]> {
  purgeExpiredHoldsThrottled(db);
  const where = includeInactive ? '' : 'WHERE b.aktif = 1';
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT b.*,
      (SELECT COUNT(*) FROM seats s WHERE s.bus_id = b.id) AS total_seats,
      (SELECT COUNT(*) FROM booking_seats bs
        JOIN seats s ON s.id = bs.seat_id
        WHERE s.bus_id = b.id AND bs.active_flag = 1) AS occupied_seats,
      (SELECT COUNT(*) FROM seat_blocks sb
        JOIN seats s ON s.id = sb.seat_id
        WHERE s.bus_id = b.id) AS blocked_seats
    FROM buses b
    ${where}
    ORDER BY b.urutan ASC, b.id ASC`
  );

  return rows.map((r) => {
    const total = Number(r.total_seats);
    const occupied = Number(r.occupied_seats);
    const blocked = Number(r.blocked_seats);
    return {
      id: Number(r.id),
      eventId: Number(r.event_id),
      nama: String(r.nama),
      platNomor: String(r.plat_nomor ?? ''),
      tipeArmada: String(r.tipe_armada ?? ''),
      posisiSopir: (r.posisi_sopir as 'kanan' | 'kiri') ?? 'kanan',
      aktif: Number(r.aktif) === 1,
      urutan: Number(r.urutan),
      totalSeats: total,
      occupiedSeats: occupied,
      blockedSeats: blocked,
      availableSeats: Math.max(0, total - occupied - blocked),
    };
  });
}

async function queryBusSeatRows(db: DbClient, busId: number) {
  const nowSec = Math.floor(Date.now() / 1000);
  return db.queryAll<Record<string, unknown>>(
    `SELECT
      s.id AS seat_id,
      s.bus_id,
      s.label,
      s.tipe,
      s.baris,
      s.posisi,
      s.sisi,
      s.posisi_desc,
      s.adjacent_labels,
      bs.jenis_kelamin AS occupied_gender,
      bs.nama_penumpang AS passenger_name,
      bs.peran_pasangan AS couple_role,
      bk.id AS booking_id,
      bk.kode_booking AS booking_code,
      bk.mode AS booking_mode,
      bk.no_whatsapp AS passenger_phone,
      bk.dibuat_pada AS booked_at,
      sb.alasan AS block_reason,
      sh.session_id AS hold_session_id,
      sh.gender AS hold_gender,
      sh.expires_at AS hold_expires_at
    FROM seats s
    LEFT JOIN booking_seats bs ON bs.seat_id = s.id AND bs.active_flag = 1
    LEFT JOIN bookings bk ON bk.id = bs.booking_id AND bk.status = 'aktif'
    LEFT JOIN seat_blocks sb ON sb.seat_id = s.id
    LEFT JOIN seat_holds sh ON sh.seat_id = s.id AND sh.expires_at > ?
    WHERE s.bus_id = ?
    ORDER BY
      CASE WHEN s.baris = 'R' THEN 1 ELSE 0 END ASC,
      s.baris ASC,
      s.posisi ASC`,
    [nowSec, busId]
  );
}

export async function getPublicBusSeats(
  db: DbClient,
  busId: number,
  sessionId?: string,
  opts: { skipPurge?: boolean; rows?: Array<Record<string, unknown>> } = {}
): Promise<PublicSeat[]> {
  if (!opts.skipPurge) purgeExpiredHoldsThrottled(db);
  const rows = opts.rows ?? (await queryBusSeatRows(db, busId));
  return rows.map((r) => {
    const isOccupied = r.booking_id != null;
    const isBlocked = r.block_reason != null;
    const isHeld = !isOccupied && !isBlocked && r.hold_session_id != null;
    const status = isOccupied ? 'terisi' : isBlocked ? 'diblokir' : isHeld ? 'ditahan' : 'tersedia';
    const isCouple = isOccupied && r.booking_mode === 'suami_istri';

    return {
      id: Number(r.seat_id),
      busId: Number(r.bus_id),
      label: String(r.label),
      tipe: r.tipe as 'leg_rest' | 'belakang',
      baris: String(r.baris),
      posisi: Number(r.posisi),
      sisi: r.sisi as 'kiri' | 'kanan' | 'belakang',
      posisiDesc: String(r.posisi_desc),
      adjacentLabels: JSON.parse(String(r.adjacent_labels)) as string[],
      status,
      occupiedGender: isOccupied ? (r.occupied_gender as Gender) : null,
      isCouple,
      couplePairId: isCouple ? Number(r.booking_id) : null,
      heldBySelf: isHeld ? Boolean(sessionId && r.hold_session_id === sessionId) : false,
      heldGender: isHeld ? (r.hold_gender as Gender) : null,
      holdExpiresAt:
        isHeld && r.hold_expires_at ? new Date(Number(r.hold_expires_at) * 1000).toISOString() : null,
      blockReason: isBlocked ? String(r.block_reason) : null,
    };
  });
}

export async function getAdminBusSeats(db: DbClient, busId: number): Promise<AdminSeat[]> {
  purgeExpiredHoldsThrottled(db);
  const rows = await queryBusSeatRows(db, busId);
  return rows.map((r) => {
    const isOccupied = r.booking_id != null;
    const isBlocked = r.block_reason != null;
    const isHeld = !isOccupied && !isBlocked && r.hold_session_id != null;
    const status = isOccupied ? 'terisi' : isBlocked ? 'diblokir' : isHeld ? 'ditahan' : 'tersedia';
    const isCouple = isOccupied && r.booking_mode === 'suami_istri';

    return {
      id: Number(r.seat_id),
      busId: Number(r.bus_id),
      label: String(r.label),
      tipe: r.tipe as 'leg_rest' | 'belakang',
      baris: String(r.baris),
      posisi: Number(r.posisi),
      sisi: r.sisi as 'kiri' | 'kanan' | 'belakang',
      posisiDesc: String(r.posisi_desc),
      adjacentLabels: JSON.parse(String(r.adjacent_labels)) as string[],
      status,
      occupiedGender: isOccupied ? (r.occupied_gender as Gender) : null,
      isCouple,
      couplePairId: isCouple ? Number(r.booking_id) : null,
      heldBySelf: false,
      heldGender: isHeld ? (r.hold_gender as Gender) : null,
      holdExpiresAt:
        isHeld && r.hold_expires_at ? new Date(Number(r.hold_expires_at) * 1000).toISOString() : null,
      blockReason: isBlocked ? String(r.block_reason) : null,
      passengerName: isOccupied ? String(r.passenger_name) : null,
      passengerPhone: isOccupied ? String(r.passenger_phone) : null,
      bookingCode: isOccupied ? String(r.booking_code) : null,
      bookingId: isOccupied ? Number(r.booking_id) : null,
      bookingMode: isOccupied ? (r.booking_mode as BookingMode) : null,
      coupleRole: isOccupied && r.couple_role ? (r.couple_role as CoupleRole) : null,
      bookedAt: isOccupied && r.booked_at ? String(r.booked_at) : null,
    };
  });
}

function assertRegistrationOpen(event: EventInfo) {
  if (event.statusPendaftaran !== 'buka') {
    throw new ServiceError('Maaf, pendaftaran kursi untuk event ini sedang ditutup.', 400);
  }
  if (event.batasWaktuPendaftaran) {
    const deadline = Date.parse(event.batasWaktuPendaftaran);
    if (!Number.isNaN(deadline) && Date.now() > deadline) {
      throw new ServiceError('Batas waktu pendaftaran kursi sudah berakhir.', 400);
    }
  }
}

function buildSeatMap(seats: PublicSeat[]): Map<string, PublicSeat> {
  return new Map(seats.map((s) => [s.label, s]));
}

export interface HoldSelectionItem {
  label: string;
  gender: Gender;
}

export async function createOrReplaceHold(
  db: DbClient,
  params: {
    busId: number;
    sessionId: string;
    mode: BookingMode;
    seats: HoldSelectionItem[];
    ignoreSeatLabels?: string[];
    participantId?: number;
  }
): Promise<{ expiresAt: string; holdDurationSeconds: number }> {
  if (!params.sessionId || params.sessionId.length < 6) {
    throw new ServiceError('Session ID tidak valid.', 400);
  }
  return db.withTransaction(async (tx) => {
    await lockBus(tx, params.busId);
    await purgeExpiredHolds(tx);
    if (params.participantId !== undefined) {
      const participant = await getParticipantById(tx, params.participantId);
      if (!participant) {
        throw new ServiceError('Akun peserta tidak ditemukan. Silakan login kembali.', 401);
      }
    }
    const event = await getEventInfo(tx);
    assertRegistrationOpen(event);

    const bus = await tx.queryOne<{ id: number; aktif: number }>(
      'SELECT id, aktif FROM buses WHERE id = ?',
      [params.busId]
    );
    if (!bus || Number(bus.aktif) !== 1) {
      throw new ServiceError('Bus tidak ditemukan atau sedang nonaktif.', 404);
    }

    await tx.execute('DELETE FROM seat_holds WHERE session_id = ?', [params.sessionId]);

    if (params.seats.length === 0) {
      return {
        expiresAt: new Date(Date.now() + event.durasiHoldDetik * 1000).toISOString(),
        holdDurationSeconds: event.durasiHoldDetik,
      };
    }

    const busSeats = await getPublicBusSeats(tx, params.busId, params.sessionId, { skipPurge: true });
    const seatsMap = buildSeatMap(busSeats);

    if (params.mode === 'sendiri') {
      if (params.seats.length !== 1) {
        throw new ServiceError('Mode Sendiri hanya dapat menahan 1 kursi.', 400);
      }
      const pick = params.seats[0];
      const seat = seatsMap.get(pick.label);
      if (!seat) throw new ServiceError(`Kursi ${pick.label} tidak ditemukan.`, 404);
      const check = getSeatEligibilityForSingle(seat, seatsMap, pick.gender, {
        ignoreSeatLabels: params.ignoreSeatLabels,
      });
      if (!check.allowed) {
        throw new ServiceError(check.reason ?? 'Kursi tidak tersedia.', 409);
      }
    } else {
      if (params.seats.length > 2) {
        throw new ServiceError('Mode Suami & Istri maksimal memilih 2 kursi.', 400);
      }
      if (params.seats.length === 1) {
        const pick = params.seats[0];
        const seat = seatsMap.get(pick.label);
        if (!seat) throw new ServiceError(`Kursi ${pick.label} tidak ditemukan.`, 404);
        if (
          seat.status === 'terisi' ||
          seat.status === 'diblokir' ||
          (seat.status === 'ditahan' && !seat.heldBySelf)
        ) {
          throw new ServiceError(`Kursi ${pick.label} baru saja dipilih atau tidak tersedia.`, 409);
        }
      } else {
        const suamiPick = params.seats.find((s) => s.gender === 'L');
        const istriPick = params.seats.find((s) => s.gender === 'P');
        if (!suamiPick || !istriPick) {
          throw new ServiceError(
            'Pasangan Suami & Istri harus terdiri dari 1 kursi Laki-laki dan 1 kursi Perempuan.',
            400
          );
        }
        const suamiSeat = seatsMap.get(suamiPick.label);
        const istriSeat = seatsMap.get(istriPick.label);
        if (!suamiSeat || !istriSeat) {
          throw new ServiceError('Kursi tidak ditemukan.', 404);
        }
        const check = validateCoupleSelection(suamiSeat, istriSeat, seatsMap, {
          ignoreSeatLabels: params.ignoreSeatLabels,
        });
        if (!check.valid) {
          throw new ServiceError(check.reason ?? 'Pasangan kursi tidak valid.', 409);
        }
      }
    }

    const expiresAtSec = Math.floor(Date.now() / 1000) + event.durasiHoldDetik;
    try {
      for (const pick of params.seats) {
        const seat = seatsMap.get(pick.label)!;
        await tx.execute(
          'INSERT INTO seat_holds (bus_id, seat_id, session_id, mode, gender, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          [params.busId, seat.id, params.sessionId, params.mode, pick.gender, expiresAtSec]
        );
      }
    } catch {
      throw new ServiceError(
        'Kursi baru saja dipesan atau ditahan peserta lain. Silakan pilih kursi lain.',
        409
      );
    }

    return {
      expiresAt: new Date(expiresAtSec * 1000).toISOString(),
      holdDurationSeconds: event.durasiHoldDetik,
    };
  });
}

export async function releaseSessionHold(db: DbClient, sessionId: string) {
  if (!sessionId) return;
  await db.execute('DELETE FROM seat_holds WHERE session_id = ?', [sessionId]);
}

async function generateBookingCode(db: DbClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = 'TRS-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const exists = await db.queryOne('SELECT 1 FROM bookings WHERE kode_booking = ?', [code]);
    if (!exists) return code;
  }
  return 'TRS-' + Date.now().toString(36).toUpperCase();
}

async function hydrateBookings(
  db: DbClient,
  bookingRows: Array<Record<string, unknown>>
): Promise<BookingDetail[]> {
  if (bookingRows.length === 0) return [];
  const ids = bookingRows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const seatRows = await db.queryAll<Record<string, unknown>>(
    `SELECT bs.*, s.label, s.tipe, s.baris, s.posisi_desc
     FROM booking_seats bs
     JOIN seats s ON s.id = bs.seat_id
     WHERE bs.booking_id IN (${placeholders})
     ORDER BY bs.booking_id ASC, bs.id ASC`,
    ids
  );

  const seatsByBooking = new Map<number, BookingDetail['seats']>();
  for (const sr of seatRows) {
    const bId = Number(sr.booking_id);
    const list = seatsByBooking.get(bId) ?? [];
    list.push({
      seatId: Number(sr.seat_id),
      label: String(sr.label),
      tipe: sr.tipe as 'leg_rest' | 'belakang',
      baris: String(sr.baris),
      posisiDesc: String(sr.posisi_desc),
      namaPenumpang: String(sr.nama_penumpang),
      jenisKelamin: sr.jenis_kelamin as Gender,
      peranPasangan: sr.peran_pasangan ? (sr.peran_pasangan as CoupleRole) : null,
    });
    seatsByBooking.set(bId, list);
  }

  return bookingRows.map((row) => ({
    id: Number(row.id),
    kodeBooking: String(row.kode_booking),
    eventId: Number(row.event_id),
    busId: Number(row.bus_id),
    busNama: String(row.bus_nama),
    busPlatNomor: String(row.bus_plat ?? ''),
    busTipeArmada: String(row.bus_tipe ?? ''),
    mode: row.mode as BookingMode,
    namaPemesan: String(row.nama_pemesan),
    noWhatsapp: String(row.no_whatsapp),
    status: row.status as 'aktif' | 'dibatalkan',
    dibuatPada: String(row.dibuat_pada),
    dibatalkanPada: row.dibatalkan_pada ? String(row.dibatalkan_pada) : null,
    seats: seatsByBooking.get(Number(row.id)) ?? [],
  }));
}

export async function getBookingDetailById(db: DbClient, bookingId: number): Promise<BookingDetail | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT bk.*, b.nama AS bus_nama, b.plat_nomor AS bus_plat, b.tipe_armada AS bus_tipe
     FROM bookings bk
     JOIN buses b ON b.id = bk.bus_id
     WHERE bk.id = ?`,
    [bookingId]
  );
  if (!row) return null;
  const [hydrated] = await hydrateBookings(db, [row]);
  return hydrated ?? null;
}

export async function getBookingDetailByCode(
  db: DbClient,
  kodeBooking: string
): Promise<BookingDetail | null> {
  const row = await db.queryOne<{ id: number }>(
    'SELECT id FROM bookings WHERE UPPER(kode_booking) = UPPER(?)',
    [kodeBooking.trim()]
  );
  if (!row) return null;
  return getBookingDetailById(db, Number(row.id));
}

export async function createBooking(
  db: DbClient,
  params: {
    busId: number;
    mode: BookingMode;
    namaPemesan: string;
    namaIstri?: string;
    gender?: Gender;
    noWhatsapp: string;
    sessionId: string;
    seats: Array<{ label: string; role?: CoupleRole }>;
    participantId?: number;
  }
): Promise<BookingDetail> {
  const normalizedWa = normalizeWhatsApp(params.noWhatsapp);
  if (!isValidWhatsApp(normalizedWa)) {
    throw new ServiceError('Nomor WhatsApp tidak valid. Gunakan format Indonesia, mis. 081234567890.', 400);
  }
  const namaPemesan = params.namaPemesan.trim();
  if (namaPemesan.length < 2) {
    throw new ServiceError('Nama lengkap pemesan wajib diisi (minimal 2 karakter).', 400);
  }

  return db.withTransaction(async (tx) => {
    await lockBus(tx, params.busId);
    await purgeExpiredHolds(tx);

    if (params.participantId !== undefined) {
      const participant = await getParticipantById(tx, params.participantId);
      if (!participant) {
        throw new ServiceError('Akun peserta tidak ditemukan. Silakan login kembali.', 401);
      }
      if (!participant.noWhatsapp) {
        await tx.execute('UPDATE participants SET no_whatsapp = ? WHERE id = ?', [
          normalizedWa,
          participant.id,
        ]);
      }
    }

    const event = await getEventInfo(tx);
    assertRegistrationOpen(event);

    const bus = await tx.queryOne<{ id: number; aktif: number }>(
      'SELECT id, aktif FROM buses WHERE id = ? AND event_id = ?',
      [params.busId, event.id]
    );
    if (!bus || Number(bus.aktif) !== 1) {
      throw new ServiceError('Bus tidak ditemukan atau sedang nonaktif.', 404);
    }

    const activeWaRow = await tx.queryOne<{ c: number | string }>(
      "SELECT COUNT(*) AS c FROM bookings WHERE no_whatsapp = ? AND status = 'aktif' AND event_id = ?",
      [normalizedWa, event.id]
    );
    const activeWaCount = Number(activeWaRow?.c ?? 0);
    if (activeWaCount >= event.batasPesananPerWa) {
      throw new ServiceError(
        `Nomor WhatsApp ini sudah memiliki ${activeWaCount} pesanan aktif (batas ${event.batasPesananPerWa} pesanan). Gunakan fitur "Cek atau Batalkan Kursi" di bawah jika ingin mengubah/membatalkan.`,
        409
      );
    }

    const busSeats = await getPublicBusSeats(tx, params.busId, params.sessionId, { skipPurge: true });
    const seatsMap = buildSeatMap(busSeats);

    if (params.mode === 'sendiri') {
      if (!params.gender || (params.gender !== 'L' && params.gender !== 'P')) {
        throw new ServiceError('Silakan pilih jenis kelamin (Laki-laki / Perempuan) terlebih dahulu.', 400);
      }
      if (params.seats.length !== 1) {
        throw new ServiceError('Mode Sendiri harus memilih tepat 1 kursi.', 400);
      }
      const seatLabel = String(params.seats[0]?.label ?? '').trim().toUpperCase();
      const seat = seatsMap.get(seatLabel);
      if (!seat) throw new ServiceError(`Kursi ${seatLabel} tidak ditemukan.`, 404);

      const eligibility = getSeatEligibilityForSingle(seat, seatsMap, params.gender);
      if (!eligibility.allowed) {
        throw new ServiceError(eligibility.reason ?? 'Kursi tidak dapat dipilih.', 409);
      }

      const kode = await generateBookingCode(tx);
      const bookingId = await tx.insertReturningId(
        `INSERT INTO bookings (kode_booking, event_id, bus_id, mode, nama_pemesan, no_whatsapp, status, participant_id)
         VALUES (?, ?, ?, 'sendiri', ?, ?, 'aktif', ?)`,
        [kode, event.id, params.busId, namaPemesan, normalizedWa, params.participantId ?? null]
      );

      try {
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, ?, NULL, 1)`,
          [bookingId, seat.id, namaPemesan, params.gender]
        );
      } catch {
        throw new ServiceError(
          'Kursi baru saja dipesan peserta lain. Silakan pilih kursi yang masih tersedia.',
          409
        );
      }

      await tx.execute('DELETE FROM seat_holds WHERE session_id = ?', [params.sessionId]);
      return (await getBookingDetailById(tx, bookingId))!;
    } else {
      const namaIstri = (params.namaIstri ?? '').trim();
      if (namaIstri.length < 2) {
        throw new ServiceError('Nama lengkap istri wajib diisi (minimal 2 karakter).', 400);
      }
      if (params.seats.length !== 2) {
        throw new ServiceError('Mode Suami & Istri harus memilih 2 kursi bersebelahan.', 400);
      }
      const suamiPick = params.seats.find((s) => s?.role === 'suami') ?? params.seats[0];
      const istriPick = params.seats.find((s) => s?.role === 'istri') ?? params.seats[1];
      const suamiLabel = String(suamiPick?.label ?? '').trim().toUpperCase();
      const istriLabel = String(istriPick?.label ?? '').trim().toUpperCase();
      if (!suamiLabel || !istriLabel || suamiLabel === istriLabel) {
        throw new ServiceError('Kursi suami dan istri harus berbeda.', 400);
      }

      const suamiSeat = seatsMap.get(suamiLabel);
      const istriSeat = seatsMap.get(istriLabel);
      if (!suamiSeat || !istriSeat) {
        throw new ServiceError('Kursi yang dipilih tidak ditemukan.', 404);
      }

      const coupleCheck = validateCoupleSelection(suamiSeat, istriSeat, seatsMap);
      if (!coupleCheck.valid) {
        throw new ServiceError(coupleCheck.reason ?? 'Pasangan kursi melanggar aturan pemilihan kursi.', 409);
      }

      const kode = await generateBookingCode(tx);
      const combinedName = `${namaPemesan} & ${namaIstri}`;
      const bookingId = await tx.insertReturningId(
        `INSERT INTO bookings (kode_booking, event_id, bus_id, mode, nama_pemesan, no_whatsapp, status, participant_id)
         VALUES (?, ?, ?, 'suami_istri', ?, ?, 'aktif', ?)`,
        [kode, event.id, params.busId, combinedName, normalizedWa, params.participantId ?? null]
      );

      try {
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, 'L', 'suami', 1)`,
          [bookingId, suamiSeat.id, namaPemesan]
        );
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, 'P', 'istri', 1)`,
          [bookingId, istriSeat.id, namaIstri]
        );
      } catch {
        throw new ServiceError(
          'Salah satu kursi baru saja dipesan peserta lain. Silakan pilih ulang.',
          409
        );
      }

      await tx.execute('DELETE FROM seat_holds WHERE session_id = ?', [params.sessionId]);
      return (await getBookingDetailById(tx, bookingId))!;
    }
  });
}

export async function lookupBookingsByWhatsApp(
  db: DbClient,
  rawWhatsapp: string
): Promise<PublicLookupBooking[]> {
  const normalized = normalizeWhatsApp(rawWhatsapp);
  if (!isValidWhatsApp(normalized)) {
    throw new ServiceError('Format nomor WhatsApp tidak valid. Contoh: 081234567890.', 400);
  }

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT bk.id, bk.kode_booking, bk.bus_id, b.nama AS bus_nama, bk.mode, bk.nama_pemesan,
            bk.no_whatsapp, bk.status, bk.dibuat_pada
     FROM bookings bk
     JOIN buses b ON b.id = bk.bus_id
     WHERE bk.no_whatsapp = ? AND bk.status = 'aktif'
     ORDER BY bk.id DESC`,
    [normalized]
  );

  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const seatRows = await db.queryAll<Record<string, unknown>>(
    `SELECT bs.booking_id, s.label, s.tipe, bs.jenis_kelamin, bs.peran_pasangan, bs.nama_penumpang
     FROM booking_seats bs
     JOIN seats s ON s.id = bs.seat_id
     WHERE bs.booking_id IN (${placeholders})
     ORDER BY bs.booking_id ASC, bs.id ASC`,
    ids
  );

  const seatsByBooking = new Map<number, PublicLookupBooking['seats']>();
  for (const s of seatRows) {
    const bId = Number(s.booking_id);
    const list = seatsByBooking.get(bId) ?? [];
    list.push({
      label: String(s.label),
      tipe: s.tipe as 'leg_rest' | 'belakang',
      jenisKelamin: s.jenis_kelamin as Gender,
      peranPasangan: s.peran_pasangan ? (s.peran_pasangan as CoupleRole) : null,
      maskedPassengerName: maskPersonName(String(s.nama_penumpang)),
    });
    seatsByBooking.set(bId, list);
  }

  return rows.map((r) => ({
    id: Number(r.id),
    kodeBooking: String(r.kode_booking),
    busId: Number(r.bus_id),
    busNama: String(r.bus_nama),
    mode: r.mode as BookingMode,
    maskedName: maskPersonName(String(r.nama_pemesan)),
    noWhatsappMasked: maskWhatsApp(String(r.no_whatsapp)),
    status: r.status as 'aktif' | 'dibatalkan',
    dibuatPada: String(r.dibuat_pada),
    seats: seatsByBooking.get(Number(r.id)) ?? [],
  }));
}

export async function cancelBookingByParticipant(
  db: DbClient,
  bookingId: number,
  rawWhatsapp: string,
  participantId?: number
): Promise<BookingDetail> {
  const normalized = normalizeWhatsApp(rawWhatsapp);
  return db.withTransaction(async (tx) => {
    const bk = await tx.queryOne<{
      id: number;
      no_whatsapp: string;
      status: string;
      participant_id: number | null;
    }>('SELECT id, no_whatsapp, status, participant_id FROM bookings WHERE id = ?', [bookingId]);
    if (!bk) throw new ServiceError('Pesanan tidak ditemukan.', 404);

    const ownsByAccount =
      participantId !== undefined && bk.participant_id != null && Number(bk.participant_id) === participantId;
    if (!ownsByAccount && bk.no_whatsapp !== normalized) {
      throw new ServiceError('Anda tidak memiliki izin membatalkan pesanan ini.', 403);
    }
    if (bk.status !== 'aktif') {
      throw new ServiceError('Pesanan ini sudah dibatalkan sebelumnya.', 400);
    }

    await tx.execute(
      "UPDATE bookings SET status = 'dibatalkan', dibatalkan_pada = CURRENT_TIMESTAMP WHERE id = ?",
      [bookingId]
    );
    await tx.execute('UPDATE booking_seats SET active_flag = NULL WHERE booking_id = ?', [bookingId]);
    return (await getBookingDetailById(tx, bookingId))!;
  });
}

export async function changeBookingSeats(
  db: DbClient,
  params: {
    bookingId: number;
    noWhatsapp: string;
    busId: number;
    sessionId: string;
    seats: Array<{ label: string; role?: CoupleRole }>;
    participantId?: number;
  }
): Promise<BookingDetail> {
  const normalized = normalizeWhatsApp(params.noWhatsapp);
  return db.withTransaction(async (tx) => {
    await lockBus(tx, params.busId);
    await purgeExpiredHolds(tx);
    const event = await getEventInfo(tx);
    assertRegistrationOpen(event);

    const existing = await getBookingDetailById(tx, params.bookingId);
    if (!existing) throw new ServiceError('Pesanan tidak ditemukan.', 404);
    const bkRow = await tx.queryOne<{ participant_id: number | null }>(
      'SELECT participant_id FROM bookings WHERE id = ?',
      [params.bookingId]
    );
    const ownsByAccount =
      params.participantId !== undefined &&
      bkRow?.participant_id != null &&
      Number(bkRow.participant_id) === params.participantId;
    if (!ownsByAccount && existing.noWhatsapp !== normalized) {
      throw new ServiceError('Nomor WhatsApp tidak cocok dengan pemesan.', 403);
    }
    if (existing.status !== 'aktif') {
      throw new ServiceError('Pesanan sudah dibatalkan, tidak dapat mengubah kursi.', 400);
    }

    const bus = await tx.queryOne<{ id: number; aktif: number }>(
      'SELECT id, aktif FROM buses WHERE id = ?',
      [params.busId]
    );
    if (!bus || Number(bus.aktif) !== 1) {
      throw new ServiceError('Bus tidak ditemukan atau sedang nonaktif.', 404);
    }

    const busSeats = await getPublicBusSeats(tx, params.busId, params.sessionId, { skipPurge: true });
    const seatsMap = buildSeatMap(busSeats);
    const ignoreSeatLabels =
      existing.busId === params.busId ? existing.seats.map((s) => s.label) : [];

    if (existing.mode === 'sendiri') {
      if (params.seats.length !== 1) {
        throw new ServiceError('Mode Sendiri harus memilih 1 kursi baru.', 400);
      }
      const oldSeat = existing.seats[0];
      const newSeatLabel = String(params.seats[0]?.label ?? '').trim().toUpperCase();
      const newSeat = seatsMap.get(newSeatLabel);
      if (!newSeat) throw new ServiceError('Kursi baru tidak ditemukan.', 404);

      const check = getSeatEligibilityForSingle(newSeat, seatsMap, oldSeat.jenisKelamin, {
        ignoreSeatLabels,
      });
      if (!check.allowed) {
        throw new ServiceError(check.reason ?? 'Kursi baru tidak valid.', 409);
      }

      try {
        await tx.execute('DELETE FROM booking_seats WHERE booking_id = ?', [existing.id]);
        await tx.execute('UPDATE bookings SET bus_id = ? WHERE id = ?', [params.busId, existing.id]);
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, ?, NULL, 1)`,
          [existing.id, newSeat.id, oldSeat.namaPenumpang, oldSeat.jenisKelamin]
        );
      } catch {
        throw new ServiceError('Kursi baru saja dipesan peserta lain. Silakan pilih kursi lain.', 409);
      }
    } else {
      if (params.seats.length !== 2) {
        throw new ServiceError('Mode Suami & Istri harus memilih 2 kursi bersebelahan.', 400);
      }
      const suamiPick = params.seats.find((s) => s?.role === 'suami') ?? params.seats[0];
      const istriPick = params.seats.find((s) => s?.role === 'istri') ?? params.seats[1];
      const suamiSeat = seatsMap.get(String(suamiPick?.label ?? '').trim().toUpperCase());
      const istriSeat = seatsMap.get(String(istriPick?.label ?? '').trim().toUpperCase());
      if (!suamiSeat || !istriSeat) throw new ServiceError('Kursi baru tidak ditemukan.', 404);

      const coupleCheck = validateCoupleSelection(suamiSeat, istriSeat, seatsMap, {
        ignoreSeatLabels,
      });
      if (!coupleCheck.valid) {
        throw new ServiceError(coupleCheck.reason ?? 'Pasangan kursi baru tidak valid.', 409);
      }

      const oldSuami = existing.seats.find((s) => s.peranPasangan === 'suami') ?? existing.seats[0];
      const oldIstri = existing.seats.find((s) => s.peranPasangan === 'istri') ?? existing.seats[1];

      try {
        await tx.execute('DELETE FROM booking_seats WHERE booking_id = ?', [existing.id]);
        await tx.execute('UPDATE bookings SET bus_id = ? WHERE id = ?', [params.busId, existing.id]);
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, 'L', 'suami', 1)`,
          [existing.id, suamiSeat.id, oldSuami.namaPenumpang]
        );
        await tx.execute(
          `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
           VALUES (?, ?, ?, 'P', 'istri', 1)`,
          [existing.id, istriSeat.id, oldIstri.namaPenumpang]
        );
      } catch {
        throw new ServiceError('Salah satu kursi baru saja dipesan peserta lain. Silakan pilih ulang.', 409);
      }
    }

    await tx.execute('DELETE FROM seat_holds WHERE session_id = ?', [params.sessionId]);
    return (await getBookingDetailById(tx, existing.id))!;
  });
}

// ---------------- ADMIN OPERATIONS ----------------

async function resolveValidAdminId(db: DbClient, admin: AdminSessionPayload): Promise<number | null> {
  if (admin.id) {
    const foundById = await db.queryOne<{ id: number | string }>(
      'SELECT id FROM admins WHERE id = ?',
      [admin.id]
    );
    if (foundById) return Number(foundById.id);
  }
  if (admin.email) {
    const foundByEmail = await db.queryOne<{ id: number | string }>(
      'SELECT id FROM admins WHERE LOWER(email) = LOWER(?)',
      [admin.email]
    );
    if (foundByEmail) return Number(foundByEmail.id);
  }
  return null;
}

export async function writeAuditLog(
  db: DbClient,
  admin: AdminSessionPayload,
  aksi: string,
  objek: string,
  detail: string
) {
  const safeAdminId = await resolveValidAdminId(db, admin);
  await db.execute(
    'INSERT INTO audit_logs (admin_id, admin_nama, aksi, objek, detail) VALUES (?, ?, ?, ?, ?)',
    [safeAdminId, admin.nama || 'Admin', aksi, objek, detail]
  );
}

export async function adminToggleBlockSeat(
  db: DbClient,
  admin: AdminSessionPayload,
  params: { seatId: number; block: boolean; alasan?: string }
) {
  return db.withTransaction(async (tx) => {
    const seatRow = await tx.queryOne<{ id: number; label: string; bus_nama: string }>(
      'SELECT s.id, s.label, b.nama AS bus_nama FROM seats s JOIN buses b ON b.id = s.bus_id WHERE s.id = ?',
      [params.seatId]
    );
    if (!seatRow) throw new ServiceError('Kursi tidak ditemukan.', 404);

    if (params.block) {
      const occupied = await tx.queryOne(
        'SELECT 1 FROM booking_seats WHERE seat_id = ? AND active_flag = 1',
        [params.seatId]
      );
      if (occupied) {
        throw new ServiceError(
          `Kursi ${seatRow.label} sedang terisi penumpang. Lepas penumpang terlebih dahulu.`,
          409
        );
      }
      await tx.execute('DELETE FROM seat_holds WHERE seat_id = ?', [params.seatId]);
      const alasan = (params.alasan ?? '').trim() || 'Diblokir Panitia';
      const safeAdminId = await resolveValidAdminId(tx, admin);
      await tx.execute(
        `INSERT INTO seat_blocks (seat_id, alasan, dibuat_oleh)
         VALUES (?, ?, ?)
         ON CONFLICT(seat_id) DO UPDATE SET alasan = excluded.alasan, dibuat_oleh = excluded.dibuat_oleh`,
        [params.seatId, alasan, safeAdminId]
      );
      await writeAuditLog(
        tx,
        admin,
        'BLOCK_SEAT',
        `${seatRow.bus_nama} - ${seatRow.label}`,
        `Alasan: ${alasan}`
      );
    } else {
      await tx.execute('DELETE FROM seat_blocks WHERE seat_id = ?', [params.seatId]);
      await writeAuditLog(
        tx,
        admin,
        'UNBLOCK_SEAT',
        `${seatRow.bus_nama} - ${seatRow.label}`,
        'Kursi dibuka kembali'
      );
    }
  });
}

export async function adminManualBook(
  db: DbClient,
  admin: AdminSessionPayload,
  params: {
    busId: number;
    mode: BookingMode;
    namaPemesan: string;
    namaIstri?: string;
    gender?: Gender;
    noWhatsapp: string;
    seats: Array<{ label: string; role?: CoupleRole }>;
    override?: boolean;
    overrideReason?: string;
  }
): Promise<BookingDetail> {
  const wantOverride = Boolean(params.override);
  if (wantOverride && !(params.overrideReason ?? '').trim()) {
    throw new ServiceError('Alasan pengecualian wajib diisi saat menggunakan override aturan.', 400);
  }

  const normalizedWa = normalizeWhatsApp(params.noWhatsapp);
  if (!isValidWhatsApp(normalizedWa)) {
    throw new ServiceError('Format nomor WhatsApp tidak valid.', 400);
  }
  const namaPemesan = params.namaPemesan.trim();
  if (namaPemesan.length < 2) {
    throw new ServiceError('Nama penumpang wajib diisi.', 400);
  }

  return db.withTransaction(async (tx) => {
    await lockBus(tx, params.busId);
    await purgeExpiredHolds(tx);
    const event = await getEventInfo(tx);
    const busSeats = await getPublicBusSeats(tx, params.busId, undefined, { skipPurge: true });
    const seatsMap = buildSeatMap(busSeats);

    if (params.mode === 'sendiri') {
      if (!params.gender || (params.gender !== 'L' && params.gender !== 'P')) {
        throw new ServiceError('Jenis kelamin wajib dipilih.', 400);
      }
      if (params.seats.length !== 1) throw new ServiceError('Pilih tepat 1 kursi.', 400);
      const seat = seatsMap.get(params.seats[0].label);
      if (!seat) throw new ServiceError('Kursi tidak ditemukan.', 404);

      const check = getSeatEligibilityForSingle(seat, seatsMap, params.gender, {
        allowOverride: wantOverride,
      });
      if (!check.allowed) {
        throw new ServiceError(check.reason ?? 'Melanggar aturan kursi.', 409);
      }

      await tx.execute('DELETE FROM seat_holds WHERE seat_id = ?', [seat.id]);
      const kode = await generateBookingCode(tx);
      const bookingId = await tx.insertReturningId(
        `INSERT INTO bookings (kode_booking, event_id, bus_id, mode, nama_pemesan, no_whatsapp, status)
         VALUES (?, ?, ?, 'sendiri', ?, ?, 'aktif')`,
        [kode, event.id, params.busId, namaPemesan, normalizedWa]
      );
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, ?, NULL, 1)`,
        [bookingId, seat.id, namaPemesan, params.gender]
      );

      await writeAuditLog(
        tx,
        admin,
        wantOverride ? 'MANUAL_BOOK_OVERRIDE' : 'MANUAL_BOOK',
        `Kursi ${seat.label}`,
        `${namaPemesan} (${params.gender})${wantOverride ? ` | Override: ${params.overrideReason}` : ''}`
      );
      return (await getBookingDetailById(tx, bookingId))!;
    } else {
      const namaIstri = (params.namaIstri ?? '').trim();
      if (namaIstri.length < 2) throw new ServiceError('Nama istri wajib diisi.', 400);
      if (params.seats.length !== 2) throw new ServiceError('Pilih 2 kursi bersebelahan.', 400);
      const suamiPick = params.seats.find((s) => s.role === 'suami') ?? params.seats[0];
      const istriPick = params.seats.find((s) => s.role === 'istri') ?? params.seats[1];
      const suamiSeat = seatsMap.get(suamiPick.label);
      const istriSeat = seatsMap.get(istriPick.label);
      if (!suamiSeat || !istriSeat) throw new ServiceError('Kursi tidak ditemukan.', 404);

      const check = validateCoupleSelection(suamiSeat, istriSeat, seatsMap, {
        allowOverride: wantOverride,
      });
      if (!check.valid) {
        throw new ServiceError(check.reason ?? 'Melanggar aturan pasangan.', 409);
      }

      await tx.execute('DELETE FROM seat_holds WHERE seat_id IN (?, ?)', [suamiSeat.id, istriSeat.id]);
      const kode = await generateBookingCode(tx);
      const bookingId = await tx.insertReturningId(
        `INSERT INTO bookings (kode_booking, event_id, bus_id, mode, nama_pemesan, no_whatsapp, status)
         VALUES (?, ?, ?, 'suami_istri', ?, ?, 'aktif')`,
        [kode, event.id, params.busId, `${namaPemesan} & ${namaIstri}`, normalizedWa]
      );
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, 'L', 'suami', 1)`,
        [bookingId, suamiSeat.id, namaPemesan]
      );
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, 'P', 'istri', 1)`,
        [bookingId, istriSeat.id, namaIstri]
      );

      await writeAuditLog(
        tx,
        admin,
        wantOverride ? 'MANUAL_BOOK_OVERRIDE' : 'MANUAL_BOOK',
        `Kursi ${suamiSeat.label} & ${istriSeat.label}`,
        `Pasutri ${namaPemesan} & ${namaIstri}${wantOverride ? ` | Override: ${params.overrideReason}` : ''}`
      );
      return (await getBookingDetailById(tx, bookingId))!;
    }
  });
}

export async function adminMoveBookingSeats(
  db: DbClient,
  admin: AdminSessionPayload,
  params: {
    bookingId: number;
    busId: number;
    seats: Array<{ label: string; role?: CoupleRole }>;
    override?: boolean;
    overrideReason?: string;
  }
): Promise<BookingDetail> {
  const wantOverride = Boolean(params.override);
  if (wantOverride && !(params.overrideReason ?? '').trim()) {
    throw new ServiceError('Alasan pengecualian wajib diisi.', 400);
  }

  return db.withTransaction(async (tx) => {
    await lockBus(tx, params.busId);
    await purgeExpiredHolds(tx);
    const existing = await getBookingDetailById(tx, params.bookingId);
    if (!existing || existing.status !== 'aktif') {
      throw new ServiceError('Pesanan aktif tidak ditemukan.', 404);
    }

    const busSeats = await getPublicBusSeats(tx, params.busId, undefined, { skipPurge: true });
    const seatsMap = buildSeatMap(busSeats);
    const ignoreSeatLabels =
      existing.busId === params.busId ? existing.seats.map((s) => s.label) : [];

    if (existing.mode === 'sendiri') {
      if (params.seats.length !== 1) throw new ServiceError('Pilih tepat 1 kursi tujuan.', 400);
      const oldSeat = existing.seats[0];
      const newSeat = seatsMap.get(params.seats[0].label);
      if (!newSeat) throw new ServiceError('Kursi tujuan tidak ditemukan.', 404);

      const check = getSeatEligibilityForSingle(newSeat, seatsMap, oldSeat.jenisKelamin, {
        ignoreSeatLabels,
        allowOverride: wantOverride,
      });
      if (!check.allowed) throw new ServiceError(check.reason ?? 'Kursi tujuan tidak valid.', 409);

      await tx.execute('DELETE FROM seat_holds WHERE seat_id = ?', [newSeat.id]);
      await tx.execute('DELETE FROM booking_seats WHERE booking_id = ?', [existing.id]);
      await tx.execute('UPDATE bookings SET bus_id = ? WHERE id = ?', [params.busId, existing.id]);
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, ?, NULL, 1)`,
        [existing.id, newSeat.id, oldSeat.namaPenumpang, oldSeat.jenisKelamin]
      );

      await writeAuditLog(
        tx,
        admin,
        wantOverride ? 'MOVE_SEAT_OVERRIDE' : 'MOVE_SEAT',
        `${existing.kodeBooking}`,
        `${existing.busNama} ${oldSeat.label} -> Bus#${params.busId} ${newSeat.label}${
          wantOverride ? ` | Override: ${params.overrideReason}` : ''
        }`
      );
    } else {
      if (params.seats.length !== 2) {
        throw new ServiceError(
          'Pemindahan pasangan Suami & Istri wajib memilih 2 kursi bersebelahan sekaligus.',
          400
        );
      }
      const suamiPick = params.seats.find((s) => s.role === 'suami') ?? params.seats[0];
      const istriPick = params.seats.find((s) => s.role === 'istri') ?? params.seats[1];
      const suamiSeat = seatsMap.get(suamiPick.label);
      const istriSeat = seatsMap.get(istriPick.label);
      if (!suamiSeat || !istriSeat) throw new ServiceError('Kursi tujuan tidak ditemukan.', 404);

      const check = validateCoupleSelection(suamiSeat, istriSeat, seatsMap, {
        ignoreSeatLabels,
        allowOverride: wantOverride,
      });
      if (!check.valid) throw new ServiceError(check.reason ?? 'Pasangan kursi tujuan tidak valid.', 409);

      const oldSuami = existing.seats.find((s) => s.peranPasangan === 'suami') ?? existing.seats[0];
      const oldIstri = existing.seats.find((s) => s.peranPasangan === 'istri') ?? existing.seats[1];

      await tx.execute('DELETE FROM seat_holds WHERE seat_id IN (?, ?)', [suamiSeat.id, istriSeat.id]);
      await tx.execute('DELETE FROM booking_seats WHERE booking_id = ?', [existing.id]);
      await tx.execute('UPDATE bookings SET bus_id = ? WHERE id = ?', [params.busId, existing.id]);
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, 'L', 'suami', 1)`,
        [existing.id, suamiSeat.id, oldSuami.namaPenumpang]
      );
      await tx.execute(
        `INSERT INTO booking_seats (booking_id, seat_id, nama_penumpang, jenis_kelamin, peran_pasangan, active_flag)
         VALUES (?, ?, ?, 'P', 'istri', 1)`,
        [existing.id, istriSeat.id, oldIstri.namaPenumpang]
      );

      await writeAuditLog(
        tx,
        admin,
        wantOverride ? 'MOVE_COUPLE_OVERRIDE' : 'MOVE_COUPLE',
        `${existing.kodeBooking}`,
        `${oldSuami.label}+${oldIstri.label} -> ${suamiSeat.label}+${istriSeat.label}${
          wantOverride ? ` | Override: ${params.overrideReason}` : ''
        }`
      );
    }

    return (await getBookingDetailById(tx, existing.id))!;
  });
}

export async function adminCancelBooking(
  db: DbClient,
  admin: AdminSessionPayload,
  bookingId: number,
  reason?: string
): Promise<BookingDetail> {
  return db.withTransaction(async (tx) => {
    const existing = await getBookingDetailById(tx, bookingId);
    if (!existing) throw new ServiceError('Pesanan tidak ditemukan.', 404);
    if (existing.status === 'dibatalkan') {
      throw new ServiceError('Pesanan ini sudah berstatus Dibatalkan.', 400);
    }

    await tx.execute(
      "UPDATE bookings SET status = 'dibatalkan', dibatalkan_pada = CURRENT_TIMESTAMP WHERE id = ?",
      [bookingId]
    );
    await tx.execute('UPDATE booking_seats SET active_flag = NULL WHERE booking_id = ?', [bookingId]);

    await writeAuditLog(
      tx,
      admin,
      'CANCEL_BOOKING',
      existing.kodeBooking,
      `Dibatalkan oleh admin (${existing.namaPemesan})${reason ? `: ${reason}` : ''}`
    );

    return (await getBookingDetailById(tx, bookingId))!;
  });
}

export async function listAllBookings(db: DbClient, busId?: number): Promise<BookingDetail[]> {
  const where = busId ? 'WHERE bk.bus_id = ?' : '';
  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT bk.*, b.nama AS bus_nama, b.plat_nomor AS bus_plat, b.tipe_armada AS bus_tipe
     FROM bookings bk
     JOIN buses b ON b.id = bk.bus_id
     ${where}
     ORDER BY bk.id DESC`,
    busId ? [busId] : []
  );
  return hydrateBookings(db, rows);
}

export async function getDashboardSummary(db: DbClient): Promise<DashboardSummary> {
  await purgeExpiredHolds(db);
  const buses = (await getBuses(db, true)).filter((b) => b.aktif);
  const countRows = await db.queryAll<{
    bus_id: number | string;
    male_count: number | string | null;
    female_count: number | string | null;
  }>(
    `SELECT s.bus_id,
      SUM(CASE WHEN bs.jenis_kelamin = 'L' THEN 1 ELSE 0 END) AS male_count,
      SUM(CASE WHEN bs.jenis_kelamin = 'P' THEN 1 ELSE 0 END) AS female_count
     FROM booking_seats bs
     JOIN seats s ON s.id = bs.seat_id
     WHERE bs.active_flag = 1
     GROUP BY s.bus_id`
  );
  const countMap = new Map(
    countRows.map((r) => [
      Number(r.bus_id),
      { male: Number(r.male_count ?? 0), female: Number(r.female_count ?? 0) },
    ])
  );

  const busSummaries = buses.map((b) => {
    const counts = countMap.get(b.id) ?? { male: 0, female: 0 };
    return {
      busId: b.id,
      nama: b.nama,
      total: b.totalSeats,
      occupied: b.occupiedSeats,
      available: b.availableSeats,
      blocked: b.blockedSeats,
      maleCount: counts.male,
      femaleCount: counts.female,
    };
  });

  const coupleRow = await db.queryOne<{ c: number | string }>(
    "SELECT COUNT(*) AS c FROM bookings WHERE mode = 'suami_istri' AND status = 'aktif'"
  );
  const holdRow = await db.queryOne<{ c: number | string }>('SELECT COUNT(*) AS c FROM seat_holds');
  const recentRows = await db.queryAll<Record<string, unknown>>(
    `SELECT bk.*, b.nama AS bus_nama, b.plat_nomor AS bus_plat, b.tipe_armada AS bus_tipe
     FROM bookings bk
     JOIN buses b ON b.id = bk.bus_id
     WHERE bk.status = 'aktif'
     ORDER BY bk.id DESC
     LIMIT 6`
  );
  const recentBookings = await hydrateBookings(db, recentRows);

  return {
    totalCapacity: busSummaries.reduce((acc, b) => acc + b.total, 0),
    totalOccupied: busSummaries.reduce((acc, b) => acc + b.occupied, 0),
    totalAvailable: busSummaries.reduce((acc, b) => acc + b.available, 0),
    totalBlocked: busSummaries.reduce((acc, b) => acc + b.blocked, 0),
    totalActiveHolds: Number(holdRow?.c ?? 0),
    maleCount: busSummaries.reduce((acc, b) => acc + b.maleCount, 0),
    femaleCount: busSummaries.reduce((acc, b) => acc + b.femaleCount, 0),
    coupleCount: Number(coupleRow?.c ?? 0),
    buses: busSummaries,
    recentBookings,
  };
}

// ---------------- PARTICIPANT AUTH ----------------

export async function getParticipantById(
  db: DbClient,
  participantId: number
): Promise<ParticipantUser | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT id, email, nama, no_whatsapp, created_at FROM participants WHERE id = ?',
    [participantId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    nama: String(row.nama ?? ''),
    noWhatsapp: String(row.no_whatsapp ?? ''),
    createdAt: String(row.created_at),
  };
}

export async function registerParticipant(
  db: DbClient,
  params: { email: string; nama: string; noWhatsapp?: string }
): Promise<ParticipantUser> {
  const email = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ServiceError('Format email tidak valid.', 400);
  }
  const nama = params.nama.trim();
  if (nama.length < 2) {
    throw new ServiceError('Nama lengkap wajib diisi (minimal 2 karakter).', 400);
  }

  let normalizedWa = '';
  if (params.noWhatsapp && params.noWhatsapp.trim()) {
    normalizedWa = normalizeWhatsApp(params.noWhatsapp);
    if (!isValidWhatsApp(normalizedWa)) {
      throw new ServiceError(
        'Format nomor WhatsApp tidak valid. Gunakan format Indonesia (mis. 081234567890).',
        400
      );
    }
  }

  const existing = await db.queryOne('SELECT id FROM participants WHERE LOWER(email) = ?', [email]);
  if (existing) {
    throw new ServiceError('Email ini sudah terdaftar. Silakan masuk melalui tab Login.', 409);
  }

  const newId = await db.insertReturningId(
    'INSERT INTO participants (email, nama, no_whatsapp) VALUES (?, ?, ?)',
    [email, nama, normalizedWa]
  );

  return (await getParticipantById(db, newId))!;
}

export async function loginParticipantByEmail(
  db: DbClient,
  rawEmail: string
): Promise<ParticipantUser> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ServiceError('Format email tidak valid.', 400);
  }
  const row = await db.queryOne<{ id: number }>(
    'SELECT id FROM participants WHERE LOWER(email) = ?',
    [email]
  );
  if (!row) {
    throw new ServiceError('Email belum terdaftar. Silakan daftar (Register) terlebih dahulu.', 404);
  }
  return (await getParticipantById(db, Number(row.id)))!;
}

export async function updateParticipantProfile(
  db: DbClient,
  participantId: number,
  params: { nama?: string; noWhatsapp?: string }
): Promise<ParticipantUser> {
  const current = await getParticipantById(db, participantId);
  if (!current) throw new ServiceError('Akun tidak ditemukan.', 404);

  const nextNama = params.nama !== undefined ? params.nama.trim() : current.nama;
  if (nextNama.length < 2) {
    throw new ServiceError('Nama lengkap minimal 2 karakter.', 400);
  }

  let nextWa = current.noWhatsapp;
  if (params.noWhatsapp !== undefined) {
    const trimmed = params.noWhatsapp.trim();
    if (!trimmed) {
      nextWa = '';
    } else {
      nextWa = normalizeWhatsApp(trimmed);
      if (!isValidWhatsApp(nextWa)) {
        throw new ServiceError('Format nomor WhatsApp tidak valid (contoh: 081234567890).', 400);
      }
    }
  }

  await db.execute('UPDATE participants SET nama = ?, no_whatsapp = ? WHERE id = ?', [
    nextNama,
    nextWa,
    participantId,
  ]);
  return (await getParticipantById(db, participantId))!;
}

export async function getMyBookings(
  db: DbClient,
  participantId: number
): Promise<BookingDetail[]> {
  const participant = await getParticipantById(db, participantId);
  if (!participant) return [];

  const rows = participant.noWhatsapp
    ? await db.queryAll<Record<string, unknown>>(
        `SELECT bk.*, b.nama AS bus_nama, b.plat_nomor AS bus_plat, b.tipe_armada AS bus_tipe
         FROM bookings bk
         JOIN buses b ON b.id = bk.bus_id
         WHERE bk.participant_id = ? OR bk.no_whatsapp = ?
         ORDER BY CASE WHEN bk.status = 'aktif' THEN 0 ELSE 1 END ASC, bk.id DESC`,
        [participant.id, participant.noWhatsapp]
      )
    : await db.queryAll<Record<string, unknown>>(
        `SELECT bk.*, b.nama AS bus_nama, b.plat_nomor AS bus_plat, b.tipe_armada AS bus_tipe
         FROM bookings bk
         JOIN buses b ON b.id = bk.bus_id
         WHERE bk.participant_id = ?
         ORDER BY CASE WHEN bk.status = 'aktif' THEN 0 ELSE 1 END ASC, bk.id DESC`,
        [participant.id]
      );

  return hydrateBookings(db, rows);
}


// ---------------- OPTIMASI: cache baca singkat, koalesensi, dan kunci per-bus ----------------

let lastHoldPurgeAt = 0;

/** Bersihkan hold kedaluwarsa paling sering sekali per 5 detik per instance, tanpa menunggu hasilnya. */
export function purgeExpiredHoldsThrottled(db: DbClient, minIntervalMs = 5000): void {
  const now = Date.now();
  if (now - lastHoldPurgeAt < minIntervalMs) return;
  lastHoldPurgeAt = now;
  purgeExpiredHolds(db).catch(() => {
    // Aman diabaikan: query baca sudah menyaring hold kedaluwarsa, dan jalur tulis selalu purge.
  });
}

/**
 * Serialisasi semua perubahan kursi pada satu bus (Postgres advisory lock, otomatis lepas saat transaksi selesai).
 * Tanpa ini, dua orang yang memesan kursi bersebelahan secara bersamaan bisa sama-sama lolos validasi
 * aturan jenis kelamin. SQLite sudah diserialisasi oleh BEGIN IMMEDIATE.
 */
async function lockBus(tx: DbClient, busId: number): Promise<void> {
  if (tx.dialect !== 'postgres') return;
  await tx.execute('SELECT pg_advisory_xact_lock(?)', [900000 + busId]);
}

interface CacheEntry {
  at: number;
  promise: Promise<unknown>;
}
const readCache = new Map<string, CacheEntry>();

/** Cache singkat + koalesensi: ratusan permintaan bersamaan hanya memicu satu query ke database. */
function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = readCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = load();
  const entry: CacheEntry = { at: now, promise };
  readCache.set(key, entry);
  promise.catch(() => {
    if (readCache.get(key) === entry) readCache.delete(key);
  });
  return promise;
}

export function invalidateReadCache(): void {
  readCache.clear();
}

export async function getEventPayloadCached(
  db: DbClient
): Promise<{ event: EventInfo; buses: BusInfo[] }> {
  const [event, buses] = await Promise.all([
    memo('event', 2000, () => getEventInfo(db)),
    memo('buses', 1000, () => getBuses(db, false)),
  ]);
  return { event, buses };
}

export async function getPublicSeatMapCached(
  db: DbClient,
  busId: number,
  sessionId?: string
): Promise<{ bus: BusInfo; seats: PublicSeat[] } | null> {
  const [buses, rows] = await Promise.all([
    memo('buses', 1000, () => getBuses(db, false)),
    memo(`seats:${busId}`, 1000, () => queryBusSeatRows(db, busId)),
  ]);
  const bus = buses.find((x) => x.id === busId);
  if (!bus) return null;
  const seats = await getPublicBusSeats(db, busId, sessionId, { skipPurge: true, rows });
  return { bus, seats };
}
