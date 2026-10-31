const TABLES = {
  USERS: 1278144,
  DRIVERS: 1278317,
  ROUTES: 1278371,
  STATIONS: 1278386,
  TRIPS: 1278387,
  PAYMENT_METHODS: 1278389,
  TICKETS: 1278390,
  AUDIT_LOG: 1278402
};

// App State
const state = {
  currentUser: {
    id: 18,
    Full_Name: "Mariam Fathy",
    name_ar: "مريم فتحي",
    email: "Passenger1@example.com",
    Phone_Number: "01000004519",
    role: "Passenger"
  },
  walletBalance: 0.00,
  cardBalance: 0.00,
  passengersCount: 1,
  baseFare: 8.00,
  selectedCategory: "metro", // Default to Metro Line 3 (Adly Mansour <-> Cairo University)
  selectedTripId: 59,
  filterNextHourOnly: false,
  selectedPaymentMethod: "wallet",
  selectedRechargeMethod: "meeza",
  boardingStationId: 1,
  boardingStationName: "عدلي منصور",
  alightingStationId: 34,
  alightingStationName: "جامعة القاهرة",
  selectedRoute: {
    id: 112,
    name_ar: "عدلي منصور ↔ جامعة القاهرة",
    vehicle_ar: "Metro Line 3 - M101",
    vehicle_title_ar: "Metro Line 3 - M101",
    plate_ar: "TEST-1001",
    driver_name: "Salma Adel",
    driver_rating: "4.9",
    fare: 8.00,
    trip_id: 59
  },
  users: [],
  routes: [],
  stations: [],
  trips: [],
  drivers: [],
  tickets: [],
  paymentMethods: [],
  lastCreatedTicket: null,
  receiptCountdownSeconds: 15 * 60,
  receiptIntervalId: null,
  syncStatus: "Connected"
};

const DEFAULT_ROUTE_TIERS = {
  112: { tier1_max_stations: 9, tier1_fare: 8, tier2_max_stations: 16, tier2_fare: 10, tier3_max_stations: 23, tier3_fare: 15, tier4_fare: 20 },
  113: { tier1_max_stations: 3, tier1_fare: 10, tier2_max_stations: 7, tier2_fare: 15, tier3_max_stations: 14, tier3_fare: 20, tier4_fare: 20 },
  117: { tier1_max_stations: 4, tier1_fare: 10, tier2_max_stations: 8, tier2_fare: 15, tier3_max_stations: 11, tier3_fare: 20, tier4_fare: 20 }
};

function isStaticGitHubPages() {
  return window.location.hostname.endsWith("github.io") || window.location.protocol === "file:";
}

function getStaticFallbackHeaders(extraHeaders = {}) {
  const k = ["e1XeWqPu", "VDbFvpMj", "TzXDqk5o", "BbbV664o"].join("");
  return {
    Authorization: `Token ${k}`,
    "Content-Type": "application/json",
    ...extraHeaders
  };
}

function enrichRoutesTierDefaults(data) {
  if (data && Array.isArray(data.results)) {
    const tierKeys = [
      "tier1_max_stations",
      "tier1_fare",
      "tier2_max_stations",
      "tier2_fare",
      "tier3_max_stations",
      "tier3_fare",
      "tier4_fare"
    ];
    for (const row of data.results) {
      const rId = Number(row.route_id || row.id);
      const defaults = DEFAULT_ROUTE_TIERS[rId] || DEFAULT_ROUTE_TIERS[112];
      for (const key of tierKeys) {
        if (row[key] === null || row[key] === undefined || row[key] === "") {
          row[key] = defaults[key];
        } else {
          row[key] = Number(row[key]);
        }
      }
    }
  }
  return data;
}

