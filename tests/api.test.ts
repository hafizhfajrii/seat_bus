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

test('Guest browsing, email-only register/login, admin phone whitelist verification, and E-Ticket via email', async () => {
  const srv = await startTestServer();
  try {
    // 1. Guest can access event & seat map without login
    const evRes = await fetch(`${srv.baseUrl}/api/event`);
    assert.equal(evRes.status, 200);
    const evJson = (await evRes.json()) as { event: { nama: string }; buses: Array<{ id: number }> };
    assert.equal(evJson.buses.length, 1);

    const seatsRes = await fetch(`${srv.baseUrl}/api/buses/1/seats`);
    assert.equal(seatsRes.status, 200);
    const seatsText = await seatsRes.text();
    assert.equal(seatsText.includes('Ahmad Fauzi'), false);
    assert.equal(seatsText.includes('6281388991234'), false);

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

    // 3. Participant registers with email + name ONLY (no password, no phone yet)
    const regRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'siti@example.com',
        nama: 'Siti Fatimah',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as {
      participant: { isPhoneRegistered: boolean; noWhatsapp: string };
    };
    assert.equal(regJson.participant.isPhoneRegistered, false);
    assert.equal(regJson.participant.noWhatsapp, '');

    // Participant can login using email ONLY (no password)
    const pLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'siti@example.com' }),
    });
    assert.equal(pLoginRes.status, 200);
    const pCookie = (pLoginRes.headers.get('set-cookie') ?? '').split(';')[0];

    // Participant updates/submits their WA number for verification (still not registered by admin -> false)
    const updWaRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: pCookie },
      body: JSON.stringify({ noWhatsapp: '081299887766' }),
    });
    assert.equal(updWaRes.status, 200);
    const updWaJson = (await updWaRes.json()) as { participant: { isPhoneRegistered: boolean } };
    assert.equal(updWaJson.participant.isPhoneRegistered, false);

    // 4. Logged-in participant whose number is NOT registered by admin cannot book (403)
    const unverifiedBookRes = await fetch(`${srv.baseUrl}/api/bookings`, {
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
    assert.equal(unverifiedBookRes.status, 403);

    // 5. Admin unauthenticated blocked (401)
    const unauthRes = await fetch(`${srv.baseUrl}/api/admin/dashboard`);
    assert.equal(unauthRes.status, 401);

    // Admin logs in & registers Siti's phone number
    const loginRes = await fetch(`${srv.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin', password: '123' }),
    });
    assert.equal(loginRes.status, 200);
    const adminCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

    const addPhoneRes = await fetch(`${srv.baseUrl}/api/admin/phones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        entries: [{ noWhatsapp: '081299887766', catatan: 'Siti Fatimah' }],
      }),
    });
    assert.equal(addPhoneRes.status, 201);

    // 6. Direct API attempt to bypass gender rule (using registered number of a Male account) still rejected 409
    const maleReg = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bypass@example.com',
        nama: 'Bypass User',
        noWhatsapp: '081233334444',
      }),
    });
    const maleCookie = (maleReg.headers.get('set-cookie') ?? '').split(';')[0];
    await fetch(`${srv.baseUrl}/api/admin/phones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ entries: [{ noWhatsapp: '081233334444' }] }),
    });

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

    // 7. Now Siti's booking succeeds (201), and /api/my-bookings returns her E-Ticket via email login
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
    const okJson = (await okRes.json()) as { booking: { kodeBooking: string } };
    assert.ok(okJson.booking.kodeBooking.startsWith('TRS-'));

    const myBookingsRes = await fetch(`${srv.baseUrl}/api/my-bookings`, {
      headers: { Cookie: pCookie },
    });
    assert.equal(myBookingsRes.status, 200);
    const myBookingsJson = (await myBookingsRes.json()) as {
      bookings: Array<{ kodeBooking: string }>;
    };
    assert.equal(myBookingsJson.bookings.length, 1);
    assert.equal(myBookingsJson.bookings[0].kodeBooking, okJson.booking.kodeBooking);

    // 8. Admin CSV export works
    const csvRes = await fetch(`${srv.baseUrl}/api/admin/manifest/export`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Siti Fatimah'));
    assert.ok(csvText.includes('D3'));
  } finally {
    await srv.close();
  }
});
