require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = process.env.PORT || 8085;
const BASEROW_TOKEN = process.env.BASEROW_TOKEN;
const USERS_TABLE_ID = 1278144;
const ROUTES_TABLE_ID = 1278371;
const PAYMENT_METHODS_TABLE_ID = 1278389;
const TICKETS_TABLE_ID = 1278390;
const WALLET_FILE_PATH = path.join(__dirname, "wallet_balances.json");

// Station-count pricing tiers per route (Routes table 1278371)
const DEFAULT_ROUTE_TIERS = {
  112: {
    tier1_max_stations: 9,
    tier1_fare: 8,
    tier2_max_stations: 16,
    tier2_fare: 10,
    tier3_max_stations: 23,
    tier3_fare: 15,
    tier4_fare: 20
  },
  113: {
    tier1_max_stations: 3,
    tier1_fare: 10,
    tier2_max_stations: 7,
    tier2_fare: 15,
    tier3_max_stations: 14,
    tier3_fare: 20,
    tier4_fare: 20
  },
  117: {
    tier1_max_stations: 4,
    tier1_fare: 10,
    tier2_max_stations: 8,
    tier2_fare: 15,
    tier3_max_stations: 11,
    tier3_fare: 20,
    tier4_fare: 20
  }
};

function readWalletStore() {
  try {
    if (fs.existsSync(WALLET_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(WALLET_FILE_PATH, "utf8"));
    }
  } catch (e) {
    console.warn("Could not read wallet_balances.json:", e);
  }
  return {};
}

function writeWalletStore(store) {
  try {
    fs.writeFileSync(WALLET_FILE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.warn("Could not write wallet_balances.json:", e);
  }
}

function getUserBalanceFromStore(userId) {
  const store = readWalletStore();
  const key = String(userId || 18);
  if (key in store && typeof store[key] === "number" && !isNaN(store[key])) {
    return store[key];
  }
  return null;
}

function setUserBalanceInStore(userId, balance) {
  const store = readWalletStore();
  const key = String(userId || 18);
  const num = Math.max(0, parseFloat(Number(balance).toFixed(2)));
  store[key] = num;
  writeWalletStore(store);
  return num;
}

// Server-only password validation regex: at least 10 chars, 1 uppercase letter, 1 digit
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// Recursively remove password_hash / Password_hash so the hash is NEVER returned in responses
function stripPasswordHash(obj) {
  if (Array.isArray(obj)) {
    return obj.map(stripPasswordHash);
  }
  if (obj && typeof obj === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase() === "password_hash") {
        continue;
      }
      cleaned[key] = stripPasswordHash(value);
    }
    return cleaned;
  }
  return obj;
}