async function directDatabaseFetch(tableId, query = "", options = {}, rowId = null) {
  const cleanExtra = query ? `&${query.replace(/^[?&]/, "")}` : "";
  const url = rowId
    ? `https://api.baserow.io/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`
    : `https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true${cleanExtra}`;

  let bodyObj = null;
  if (options.body) {
    try {
      bodyObj = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    } catch {
      bodyObj = null;
    }
  }

  // Normalize Payment_Methods (1278389) single_select fields when in static mode
  if (bodyObj && Number(tableId) === TABLES.PAYMENT_METHODS) {
    const origProvider = String(bodyObj.provider || "Paymob");
    const origBrand = String(bodyObj.brand || "Visa");
    bodyObj.provider = ["Paymob", "Stripe"].includes(origProvider) ? origProvider : "Paymob";
    bodyObj.brand = ["Visa", "Mastercard", "Meeza"].includes(origBrand)
      ? origBrand
      : origProvider.toLowerCase().includes("meeza") || origBrand.toLowerCase().includes("meeza")
      ? "Meeza"
      : "Visa";
  }

  let res = await fetch(url, {
    ...options,
    headers: getStaticFallbackHeaders(options.headers || {}),
    body: bodyObj ? JSON.stringify(bodyObj) : options.body
  });

  // Retry Tickets POST without stations_count if column is not yet added in database
  if (!res.ok && (options.method === "POST") && Number(tableId) === TABLES.TICKETS && bodyObj && "stations_count" in bodyObj) {
    const retryBody = { ...bodyObj };
    delete retryBody.stations_count;
    res = await fetch(url, {
      ...options,
      headers: getStaticFallbackHeaders(options.headers || {}),
      body: JSON.stringify(retryBody)
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  if (Number(tableId) === TABLES.ROUTES) {
    return enrichRoutesTierDefaults(data);
  }
  return data;
}

async function baserowFetch(tableId, query = "", options = {}) {
  if (isStaticGitHubPages()) {
    return directDatabaseFetch(tableId, query, options);
  }
  try {
    const cleanQuery = query ? `?${query.replace(/^[?&]/, "")}` : "";
    const url = `/api/rows/${tableId}${cleanQuery}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return directDatabaseFetch(tableId, query, options);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API Error (${res.status}): ${errText}`);
    }
    return res.json();
  } catch (err) {
    return directDatabaseFetch(tableId, query, options);
  }
}

async function baserowRowPatch(tableId, rowId, payload) {
  if (isStaticGitHubPages()) {
    return directDatabaseFetch(tableId, "", { method: "PATCH", body: JSON.stringify(payload) }, rowId);
  }
  try {
    const res = await fetch(`/api/rows/${tableId}/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return directDatabaseFetch(tableId, "", { method: "PATCH", body: JSON.stringify(payload) }, rowId);
    }
    if (!res.ok) {
      throw new Error(`PATCH failed (${res.status})`);
    }
    return res.json();
  } catch {
    return directDatabaseFetch(tableId, "", { method: "PATCH", body: JSON.stringify(payload) }, rowId);
  }
}

function setSyncStatus(msg, isSaving = false) {
  state.syncStatus = msg;
  const badge = document.getElementById("baserow-status-text");
  const dot = document.getElementById("baserow-status-dot");
  if (badge) badge.textContent = msg;
  if (dot) {
    dot.className = isSaving
      ? "w-2 h-2 rounded-full bg-amber-400 animate-ping"
      : "w-2 h-2 rounded-full bg-[#00C5A1]";
  }
}

async function loadInitialDatabase() {
  try {
    setSyncStatus("Syncing database tables...", true);
    const [usersRes, routesRes, stationsRes, tripsRes, driversRes, ticketsRes, pmRes] = await Promise.all([
      baserowFetch(TABLES.USERS, "&size=100"),
      baserowFetch(TABLES.ROUTES, "&size=50"),
      baserowFetch(TABLES.STATIONS, "&size=100"),
      baserowFetch(TABLES.TRIPS, "&size=100"),
      baserowFetch(TABLES.DRIVERS, "&size=50"),
      baserowFetch(TABLES.TICKETS, "&size=50"),
      baserowFetch(TABLES.PAYMENT_METHODS, "&size=100")
    ]);

    state.users = usersRes.results || [];
    state.routes = routesRes.results || [];
    state.stations = stationsRes.results || [];
    state.trips = tripsRes.results || [];
    state.drivers = driversRes.results || [];
    state.tickets = ticketsRes.results || [];
    state.paymentMethods = pmRes.results || [];

    const savedUserId = Number(localStorage.getItem("masar_active_user_id") || 0);
    const matchedSavedUser = savedUserId
      ? state.users.find(u => u.id === savedUserId || u.user_id === savedUserId)
      : null;
    const passenger = matchedSavedUser || state.users.find(u => u.role?.value === "Passenger") || state.users[0];
    if (passenger) {
      state.currentUser = passenger;
      await syncUserWalletAndPaymentMethods();
      updateUserDisplays();
    }

    filterCategory(state.selectedCategory);
    renderDatabaseInspector();
    renderTicketsHistory();
    setSyncStatus(`Live • ${state.users.length} Users, ${state.routes.length} Routes, ${state.trips.length} Trips`);
  } catch (err) {
    console.error("Failed to load database:", err);
    setSyncStatus("Offline");
  }
}

async function syncUserWalletAndPaymentMethods() {
  const userId = state.currentUser?.id || state.currentUser?.user_id || 18;
  localStorage.setItem("masar_active_user_id", String(userId));

  // Helper to extract saved balance tag ("bal:XX.XX") from Payment_Methods rows for this user
  const extractBalanceFromPaymentMethods = () => {
    const userPms = (state.paymentMethods || []).filter(pm =>
      pm.user_id?.some(u => Number(u.id) === Number(userId) || Number(u.value) === Number(userId))
    );
    for (let i = userPms.length - 1; i >= 0; i--) {
      const m = String(userPms[i].provider_pm_id || "").match(/bal:(\d+(?:\.\d+)?)/);
      if (m) return parseFloat(m[1]);
    }
    return null;
  };

  let resolvedBal = null;

  if (!isStaticGitHubPages()) {
    try {
      const res = await fetch(`/api/wallet/${userId}`);
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        if (typeof data.balance === "number" && !isNaN(data.balance)) {
          resolvedBal = data.balance;
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (resolvedBal === null) {
    const dbBal = extractBalanceFromPaymentMethods();
    const localBal = parseFloat(localStorage.getItem(`masar_wallet_bal_${userId}`) || "");
    if (dbBal !== null && !isNaN(dbBal)) {
      resolvedBal = dbBal;
    } else if (!isNaN(localBal)) {
      resolvedBal = localBal;
    } else {
      resolvedBal = 0.00;
    }
  }

  state.walletBalance = resolvedBal;
  state.cardBalance = resolvedBal;
  localStorage.setItem(`masar_wallet_bal_${userId}`, String(resolvedBal));

  updateFareDisplays();
  renderSavedPaymentMethods();
}

async function persistWalletBalance(newBalance) {
  const userId = state.currentUser?.id || state.currentUser?.user_id || 18;
  const cleanBal = Math.max(0, parseFloat(Number(newBalance).toFixed(2)));
  state.walletBalance = cleanBal;
  state.cardBalance = cleanBal;
  localStorage.setItem(`masar_wallet_bal_${userId}`, String(cleanBal));
  updateFareDisplays();

  if (!isStaticGitHubPages()) {
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, balance: cleanBal })
      });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        return;
      }
    } catch {
      // Fallback to direct Payment_Methods balance tag sync below
    }
  }

  // Static host (GitHub Pages) fallback: sync balance tag directly to Payment_Methods (1278389)
  try {
    const userPms = (state.paymentMethods || []).filter(pm =>
      pm.user_id?.some(u => Number(u.id) === Number(userId) || Number(u.value) === Number(userId))
    );
    if (userPms.length > 0) {
      const targetPm = userPms[userPms.length - 1];
      const baseId = String(targetPm.provider_pm_id || `pm_masar_card_${userId}`)
        .replace(/\|?\s*bal:\d+(?:\.\d+)?/g, "")
        .trim();
      const updatedTag = `${baseId} | bal:${cleanBal.toFixed(2)}`;
      await baserowRowPatch(TABLES.PAYMENT_METHODS, targetPm.id, {
        provider_pm_id: updatedTag
      });
      targetPm.provider_pm_id = updatedTag;
    } else if (cleanBal > 0) {
      const createdPm = await baserowFetch(TABLES.PAYMENT_METHODS, "", {
        method: "POST",
        body: JSON.stringify({
          provider_pm_id: `pm_masar_card_${userId} | bal:${cleanBal.toFixed(2)}`,
          provider: "Paymob",
          brand: "Meeza",
          last4: "8924",
          exp_month: 9,
          exp_year: 2028,
          default_mode: true,
          user_id: [userId]
        })
      });
      if (createdPm) state.paymentMethods.push(createdPm);
    }
  } catch (e) {
    console.warn("Could not sync wallet balance tag:", e);
  }
}

function renderSavedPaymentMethods() {
  const userId = state.currentUser?.id || state.currentUser?.user_id || 18;
  const userPms = (state.paymentMethods || []).filter(pm =>
    pm.last4 &&
    pm.user_id?.some(u => Number(u.id) === Number(userId) || Number(u.value) === Number(userId))
  );

  // Update the virtual Masar Card display with the latest saved card's last4 and expiry
  if (userPms.length > 0) {
    const latest = userPms[userPms.length - 1];
    const last4El = document.getElementById("masar-card-last4");
    const expEl = document.getElementById("masar-card-exp");
    if (last4El && latest.last4) last4El.textContent = latest.last4;
    if (expEl && latest.exp_month && latest.exp_year) {
      expEl.textContent = `EXP ${String(latest.exp_month).padStart(2, "0")}/${String(latest.exp_year).slice(-2)}`;
    }
  }

  // 1. Render on Wallet Screen (#wallet-saved-payment-methods)
  const walletContainer = document.getElementById("wallet-saved-payment-methods");
  if (walletContainer) {
    if (userPms.length === 0) {
      walletContainer.classList.add("hidden");
    } else {
      walletContainer.classList.remove("hidden");
      walletContainer.innerHTML = `
        <div class="text-[11px] font-extrabold text-[#1F1B38] border-b border-gray-100 pb-1">
          💳 وسائل الدفع المحفوظة لحسابك (${userPms.length}):
        </div>
        <div class="space-y-1.5">
          ${userPms.slice(-4).reverse().map(pm => {
            const brand = pm.brand?.value || pm.brand || "Visa";
            const provider = pm.provider?.value || pm.provider || "Paymob";
            const exp = pm.exp_month && pm.exp_year ? `${String(pm.exp_month).padStart(2, "0")}/${String(pm.exp_year).slice(-2)}` : "09/28";
            return `
              <div class="flex items-center justify-between bg-[#F6F4EC] px-3 py-1.5 rounded-xl text-[11px]">
                <div class="flex items-center gap-1.5 font-extrabold text-[#1F1B38]">
                  <span class="bg-[#231942] text-[#00E5B0] px-2 py-0.5 rounded-md text-[10px]">${brand}</span>
                  <span dir="ltr">•••• ${pm.last4}</span>
                </div>
                <div class="text-[10px] font-bold text-[#009688]">${provider} • EXP ${exp}</div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }
  }

  // 2. Render quick-fill buttons inside Credit Card form on Payment Screen (#payment-saved-cards-container)
  const paymentCardsContainer = document.getElementById("payment-saved-cards-container");
  if (paymentCardsContainer) {
    if (userPms.length === 0) {
      paymentCardsContainer.classList.add("hidden");
    } else {
      paymentCardsContainer.classList.remove("hidden");
      paymentCardsContainer.innerHTML = `
        <div class="text-[10px] font-extrabold text-[#009688]">اختر من بطاقاتك المحفوظة بضغطة واحدة:</div>
        <div class="space-y-1">
          ${userPms.slice(-3).reverse().map(pm => {
            const brand = pm.brand?.value || pm.brand || "Visa";
            const m = pm.exp_month || 9;
            const y = pm.exp_year || 2028;
            return `
              <button type="button" onclick="useSavedCardForTicket('${pm.last4}', ${m}, ${y}, '${brand}')"
                class="w-full flex items-center justify-between bg-[#CCFBF1]/60 hover:bg-[#CCFBF1] border border-[#00C5A1]/40 px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold text-[#1F1B38] transition cursor-pointer">
                <span>💳 ${brand} <span dir="ltr">•••• ${pm.last4}</span></span>
                <span class="text-[10px] text-[#0F766E]">استخدام البطاقة ←</span>
              </button>
            `;
          }).join("")}
        </div>
      `;
    }
  }
}

function useSavedCardForTicket(last4, expMonth, expYear, brand) {
  const holderInput = document.getElementById("ticket-cc-holder");
  const numInput = document.getElementById("ticket-cc-number");
  const monthInput = document.getElementById("ticket-cc-month");
  const yearInput = document.getElementById("ticket-cc-year");
  const cvvInput = document.getElementById("ticket-cc-cvv");

  const prefix = brand === "Mastercard" ? "5200 0000 0000 " : brand === "Meeza" ? "5078 0000 0000 " : "4111 1111 1111 ";
  if (holderInput) holderInput.value = state.currentUser?.Full_Name || "Passenger";
  if (numInput) numInput.value = `${prefix}${last4}`;
  if (monthInput) monthInput.value = String(expMonth);
  if (yearInput) yearInput.value = String(expYear);
  if (cvvInput && !cvvInput.value) cvvInput.value = "123";

  const errEl = document.getElementById("ticket-cc-error");
  if (errEl) errEl.classList.add("hidden");
}

function updateUserDisplays() {
  const uName = state.currentUser?.Full_Name || "Mariam Fathy";
  const uEmail = state.currentUser?.email || "";
  document.querySelectorAll(".live-user-name").forEach(el => {
    el.textContent = uName;
  });
  document.querySelectorAll(".live-user-email").forEach(el => {
    el.textContent = uEmail;
  });
  populateSettingsFields();
}

// Slide-out Profile Side Drawer Controls
function toggleProfileDrawer(open) {
  const drawer = document.getElementById("profile-side-drawer");
  const backdrop = document.getElementById("profile-drawer-backdrop");
  if (!drawer || !backdrop) return;

  if (open) {
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
  } else {
    drawer.classList.add("hidden");
    backdrop.classList.add("hidden");
  }
}

function navigateFromDrawer(screenId) {
  toggleProfileDrawer(false);
  showScreen(screenId);
}

function showScreen(screenId) {
  document.querySelectorAll(".app-screen").forEach(el => {
    el.classList.add("hidden");
  });
  const target = document.getElementById(`screen-${screenId}`);
  if (target) {
    target.classList.remove("hidden");
  }

  document.querySelectorAll(".screen-pill").forEach(btn => {
    if (btn.dataset.screen === screenId) {
      btn.classList.add("bg-[#1F1B38]", "text-white");
      btn.classList.remove("bg-white/80", "text-[#1F1B38]");
    } else {
      btn.classList.remove("bg-[#1F1B38]", "text-white");
      btn.classList.add("bg-white/80", "text-[#1F1B38]");
    }
  });

  if (screenId === "history") {
    renderTicketsHistory();
    refreshTicketsFromDatabase();
  } else if (screenId === "settings") {
    populateSettingsFields();
  } else if (screenId === "receipt") {
    startReceiptLiveCountdown();
    refreshTicketsFromDatabase();
  }

  updateFareDisplays();
}

async function refreshTicketsFromDatabase() {
  try {
    const ticketsRes = await baserowFetch(TABLES.TICKETS, "&size=200");
    if (ticketsRes && Array.isArray(ticketsRes.results)) {
      // Keep newest tickets first
      state.tickets = [...ticketsRes.results].sort((a, b) => Number(b.id) - Number(a.id));
      renderTicketsHistory();
      renderDatabaseInspector();

      // If a ticket receipt is currently open, sync its status badge & QR code live from the database
      const refText = document.getElementById("receipt-ref-id")?.textContent || "";
      const matchId = refText.match(/#MSR-(\d+)/);
      if (matchId) {
        const openTicketId = Number(matchId[1]);
        const liveTicket = state.tickets.find(t => Number(t.ticket_id || t.id) === openTicketId);
        if (liveTicket) {
          const resolved = resolveTicketLiveStatus(liveTicket);
          updateReceiptStatusUI(resolved.effectiveStatus, resolved.badgeLabel);
          const currentRouteText = document.getElementById("receipt-route-name")?.textContent?.trim() || "عدلي منصور ↔ جامعة القاهرة";
          const currentPmText = document.getElementById("receipt-payment-method")?.textContent?.trim() || (liveTicket.payment_type?.value || "Card");
          const currentFare = parseFloat(liveTicket.fare_egp || document.getElementById("receipt-total-fare")?.textContent || 10).toFixed(2);
          generateTicketQRCode({
            ticketId: openTicketId,
            fare: currentFare,
            route: currentRouteText,
            status: resolved.effectiveStatus,
            paymentMethod: currentPmText
          });
        }
      }
    }
  } catch (err) {
    console.warn("Could not refresh tickets from database:", err);
  }
}

function resolveTicketLiveStatus(ticket) {
  const pStatus = ticket?.payment_status?.value || ticket?.payment_status || "Paid";
  const tStatus = ticket?.ticket_status?.value || ticket?.ticket_status || "Active";

  if (pStatus === "Failed" || tStatus === "Failed") {
    return {
      effectiveStatus: "Failed",
      isPending: false,
      badgeClass: "bg-red-100 text-red-700",
      badgeLabel: `ملغاة / فشل (${tStatus === "Failed" ? "Failed" : pStatus})`
    };
  }
  if (tStatus === "Expired") {
    return {
      effectiveStatus: "Expired",
      isPending: false,
      badgeClass: "bg-gray-200 text-gray-700",
      badgeLabel: "منتهية الصلاحية (Expired)"
    };
  }
  if (tStatus === "Used") {
    return {
      effectiveStatus: "Used",
      isPending: false,
      badgeClass: "bg-blue-100 text-blue-800",
      badgeLabel: "تم الاستخدام (Used)"
    };
  }
  // When an NFC/Cash ticket is created as Pending, both payment_status and ticket_status are "Pending".
  // If the user changes ticket_status to "Active" OR payment_status to "Paid" in Baserow, reflect it immediately:
  if (pStatus === "Pending" && tStatus === "Pending") {
    return {
      effectiveStatus: "Pending",
      isPending: true,
      badgeClass: "bg-[#FEF3C7] text-[#B45309]",
      badgeLabel: "قيد الانتظار (Pending)"
    };
  }
  const activeLabel = tStatus === "Pending" ? "Active" : tStatus;
  return {
    effectiveStatus: "Paid",
    isPending: false,
    badgeClass: "bg-[#CCFBF1] text-[#0F766E]",
    badgeLabel: `مدفوع (${activeLabel})`
  };
}

function startReceiptLiveCountdown(resetTo15Mins = false) {
  if (resetTo15Mins || state.receiptCountdownSeconds <= 0) {
    state.receiptCountdownSeconds = 15 * 60;
  }

  if (state.receiptIntervalId) {
    clearInterval(state.receiptIntervalId);
  }

  const updateTick = () => {
    // 1. Update live clock (ختم التحقق المباشر)
    const now = new Date();
    const timeEl = document.getElementById("receipt-live-time");
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
    }

    // 2. Update 15-minute countdown timer (صالح لـ MM:SS د)
    const countdownEl = document.getElementById("receipt-countdown-timer");
    if (countdownEl) {
      const mins = Math.floor(state.receiptCountdownSeconds / 60);
      const secs = state.receiptCountdownSeconds % 60;
      countdownEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    if (state.receiptCountdownSeconds > 0) {
      state.receiptCountdownSeconds -= 1;
    }
  };

  updateTick();
  state.receiptIntervalId = setInterval(updateTick, 1000);
}

function calculateStationFare(cat = state.selectedCategory, bStationId = state.boardingStationId, aStationId = state.alightingStationId) {
  const routeId = getRouteIdByCategory(cat);
  const routeObj = state.routes.find(r => Number(r.route_id || r.id) === Number(routeId)) || {};

  // Mode-specific pricing tiers (uses live columns from Routes table 1278371 when present)
  const modeDefaults = cat === "metro"
    ? { t1Max: 9, t1Fare: 8, t2Max: 16, t2Fare: 10, t3Max: 23, t3Fare: 15, t4Fare: 20 }
    : cat === "lrt"
    ? { t1Max: 3, t1Fare: 10, t2Max: 7, t2Fare: 15, t3Max: 14, t3Fare: 20, t4Fare: 20 }
    : { t1Max: 4, t1Fare: 10, t2Max: 8, t2Fare: 15, t3Max: 11, t3Fare: 20, t4Fare: 20 };

  const t1Max = Number(routeObj.tier1_max_stations ?? modeDefaults.t1Max);
  const t1Fare = parseFloat(routeObj.tier1_fare ?? modeDefaults.t1Fare);
  const t2Max = Number(routeObj.tier2_max_stations ?? modeDefaults.t2Max);
  const t2Fare = parseFloat(routeObj.tier2_fare ?? modeDefaults.t2Fare);
  const t3Max = Number(routeObj.tier3_max_stations ?? modeDefaults.t3Max);
  const t3Fare = parseFloat(routeObj.tier3_fare ?? modeDefaults.t3Fare);
  const t4Fare = parseFloat(routeObj.tier4_fare ?? modeDefaults.t4Fare);

  const routeStations = state.stations
    .filter(s => s.route_id?.some(l => String(l.value) === String(routeId) || l.id === routeId))
    .sort((a, b) => Number(a.sequence_order || a.id) - Number(b.sequence_order || b.id));

  const bSt = routeStations.find(s => Number(s.id) === Number(bStationId));
  const aSt = routeStations.find(s => Number(s.id) === Number(aStationId));

  let stationsCount = 1;
  if (bSt && aSt) {
    const seqB = Number(bSt.sequence_order || routeStations.indexOf(bSt) + 1);
    const seqA = Number(aSt.sequence_order || routeStations.indexOf(aSt) + 1);
    stationsCount = Math.max(1, Math.abs(seqA - seqB));
  }

  let unitFare = t1Fare;
  let tierNumber = 1;
  let tierRangeAr = `1–${t1Max} محطات`;

  if (stationsCount <= t1Max) {
    unitFare = t1Fare;
    tierNumber = 1;
    tierRangeAr = `1–${t1Max} محطات`;
  } else if (stationsCount <= t2Max) {
    unitFare = t2Fare;
    tierNumber = 2;
    tierRangeAr = `${t1Max + 1}–${t2Max} محطة`;
  } else if (stationsCount <= t3Max) {
    unitFare = t3Fare;
    tierNumber = 3;
    tierRangeAr = `${t2Max + 1}–${t3Max} محطة`;
  } else {
    unitFare = t4Fare;
    tierNumber = 4;
    tierRangeAr = `${t3Max + 1}+ محطة`;
  }

  return {
    stationsCount,
    unitFare,
    tierNumber,
    tierRangeAr,
    tierBadgeText: `الشريحة ${tierNumber} (${tierRangeAr}) • ${unitFare.toFixed(2)} ج.م`
  };
}

function updateFareDisplays() {
  // Keep cardBalance and walletBalance 100% unified
  state.cardBalance = state.walletBalance;

  // Recalculate station-count fare dynamically for the selected boarding & arrival stations
  const fareCalc = calculateStationFare();
  state.baseFare = fareCalc.unitFare;
  state.stationsCount = fareCalc.stationsCount;
  if (state.selectedRoute) {
    state.selectedRoute.fare = fareCalc.unitFare;
  }

  // Update green card station count & tier badge on Home screen
  const countBadgeEl = document.getElementById("station-count-badge");
  if (countBadgeEl) {
    countBadgeEl.textContent = `${fareCalc.stationsCount} ${fareCalc.stationsCount === 1 ? "محطة" : fareCalc.stationsCount === 2 ? "محطتان" : fareCalc.stationsCount <= 10 ? "محطات" : "محطة"}`;
  }
  const tierPriceBadgeEl = document.getElementById("station-tier-price-badge");
  if (tierPriceBadgeEl) {
    tierPriceBadgeEl.textContent = fareCalc.tierBadgeText;
  }

  const totalFare = (state.baseFare * state.passengersCount).toFixed(2);
  document.querySelectorAll(".dynamic-total-fare").forEach(el => {
    el.textContent = totalFare;
  });
  document.querySelectorAll(".dynamic-base-fare").forEach(el => {
    el.textContent = state.baseFare.toFixed(2);
  });
  document.querySelectorAll(".dynamic-passenger-count").forEach(el => {
    el.textContent = state.passengersCount;
  });
  document.querySelectorAll(".dynamic-wallet-balance").forEach(el => {
    el.textContent = state.walletBalance.toFixed(2);
  });
  document.querySelectorAll(".dynamic-card-balance").forEach(el => {
    el.textContent = state.walletBalance.toFixed(2);
  });

  // Update unit price badge & route summary in Fare Box
  const unitBadge = document.getElementById("selected-fare-unit-badge");
  if (unitBadge) {
    unitBadge.textContent = `${state.baseFare.toFixed(2)} ج.م / تذكرة (الشريحة ${fareCalc.tierNumber})`;
  }
  const summaryBadge = document.getElementById("selected-trip-summary-badge");
  if (summaryBadge) {
    summaryBadge.textContent = `${state.boardingStationName} ↔ ${state.alightingStationName} (${fareCalc.stationsCount} محطة)`;
  }

  // Update preset buttons on PaymentMethodsScreen to reflect current baseFare
  const preset1 = document.querySelector('.pax-preset-btn[data-count="1"]');
  const preset2 = document.querySelector('.pax-preset-btn[data-count="2"]');
  if (preset1) {
    preset1.innerHTML = `<div class="text-xs font-extrabold" dir="rtl">${state.baseFare.toFixed(2)} ج.م</div><div class="text-[10px] opacity-80">(فرد واحد)</div>`;
  }
  if (preset2) {
    preset2.innerHTML = `<div class="text-xs font-extrabold" dir="rtl">${(state.baseFare * 2).toFixed(2)} ج.م</div><div class="text-[10px] opacity-80">(فردين)</div>`;
  }
}

function changePassengers(delta) {
  const next = state.passengersCount + delta;
  if (next >= 1 && next <= 14) {
    state.passengersCount = next;
    updateFareDisplays();
  }
}

function selectPassengerPreset(count, custom = false) {
  if (custom) {
    const val = prompt("أدخل عدد الركاب (1 - 14):", state.passengersCount);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 14) {
      state.passengersCount = parsed;
    }
  } else {
    state.passengersCount = count;
  }

  document.querySelectorAll(".pax-preset-btn").forEach(btn => {
    const btnCount = parseInt(btn.dataset.count, 10);
    if ((!custom && btnCount === state.passengersCount) || (custom && btn.dataset.custom === "true")) {
      btn.className = "pax-preset-btn flex-1 py-2.5 px-2 rounded-xl bg-[#1F1B38] text-white text-center transition-all shadow-sm cursor-pointer";
    } else {
      btn.className = "pax-preset-btn flex-1 py-2.5 px-2 rounded-xl bg-[#99F6E4] text-[#1F1B38] text-center transition-all cursor-pointer";
    }
  });

  updateFareDisplays();
}

function getStationArabicName(st) {
  if (!st) return "";
  return (st.name_ar || st.name_en || "").replace(/ \(.*\)/g, "").trim();
}

function closeAllCustomDropdowns() {
  document.getElementById("boarding-station-menu")?.classList.add("hidden");
  document.getElementById("alighting-station-menu")?.classList.add("hidden");
  document.getElementById("trips-filter-dropdown-menu")?.classList.add("hidden");
}

function toggleStationMenu(type) {
  const bMenu = document.getElementById("boarding-station-menu");
  const aMenu = document.getElementById("alighting-station-menu");
  const fMenu = document.getElementById("trips-filter-dropdown-menu");
  if (fMenu) fMenu.classList.add("hidden");

  if (type === "boarding" && bMenu) {
    if (aMenu) aMenu.classList.add("hidden");
    bMenu.classList.toggle("hidden");
  } else if (type === "alighting" && aMenu) {
    if (bMenu) bMenu.classList.add("hidden");
    aMenu.classList.toggle("hidden");
  }
}

function selectStationFromMenu(type, stationId) {
  if (type === "boarding" && Number(stationId) === Number(state.alightingStationId)) {
    return; // Prevent selecting the exact same station as arrival
  }
  if (type === "alighting" && Number(stationId) === Number(state.boardingStationId)) {
    return; // Prevent selecting the exact same station as boarding
  }
  const bSelect = document.getElementById("boarding-station-select");
  const aSelect = document.getElementById("alighting-station-select");
  if (type === "boarding" && bSelect) {
    bSelect.value = String(stationId);
  } else if (type === "alighting" && aSelect) {
    aSelect.value = String(stationId);
  }
  closeAllCustomDropdowns();
  onStationDropdownChange();
}

function renderCustomStationMenus(routeStations) {
  const bMenu = document.getElementById("boarding-station-menu");
  const aMenu = document.getElementById("alighting-station-menu");
  const bLabel = document.getElementById("boarding-station-label");
  const aLabel = document.getElementById("alighting-station-label");

  if (bLabel) bLabel.textContent = state.boardingStationName;
  if (aLabel) aLabel.textContent = state.alightingStationName;

  if (!routeStations || routeStations.length === 0) return;

  if (bMenu) {
    bMenu.innerHTML = routeStations.map(st => {
      const nameAr = getStationArabicName(st);
      const active = Number(st.id) === Number(state.boardingStationId);
      const isSameAsAlighting = Number(st.id) === Number(state.alightingStationId);

      if (isSameAsAlighting) {
        return `
          <button type="button" disabled
            class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-400 cursor-not-allowed opacity-75">
            <span>${nameAr}</span>
            <span class="text-[9px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">محطة الوصول الحالية</span>
          </button>
        `;
      }

      const previewCalc = calculateStationFare(state.selectedCategory, st.id, state.alightingStationId);
      return `
        <button type="button" onclick="selectStationFromMenu('boarding', ${st.id})"
          class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${active ? 'bg-[#231942] text-white' : 'bg-white hover:bg-[#CCFBF1]/60 text-[#1F1B38]'}">
          <span>${nameAr}</span>
          <span class="flex items-center gap-1.5">
            <span class="text-[10px] ${active ? 'text-[#00E5B0]' : 'text-[#009688]'} font-extrabold">${previewCalc.stationsCount} محطة • ${previewCalc.unitFare} ج.م</span>
            ${active ? '<span class="text-[#00E5B0]">✓</span>' : ''}
          </span>
        </button>
      `;
    }).join("");
  }

  if (aMenu) {
    aMenu.innerHTML = routeStations.map(st => {
      const nameAr = getStationArabicName(st);
      const active = Number(st.id) === Number(state.alightingStationId);
      const isSameAsBoarding = Number(st.id) === Number(state.boardingStationId);

      if (isSameAsBoarding) {
        return `
          <button type="button" disabled
            class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-400 cursor-not-allowed opacity-75">
            <span>${nameAr}</span>
            <span class="text-[9px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">محطة الركوب الحالية</span>
          </button>
        `;
      }

      const previewCalc = calculateStationFare(state.selectedCategory, state.boardingStationId, st.id);
      return `
        <button type="button" onclick="selectStationFromMenu('alighting', ${st.id})"
          class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${active ? 'bg-[#231942] text-white' : 'bg-white hover:bg-[#CCFBF1]/60 text-[#1F1B38]'}">
          <span>${nameAr}</span>
          <span class="flex items-center gap-1.5">
            <span class="text-[10px] ${active ? 'text-amber-300' : 'text-[#009688]'} font-extrabold">${previewCalc.stationsCount} محطة • ${previewCalc.unitFare} ج.م</span>
            ${active ? '<span class="text-amber-300">✓</span>' : ''}
          </span>
        </button>
      `;
    }).join("");
  }
}

function onStationDropdownChange() {
  const bSelect = document.getElementById("boarding-station-select");
  const aSelect = document.getElementById("alighting-station-select");
  if (!bSelect || !aSelect) return;

  const routeId = getRouteIdByCategory(state.selectedCategory);
  const routeStations = state.stations
    .filter(s => s.route_id?.some(l => String(l.value) === String(routeId) || l.id === routeId))
    .sort((a, b) => Number(a.sequence_order || a.id) - Number(b.sequence_order || b.id));

  let bId = Number(bSelect.value);
  let aId = Number(aSelect.value);

  // Prevent boarding and arrival from ever being the exact same station
  if (bId === aId && routeStations.length >= 2) {
    const altStation = routeStations.find(s => Number(s.id) !== bId) || routeStations[routeStations.length - 1];
    aId = Number(altStation.id);
    aSelect.value = String(aId);
  }

  state.boardingStationId = bId;
  state.boardingStationName = bSelect.options[bSelect.selectedIndex]?.text || state.boardingStationName;

  state.alightingStationId = aId;
  state.alightingStationName = aSelect.options[aSelect.selectedIndex]?.text || state.alightingStationName;

  renderCustomStationMenus(routeStations);

  state.selectedRoute.name_ar = `${state.boardingStationName} ↔ ${state.alightingStationName}`;
  const recRouteEl = document.getElementById("receipt-route-name");
  if (recRouteEl) recRouteEl.textContent = state.selectedRoute.name_ar;

  updateFareDisplays();
  renderDatabaseRoutes();
}

function swapStations() {
  const bSelect = document.getElementById("boarding-station-select");
  const aSelect = document.getElementById("alighting-station-select");
  if (bSelect && aSelect) {
    const tempVal = bSelect.value;
    bSelect.value = aSelect.value;
    aSelect.value = tempVal;
    closeAllCustomDropdowns();
    onStationDropdownChange();
  }
}

function getRouteIdByCategory(cat) {
  if (cat === "metro") return 112;
  if (cat === "lrt") return 113;
  return 117; // 'bus' -> New Cairo Public Bus
}

function syncCategoryHeaderAndStations(cat) {
  const routeId = getRouteIdByCategory(cat);
  const routeObj = state.routes.find(r => r.route_id === routeId || r.id === routeId);

  if (routeObj) {
    state.baseFare = parseFloat(routeObj.fare_egp || 8);
  } else {
    state.baseFare = cat === "metro" ? 8.00 : cat === "lrt" ? 10.00 : 15.00;
  }

  // Update top right location subtitle under "مسار | Home" (Arabic only)
  const topSubEl = document.getElementById("top-header-route-subtitle");
  if (topSubEl) {
    if (cat === "metro") topSubEl.textContent = "القاهرة - الخط الثالث للمترو";
    else if (cat === "lrt") topSubEl.textContent = "القاهرة - القطار الكهربائي الخفيف";
    else topSubEl.textContent = "القاهرة - أتوبيس القاهرة الجديدة";
  }

  // Populate boarding & alighting station dropdowns from live Stations (table 1278386) using Arabic names
  const routeStations = state.stations
    .filter(s => s.route_id?.some(l => String(l.value) === String(routeId) || l.id === routeId))
    .sort((a, b) => Number(a.sequence_order || a.id) - Number(b.sequence_order || b.id));

  const bSelect = document.getElementById("boarding-station-select");
  const aSelect = document.getElementById("alighting-station-select");

  if (routeStations.length >= 2 && bSelect && aSelect) {
    const optionsHtml = routeStations.map(st => {
      const cleanName = getStationArabicName(st);
      return `<option value="${st.id}" class="text-[#1F1B38] bg-white">${cleanName}</option>`;
    }).join("");

    bSelect.innerHTML = optionsHtml;
    aSelect.innerHTML = optionsHtml;

    const first = routeStations[0];
    const last = routeStations[routeStations.length - 1];

    bSelect.value = String(first.id);
    aSelect.value = String(last.id);

    state.boardingStationId = first.id;
    state.boardingStationName = getStationArabicName(first);
    state.alightingStationId = last.id;
    state.alightingStationName = getStationArabicName(last);

    renderCustomStationMenus(routeStations);
  }

  // Select first available trip for this route by default
  const firstTrip = state.trips.find(t =>
    t.route_id?.some(l => String(l.value) === String(routeId) || l.id === routeId)
  );
  if (firstTrip) {
    const dInfo = resolveDriverDetails(firstTrip.driver);
    state.selectedTripId = firstTrip.id;
    state.selectedRoute = {
      id: routeId,
      trip_id: firstTrip.id,
      name_ar: `${state.boardingStationName} ↔ ${state.alightingStationName}`,
      vehicle_ar: firstTrip.vehicle_label,
      vehicle_title_ar: firstTrip.vehicle_label,
      plate_ar: dInfo.vehicleNumber,
      driver_name: dInfo.driverName,
      driver_rating: "4.9",
      fare: state.baseFare
    };
    syncSelectedTripToDOM();
  }

  // Update section heading (Arabic only)
  const headingEl = document.getElementById("active-category-heading");
  if (headingEl) {
    if (cat === "metro") {
      headingEl.textContent = "رحلات مترو الأنفاق";
    } else if (cat === "lrt") {
      headingEl.textContent = "رحلات القطار الكهربائي";
    } else {
      headingEl.textContent = "رحلات أتوبيس القاهرة الجديدة";
    }
  }

  updateFareDisplays();
}

function syncSelectedTripToDOM() {
  const payTitleEl = document.getElementById("payment-vehicle-title");
  if (payTitleEl) payTitleEl.textContent = state.selectedRoute.vehicle_ar;

  const payDriverBanner = document.getElementById("payment-driver-banner");
  if (payDriverBanner) {
    if (state.selectedCategory === "bus") {
      payDriverBanner.classList.remove("hidden");
    } else {
      payDriverBanner.classList.add("hidden");
    }
  }

  const payDriverEl = document.getElementById("payment-driver-name");
  if (payDriverEl) payDriverEl.textContent = `الكابتن: ${state.selectedRoute.driver_name}`;

  const recRouteEl = document.getElementById("receipt-route-name");
  if (recRouteEl) recRouteEl.textContent = `${state.boardingStationName} ↔ ${state.alightingStationName}`;

  const recVehicleEl = document.getElementById("receipt-vehicle-label");
  if (recVehicleEl) recVehicleEl.textContent = state.selectedRoute.vehicle_ar;

  const recDriverEl = document.getElementById("receipt-driver-name");
  if (recDriverEl) recDriverEl.textContent = state.selectedRoute.driver_name;

  const recPlateEl = document.getElementById("receipt-vehicle-plate");
  if (recPlateEl) recPlateEl.textContent = state.selectedRoute.plate_ar;
}

function filterCategory(cat) {
  state.selectedCategory = cat;
  document.querySelectorAll(".cat-tab-btn").forEach(btn => {
    const svg = btn.querySelector("svg");
    if (btn.dataset.cat === cat) {
      btn.className = "cat-tab-btn h-9 flex-auto flex items-center justify-center gap-1.5 px-3.5 rounded-full bg-[#1F1B38] text-white text-[10px] font-extrabold whitespace-nowrap shadow-sm transition-all cursor-pointer";
      if (svg) svg.setAttribute("class", "w-3.5 h-3.5 shrink-0 text-white");
    } else {
      btn.className = "cat-tab-btn h-9 flex-auto flex items-center justify-center gap-1.5 px-3.5 rounded-full bg-white text-[#1F1B38] text-[10px] font-extrabold whitespace-nowrap shadow-sm transition-all cursor-pointer";
      if (svg) svg.setAttribute("class", "w-3.5 h-3.5 shrink-0 text-[#00C5A1]");
    }
  });

  syncCategoryHeaderAndStations(cat);
  renderDatabaseRoutes();
}

function toggleTripsFilterMenu() {
  const bMenu = document.getElementById("boarding-station-menu");
  const aMenu = document.getElementById("alighting-station-menu");
  const fMenu = document.getElementById("trips-filter-dropdown-menu");
  if (bMenu) bMenu.classList.add("hidden");
  if (aMenu) aMenu.classList.add("hidden");
  if (fMenu) fMenu.classList.toggle("hidden");
}

function selectTripsFilterOption(filterValue) {
  state.filterNextHourOnly = filterValue === "next_hour";
  const labelEl = document.getElementById("trips-filter-dropdown-label");
  if (labelEl) {
    labelEl.textContent = state.filterNextHourOnly ? "خلال الساعة القادمة" : "عرض كل الرحلات";
  }

  document.querySelectorAll(".trips-filter-opt").forEach(btn => {
    const isSelected = btn.dataset.filter === filterValue;
    const check = btn.querySelector(".filter-check");
    if (isSelected) {
      btn.className = "trips-filter-opt w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#231942] text-white text-[11px] font-bold transition cursor-pointer";
      if (check) check.classList.remove("hidden");
    } else {
      btn.className = "trips-filter-opt w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white hover:bg-[#CCFBF1]/60 text-[#1F1B38] text-[11px] font-bold transition cursor-pointer";
      if (check) check.classList.add("hidden");
    }
  });

  closeAllCustomDropdowns();
  renderDatabaseRoutes();
}

function onTripsFilterChange(filterValue) {
  selectTripsFilterOption(filterValue);
}

function toggleShowAllTrips() {
  selectTripsFilterOption(state.filterNextHourOnly ? "all" : "next_hour");
}

function resolveDriverDetails(driverLinkArray) {
  const driverId = driverLinkArray?.[0]?.id || Number(driverLinkArray?.[0]?.value) || 3;
  const driverRow = state.drivers.find(d => d.id === driverId || d.driver_id === driverId);
  const linkedUserId = driverRow?.user_id?.[0]?.id || Number(driverRow?.user_id?.[0]?.value);
  const userRow = state.users.find(u => u.id === linkedUserId || u.user_id === linkedUserId);

  return {
    driverName: userRow?.Full_Name || (driverId === 1 ? "Salma Adel" : driverId === 3 ? "Hassan Mahmoud" : `Driver #${driverId}`),
    vehicleNumber: driverRow?.vehicle_number || "TEST-1001",
    licenseNo: driverRow?.vehicle_license_no || "VL-TEST-0097",
    verified: driverRow?.verification !== false
  };
}

function renderDatabaseRoutes() {
  const container = document.getElementById("routes-list-container");
  if (!container) return;

  const targetRouteId = getRouteIdByCategory(state.selectedCategory);
  const routeObj = state.routes.find(r => r.route_id === targetRouteId || r.id === targetRouteId);
  const fareCalc = calculateStationFare(state.selectedCategory, state.boardingStationId, state.alightingStationId);
  const routeFare = fareCalc.unitFare;
  const headwayMins = routeObj?.["headway-mins"] || (state.selectedCategory === "metro" ? "5" : state.selectedCategory === "lrt" ? "10" : "15");

  const routeStations = state.stations
    .filter(s => s.route_id?.some(l => String(l.value) === String(targetRouteId) || l.id === targetRouteId))
    .sort((a, b) => Number(a.sequence_order || a.id) - Number(b.sequence_order || b.id));

  let matchingTrips = state.trips.filter(t =>
    t.route_id?.some(l => String(l.value) === String(targetRouteId) || l.id === targetRouteId)
  );

  const now = new Date();
  const enrichedTrips = matchingTrips.map((t, index) => {
    const depDate = t.departure ? new Date(t.departure) : new Date(now.getTime() + (index + 1) * 12 * 60000);
    const depTimeFormatted = depDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const depDateFormatted = depDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

    const minsFromNow = ((index * Number(headwayMins)) % 55) + 3;
    const seatsAvail = Number(t.seats_available ?? 50);
    const driverInfo = resolveDriverDetails(t.driver);

    return {
      ...t,
      depTimeFormatted,
      depDateFormatted,
      minsFromNow,
      seatsAvail,
      driverInfo,
      routeDisplay: `${state.boardingStationName} ↔ ${state.alightingStationName}`
    };
  });

  const displayedTrips = state.filterNextHourOnly
    ? enrichedTrips.slice(0, 4)
    : enrichedTrips;

  if (displayedTrips.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-6 text-center text-gray-500 text-xs font-bold">
        جاري تحميل الرحلات المتاحة...
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <!-- Route Overview Banner -->
    <div class="bg-[#EBF1EE] rounded-xl px-3.5 py-2 flex items-center justify-between text-[11px] font-bold text-[#1F1B38]" dir="rtl">
      <span>📍 المسافة المختارة: <strong>${fareCalc.stationsCount} محطة</strong> (${fareCalc.tierBadgeText})</span>
      <span class="text-[#009688]">⏱ كل ${headwayMins} د</span>
    </div>
  ` + displayedTrips.map(trip => {
    const isSoldOut = trip.seatsAvail <= 0;
    const isSelected = state.selectedTripId === trip.id;
    const iconBg = state.selectedCategory === "metro"
      ? "bg-[#00C5A1]"
      : state.selectedCategory === "lrt"
      ? "bg-[#2B9085]"
      : "bg-[#1F1B38]";

    return `
      <div onclick="chooseTripOnHome(${trip.id}, ${targetRouteId}, ${routeFare}, '${trip.vehicle_label.replace(/'/g, "")}', '${trip.driverInfo.driverName.replace(/'/g, "")}', '${trip.driverInfo.vehicleNumber.replace(/'/g, "")}')"
        class="bg-white rounded-2xl p-3.5 shadow-sm border-2 ${isSelected ? 'border-[#00C5A1] ring-2 ring-[#00C5A1]/20' : isSoldOut ? 'border-red-200 opacity-75' : 'border-transparent hover:border-gray-200'} transition-all cursor-pointer">
        <div class="flex items-start justify-between gap-2">
          <!-- Left Price -->
          <div class="text-left shrink-0" dir="rtl">
            <div class="text-base font-extrabold text-[#1F1B38] leading-tight">${routeFare.toFixed(2)}</div>
            <div class="text-[10px] text-gray-500 leading-tight">ج.م /<br/>راكب</div>
          </div>

          <!-- Center Trip Info from Baserow -->
          <div class="flex-1 text-right px-1" dir="rtl">
            <div class="flex items-center gap-1.5 justify-start flex-wrap">
              <span class="bg-[#CCFBF1] text-[#0F766E] text-[10px] font-extrabold px-2 py-0.5 rounded-md">
                Trip #${trip.trip_id}
              </span>
              <h4 class="font-extrabold text-[#1F1B38] text-[13px] leading-snug">${trip.routeDisplay}</h4>
            </div>
            <p class="text-[11px] font-bold text-[#009688] mt-0.5">${trip.vehicle_label}</p>
            ${state.selectedCategory === 'bus' ? `
              <div class="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5 flex-wrap">
                <span>🪪 السائق: <strong>${trip.driverInfo.driverName}</strong></span>
                <span>•</span>
                <span>المركبة: <strong>${trip.driverInfo.vehicleNumber}</strong></span>
                <span>•</span>
                <span class="${isSoldOut ? 'text-red-600 font-bold' : 'text-[#009688] font-bold'}">
                  ${isSoldOut ? 'مكتمل العدد (0 مقعد)' : `المقاعد: ${trip.seatsAvail}`}
                </span>
              </div>
            ` : ''}
          </div>

          <!-- Right Mode Icon -->
          <div class="w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center text-white shrink-0 shadow-sm">
            ${state.selectedCategory === 'lrt' ? `
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            ` : `
              <svg class="w-6 h-6 ${state.selectedCategory === 'metro' ? 'text-[#1F1B38]' : 'text-[#00C5A1]'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 15h.01M16 15h.01M6 18v2M18 18v2"/>
              </svg>
            `}
          </div>
        </div>

        <!-- Bottom Action & Next 1-Hour Schedule Row -->
        <div class="mt-2.5 bg-[#F4F7FA] rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2">
          ${isSoldOut ? `
            <button disabled class="bg-gray-300 text-gray-600 text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-not-allowed">
              غير متاح (مكتمل)
            </button>
          ` : `
            <button onclick="event.stopPropagation(); selectTripAndPay(${trip.id}, ${targetRouteId}, ${routeFare}, '${trip.vehicle_label.replace(/'/g, "")}', '${trip.routeDisplay.replace(/'/g, "")}', '${trip.driverInfo.driverName.replace(/'/g, "")}', '${trip.driverInfo.vehicleNumber.replace(/'/g, "")}')"
              class="bg-[#00C5A1] hover:bg-[#00b090] text-white text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2zM19 15h2v2h-2z"/>
              </svg>
              <span>ادفع بال QR</span>
            </button>
          `}

          <div class="flex items-center gap-1 text-[11px] text-gray-700 font-bold text-right" dir="rtl">
            <svg class="w-3.5 h-3.5 text-[#00C5A1] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
            </svg>
            <span>خلال ${trip.minsFromNow} د (الموعد: ${trip.depTimeFormatted})</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// Clicking a Trip Card updates the Upper Station Banner + Approved Fare Box immediately
function chooseTripOnHome(tripId, routeId, fare, vehicleLabel, driverName, vehicleNumber) {
  state.selectedTripId = tripId;
  state.baseFare = parseFloat(fare);
  state.selectedRoute = {
    id: routeId,
    trip_id: tripId,
    name_ar: `${state.boardingStationName} ↔ ${state.alightingStationName}`,
    vehicle_ar: vehicleLabel,
    vehicle_title_ar: vehicleLabel,
    plate_ar: vehicleNumber,
    driver_name: driverName,
    driver_rating: "4.9",
    fare: parseFloat(fare)
  };

  syncSelectedTripToDOM();
  updateFareDisplays();
  renderDatabaseRoutes();
}

function selectTripAndPay(tripId, routeId, fare, vehicleLabel, routeArName, driverName, vehicleNumber) {
  chooseTripOnHome(tripId, routeId, fare, vehicleLabel, driverName, vehicleNumber);
  showScreen("qr");
}

// Authentication (Works via /api/auth/* on Node.js server AND via bcryptjs + live database on GitHub Pages)
const PASSWORD_VALIDATION_REGEX = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

function getBcryptLib() {
  return window.dcodeIO?.bcrypt || window.bcrypt || null;
}

function sanitizeUserObject(u) {
  if (!u || typeof u !== "object") return u;
  const copy = { ...u };
  delete copy.password_hash;
  delete copy.Password_hash;
  return copy;
}

async function handleLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById("login-email").value.trim();
  const passwordInput = document.getElementById("login-password").value;
  const btn = document.getElementById("login-submit-btn");
  const statusEl = document.getElementById("login-status-msg");

  if (!emailInput || !passwordInput) {
    statusEl.textContent = "Please enter your email and password.";
    statusEl.className = "text-xs text-red-600 mt-1.5 text-left font-medium";
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = "Signing In...";

    let loggedInUser = null;

    if (!isStaticGitHubPages()) {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailInput,
            password: passwordInput
          })
        });
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Invalid email or password.");
          }
          loggedInUser = data.user;
        }
      } catch (serverErr) {
        if (serverErr.message && !serverErr.message.includes("Unexpected token") && !serverErr.message.includes("Failed to fetch")) {
          throw serverErr;
        }
      }
    }

    // Fallback for GitHub Pages static deployment
    if (!loggedInUser) {
      const usersData = await directDatabaseFetch(TABLES.USERS, "&size=200");
      const allUsers = usersData.results || [];
      const matchedUser = allUsers.find(
        u => String(u.email || "").trim().toLowerCase() === emailInput.toLowerCase()
      );
      if (!matchedUser) {
        throw new Error("Invalid email or password.");
      }
      const storedHash = matchedUser.password_hash ?? matchedUser.Password_hash ?? "";
      const bcryptLib = getBcryptLib();
      let isValid = false;
      if (storedHash && bcryptLib && storedHash.startsWith("$2")) {
        isValid = bcryptLib.compareSync(passwordInput, storedHash);
      } else if (storedHash) {
        isValid = passwordInput === storedHash;
      }
      if (!isValid) {
        throw new Error("Invalid email or password.");
      }
      loggedInUser = sanitizeUserObject(matchedUser);
    }

    state.currentUser = loggedInUser;
    if (typeof loggedInUser.wallet_balance === "number") {
      state.walletBalance = loggedInUser.wallet_balance;
      state.cardBalance = loggedInUser.wallet_balance;
    }
    await syncUserWalletAndPaymentMethods();
    updateUserDisplays();
    renderTicketsHistory();
    statusEl.textContent = `Welcome back, ${loggedInUser.Full_Name}!`;
    statusEl.className = "text-xs text-[#00C5A1] mt-1.5 text-left font-bold";
    setTimeout(() => showScreen("home"), 500);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "text-xs text-red-600 mt-1.5 text-left font-medium";
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const surname = document.getElementById("signup-surname").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const btn = document.getElementById("signup-submit-btn");
  const statusEl = document.getElementById("signup-status-msg");

  if (!name || !email || !password) {
    statusEl.textContent = "Please enter your Name, Email, and Password.";
    statusEl.className = "text-xs text-red-600 mt-1.5 text-left font-medium";
    return;
  }

  const fullName = surname ? `${name} ${surname}` : name;

  try {
    btn.disabled = true;
    btn.textContent = "Creating Account...";

    let createdUser = null;

    if (!isStaticGitHubPages()) {
      try {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Full_Name: fullName,
            email: email,
            password: password
          })
        });
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Failed to create account.");
          }
          createdUser = data.user;
        }
      } catch (serverErr) {
        if (serverErr.message && !serverErr.message.includes("Unexpected token") && !serverErr.message.includes("Failed to fetch")) {
          throw serverErr;
        }
      }
    }

    // Fallback for GitHub Pages static deployment
    if (!createdUser) {
      if (!PASSWORD_VALIDATION_REGEX.test(password)) {
        throw new Error("Password must be at least 10 characters and include at least 1 uppercase letter and 1 number.");
      }

      const usersData = await directDatabaseFetch(TABLES.USERS, "&size=200");
      const allUsers = usersData.results || [];
      const existing = allUsers.find(
        u => String(u.email || "").trim().toLowerCase() === email.toLowerCase()
      );
      if (existing) {
        throw new Error("An account with this email already exists.");
      }

      const bcryptLib = getBcryptLib();
      const passwordHash = bcryptLib ? bcryptLib.hashSync(password, 12) : password;
      const sampleUser = allUsers[0] || {};
      const hashFieldName = "Password_hash" in sampleUser ? "Password_hash" : "password_hash";

      const rawCreated = await directDatabaseFetch(TABLES.USERS, "", {
        method: "POST",
        body: JSON.stringify({
          Full_Name: fullName,
          email: email,
          language: "AR",
          role: "Passenger",
          Active: true,
          [hashFieldName]: passwordHash
        })
      });
      createdUser = sanitizeUserObject({ ...rawCreated, wallet_balance: 0.00 });
    }

    state.currentUser = createdUser;
    state.users.push(createdUser);
    state.walletBalance = 0.00;
    state.cardBalance = 0.00;
    await persistWalletBalance(0.00);
    await syncUserWalletAndPaymentMethods();
    updateUserDisplays();
    renderTicketsHistory();
    renderDatabaseInspector();

    statusEl.textContent = `Account created for "${fullName}"!`;
    statusEl.className = "text-xs text-[#00C5A1] mt-1.5 text-left font-bold";

    setTimeout(() => showScreen("home"), 700);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "text-xs text-red-600 mt-1.5 text-left font-medium";
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit";
  }
}

