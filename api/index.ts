import { getDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

const app = createApp(() => getDatabase());

export default app;

