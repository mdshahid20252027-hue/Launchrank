# LaunchRank — Full-stack MVP

LaunchRank is a product discovery and launch platform built with React, TypeScript, Vite, Express, PostgreSQL and Prisma.

## Requirements
- Node.js 20+
- PostgreSQL database
- npm

## Local setup
1. Create a PostgreSQL database named `launchrank`.
2. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` plus a random `JWT_SECRET` (at least 32 characters). Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
3. Copy `client/.env.example` to `client/.env`. For local development, `VITE_API_URL=http://localhost:4000/api` is correct.
4. From this project root run:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: http://localhost:5173  
API health check: http://localhost:4000/api/health

Create the admin account by setting `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` (at least 12 characters) in `server/.env`, then run `npm run db:seed`. The seed script does not contain a default public admin password.

## Features
- Product discovery, search and leaderboard
- Registration/login with bcrypt and HTTP-only JWT cookies
- Product submission and admin moderation APIs
- Product detail page with status, maker, website and vote information
- One vote per user per product, backed by a database unique constraint
- User dashboard with submitted products, approval status, vote totals, vote history and payment/order history
- Razorpay checkout for 1-day boost (₹99) and 7-day feature (₹499)
- Payment signature and captured-payment/amount verification
- Razorpay webhook signature validation and idempotent captured/failed/full-refund event processing
- Responsive layouts for desktop, tablet and mobile

## Voting test checklist
1. Create two accounts: Maker A and Voter B.
2. Submit a product using Maker A, then approve it using an admin account.
3. Sign in as Voter B and cast one vote.
4. Confirm the vote count increases by one and the product detail button changes to `You voted`.
5. Try voting again (including from another browser tab). The API should return HTTP 409 and the count must not increase.
6. Sign in as Maker A and confirm voting on their own product is blocked.
7. Sign out and confirm voting sends the visitor to sign in.

## Razorpay test checklist
- Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` on the server using Razorpay test credentials first.
- A product must be approved and owned by the signed-in user before checkout can start.
- Test both packages using Razorpay's current test payment methods.
- Confirm successful checkout is verified server-side against the order ID, payment ID, signature, captured status, currency and stored order amount.
- Test cancellation and failed payments; no promotion should be activated.
- Never put Razorpay secret keys in the client app or commit `.env` files.

## Production deployment checklist
1. Provision a managed PostgreSQL database and run Prisma migrations against it.
2. Deploy the Express API to a Node.js host and set all server environment variables there.
3. Deploy the Vite frontend to a static hosting provider and set `VITE_API_URL` to the deployed API URL.
4. Set `CLIENT_URL` to the exact frontend origin. Use HTTPS on both frontend and API.
5. Configure Razorpay live credentials and a webhook only after end-to-end testing in test mode.
6. Configure the custom domain's DNS records at your domain registrar and verify HTTPS.
7. Test registration, login, logout, submissions, moderation, voting and payments on the deployed domain.

If frontend and API are on different sites, verify cookie/CORS behavior in the target hosting setup. Production cookies use `SameSite=None; Secure`; HTTPS is required. Use a single trusted `CLIENT_URL` and do not use wildcard credentialed CORS.

## Payment webhook setup
Configure the Razorpay webhook URL as `https://YOUR_API_DOMAIN/api/webhooks/razorpay` and subscribe to `payment.captured`, `payment.failed`, and `refund.processed`. Store the webhook signing secret in `RAZORPAY_WEBHOOK_SECRET`. The handler verifies the signature and processes payment state changes idempotently.

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) and `render.yaml` for a Render + PostgreSQL deployment blueprint. The client also includes a Vercel SPA rewrite file.

## Important
- The source ZIP intentionally excludes `node_modules`, real `.env` files and generated build output. Run `npm install` on your computer after extracting it.
- This is an MVP, not a completed independent security audit. Before public launch, complete end-to-end testing, configure monitoring and automated database backups, add email verification and password reset, publish privacy/terms/refund pages, and obtain a security review. Use Razorpay Test Mode first.
