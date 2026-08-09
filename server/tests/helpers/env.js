// Loaded before anything else in every test file (see `npm test`'s --import).
//
// Tests MUST NOT run against the development database. This module loads
// `.env.test`, then refuses to continue unless DATABASE_URL points at a
// database whose name ends in `_test`.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(serverRoot, '.env.test') });

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'roadmate_test_secret';
// Razorpay stays unconfigured in tests (RAZORPAY_KEY_ID/SECRET absent), so
// `lib/razorpay.js` takes the stub path — only the webhook secret is needed
// here, since signature verification is real regardless of live credentials.
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'roadmate_test_webhook_secret';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('No DATABASE_URL. Copy server/.env.test.example to server/.env.test.');
}

const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against database "${dbName}" — the name must end in "_test". ` +
    'Check server/.env.test.'
  );
}

export { serverRoot, dbName };