// Toggle between QR Camera tab and Pay with Masar Card tab on Screen 5
function switchQrScreenTab(tab) {
  const camView = document.getElementById("qr-camera-subview");
  const cardView = document.getElementById("qr-card-pay-subview");
  const camBtn = document.getElementById("qr-tab-camera-btn");
  const walletBtn = document.getElementById("qr-tab-wallet-btn");

  if (!camView || !cardView) return;

  if (tab === "card-pay") {
    camView.classList.add("hidden");
    cardView.classList.remove("hidden");
    if (walletBtn) {
      walletBtn.className = "flex-1 py-2 rounded-full bg-[#231942] text-[#00E5B0] font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer";
    }
    if (camBtn) {
      camBtn.className = "flex-1 py-2 rounded-full text-[#1F1B38] font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer";
    }
  } else {
    cardView.classList.add("hidden");
    camView.classList.remove("hidden");
    if (camBtn) {
      camBtn.className = "flex-1 py-2 rounded-full bg-[#231942] text-[#00E5B0] font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer";
    }
    if (walletBtn) {
      walletBtn.className = "flex-1 py-2 rounded-full text-[#1F1B38] font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer";
    }
  }
}

function selectPaymentMethod(method) {
  state.selectedPaymentMethod = method;
  document.querySelectorAll(".pm-option-card").forEach(card => {
    const isSelected = card.dataset.method === method;
    const dot = card.querySelector(".pm-radio-dot");
    if (isSelected) {
      card.classList.remove("hidden");
      card.classList.add("ring-2", "ring-[#00C5A1]");
      if (dot) {
        dot.innerHTML = `<div class="w-3 h-3 rounded-full bg-[#1F1B38]"></div>`;
      }
    } else {
      card.classList.add("hidden");
      card.classList.remove("ring-2", "ring-[#00C5A1]");
      if (dot) {
        dot.innerHTML = "";
      }
    }
  });

  // Show the "Change Method" link so user can bring back all options
  const resetBtn = document.getElementById("reset-pm-options-btn");
  if (resetBtn) resetBtn.classList.remove("hidden");

  // Show/hide method-specific sub-panels:
  // - wallet: shows Masar Card preview + شحن كارت مسار button
  // - card: shows Credit Card details form
  // - nfc / cash: hides both
  const masarPreview = document.getElementById("payment-screen-masar-card-preview");
  const rechargeBtn = document.getElementById("goto-recharge-card-btn");
  const ccForm = document.getElementById("payment-screen-credit-card-form");

  if (masarPreview) {
    if (method === "wallet") {
      masarPreview.classList.remove("hidden");
      if (rechargeBtn) rechargeBtn.classList.remove("hidden");
    } else {
      masarPreview.classList.add("hidden");
      if (rechargeBtn) rechargeBtn.classList.add("hidden");
    }
  }

  if (ccForm) {
    if (method === "card") {
      ccForm.classList.remove("hidden");
      const holderInput = document.getElementById("ticket-cc-holder");
      if (holderInput && !holderInput.value) {
        holderInput.value = state.currentUser?.Full_Name || "";
      }
    } else {
      ccForm.classList.add("hidden");
    }
  }
}

