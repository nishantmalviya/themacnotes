# Notepad for macOS — sales site

Zero-dependency Node (18+) site. Download is gated server-side: `/download` needs a signed token issued only after a verified $5.00 USD payment (Stripe Checkout for cards, PayPal Orders API).

## Setup
1. `cp .env.example .env` and fill in Stripe / PayPal keys (use test/sandbox first). Set `BASE_URL` to your public URL and `TOKEN_SECRET` to a random string.
2. Put your installer at `downloads/Notepad.dmg` (never served statically).
3. Run `npm start` → http://localhost:3000. Node.js 18 or newer is required.

`npm run build` performs JavaScript syntax checks; this zero-dependency app does not require a compilation step. This also supports hosts that run a build command before startup.

## GoDaddy Node.js deployment
Use a GoDaddy hosting plan that supports Node.js applications (for example, cPanel Setup Node.js App). Set the application root to the directory containing `package.json`, choose `server.js` as the startup file, and use Node.js 18 or newer. Install dependencies with `npm install` and start/restart the app with `npm start`.

Configure `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV`, `BASE_URL` (your public HTTPS URL), and `TOKEN_SECRET` in the hosting environment. Do not deploy a local `.env` containing localhost URLs or development credentials. Ensure `downloads/Notepad.dmg` is present in the deployed app root.

The sales page uses the product screenshots in `public/images/`. The screenshots supplied for the page are copied there and shown in the editor and feature galleries.