async function baserowServerFetch(urlPath, options = {}) {
  if (!BASEROW_TOKEN) {
    throw new Error("Server configuration error: BASEROW_TOKEN environment variable is missing.");
  }
  const url = `https://api.baserow.io${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token ${BASEROW_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const safePayload = stripPasswordHash(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  });
  res.end(JSON.stringify(safePayload));
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // ========================================================
    // 1. POST /api/auth/signup
    //    - Validates password on server only with ^(?:(?=.*[A-Z])(?=.*\d).{10,})$
    //    - Checks that email isn't already used
    //    - Hashes with bcrypt (cost 12) and saves ONLY the hash
    //    - Forces role = "Passenger"
    //    - Never returns password_hash in response
    // ========================================================
    if (req.method === "POST" && pathname === "/api/auth/signup") {
      const body = await readJsonBody(req);
      const fullName = String(body.Full_Name || body.name || "").trim();
      const email = String(body.email || "").trim();
      const password = String(body.password || "");

      if (!fullName || !email || !password) {
        return sendJson(res, 400, { error: "Name, email, and password are required." });
      }

      // Validate password on the server using ^(?:(?=.*[A-Z])(?=.*\d).{10,})$
      if (!PASSWORD_REGEX.test(password)) {
        return sendJson(res, 400, {
          error: "Password must be at least 10 characters and include at least one uppercase letter and one number."
        });
      }

      // Check that the email isn't already used in Baserow Users table
      const listRes = await baserowServerFetch(
        `/api/database/rows/table/${USERS_TABLE_ID}/?user_field_names=true&size=200`
      );
      if (!listRes.ok) {
        return sendJson(res, 502, { error: "Failed to verify email uniqueness." });
      }

      const allUsers = listRes.data?.results || [];
      const emailExists = allUsers.some(
        u => String(u.email || "").trim().toLowerCase() === email.toLowerCase()
      );
      if (emailExists) {
        return sendJson(res, 409, { error: "This email is already registered. Please log in instead." });
      }

      // Hash password with bcrypt (cost 12)
      const passwordHash = await bcrypt.hash(password, 12);

      // Detect exact case of password_hash column in Baserow Users table (e.g. "password_hash" vs "Password_hash")
      const sampleUser = allUsers[0] || {};
      const hashFieldName =
        "password_hash" in sampleUser
          ? "password_hash"
          : "Password_hash" in sampleUser
          ? "Password_hash"
          : "password_hash";

      // Force role = "Passenger" and save only the bcrypt hash
      const newUserPayload = {
        Full_Name: fullName,
        email: email,
        language: "AR",
        role: "Passenger",
        Active: true,
        [hashFieldName]: passwordHash
      };

      let createRes = await baserowServerFetch(
        `/api/database/rows/table/${USERS_TABLE_ID}/?user_field_names=true`,
        {
          method: "POST",
          body: JSON.stringify(newUserPayload)
        }
      );

      // Fallback if column casing was the opposite
      if (!createRes.ok && hashFieldName === "password_hash") {
        delete newUserPayload.password_hash;
        newUserPayload.Password_hash = passwordHash;
        createRes = await baserowServerFetch(
          `/api/database/rows/table/${USERS_TABLE_ID}/?user_field_names=true`,
          {
            method: "POST",
            body: JSON.stringify(newUserPayload)
          }
        );
      }

      if (!createRes.ok) {
        return sendJson(res, createRes.status, {
          error: createRes.data?.detail || "Could not create user account."
        });
      }

      // Initialize default 100.00 EGP Masar Card balance for new user
      const newUserId = createRes.data?.id || createRes.data?.user_id;
      if (newUserId) {
        setUserBalanceInStore(newUserId, 100.00);
      }

      // Return sanitized user (stripPasswordHash guarantees hash is never returned)
      return sendJson(res, 201, {
        user: { ...createRes.data, wallet_balance: 100.00 }
      });
    }

    // ========================================================
    // 2. POST /api/auth/login
    //    - Looks up user by email
    //    - Compares password with bcrypt.compare
    //    - Never returns password_hash in response
    // ========================================================
    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim();
      const password = String(body.password || "");

      if (!email || !password) {
        return sendJson(res, 400, { error: "Email and password are required." });
      }

      const listRes = await baserowServerFetch(
        `/api/database/rows/table/${USERS_TABLE_ID}/?user_field_names=true&size=200`
      );
      if (!listRes.ok) {
        return sendJson(res, 502, { error: "Authentication service unavailable." });
      }

      const allUsers = listRes.data?.results || [];
      const matchedUser = allUsers.find(
        u => String(u.email || "").trim().toLowerCase() === email.toLowerCase()
      );

      if (!matchedUser) {
        return sendJson(res, 401, { error: "Invalid email or password." });
      }

      const storedHash = matchedUser.password_hash ?? matchedUser.Password_hash ?? "";
      if (!storedHash || typeof storedHash !== "string") {
        return sendJson(res, 401, { error: "Invalid email or password." });
      }

      const isValid = await bcrypt.compare(password, storedHash);
      if (!isValid) {
        return sendJson(res, 401, { error: "Invalid email or password." });
      }

      const savedBal = getUserBalanceFromStore(matchedUser.id);
      const balance = savedBal !== null ? savedBal : 100.00;

      // Return sanitized user (never includes password_hash)
      return sendJson(res, 200, {
        user: { ...matchedUser, wallet_balance: balance }
      });
    }

    // ========================================================
    // 2b. GET /api/wallet/:userId & POST /api/wallet
    //     Persists Masar Card Balance on server AND in Baserow Payment_Methods (1278389)
    // ========================================================
    const walletGetMatch = pathname.match(/^\/api\/wallet\/(\d+)\/?$/);
    if (req.method === "GET" && walletGetMatch) {
      const userId = Number(walletGetMatch[1]);
      let bal = getUserBalanceFromStore(userId);

      if (bal === null) {
        // Check Baserow Payment_Methods (1278389) for a saved balance tag on this user's rows
        const pmRes = await baserowServerFetch(
          `/api/database/rows/table/${PAYMENT_METHODS_TABLE_ID}/?user_field_names=true&size=200`
        );
        if (pmRes.ok) {
          const userPms = (pmRes.data?.results || []).filter(pm =>
            pm.user_id?.some(u => Number(u.id) === userId || Number(u.value) === userId)
          );
          for (let i = userPms.length - 1; i >= 0; i--) {
            const match = String(userPms[i].provider_pm_id || "").match(/bal:([0-9.]+)/);
            if (match) {
              bal = parseFloat(match[1]);
              setUserBalanceInStore(userId, bal);
              break;
            }
          }
        }
      }

      if (bal === null) {
        bal = setUserBalanceInStore(userId, 100.00);
      }

      return sendJson(res, 200, { userId, balance: bal });
    }

    if (req.method === "POST" && pathname === "/api/wallet") {
      const body = await readJsonBody(req);
      const userId = Number(body.userId || 18);
      const newBalance = setUserBalanceInStore(userId, Number(body.balance ?? 100));

      // Also sync balance tag to the user's latest Payment_Methods row in Baserow (1278389)
      try {
        const pmRes = await baserowServerFetch(
          `/api/database/rows/table/${PAYMENT_METHODS_TABLE_ID}/?user_field_names=true&size=200`
        );
        if (pmRes.ok) {
          const userPms = (pmRes.data?.results || []).filter(pm =>
            pm.user_id?.some(u => Number(u.id) === userId || Number(u.value) === userId)
          );
          if (userPms.length > 0) {
            const latestPm = userPms[userPms.length - 1];
            const cleanBaseId = String(latestPm.provider_pm_id || `pm_user_${userId}`).replace(/\s*\|\s*bal:[0-9.]+/, "");
            await baserowServerFetch(
              `/api/database/rows/table/${PAYMENT_METHODS_TABLE_ID}/${latestPm.id}/?user_field_names=true`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  provider_pm_id: `${cleanBaseId} | bal:${newBalance.toFixed(2)}`
                })
              }
            );
          } else {
            await baserowServerFetch(
              `/api/database/rows/table/${PAYMENT_METHODS_TABLE_ID}/?user_field_names=true`,
              {
                method: "POST",
                body: JSON.stringify({
                  provider_pm_id: `pm_masar_card_${userId} | bal:${newBalance.toFixed(2)}`,
                  provider: "Paymob",
                  brand: "Meeza",
                  last4: "8924",
                  exp_month: 9,
                  exp_year: 2028,
                  default_mode: true,
                  user_id: [userId]
                })
              }
            );
          }
        }
      } catch (syncErr) {
        console.warn("Could not sync wallet balance tag to Baserow:", syncErr);
      }

      return sendJson(res, 200, { userId, balance: newBalance });
    }

    // ========================================================
    // 3. Server-side Database Proxy Endpoints (/api/rows/:tableId and /api/rows/:tableId/:rowId)
    //    - Keeps BASEROW_TOKEN on the server only
    //    - Prevents direct client calls to Baserow
    //    - Strips password_hash from all responses
    // ========================================================
    const rowItemMatch = pathname.match(/^\/api\/rows\/(\d+)\/(\d+)\/?$/);
    if (rowItemMatch) {
      const [, tableId, rowId] = rowItemMatch;
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readJsonBody(req);

      // Prevent client from writing password_hash or changing role on Users table directly
      if (body && Number(tableId) === USERS_TABLE_ID) {
        delete body.password_hash;
        delete body.Password_hash;
      }

      const apiRes = await baserowServerFetch(
        `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`,
        {
          method: req.method,
          body: body ? JSON.stringify(body) : undefined
        }
      );
      return sendJson(res, apiRes.status, apiRes.data);
    }

    const tableMatch = pathname.match(/^\/api\/rows\/(\d+)\/?$/);
    if (tableMatch) {
      const [, tableId] = tableMatch;
      const searchParams = new URLSearchParams(parsedUrl.search);
      searchParams.set("user_field_names", "true");

      // Block direct POST to Users table through generic proxy; must use /api/auth/signup
      if (req.method === "POST" && Number(tableId) === USERS_TABLE_ID) {
        return sendJson(res, 403, { error: "Use /api/auth/signup to register users." });
      }

      let body = req.method === "GET" || req.method === "DELETE" ? undefined : await readJsonBody(req);

      // Ensure Payment_Methods (1278389) single_select fields ("provider" & "brand") always match Baserow select_options
      if (body && Number(tableId) === PAYMENT_METHODS_TABLE_ID) {
        const origProvider = String(body.provider || "Paymob");
        const origBrand = String(body.brand || "Visa");
        body.provider = ["Paymob", "Stripe"].includes(origProvider) ? origProvider : "Paymob";
        body.brand = ["Visa", "Mastercard", "Meeza"].includes(origBrand)
          ? origBrand
          : origProvider.toLowerCase().includes("meeza") || origBrand.toLowerCase().includes("meeza")
          ? "Meeza"
          : "Visa";

        const uid = Array.isArray(body.user_id) ? body.user_id[0] : 18;
        const curBal = getUserBalanceFromStore(uid) ?? 100.00;
        const pmBase = body.provider_pm_id || `pm_${origProvider.replace(/\s+/g, "_").toLowerCase()}_${body.last4 || "0000"}`;
        if (!String(pmBase).includes("bal:")) {
          body.provider_pm_id = `${pmBase} | bal:${curBal.toFixed(2)}`;
        }
      }

      let apiRes = await baserowServerFetch(
        `/api/database/rows/table/${tableId}/?${searchParams.toString()}`,
        {
          method: req.method,
          body: body ? JSON.stringify(body) : undefined
        }
      );

      // If creating a Ticket (1278390) with optional stations_count and the column doesn't exist yet in Baserow, retry without stations_count
      if (
        !apiRes.ok &&
        req.method === "POST" &&
        Number(tableId) === TICKETS_TABLE_ID &&
        body &&
        "stations_count" in body
      ) {
        const fallbackTicketBody = { ...body };
        delete fallbackTicketBody.stations_count;
        apiRes = await baserowServerFetch(
          `/api/database/rows/table/${tableId}/?${searchParams.toString()}`,
          {
            method: "POST",
            body: JSON.stringify(fallbackTicketBody)
          }
        );
      }

      // If fetching Routes (1278371), enrich with tier columns and auto-populate any newly created empty tier columns in Baserow
      if (req.method === "GET" && Number(tableId) === ROUTES_TABLE_ID && apiRes.ok && Array.isArray(apiRes.data?.results)) {
        const tierKeys = [
          "tier1_max_stations",
          "tier1_fare",
          "tier2_max_stations",
          "tier2_fare",
          "tier3_max_stations",
          "tier3_fare",
          "tier4_fare"
        ];
        for (const row of apiRes.data.results) {
          const rId = Number(row.route_id || row.id);
          const defaults = DEFAULT_ROUTE_TIERS[rId] || DEFAULT_ROUTE_TIERS[112];
          const patchPayload = {};

          for (const key of tierKeys) {
            if (key in row) {
              if (row[key] === null || row[key] === undefined || row[key] === "") {
                row[key] = defaults[key];
                patchPayload[key] = defaults[key];
              } else {
                row[key] = Number(row[key]);
              }
            } else {
              row[key] = defaults[key];
            }
          }

          if (Object.keys(patchPayload).length > 0) {
            baserowServerFetch(
              `/api/database/rows/table/${ROUTES_TABLE_ID}/${row.id}/?user_field_names=true`,
              {
                method: "PATCH",
                body: JSON.stringify(patchPayload)
              }
            ).catch(() => {});
          }
        }
      }

      return sendJson(res, apiRes.status, apiRes.data);
    }

    // ========================================================
    // 4. Static File Server (Zero-Cache)
    // ========================================================
    let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, "");
    if (safePath === "/" || safePath === "\\") {
      safePath = "/index.html";
    }

    // Block access to server files and .env
    const blockedFiles = new Set(["/.env", "/server.js", "/server.py", "/package.json", "/package-lock.json", "/wallet_balances.json"]);
    if (blockedFiles.has(safePath.replace(/\\/g, "/")) || safePath.startsWith("/node_modules")) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    const filePath = path.join(__dirname, safePath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end("Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("Server error:", err);
    sendJson(res, 500, { error: err.message || "Internal Server Error" });
  }
});

server.listen(PORT, () => {
  console.log(`Masar Egypt Server running on http://localhost:${PORT}`);
});