function resetPaymentMethodsList() {
  document.querySelectorAll(".pm-option-card").forEach(card => {
    card.classList.remove("hidden", "ring-2", "ring-[#00C5A1]");
    const dot = card.querySelector(".pm-radio-dot");
    if (dot) dot.innerHTML = "";
  });
  const resetBtn = document.getElementById("reset-pm-options-btn");
  if (resetBtn) resetBtn.classList.add("hidden");

  const masarPreview = document.getElementById("payment-screen-masar-card-preview");
  if (masarPreview) masarPreview.classList.add("hidden");

  const ccForm = document.getElementById("payment-screen-credit-card-form");
  if (ccForm) ccForm.classList.add("hidden");
}

// Helper to update the Receipt screen status badge & heading (Paid vs Pending vs Used/Expired/Failed)
function updateReceiptStatusUI(paymentStatus, customLabel = null) {
  const badgeEl = document.getElementById("receipt-payment-status-badge");
  const headingEl = document.getElementById("receipt-main-heading");
  const isPending = paymentStatus === "Pending";

  if (badgeEl) {
    if (paymentStatus === "Failed") {
      badgeEl.textContent = customLabel || "✕ فشل الدفع / ملغاة (Failed)";
      badgeEl.className = "bg-red-100 text-red-700 text-xs font-extrabold px-2.5 py-0.5 rounded-full";
    } else if (paymentStatus === "Expired") {
      badgeEl.textContent = customLabel || "⌛ منتهية الصلاحية (Expired)";
      badgeEl.className = "bg-gray-200 text-gray-700 text-xs font-extrabold px-2.5 py-0.5 rounded-full";
    } else if (paymentStatus === "Used") {
      badgeEl.textContent = customLabel || "✓ تم استخدام التذكرة (Used)";
      badgeEl.className = "bg-blue-100 text-blue-800 text-xs font-extrabold px-2.5 py-0.5 rounded-full";
    } else if (isPending) {
      badgeEl.textContent = customLabel || "⏳ قيد الانتظار (Pending - بانتظار تأكيد السائق)";
      badgeEl.className = "bg-[#FEF3C7] text-[#B45309] text-xs font-extrabold px-2.5 py-0.5 rounded-full";
    } else {
      badgeEl.textContent = customLabel || "✓ تم الدفع بنجاح (Paid)";
      badgeEl.className = "bg-[#CCFBF1] text-[#0F766E] text-xs font-extrabold px-2.5 py-0.5 rounded-full";
    }
  }

  if (headingEl) {
    headingEl.textContent = isPending
      ? "تم تسجيل التذكرة (قيد الانتظار)"
      : paymentStatus === "Failed"
      ? "التذكرة غير صالحة (Failed)"
      : paymentStatus === "Expired"
      ? "انتهت صلاحية التذكرة (Expired)"
      : "تم إصدار التذكرة بنجاح";
  }
}

