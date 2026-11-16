// Runs every morning and emails anything a week away or happening tomorrow.
import { runReminders } from '../lib/common.mjs';

export default async () => {
  try {
    const result = await runReminders();
    console.log('Reminders checked', result);
  } catch (err) {
    console.error('Reminder run failed:', err.message);
  }
};

// 06:30 UTC = 06:30 in winter, 07:30 in summer (UK time).
export const config = { schedule: '30 6 * * *' };
