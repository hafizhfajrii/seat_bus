import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

async function startTestServer() {
  const db = await createDatabase({ dbPath: ':memory:' });
  const app = createApp(db);
  const server = http.createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((res) => {
            server.close(async () => {
              await db.close();
              res();
            });
          }),
      });
    });
  });
}

test('Guest browsing, email-only register/login, immediate booking, gender rules, and E-Ticket via email', async () => {
  const srv = await startTestServer();
  try {
    // 1. Guest can access event & seat map without login
    const evRes = await fetch(`${srv.baseUrl}/api/event`);
    assert.equal(evRes.status, 200);
    const evJson = (await evRes.json()) as { event: { nama: string }; buses: Array<{ id: number }> };
    assert.equal(evJson.buses.length, 1);

    const seatsRes = await fetch(`${srv.baseUrl}/api/buses/1/seats`);
    assert.equal(seatsRes.status, 200);
    const initialSeatsJson = (await seatsRes.json()) as { seats: Array<{ status: string }> };
    assert.equal(initialSeatsJson.seats.every((s) => s.status === 'tersedia'), true);

    // 2. Guest cannot book without login (401)
    const guestBookRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Tamu',
        gender: 'P',
        noWhatsapp: '081234567890',
        sessionId: 'sess-guest',
        seats: [{ label: 'D3' }],
      }),
    });
    assert.equal(guestBookRes.status, 401);

    // 3. Participant registers with email + name ONLY (no password, no phone verification required)
    const regRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'siti@example.com',
        nama: 'Siti Fatimah',
      }),
    });
    assert.equal(regRes.status, 201);

    // Participant can login using email ONLY (no password)
    const pLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'siti@example.com' }),
    });
    assert.equal(pLoginRes.status, 200);
    const pCookie = (pLoginRes.headers.get('set-cookie') ?? '').split(';')[0];

    // 4. Book B1 as female, then direct API attempt to bypass gender rule on B2 is rejected 409
    const b1BookRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: pCookie },
      body: JSON.stringify({
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Aisyah Putri',
        gender: 'P',
        noWhatsapp: '081299001122',
        sessionId: 'sess-aisyah',
        seats: [{ label: 'B1' }],
      }),
    });
    assert.equal(b1BookRes.status, 201);

    const maleReg = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bypass@example.com',
        nama: 'Bypass User',
      }),
    });
    const maleCookie = (maleReg.headers.get('set-cookie') ?? '').split(';')[0];

    const bypassRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: maleCookie },
      body: JSON.stringify({
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Bypass User',
        gender: 'L',
        noWhatsapp: '081233334444',
        sessionId: 'sess-bypass',
        seats: [{ label: 'B2' }],
      }),
    });
    assert.equal(bypassRes.status, 409);

    // 5. Siti can immediately book D3 with her WhatsApp number without admin pre-registering it (201)
    const okRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: pCookie },
      body: JSON.stringify({
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Siti Fatimah',
        gender: 'P',
        noWhatsapp: '081299887766',
        sessionId: 'sess-siti',
        seats: [{ label: 'D3' }],
      }),
    });
    assert.equal(okRes.status, 201);
    const okJson = (await okRes.json()) as { booking: { id: number; kodeBooking: string } };
    assert.ok(okJson.booking.kodeBooking.startsWith('TRS-'));

    // Public seat map does not leak passenger full names or WhatsApp numbers
    const afterSeatsText = await (await fetch(`${srv.baseUrl}/api/buses/1/seats`)).text();
    assert.equal(afterSeatsText.includes('Siti Fatimah'), false);
    assert.equal(afterSeatsText.includes('081299887766'), false);

    // /api/my-bookings returns her E-Ticket via email login
    const myBookingsRes = await fetch(`${srv.baseUrl}/api/my-bookings`, {
      headers: { Cookie: pCookie },
    });
    assert.equal(myBookingsRes.status, 200);
    const myBookingsJson = (await myBookingsRes.json()) as {
      bookings: Array<{ kodeBooking: string }>;
    };
    assert.equal(myBookingsJson.bookings.length, 2);
    assert.ok(myBookingsJson.bookings.some((b) => b.kodeBooking === okJson.booking.kodeBooking));

    // 6. Admin unauthenticated blocked (401), login with Selangkahtourtravel@gmail.com + CSV export works
    const unauthRes = await fetch(`${srv.baseUrl}/api/admin/dashboard`);
    assert.equal(unauthRes.status, 401);

    const loginRes = await fetch(`${srv.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Selangkahtourtravel@gmail.com', password: 'hafizhganteng' }),
    });
    assert.equal(loginRes.status, 200);
    const adminCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

    // Shorthand password 'hafizh' must be rejected (strictly 'hafizhganteng' only)
    const badLoginRes = await fetch(`${srv.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'selangkah', password: 'hafizh' }),
    });
    assert.equal(badLoginRes.status, 401);

    // Second device logs in with shortcut 'selangkah' and strict password 'hafizhganteng' simultaneously
    const loginRes2 = await fetch(`${srv.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'selangkah', password: 'hafizhganteng' }),
    });
    assert.equal(loginRes2.status, 200);
    const adminCookie2 = (loginRes2.headers.get('set-cookie') ?? '').split(';')[0];

    const [me1, me2] = await Promise.all([
      fetch(`${srv.baseUrl}/api/admin/me`, { headers: { Cookie: adminCookie } }),
      fetch(`${srv.baseUrl}/api/admin/me`, { headers: { Cookie: adminCookie2 } }),
    ]);
    assert.equal(me1.status, 200);
    assert.equal(me2.status, 200);

    const csvRes = await fetch(`${srv.baseUrl}/api/admin/manifest/export?busId=1`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Siti Fatimah'));
    assert.ok(csvText.includes('D3'));

    // Admin moves Siti from D3 -> D4 and then cancels booking
    const moveRes = await fetch(`${srv.baseUrl}/api/admin/bookings/${okJson.booking.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ busId: 1, seats: [{ label: 'D4' }], override: false }),
    });
    assert.equal(moveRes.status, 200);
    const moveJson = (await moveRes.json()) as { booking: { seats: Array<{ label: string }> } };
    assert.equal(moveJson.booking.seats[0].label, 'D4');

    const cancelRes = await fetch(`${srv.baseUrl}/api/admin/bookings/${okJson.booking.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ reason: 'Dilepas oleh Admin' }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as { booking: { status: string } };
    assert.equal(cancelJson.booking.status, 'dibatalkan');

    // Admin updates event details and Bus 1 name/plate/type
    const updEventRes = await fetch(`${srv.baseUrl}/api/admin/event`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        nama: 'Acara Baru 2026',
        tanggal: 'Minggu, 15 Nov 2026',
        jamBerangkat: '07.00 WIB',
        lokasiBerangkat: 'Alun-Alun Kota',
      }),
    });
    assert.equal(updEventRes.status, 200);
    const updEventJson = (await updEventRes.json()) as { event: { nama: string; lokasiBerangkat: string } };
    assert.equal(updEventJson.event.nama, 'Acara Baru 2026');
    assert.equal(updEventJson.event.lokasiBerangkat, 'Alun-Alun Kota');

    const updBusRes = await fetch(`${srv.baseUrl}/api/admin/buses/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        nama: 'BUS VIP 1',
        platNomor: 'B 1234 XYZ',
        tipeArmada: 'Mercedes OH 1626',
        posisiSopir: 'kiri',
      }),
    });
    assert.equal(updBusRes.status, 200);
    const updBusJson = (await updBusRes.json()) as {
      buses: Array<{ id: number; nama: string; platNomor: string; tipeArmada: string; posisiSopir: string }>;
    };
    const bus1 = updBusJson.buses.find((b) => b.id === 1);
    assert.equal(bus1?.nama, 'BUS VIP 1');
    assert.equal(bus1?.platNomor, 'B 1234 XYZ');
    assert.equal(bus1?.tipeArmada, 'Mercedes OH 1626');
    assert.equal(bus1?.posisiSopir, 'kiri');

    // Audit logs: list, delete single log, and clear all logs
    const logsRes = await fetch(`${srv.baseUrl}/api/admin/audit-logs`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(logsRes.status, 200);
    const logsJson = (await logsRes.json()) as { logs: Array<{ id: number }> };
    assert.ok(logsJson.logs.length >= 2);

    const delOneRes = await fetch(`${srv.baseUrl}/api/admin/audit-logs/${logsJson.logs[0].id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    assert.equal(delOneRes.status, 200);

    const clearRes = await fetch(`${srv.baseUrl}/api/admin/audit-logs`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    assert.equal(clearRes.status, 200);

    const afterClearJson = (await (
      await fetch(`${srv.baseUrl}/api/admin/audit-logs`, { headers: { Cookie: adminCookie } })
    ).json()) as { logs: Array<{ id: number }> };
    assert.equal(afterClearJson.logs.length, 0);
  } finally {
    await srv.close();
  }
});
