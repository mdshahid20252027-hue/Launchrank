# LaunchRank deployment guide

This repository is prepared for a Render API + PostgreSQL + Render static frontend deployment. A custom domain can be connected after the first deploy.

## Before deployment

- Create a GitHub repository and push this project (do not commit any `.env` file).
- Confirm the production admin email/password and Razorpay credentials are ready.
- Keep Razorpay in Test Mode until all payment and webhook checks pass.

## Render deployment

1. In Render, choose **New > Blueprint** and select the GitHub repository containing `render.yaml`.
2. Review the resources. Render creates `launchrank-db`, `launchrank-api`, and `launchrank-web`.
3. In the API service environment, set `CLIENT_URL` to the exact frontend URL shown by Render (for example `https://launchrank-web.onrender.com`).
4. Set `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 12 characters. Set Razorpay test keys and a webhook secret when ready.
5. Run the database migrations from the API service shell: `npm run db:migrate:deploy`.
6. Run the admin seed once from the API service shell: `npm run db:seed`.
7. Open `https://YOUR_API_HOST/api/health`; it should return `{"status":"ok"}`.
8. Open the frontend URL and test registration, login, product submission, admin approval, voting and dashboards.

## Razorpay webhook

In the Razorpay dashboard (Test Mode), add `https://YOUR_API_HOST/api/webhooks/razorpay` and subscribe to `payment.captured`, `payment.failed`, and `refund.processed`. Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`. Test both packages with Razorpay test payments before switching to Live Mode.

## Custom domain

1. Buy or use a domain you control.
2. In the Render frontend service, add the domain and follow the DNS records Render displays at your registrar.
3. Wait for DNS and TLS certificate provisioning.
4. Update API `CLIENT_URL` to the final HTTPS frontend origin.
5. If the API also gets a custom domain, update `VITE_API_URL` in the frontend service to `https://YOUR_API_DOMAIN/api`, then redeploy the frontend.
6. Re-test sign-in and sign-out after the domain change because auth uses secure HTTP-only cookies.

## Important limitations

- This repo cannot be deployed to your personal Render/GitHub/Razorpay accounts from this workspace. You must authorize the services and supply your own credentials/domain.
- The Render blueprint uses the default service names and starter/basic plans; review billing and regional availability before approving.
- Do not share passwords, database URLs, JWT secrets or Razorpay secret keys in chat or commit them to GitHub.
