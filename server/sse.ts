import type { Response } from 'express';

const clients = new Set<Response>();

export function addSseClient(res: Response) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

export function broadcastSeatUpdate(payload: { type: string; busId?: number; timestamp?: number }) {
  const data = JSON.stringify({ ...payload, timestamp: Date.now() });
  for (const client of clients) {
    try {
      client.write(`event: seat-update\ndata: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