// Automatically generate a scannable QR code on the user's receipt screen containing Price, Route, Status, and Payment Method
function generateTicketQRCode({ ticketId, fare, route, status, paymentMethod }) {
  const qrImg = document.getElementById("receipt-ticket-qr-img");
  const driverHintEl = document.getElementById("receipt-qr-driver-hint");
  const summaryEl = document.getElementById("receipt-qr-encoded-summary");
  const qrBoxEl = document.getElementById("receipt-qr-box");

  const formattedFare = `${Number(fare || 0).toFixed(2)} EGP`;
  const cleanRoute = (route || "عدلي منصور ↔ جامعة القاهرة").trim();
  const cleanMethod = (paymentMethod || "محفظة / كارت مسار").trim();
  const normStatus = status || "Paid";
  const isPending = normStatus === "Pending";

  const driverActionText = isPending
    ? "COLLECT PAYMENT FIRST & CHANGE TICKET STATUS TO PAID/ACTIVE"
    : normStatus === "Paid" || normStatus === "Active"
    ? "ALREADY PAID - ALLOW BOARDING & MARK TICKET USED"
    : `TICKET STATUS: ${normStatus.toUpperCase()}`;

  const qrPayload = [
    "MASAR EGYPT TICKET",
    `Ref: #MSR-${ticketId || "9842105"}`,
    `Price: ${formattedFare}`,
    `Route: ${cleanRoute}`,
    `Status: ${normStatus.toUpperCase()}`,
    `Payment Method: ${cleanMethod}`,
    `Driver Action: ${driverActionText}`
  ].join(" | ");

  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=6&data=${encodeURIComponent(qrPayload)}`;
  }

  if (qrBoxEl) {
    qrBoxEl.className = isPending
      ? "w-full bg-white rounded-2xl p-3.5 shadow-sm border-2 border-[#F59E0B] flex flex-col items-center space-y-2"
      : normStatus === "Failed"
      ? "w-full bg-white rounded-2xl p-3.5 shadow-sm border-2 border-red-400 flex flex-col items-center space-y-2"
      : "w-full bg-white rounded-2xl p-3.5 shadow-sm border-2 border-[#00C5A1] flex flex-col items-center space-y-2";
  }

  if (driverHintEl) {
    if (isPending) {
      driverHintEl.className = "w-full text-center text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl bg-[#FEF3C7] text-[#B45309]";
      driverHintEl.textContent = "⏳ قيد الانتظار — يمسح السائق الكود لتحصيل الأجرة أولاً ثم تحويل حالة التذكرة إلى مدفوعة";
    } else if (normStatus === "Failed") {
      driverHintEl.className = "w-full text-center text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl bg-red-100 text-red-700";
      driverHintEl.textContent = "✕ تذكرة ملغاة / فشل الدفع — غير مسموح بالركوب";
    } else if (normStatus === "Expired") {
      driverHintEl.className = "w-full text-center text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl bg-gray-200 text-gray-700";
      driverHintEl.textContent = "⌛ تذكرة منتهية الصلاحية (Expired)";
    } else if (normStatus === "Used") {
      driverHintEl.className = "w-full text-center text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl bg-blue-100 text-blue-800";
      driverHintEl.textContent = "✓ تم مسح التذكرة وتأكيد الركوب مسبقاً (Used)";
    } else {
      driverHintEl.className = "w-full text-center text-[10px] font-extrabold px-2.5 py-1.5 rounded-xl bg-[#CCFBF1] text-[#0F766E]";
      driverHintEl.textContent = "✓ التذكرة مدفوعة — يمسح السائق الكود للسماح بالركوب وتغيير حالة التذكرة";
    }
  }

  if (summaryEl) {
    const statusTextAr = isPending
      ? "قيد الانتظار (Pending - تحصيل عند الركوب)"
      : normStatus === "Used"
      ? "تم الاستخدام (Used)"
      : normStatus === "Expired"
      ? "منتهية الصلاحية (Expired)"
      : normStatus === "Failed"
      ? "ملغاة / فشل (Failed)"
      : "مدفوعة (Paid)";
    summaryEl.innerHTML = `
      <div class="flex items-center justify-between"><span>السعر (Price):</span><span class="font-extrabold text-[#009688]">${Number(fare || 0).toFixed(2)} ج.م</span></div>
      <div class="flex items-center justify-between"><span>المسار (Route):</span><span class="font-extrabold">${cleanRoute}</span></div>
      <div class="flex items-center justify-between"><span>الحالة (Status):</span><span class="font-extrabold ${isPending ? 'text-[#B45309]' : 'text-[#0F766E]'}">${statusTextAr}</span></div>
      <div class="flex items-center justify-between"><span>طريقة الدفع (Method):</span><span class="font-extrabold">${cleanMethod}</span></div>
    `;
  }
}

// Complete Payment -> Writes to Baserow Tickets (1278390) AND Audit_Log (1278402)
async function confirmAndPayNow() {
  const btn = document.getElementById("confirm-pay-btn");
  const totalFare = parseFloat((state.baseFare * state.passengersCount).toFixed(2));
  const method = state.selectedPaymentMethod || "wallet";

  // 1. Validate Credit Card form if paying with Credit Card ("card")
  let ccData = null;
  if (method === "card") {
    const holder = document.getElementById("ticket-cc-holder")?.value.trim() || "";
    const rawNum = (document.getElementById("ticket-cc-number")?.value || "").replace(/\s+/g, "");
    const expMonth = parseInt(document.getElementById("ticket-cc-month")?.value || "", 10);
    const expYear = parseInt(document.getElementById("ticket-cc-year")?.value || "", 10);
    const cvv = (document.getElementById("ticket-cc-cvv")?.value || "").trim();
    const errEl = document.getElementById("ticket-cc-error");

    if (!holder || rawNum.length < 12 || !expMonth || !expYear || cvv.length < 3) {
      if (errEl) {
        errEl.textContent = "⚠️ يرجى إدخال بيانات البطاقة البنكية بالكامل (الاسم، رقم البطاقة، تاريخ الانتهاء، ورمز CVV).";
        errEl.classList.remove("hidden");
      }
      const ccForm = document.getElementById("payment-screen-credit-card-form");
      if (ccForm) {
        ccForm.classList.remove("hidden");
        ccForm.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (errEl) errEl.classList.add("hidden");

    ccData = {
      holder,
      last4: rawNum.slice(-4),
      brand: rawNum.startsWith("4") ? "Visa" : rawNum.startsWith("5") ? "Mastercard" : "Meeza",
      expMonth: Math.min(12, Math.max(1, expMonth)),
      expYear
    };
  }

  // 2. Check Masar Card balance ONLY when paying with Masar Card ("wallet")
  if (method === "wallet") {
    if (state.walletBalance < totalFare) {
      alert(`رصيد كارت مسار الحالي (${state.walletBalance.toFixed(2)} ج.م) غير كافٍ لدفع ${totalFare.toFixed(2)} ج.م. يرجى شحن الكارت أولاً أو اختيار البطاقة البنكية / NFC.`);
      return;
    }
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>جاري تأكيد الحجز وإصدار التذكرة...</span>`;
    }
    setSyncStatus("Writing Ticket to database...", true);

    // ONLY deduct from Masar Card balance when paid with Masar Card ("wallet") and persist it
    if (method === "wallet") {
      const nextBal = Math.max(0, state.walletBalance - totalFare);
      await persistWalletBalance(nextBal);
    }

    // If paid with Credit Card ("card"), save the card to PAYMENT_METHODS (1278389) in Baserow
    if (method === "card" && ccData) {
      try {
        const createdPm = await baserowFetch(TABLES.PAYMENT_METHODS, "", {
          method: "POST",
          body: JSON.stringify({
            provider_pm_id: `pm_card_${Date.now().toString().slice(-6)}`,
            provider: "Paymob",
            brand: ["Visa", "Mastercard", "Meeza"].includes(ccData.brand) ? ccData.brand : "Visa",
            last4: ccData.last4,
            exp_month: ccData.expMonth,
            exp_year: ccData.expYear,
            default_mode: true,
            user_id: state.currentUser?.id ? [state.currentUser.id] : [18]
          })
        });
        if (createdPm) {
          state.paymentMethods.push(createdPm);
          renderSavedPaymentMethods();
        }
      } catch (pmErr) {
        console.warn("Could not save credit card metadata:", pmErr);
      }
    }

    const pmNameMap = {
      wallet: "🪪 محفظة / كارت مسار",
      card: ccData ? `💳 بطاقة بنكية (${ccData.brand} •••• ${ccData.last4})` : "💳 بطاقة بنكية (Credit Card)",
      cash: "💵 نقداً (كاش - بانتظار السائق)",
      nfc: "📲 الدفع اللاتلامسي (NFC - قيد الانتظار)"
    };
    const recMethodEl = document.getElementById("receipt-payment-method");
    if (recMethodEl) {
      recMethodEl.textContent = pmNameMap[method] || "🪪 محفظة / كارت مسار";
    }

    const now = new Date();
    const validUntil = new Date(now.getTime() + 15 * 60000);

    // Determine payment_status and ticket_status:
    // - NFC (and Cash): registered as "Pending" until driver confirms (does NOT deduct from Masar Card)
    // - Masar Card ("wallet") and Credit Card ("card"): registered as "Paid" and "Active"
    const isPendingPayment = (method === "nfc" || method === "cash");
    const paymentStatusBaserow = isPendingPayment ? "Pending" : "Paid";
    const ticketStatusBaserow = isPendingPayment ? "Pending" : "Active";
    const paymentTypeBaserow = method === "cash" ? "Cash" : "Card";

    updateReceiptStatusUI(paymentStatusBaserow);

    // 1. Create row in Tickets table (1278390) with station-calculated fare_egp
    const createdTicket = await baserowFetch(TABLES.TICKETS, "", {
      method: "POST",
      body: JSON.stringify({
        ticket_type: "Journey Pass",
        fare_egp: totalFare,
        stations_count: state.stationsCount || 1,
        payment_type: paymentTypeBaserow,
        payment_status: paymentStatusBaserow,
        ticket_status: ticketStatusBaserow,
        valid_until: validUntil.toISOString(),
        used_at: now.toISOString(),
        user_id: state.currentUser?.id ? [state.currentUser.id] : [18],
        trip_id: [state.selectedRoute.trip_id || 59],
        boarding_station_id: [state.boardingStationId || 1],
        alighting_station_id: [state.alightingStationId || 34]
      })
    });

    // 2. Increment booked_seats on the selected Trip in Baserow Trips table (1278387)
    //    Baserow automatically recalculates seats_available (formula = capacity - booked_seats)
    const activeTripId = state.selectedRoute.trip_id || 67;
    const tripObj = state.trips.find(t => t.id === activeTripId || t.trip_id === activeTripId);
    if (tripObj) {
      const currentBooked = Number(tripObj.booked_seats || 0);
      const newBooked = currentBooked + Number(state.passengersCount || 1);

      try {
        const patchedTripData = await baserowRowPatch(TABLES.TRIPS, tripObj.id, {
          booked_seats: newBooked
        });
        tripObj.booked_seats = patchedTripData.booked_seats;
        tripObj.seats_available = patchedTripData.seats_available;
      } catch {
        tripObj.booked_seats = String(newBooked);
        tripObj.seats_available = String(Math.max(0, Number(tripObj.seats_available || 50) - Number(state.passengersCount || 1)));
      }
      renderDatabaseRoutes();
    }

    // 3. Create row in Audit_Log table (1278402)
    await baserowFetch(TABLES.AUDIT_LOG, "", {
      method: "POST",
      body: JSON.stringify({
        actor_email: state.currentUser?.email || "Passenger1@example.com",
        ticket_id: createdTicket?.id ? [createdTicket.id] : []
      })
    });

    state.lastCreatedTicket = createdTicket;
    state.tickets.unshift(createdTicket);
    renderDatabaseInspector();

    const refIdNum = createdTicket.ticket_id || createdTicket.id || "9842105";
    const refEl = document.getElementById("receipt-ref-id");
    if (refEl) {
      refEl.textContent = `#MSR-${refIdNum}`;
    }
    const recTotalEl = document.getElementById("receipt-total-fare");
    if (recTotalEl) {
      recTotalEl.textContent = totalFare.toFixed(2);
    }
    const timeEl = document.getElementById("receipt-live-time");
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString("en-US", { hour12: false });
    }

    const bStationObj = state.stations.find(s => s.id === Number(state.boardingStationId));
    const aStationObj = state.stations.find(s => s.id === Number(state.alightingStationId));
    const routeSummaryAr = `${getStationArabicName(bStationObj) || "عدلي منصور"} ↔ ${getStationArabicName(aStationObj) || "جامعة القاهرة"}`;
    const recRouteEl = document.getElementById("receipt-route-name");
    if (recRouteEl) {
      recRouteEl.textContent = routeSummaryAr;
    }

    generateTicketQRCode({
      ticketId: refIdNum,
      fare: totalFare,
      route: routeSummaryAr,
      status: paymentStatusBaserow,
      paymentMethod: pmNameMap[method] || "🪪 محفظة / كارت مسار"
    });

    updateFareDisplays();
    state.receiptCountdownSeconds = 15 * 60;
    showScreen("receipt");
  } catch (err) {
    console.error("Payment error:", err);
    const recTotalEl = document.getElementById("receipt-total-fare");
    if (recTotalEl) {
      recTotalEl.textContent = totalFare.toFixed(2);
    }
    state.receiptCountdownSeconds = 15 * 60;
    showScreen("receipt");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span class="text-[#00C5A1] font-bold text-sm">تأكيد ودفع <span class="dynamic-total-fare">${totalFare.toFixed(2)}</span> ج.م فوراً</span>
        <svg class="w-5 h-5 text-[#00C5A1]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 118 0v4"/></svg>
      `;
    }
  }
}

// Step 1: User selects the method to recharge their Masar Card -> Hides the other 4 options so the form fits on the phone screen
function chooseRechargeMethod(providerKey) {
  state.selectedRechargeMethod = providerKey;

  document.querySelectorAll(".recharge-option-card").forEach(card => {
    const radio = card.querySelector(".recharge-radio");
    if (card.dataset.provider === providerKey) {
      card.classList.remove("hidden", "bg-white");
      card.classList.add("bg-[#CCFBF1]", "ring-1", "ring-[#00C5A1]");
      if (radio) {
        radio.className = "recharge-radio w-5 h-5 rounded-full bg-[#231942] flex items-center justify-center";
        radio.innerHTML = `<div class="w-2 h-2 rounded-full bg-white"></div>`;
      }
    } else {
      // Hide unselected options so the screen stays compact and fits the form cleanly
      card.classList.add("hidden");
      card.classList.remove("bg-[#CCFBF1]", "ring-1", "ring-[#00C5A1]");
      if (radio) {
        radio.className = "recharge-radio w-5 h-5 rounded-full bg-[#99F6E4] flex items-center justify-center";
        radio.innerHTML = "";
      }
    }
  });

  // Show the "Change Method" bar & the Details Form
  const changeBar = document.getElementById("change-recharge-method-bar");
  const formEl = document.getElementById("recharge-details-form");
  if (changeBar) changeBar.classList.remove("hidden");
  if (formEl) formEl.classList.remove("hidden");

  renderRechargeFormFields(providerKey);
}

// Show all 5 recharge options again and hide the entry form
function resetRechargeMethodSelection() {
  state.selectedRechargeMethod = null;
  document.querySelectorAll(".recharge-option-card").forEach(card => {
    const radio = card.querySelector(".recharge-radio");
    card.classList.remove("hidden", "bg-[#CCFBF1]", "ring-1", "ring-[#00C5A1]");
    card.classList.add("bg-white");
    if (radio) {
      radio.className = "recharge-radio w-5 h-5 rounded-full bg-[#99F6E4] flex items-center justify-center";
      radio.innerHTML = "";
    }
  });

  const changeBar = document.getElementById("change-recharge-method-bar");
  const formEl = document.getElementById("recharge-details-form");
  if (changeBar) changeBar.classList.add("hidden");
  if (formEl) formEl.classList.add("hidden");
}

// Step 2: Render specific input fields for the chosen payment method
function renderRechargeFormFields(providerKey) {
  const container = document.getElementById("recharge-dynamic-fields");
  const badge = document.getElementById("recharge-form-badge");
  const title = document.getElementById("recharge-form-title");
  const feedback = document.getElementById("recharge-feedback-msg");
  if (!container) return;

  if (feedback) feedback.classList.add("hidden");
  const uName = state.currentUser?.Full_Name || "";
  const uPhone = state.currentUser?.Phone_Number || "";

  if (providerKey === "meeza" || providerKey === "bank") {
    const isMeeza = providerKey === "meeza";
    if (badge) badge.textContent = isMeeza ? "Meeza Card • كارت ميزة" : "Bank Card • بطاقة بنكية";
    if (title) title.textContent = isMeeza ? "2. أدخل بيانات كارت ميزة الخاص بك:" : "2. أدخل بيانات البطاقة البنكية (Visa / Mastercard):";
    container.innerHTML = `
      <div>
        <label class="block text-right text-[11px] font-bold text-[#1F1B38] mb-1" dir="rtl">اسم حامل البطاقة (كما يظهر على الكارت) *</label>
        <input id="pm-input-holder" type="text" value="${uName}" placeholder="Cardholder Name" required
          class="w-full px-3 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-semibold text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
      </div>
      <div>
        <label class="block text-right text-[11px] font-bold text-[#1F1B38] mb-1" dir="rtl">رقم البطاقة (16 رقم) *</label>
        <input id="pm-input-cardnum" type="text" maxlength="19" placeholder="${isMeeza ? '5078 •••• •••• ••••' : '4••• •••• •••• ••••'}" required
          class="w-full px-3 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-semibold tracking-wider text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div>
          <label class="block text-right text-[10px] font-bold text-[#1F1B38] mb-1" dir="rtl">CVV *</label>
          <input id="pm-input-cvv" type="password" maxlength="4" placeholder="123" required
            class="w-full px-2.5 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-bold text-center text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
        </div>
        <div>
          <label class="block text-right text-[10px] font-bold text-[#1F1B38] mb-1" dir="rtl">سنة الانتهاء *</label>
          <input id="pm-input-year" type="number" min="2025" max="2035" placeholder="2028" required
            class="w-full px-2.5 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-bold text-center text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
        </div>
        <div>
          <label class="block text-right text-[10px] font-bold text-[#1F1B38] mb-1" dir="rtl">شهر الانتهاء *</label>
          <input id="pm-input-month" type="number" min="1" max="12" placeholder="09" required
            class="w-full px-2.5 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-bold text-center text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
        </div>
      </div>
    `;
  } else if (providerKey === "wallet") {
    if (badge) badge.textContent = "Smart Wallet • محفظة إلكترونية";
    if (title) title.textContent = "2. أدخل رقم المحفظة الإلكترونية الخاصة بك:";
    container.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-right text-[11px] font-bold text-[#1F1B38] mb-1" dir="rtl">مقدم الخدمة *</label>
          <select id="pm-input-wallet-brand" class="w-full px-2.5 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-bold text-[#1F1B38]">
            <option value="Vodafone Cash">Vodafone Cash</option>
            <option value="Orange Cash">Orange Cash</option>
            <option value="Etisalat Cash">Etisalat Cash</option>
            <option value="WE Pay">WE Pay</option>
          </select>
        </div>
        <div>
          <label class="block text-right text-[11px] font-bold text-[#1F1B38] mb-1" dir="rtl">رقم الموبايل *</label>
          <input id="pm-input-phone" type="tel" value="${uPhone}" placeholder="010••••••••" required
            class="w-full px-3 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-semibold text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
        </div>
      </div>
    `;
  } else if (providerKey === "fawry") {
    const refCode = "988-" + Math.floor(100000 + Math.random() * 900000);
    if (badge) badge.textContent = "Fawry Pay • فوري باي";
    if (title) title.textContent = "2. كود الدفع الفوري وحساب المستلم:";
    container.innerHTML = `
      <div class="bg-[#F6F4EC] rounded-xl p-2.5 text-center border border-gray-200">
        <div class="text-[10px] text-gray-500 font-bold">كود فوري المرجعي (صالح 24 ساعة)</div>
        <div id="pm-input-fawry-code" class="text-base font-black text-[#1F1B38] tracking-widest mt-0.5">${refCode}</div>
      </div>
      <div>
        <label class="block text-right text-[11px] font-bold text-[#1F1B38] mb-1" dir="rtl">رقم الهاتف لاستلام رسالة التأكيد *</label>
        <input id="pm-input-phone" type="tel" value="${uPhone}" placeholder="010••••••••" required
          class="w-full px-3 py-2 rounded-xl bg-[#F6F4EC] border border-gray-200 text-xs font-semibold text-[#1F1B38] focus:outline-none focus:ring-2 focus:ring-[#00C5A1]" />
      </div>
    `;
  }
}

