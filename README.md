# Masar Egypt (مسار مصر) — Smart Public Transit & Ticketing App

A full-stack mobile web application for Egypt's public transit network (**Cairo Metro Line 3**, **Electric Train / LRT**, and **New Cairo Public Bus**), featuring station-based tiered pricing, digital Masar Card wallet, QR ticket generation & driver verification, and live database synchronization.

## Features
- **3 Transit Modes & Station-Count Tiered Pricing:**
  - **Metro Line 3 (`مترو الأنفاق`):** 34 stations with tiered fares (1–9 stations: 8 EGP, 10–16: 10 EGP, 17–23: 15 EGP, 24+: 20 EGP).
  - **Electric Train / LRT (`القطار الكهربائي`):** 14 stations with tiered fares (1–3 stations: 10 EGP, 4–7: 15 EGP, 8+: 20 EGP).
  - **New Cairo Public Bus (`الأتوبيس`):** 11 stations with tiered fares (1–4 stations: 10 EGP, 5–8: 15 EGP, 9+: 20 EGP).
- **Secure Authentication:** Server-side password validation (`>= 10` characters, at least 1 uppercase letter and 1 number) and `bcrypt` hashing (cost factor 12).
- **Multiple Payment Options:** Masar Card (`محفظة / كارت مسار`), Credit/Debit Card (`Visa` / `Mastercard` / `Meeza`), Contactless `NFC`, and `Cash`.
- **Automatic Ticket QR Generation:** Generates a scannable QR code on ticket confirmation containing the Ticket Reference (`#MSR-...`), Price, Route, Payment Method, and Live Status (`Paid` vs `Pending`) for driver verification.

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and add your database token:
   ```env
   BASEROW_TOKEN=your_token_here
   PORT=8085
   ```

3. **Run the server:**
   ```bash
   node server.js
   ```
   Open `http://localhost:8085` in your browser.
