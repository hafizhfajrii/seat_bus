import { getDatabase } from '../server/db';
import { createApp } from '../server/app';

const app = createApp(() => getDatabase());

export default app;

