# Notepad for macOS — sales site

Zero-dependency Node (18+) site. Download is gated server-side: `/download` needs a signed token issued only after a verified $19.99 USD payment (Stripe Checkout for cards, PayPal Orders API).

## Setup
1. `cp .env.example .env` and fill in Stripe / PayPal keys (use test/sandbox first). Set `BASE_URL` to your public URL and `TOKEN_SECRET` to a random string.
2. Put your installer at `downloads/Notepad.dmg` (never served statically).
3. `node server.js` → http://localhost:3000

The sales page uses the product screenshots in `public/images/`. The screenshots supplied for the page are copied there and shown in the editor and feature galleries.
