import { getDatabase } from './db';
import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3001);

async function start() {
  const db = await getDatabase();
  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`Transit Event server running at http://localhost:${PORT} (DB: ${db.dialect})`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
