# LaunchRank development status

## Code updates in this package
- Preserved registration/login, JWT cookie sessions, product submission, one-vote-per-user enforcement, leaderboard and admin moderation.
- Added the missing `/api/users/me/votes` endpoint required by the dashboard's vote-history section.
- Added user payment-history API and dashboard order/payment display.
- Added `razorpayPaymentId` persistence and product-order relation migration.
- Hardened checkout verification with server-side Razorpay payment fetch, amount/currency/captured checks, and conditional idempotent order-state updates.
- Webhook verifies the raw-body HMAC signature and handles captured, failed and full-refund events. Partial refunds do not automatically revoke the purchased promotion.
- Added API rate limiting, origin checks for browser write requests, and a Content Security Policy that permits Razorpay Checkout.
- Removed the hard-coded demo admin password from the seed process; admin credentials must be supplied via environment variables.
- Added Render blueprint, Vercel SPA rewrite and deployment guide.

## Local setup
1. Extract the ZIP and open the project root in VS Code.
2. Copy `server/.env.example` to `server/.env`; set your PostgreSQL `DATABASE_URL`, a random `JWT_SECRET` (32+ characters), and admin credentials.
3. Copy `client/.env.example` to `client/.env` for local development.
4. Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run build`, then `npm run dev`.
5. Frontend: `http://localhost:5173`; API health: `http://localhost:4000/api/health`.

## Verification status and external dependencies
- Source and configuration files were updated, but a clean TypeScript/Vite build could not be verified in this execution environment: dependency installation timed out and left incomplete `@types` packages. Re-run `npm ci` on the user's computer/network before relying on build output.
- Database migration and seed must be run against the user's actual PostgreSQL instance; this workspace cannot access that local database.
- Razorpay end-to-end testing requires the user's Razorpay test credentials and publicly reachable webhook URL.
- Hosting, DNS, custom domain and HTTPS require authorization to the user's hosting/domain accounts. The included Render blueprint and deployment guide prepare the project but do not create external accounts or deploy it automatically.
- Email verification, password reset, monitoring, backups, legal pages and an independent security audit remain recommended before a public production launch.