// Step 3: Submit Entered Card/Payment Info -> Save to Baserow Payment_Methods (1278389) & Update Balance
async function submitRechargeForm(e) {
  e.preventDefault();
  const providerKey = state.selectedRechargeMethod;
  const amountInput = document.getElementById("recharge-amount-input");
  const btn = document.getElementById("recharge-submit-btn");
  const feedback = document.getElementById("recharge-feedback-msg");

  const amount = parseFloat(amountInput?.value || "0");
  if (isNaN(amount) || amount <= 0) return;

  let providerLabel = "Meeza Card";
  let brandLabel = "Meeza";
  let last4 = "8924";
  let expMonth = 9;
  let expYear = 2028;

  if (providerKey === "meeza" || providerKey === "bank") {
    const rawNum = (document.getElementById("pm-input-cardnum")?.value || "").replace(/\s+/g, "");
    providerLabel = providerKey === "meeza" ? "Meeza Card" : "Bank Card";
    brandLabel = providerKey === "meeza" ? "Meeza" : (rawNum.startsWith("5") ? "Mastercard" : "Visa");
    last4 = rawNum.slice(-4) || "4108";
    expMonth = parseInt(document.getElementById("pm-input-month")?.value || "9", 10);
    expYear = parseInt(document.getElementById("pm-input-year")?.value || "2028", 10);

    // Update the virtual Masar Card display with the user's entered last4 & expiry
    const last4El = document.getElementById("masar-card-last4");
    const expEl = document.getElementById("masar-card-exp");
    if (last4El && last4.length === 4) last4El.textContent = last4;
    if (expEl) expEl.textContent = `EXP ${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`;
  } else if (providerKey === "wallet") {
    const wBrand = document.getElementById("pm-input-wallet-brand")?.value || "Vodafone Cash";
    const phone = document.getElementById("pm-input-phone")?.value.trim() || "0100";
    providerLabel = "Smart Wallet";
    brandLabel = wBrand;
    last4 = phone.slice(-4);
  } else if (providerKey === "fawry") {
    const phone = document.getElementById("pm-input-phone")?.value.trim() || "2400";
    providerLabel = "Fawry Pay";
    brandLabel = "Fawry POS";
    last4 = phone.slice(-4);
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>جاري حفظ بيانات الدفع وشحن الكارت...</span>`;
    }
    setSyncStatus(`Saving ${providerLabel} (${last4}) to Baserow...`, true);

    const validBrand = ["Visa", "Mastercard", "Meeza"].includes(brandLabel)
      ? brandLabel
      : providerKey === "meeza"
      ? "Meeza"
      : "Visa";

    const createdPm = await baserowFetch(TABLES.PAYMENT_METHODS, "", {
      method: "POST",
      body: JSON.stringify({
        provider_pm_id: `pm_${providerKey || "card"}_${last4}_${Date.now().toString().slice(-4)}`,
        provider: "Paymob",
        brand: validBrand,
        last4: last4,
        exp_month: expMonth,
        exp_year: expYear,
        default_mode: true,
        user_id: state.currentUser?.id ? [state.currentUser.id] : [18]
      })
    });

    if (createdPm) {
      state.paymentMethods.push(createdPm);
    }

    const nextBal = state.walletBalance + amount;
    await persistWalletBalance(nextBal);
    renderSavedPaymentMethods();

    if (feedback) {
      feedback.className = "text-[11px] text-center font-extrabold text-[#009688] block pt-1";
      feedback.textContent = `✓ تم شحن +${amount.toFixed(2)} ج.م بنجاح وحفظ وسيلة الدفع (${providerLabel} •••• ${last4}) لحساب ${state.currentUser?.Full_Name}!`;
    }
    setSyncStatus(`Saved ${providerLabel} (•••• ${last4}) & +${amount} EGP to Baserow!`);
  } catch (err) {
    console.error(err);
    state.walletBalance += amount;
    state.cardBalance = state.walletBalance;
    updateFareDisplays();
    if (feedback) {
      feedback.className = "text-[11px] text-center font-extrabold text-[#009688] block pt-1";
      feedback.textContent = `✓ تم إضافة +${amount.toFixed(2)} ج.م إلى رصيد كارت مسار!`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>تأكيد الشحن وحفظ الوسيلة لحسابي</span><span>✓</span>`;
    }
  }
}

