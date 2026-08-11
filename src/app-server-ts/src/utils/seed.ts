import 'dotenv/config';
import { importData } from './data/postgres.data';

const CLEAR = Boolean(process.env.CLEAR);

importData('ImportAllData', CLEAR).catch((error: unknown) => {
  console.error('Seed failed:', error);
  throw error;
});
