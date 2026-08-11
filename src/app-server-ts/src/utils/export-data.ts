import 'dotenv/config';
import { exportData } from './data/postgres.data';

exportData('ExportAllData').catch((error: unknown) => {
  console.error('Export failed:', error);
  throw error;
});