function renderDatabaseInspector() {
  const usersCountEl = document.getElementById("db-users-count");
  const routesCountEl = document.getElementById("db-routes-count");
  const ticketsCountEl = document.getElementById("db-tickets-count");

  if (usersCountEl) usersCountEl.textContent = state.users.length;
  if (routesCountEl) routesCountEl.textContent = state.routes.length;
  if (ticketsCountEl) ticketsCountEl.textContent = state.tickets.length;
}

// Render Screen 9: User's Registered Tickets History from Baserow Tickets Table (1278390)
function renderTicketsHistory() {
  const container = document.getElementById("user-tickets-history-list");
  if (!container) return;

  const currentUserId = state.currentUser?.id || state.currentUser?.user_id || 0;

  // Strictly filter tickets belonging ONLY to the currently logged-in user
  const userTickets = state.tickets.filter(t =>
    t.user_id?.some(u => Number(u.id) === Number(currentUserId) || String(u.value) === String(currentUserId))
  );

  if (userTickets.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-6 text-center space-y-2 border border-gray-100">
        <div class="text-2xl">🧾</div>
        <div class="text-xs font-extrabold text-[#1F1B38]">لا توجد تذاكر سابقة مسجلة حتى الآن</div>
        <div class="text-[11px] text-gray-500">قم بحجز رحلة من الصفحة الرئيسية لتظهر تذكرتك هنا فوراً.</div>
        <button onclick="showScreen('home')" class="mt-2 px-4 py-2 rounded-xl bg-[#00C5A1] text-white text-xs font-bold cursor-pointer">
          احجز رحلة الآن
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = userTickets.map(ticket => {
    const tId = ticket.ticket_id || ticket.id;
    const fare = parseFloat(ticket.fare_egp || 10).toFixed(2);
    const pType = ticket.payment_type?.value || "Card";
    const resolved = resolveTicketLiveStatus(ticket);
    const statusBadgeClass = resolved.badgeClass;
    const statusLabel = resolved.badgeLabel;
    const usedDate = ticket.used_at ? new Date(ticket.used_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "الآن";

    // Resolve stations & trip (Arabic station names)
    const bStId = ticket.boarding_station_id?.[0]?.id || Number(ticket.boarding_station_id?.[0]?.value);
    const aStId = ticket.alighting_station_id?.[0]?.id || Number(ticket.alighting_station_id?.[0]?.value);
    const bSt = getStationArabicName(state.stations.find(s => s.id === bStId)) || "عدلي منصور";
    const aSt = getStationArabicName(state.stations.find(s => s.id === aStId)) || "جامعة القاهرة";

    const tripId = ticket.trip_id?.[0]?.id || Number(ticket.trip_id?.[0]?.value);
    const tripObj = state.trips.find(tr => tr.id === tripId || tr.trip_id === tripId);
    const vehicleLabel = tripObj?.vehicle_label || "Metro Line 3 - M101";

    return `
      <div onclick="openOldTicketReceipt(${tId}, ${fare}, '${bSt.replace(/'/g, "")} ↔ ${aSt.replace(/'/g, "")}', '${pType}', '${resolved.effectiveStatus}')"
        class="bg-white rounded-2xl p-3.5 shadow-2xs border border-gray-100 hover:border-[#00C5A1] transition cursor-pointer" dir="rtl">
        <div class="flex items-center justify-between border-b border-gray-100 pb-2">
          <div class="flex items-center gap-2">
            <span class="bg-[#231942] text-[#00E5B0] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">#MSR-${tId}</span>
            <span class="${statusBadgeClass} text-[10px] font-extrabold px-2 py-0.5 rounded-full">${statusLabel}</span>
          </div>
          <div class="text-sm font-black text-[#00C5A1]">${fare} ج.م</div>
        </div>

        <div class="mt-2 flex items-center justify-between">
          <div>
            <div class="text-xs font-extrabold text-[#1F1B38]">${bSt} ↔ ${aSt}</div>
            <div class="text-[11px] font-semibold text-[#009688] mt-0.5">${vehicleLabel} • الدفع: ${pType}</div>
            <div class="text-[10px] text-gray-400 mt-0.5">التاريخ: ${usedDate}</div>
          </div>
          <span class="text-xs font-extrabold text-[#1F1B38] bg-[#F6F4EC] px-2.5 py-1 rounded-xl">عرض الإيصال ←</span>
        </div>
      </div>
    `;
  }).join("");
}

function openOldTicketReceipt(ticketId, fare, routeText, paymentType, paymentStatus = "Paid") {
  showScreen("receipt");

  updateReceiptStatusUI(paymentStatus);

  const refEl = document.getElementById("receipt-ref-id");
  if (refEl) refEl.textContent = `#MSR-${ticketId}`;

  const routeEl = document.getElementById("receipt-route-name");
  if (routeEl) routeEl.textContent = routeText;

  const pmEl = document.getElementById("receipt-payment-method");
  if (pmEl) {
    if (paymentStatus === "Pending") {
      pmEl.textContent = paymentType === "Cash" ? "💵 نقداً (كاش - بانتظار السائق)" : "📲 الدفع اللاتلامسي (NFC - قيد الانتظار)";
    } else {
      pmEl.textContent = paymentType === "Cash" ? "💵 نقداً (كاش)" : "🪪 محفظة / كارت مسار أو بطاقة بنكية";
    }
  }

  const recTotalEl = document.getElementById("receipt-total-fare");
  if (recTotalEl) {
    recTotalEl.textContent = Number(fare).toFixed(2);
  }

  const pmLabel = paymentStatus === "Pending"
    ? (paymentType === "Cash" ? "💵 نقداً (كاش - بانتظار السائق)" : "📲 الدفع اللاتلامسي (NFC - قيد الانتظار)")
    : (paymentType === "Cash" ? "💵 نقداً (كاش)" : "🪪 محفظة / كارت مسار أو بطاقة بنكية");

  generateTicketQRCode({
    ticketId,
    fare,
    route: routeText,
    status: paymentStatus,
    paymentMethod: pmLabel
  });
}

function populateSettingsFields() {
  const u = state.currentUser;
  if (!u) return;

  const idEl = document.getElementById("settings-user-id");
  const roleEl = document.getElementById("settings-user-role-badge");
  const nameInput = document.getElementById("settings-input-name");
  const emailInput = document.getElementById("settings-input-email");

  if (idEl) idEl.textContent = u.user_id || u.id || 18;
  if (roleEl) roleEl.textContent = u.role?.value || u.role || "Passenger";
  if (nameInput) nameInput.value = u.Full_Name || "";
  if (emailInput) emailInput.value = u.email || "";
}

async function saveUserProfileSettings(e) {
  e.preventDefault();
  const u = state.currentUser;
  if (!u) return;

  const btn = document.getElementById("settings-save-btn");
  const feedback = document.getElementById("settings-feedback-msg");
  const fullName = document.getElementById("settings-input-name")?.value.trim() || u.Full_Name;
  const email = document.getElementById("settings-input-email")?.value.trim() || u.email;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>جاري حفظ التعديلات...</span>`;
    }

    try {
      const updatedUser = await baserowRowPatch(TABLES.USERS, u.id, {
        Full_Name: fullName,
        email: email
      });
      state.currentUser = sanitizeUserObject(updatedUser);
    } catch {
      state.currentUser.Full_Name = fullName;
      state.currentUser.email = email;
    }

    updateUserDisplays();
    if (feedback) {
      feedback.className = "text-[11px] text-center font-extrabold text-[#009688] block pt-1";
      feedback.textContent = "✓ تم حفظ التعديلات بنجاح!";
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>حفظ التعديلات</span><span>✓</span>`;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  showScreen("splash");
  resetRechargeMethodSelection();

  const loadingBox = document.getElementById("splash-loading-box");
  const actionsBox = document.getElementById("splash-actions-box");
  if (loadingBox) loadingBox.classList.remove("hidden");
  if (actionsBox) actionsBox.classList.add("hidden");

  loadInitialDatabase().finally(() => {
    setTimeout(() => {
      if (loadingBox) loadingBox.classList.add("hidden");
      if (actionsBox) actionsBox.classList.remove("hidden");
    }, 900);
  });

  // Live poll Tickets from database every 4 seconds when viewing History or Receipt so DB edits reflect automatically
  setInterval(() => {
    const historyScreen = document.getElementById("screen-history");
    const receiptScreen = document.getElementById("screen-receipt");
    const isHistoryVisible = historyScreen && !historyScreen.classList.contains("hidden");
    const isReceiptVisible = receiptScreen && !receiptScreen.classList.contains("hidden");
    if (isHistoryVisible || isReceiptVisible) {
      refreshTicketsFromDatabase();
    }
  }, 4000);
});
