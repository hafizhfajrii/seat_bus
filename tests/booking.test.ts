import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db';
import {
  adminCancelBooking,
  adminManualBook,
  adminToggleBlockSeat,
  cancelBookingByParticipant,
  changeBookingSeats,
  createBooking,
  createOrReplaceHold,
  getPublicBusSeats,
  lookupBookingsByWhatsApp,
  ServiceError,
} from '../server/bookingService';

test('Bus 1 has 38 seats (32 leg_rest A1-H4 + 6 belakang R1-R6)', async () => {
  const db = await createDatabase({ dbPath: ':memory:' });
  const seats = await getPublicBusSeats(db, 1);
  assert.equal(seats.length, 38);
  assert.equal(seats.filter((s) => s.tipe === 'leg_rest').length, 32);
  assert.equal(seats.filter((s) => s.tipe === 'belakang').length, 6);
  await db.close();
});

test('Mode Sendiri enforces gender selection and two-way female seating rule', async () => {
  const db = await createDatabase({ dbPath: ':memory:' });

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Budi',
        gender: 'L',
        noWhatsapp: '081200001111',
        sessionId: 'sess-1',
        seats: [{ label: 'B2' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  const b2Booking = await createBooking(db, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Fatimah',
    gender: 'P',
    noWhatsapp: '081200001112',
    sessionId: 'sess-2',
    seats: [{ label: 'B2' }],
  });
  assert.equal(b2Booking.seats[0].label, 'B2');

  await createBooking(db, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Hasan',
    gender: 'L',
    noWhatsapp: '081200001113',
    sessionId: 'sess-3',
    seats: [{ label: 'D2' }],
  });

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Zainab',
        gender: 'P',
        noWhatsapp: '081200001114',
        sessionId: 'sess-4',
        seats: [{ label: 'D1' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  const d3Booking = await createBooking(db, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Zainab',
    gender: 'P',
    noWhatsapp: '081200001114',
    sessionId: 'sess-4',
    seats: [{ label: 'D3' }],
  });
  assert.equal(d3Booking.seats[0].label, 'D3');

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Anon',
        noWhatsapp: '081200001115',
        sessionId: 'sess-5',
        seats: [{ label: 'E1' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 400
  );

  await db.close();
});

test('Mode Suami & Istri rules: adjacent only, rear-row neighbor orientation, and female protection next to wife', async () => {
  const db = await createDatabase({ dbPath: ':memory:' });

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'suami_istri',
        namaPemesan: 'Ali',
        namaIstri: 'Amina',
        noWhatsapp: '081200002221',
        sessionId: 'sess-c1',
        seats: [
          { label: 'E2', role: 'suami' },
          { label: 'E3', role: 'istri' },
        ],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  await createBooking(db, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Khadijah',
    gender: 'P',
    noWhatsapp: '081200002222',
    sessionId: 'sess-r3',
    seats: [{ label: 'R3' }],
  });

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'suami_istri',
        namaPemesan: 'Umar',
        namaIstri: 'Hafsah',
        noWhatsapp: '081200002223',
        sessionId: 'sess-c2',
        seats: [
          { label: 'R1', role: 'istri' },
          { label: 'R2', role: 'suami' },
        ],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  const coupleRear = await createBooking(db, {
    busId: 1,
    mode: 'suami_istri',
    namaPemesan: 'Umar',
    namaIstri: 'Hafsah',
    noWhatsapp: '081200002223',
    sessionId: 'sess-c2',
    seats: [
      { label: 'R1', role: 'suami' },
      { label: 'R2', role: 'istri' },
    ],
  });
  assert.equal(coupleRear.seats.length, 2);

  await createBooking(db, {
    busId: 1,
    mode: 'suami_istri',
    namaPemesan: 'Tariq',
    namaIstri: 'Salma',
    noWhatsapp: '081200002224',
    sessionId: 'sess-c3',
    seats: [
      { label: 'R4', role: 'istri' },
      { label: 'R5', role: 'suami' },
    ],
  });

  await assert.rejects(
    () =>
      createBooking(db, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Maryam',
        gender: 'P',
        noWhatsapp: '081200002225',
        sessionId: 'sess-r6',
        seats: [{ label: 'R6' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  const db2 = await createDatabase({ dbPath: ':memory:' });
  await createBooking(db2, {
    busId: 1,
    mode: 'suami_istri',
    namaPemesan: 'Bilal',
    namaIstri: 'Asma',
    noWhatsapp: '081200002226',
    sessionId: 'sess-c4',
    seats: [
      { label: 'R4', role: 'suami' },
      { label: 'R5', role: 'istri' },
    ],
  });
  await assert.rejects(
    () =>
      createBooking(db2, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Yusuf',
        gender: 'L',
        noWhatsapp: '081200002227',
        sessionId: 'sess-r6-2',
        seats: [{ label: 'R6' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );
  await db2.close();
  await db.close();
});

test('Seat hold blocks other sessions, cancellation releases both couple seats, and change-seats works atomically', async () => {
  const db = await createDatabase({ dbPath: ':memory:' });

  await createOrReplaceHold(db, {
    busId: 1,
    sessionId: 'session-A',
    mode: 'sendiri',
    seats: [{ label: 'F1', gender: 'L' }],
  });

  await assert.rejects(
    () =>
      createOrReplaceHold(db, {
        busId: 1,
        sessionId: 'session-B',
        mode: 'sendiri',
        seats: [{ label: 'F1', gender: 'L' }],
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 409
  );

  const bk = await createBooking(db, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Rizky',
    gender: 'L',
    noWhatsapp: '+62 812-7777-8888',
    sessionId: 'session-A',
    seats: [{ label: 'F1' }],
  });

  const found = await lookupBookingsByWhatsApp(db, '081277778888');
  assert.equal(found.length, 1);
  assert.equal(found[0].kodeBooking, bk.kodeBooking);

  const changed = await changeBookingSeats(db, {
    bookingId: bk.id,
    noWhatsapp: '0812-7777-8888',
    busId: 1,
    sessionId: 'session-A',
    seats: [{ label: 'F2' }],
  });
  assert.equal(changed.seats[0].label, 'F2');

  const coupleBk = await createBooking(db, {
    busId: 1,
    mode: 'suami_istri',
    namaPemesan: 'Farhan',
    namaIstri: 'Nadia',
    noWhatsapp: '081355556666',
    sessionId: 'session-C',
    seats: [
      { label: 'G1', role: 'suami' },
      { label: 'G2', role: 'istri' },
    ],
  });
  await cancelBookingByParticipant(db, coupleBk.id, '081355556666');

  const afterSeats = await getPublicBusSeats(db, 1);
  assert.equal(afterSeats.find((s) => s.label === 'G1')?.status, 'tersedia');
  assert.equal(afterSeats.find((s) => s.label === 'G2')?.status, 'tersedia');

  await db.close();
});

test('Admin override requires Super Admin + reason, and blocks/cancels work properly', async () => {
  const db = await createDatabase({ dbPath: ':memory:' });
  await db.execute(
    "INSERT INTO admins (id, nama, email, password_hash, role) VALUES (99, 'Panitia', 'panitia-test@transit.id', 'hash', 'admin')"
  );
  const regularAdmin = {
    id: 99,
    email: 'panitia-test@transit.id',
    nama: 'Panitia',
    role: 'admin' as const,
    exp: 0,
  };
  const superAdmin = {
    id: 1,
    email: 'Selangkahtourtravel@gmail.com',
    nama: 'Super',
    role: 'super_admin' as const,
    exp: 0,
  };

  await assert.rejects(
    () =>
      adminManualBook(db, regularAdmin, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Dedi',
        gender: 'L',
        noWhatsapp: '081299990001',
        seats: [{ label: 'B2' }],
        override: true,
        overrideReason: 'Darurat',
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 403
  );

  await assert.rejects(
    () =>
      adminManualBook(db, superAdmin, {
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Dedi',
        gender: 'L',
        noWhatsapp: '081299990001',
        seats: [{ label: 'B2' }],
        override: true,
        overrideReason: '',
      }),
    (err: unknown) => err instanceof ServiceError && err.status === 400
  );

  const overridden = await adminManualBook(db, superAdmin, {
    busId: 1,
    mode: 'sendiri',
    namaPemesan: 'Dedi',
    gender: 'L',
    noWhatsapp: '081299990001',
    seats: [{ label: 'B2' }],
    override: true,
    overrideReason: 'Anak kecil bersama ibunya di B1',
  });
  assert.equal(overridden.seats[0].label, 'B2');

  const cancelled = await adminCancelBooking(db, regularAdmin, overridden.id, 'Selesai');
  assert.equal(cancelled.status, 'dibatalkan');

  const h4 = (await getPublicBusSeats(db, 1)).find((s) => s.label === 'H4')!;
  await adminToggleBlockSeat(db, regularAdmin, { seatId: h4.id, block: true, alasan: 'Kursi Rusak' });
  assert.equal((await getPublicBusSeats(db, 1)).find((s) => s.label === 'H4')?.status, 'diblokir');
  await adminToggleBlockSeat(db, regularAdmin, { seatId: h4.id, block: false });
  assert.equal((await getPublicBusSeats(db, 1)).find((s) => s.label === 'H4')?.status, 'tersedia');

  await db.close();
});
