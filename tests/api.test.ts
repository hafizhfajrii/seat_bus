import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase } from '../server/db';
import { createApp } from '../server/app';

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

test('HTTP API enforces privacy on public seats, rejects rule bypass, and supports admin login + CSV export', async () => {
  const srv = await startTestServer();
  try {
    const evRes = await fetch(`${srv.baseUrl}/api/event`);
    assert.equal(evRes.status, 200);
    const evJson = (await evRes.json()) as { event: { nama: string }; buses: Array<{ id: number }> };
    assert.equal(evJson.buses.length, 1);

    const seatsRes = await fetch(`${srv.baseUrl}/api/buses/1/seats`);
    assert.equal(seatsRes.status, 200);
    const seatsText = await seatsRes.text();
    assert.equal(seatsText.includes('Ahmad Fauzi'), false);
    assert.equal(seatsText.includes('6281388991234'), false);

    const bypassRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const okRes = await fetch(`${srv.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        busId: 1,
        mode: 'sendiri',
        namaPemesan: 'Siti Fatimah',
        gender: 'P',
        noWhatsapp: '081234567890',
        sessionId: 'sess-siti',
        seats: [{ label: 'D3' }],
      }),
    });
    assert.equal(okRes.status, 201);
    const okJson = (await okRes.json()) as { booking: { kodeBooking: string } };
    assert.ok(okJson.booking.kodeBooking.startsWith('TRS-'));

    const unauthRes = await fetch(`${srv.baseUrl}/api/admin/dashboard`);
    assert.equal(unauthRes.status, 401);

    const loginRes = await fetch(`${srv.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Selangkahtourtravel@gmail.com', password: 'hafizhganteng' }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookieHeader = setCookie.split(';')[0];

    const csvRes = await fetch(`${srv.baseUrl}/api/admin/manifest/export`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Siti Fatimah'));
    assert.ok(csvText.includes('D3'));
  } finally {
    await srv.close();
  }
});
