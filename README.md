# Masar Egypt (مسار مصر) — Smart Public Transit & Ticketing App

A full-stack mobile web application for Egypt's public transit network (**Cairo Metro Line 3**, **Electric Train / LRT**, and **New Cairo Public Bus**), featuring station-based tiered pricing, digital Masar Card wallet, automatic QR ticket generation for driver verification, and live database synchronization.

---

## How to Run the Project (For Teammates)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- [Git](https://git-scm.com/)

### Step-by-Step Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kenzyibrahim-13/masar-egypt.git
   ```

2. **Navigate into the project folder:**
   ```bash
   cd masar-egypt
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   *(or `node server.js`)*

5. **Open the application in your browser:**
   Go to: **[http://localhost:8085](http://localhost:8085)**

*(Note: The `.env` configuration file is already included in the repository for team testing, so no extra setup is required.)*

---

## Key Features
- **3 Transit Modes & Station-Count Tiered Pricing:**
  - **Metro Line 3 (`مترو الأنفاق`):** 34 stations with tiered fares:
    - `1–9` stations: **8.00 EGP**
    - `10–16` stations: **10.00 EGP**
    - `17–23` stations: **15.00 EGP**
    - `24+` stations: **20.00 EGP**
  - **Electric Train / LRT (`القطار الكهربائي`):** 14 stations with tiered fares:
    - `1–3` stations: **10.00 EGP**
    - `4–7` stations: **15.00 EGP**
    - `8+` stations: **20.00 EGP**
  - **New Cairo Public Bus (`الأتوبيس`):** 11 stations with tiered fares:
    - `1–4` stations: **10.00 EGP**
    - `5–8` stations: **15.00 EGP**
    - `9+` stations: **20.00 EGP**
- **Secure Authentication:**
  - Server-side password validation (`>= 10` characters, at least `1` uppercase letter and `1` number).
  - Password hashing using `bcrypt` (`cost factor = 12`).
- **Multiple Payment Methods:**
  - **Masar Card (`محفظة / كارت مسار`):** Deducts directly from the user's persisted Masar Card balance (`Paid`).
  - **Credit / Debit Card (`Visa` / `Mastercard` / `Meeza`):** Saves card metadata to the database and marks the ticket as `Paid`.
  - **Contactless `NFC` & `Cash`:** Registers the ticket as `Pending` until the driver scans the QR code and confirms payment.
- **Automatic Ticket QR Generation & Live Sync:**
  - Confirming a ticket automatically generates a scannable QR code on the receipt screen containing the **Ticket ID (`#MSR-...`)**, **Price**, **Route (`من ↔ إلى`)**, **Status (`PAID` vs `PENDING`)**, and **Payment Method**.
  - Any status changes in the database automatically sync live to the user's Ticket History and Receipt screens.
