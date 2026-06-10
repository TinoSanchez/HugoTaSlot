import "./styles.css";
import {
  addBonus,
  adminAdjustBalance,
  adminArchiveHunt,
  adminDeleteHunt,
  adminListHunts,
  adminListUsers,
  adminLogs,
  adminSetBalance,
  adminSetRole,
  adminSetStatus,
  createHunt,
  deleteBonus,
  deleteHunt,
  fetchMyBalance,
  fetchProfile,
  getCurrentUser,
  listMyHunts,
  signIn,
  signOut,
  signUp,
  updateBonus,
  updateMyProfile,
} from "./lib/api";

const app = document.getElementById("app");

const state = {
  user: null,
  profile: null,
  balance: 0,
  hunts: [],
  slots: [],
  page: "hunt",
  selectedHuntId: null,
  depositWheel: {
    values: [],
    selectedIndex: null,
  },
};

function money(v, c = "EUR") {
  return `${Number(v || 0).toFixed(2)} ${c}`;
}

function toast(message, good = true) {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = [
    "position:fixed",
    "right:14px",
    "bottom:14px",
    "padding:9px 12px",
    "background:#0f1627",
    `border:1px solid ${good ? "#1f8f64" : "#833045"}`,
    `color:${good ? "#7fffc4" : "#ff9fb1"}`,
    "border-radius:8px",
    "z-index:9999",
  ].join(";");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function mapAuthError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  if (msg.includes("email rate limit exceeded")) return "Limite Supabase atteinte (emails). Attends 60s, puis réessaie. Si le compte est déjà créé, utilise Connexion.";
  if (msg.includes("email not confirmed")) return "Compte créé, mais la confirmation email est activée sur Supabase. Désactive-la dans Auth > Providers > Email.";
  if (msg.includes("for security purposes")) return "Trop de tentatives d'inscription. Attends 60 secondes puis réessaie.";
  if (msg.includes("password")) return "Mot de passe trop faible (minimum 6 caractères).";
  if (msg.includes("user already registered")) return "Ce compte existe déjà. Essaie la connexion.";
  if (msg.includes("invalid login credentials")) return "Identifiants invalides.";
  if (msg.includes("relation") || msg.includes("does not exist")) return "Base non initialisée. Exécute la migration SQL dans Supabase.";
  return error?.message || "Erreur d'authentification.";
}

async function boot() {
  await loadSlots();
  const user = await getCurrentUser();
  if (!user) {
    renderAuth();
    return;
  }
  await hydrateUser(user.id);
  renderApp();
}

async function loadSlots() {
  try {
    const res = await fetch("/jeux.json");
    if (!res.ok) return;
    const data = await res.json();
    state.slots = Array.isArray(data) ? data : [];
  } catch {
    state.slots = [];
  }
}

async function hydrateUser(userId) {
  state.user = { id: userId };
  state.profile = await fetchProfile(userId);
  state.balance = await fetchMyBalance(userId);
  state.hunts = await listMyHunts(userId);
  state.selectedHuntId = state.hunts[0]?.id || null;
}

function renderAuth() {
  const eyeSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
      <circle cx="12" cy="12" r="3.2"></circle>
      <line class="eye-off-line" x1="4" y1="20" x2="20" y2="4"></line>
    </svg>
  `;
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-box">
        <div class="brand">HugoTaSlot Cloud</div>
        <div class="muted">Inscription/Login (email ou pseudo + mot de passe)</div>
        <div class="row" style="margin-top:12px;">
          <button class="btn primary" id="tab-login">Connexion</button>
          <button class="btn" id="tab-signup">Inscription</button>
        </div>
        <div id="auth-login" style="margin-top:10px;">
          <input class="input" id="login-id" placeholder="Email ou pseudo" />
          <div class="input-wrap" style="margin-top:8px;">
            <input class="input" id="login-pass" type="password" placeholder="Mot de passe" />
            <button type="button" class="pw-eye" id="toggle-login-pass" aria-label="Afficher le mot de passe">${eyeSvg}</button>
          </div>
          <button class="btn green" id="do-login" style="margin-top:10px;">Se connecter</button>
        </div>
        <div id="auth-signup" class="hidden" style="margin-top:10px;">
          <input class="input" id="signup-id" placeholder="Email ou pseudo" />
          <input class="input" id="signup-name" placeholder="Nom affiché" style="margin-top:8px;" />
          <div class="input-wrap" style="margin-top:8px;">
            <input class="input" id="signup-pass" type="password" placeholder="Mot de passe" />
            <button type="button" class="pw-eye" id="toggle-signup-pass" aria-label="Afficher le mot de passe">${eyeSvg}</button>
          </div>
          <button class="btn primary" id="do-signup" style="margin-top:10px;">Créer le compte</button>
        </div>
      </div>
    </div>
  `;
  const tabLogin = document.getElementById("tab-login");
  const tabSignup = document.getElementById("tab-signup");
  const loginBox = document.getElementById("auth-login");
  const signupBox = document.getElementById("auth-signup");
  tabLogin.onclick = () => {
    tabLogin.classList.add("primary");
    tabSignup.classList.remove("primary");
    loginBox.classList.remove("hidden");
    signupBox.classList.add("hidden");
  };
  tabSignup.onclick = () => {
    tabSignup.classList.add("primary");
    tabLogin.classList.remove("primary");
    signupBox.classList.remove("hidden");
    loginBox.classList.add("hidden");
  };
  const bindPasswordToggle = (inputId, buttonId) => {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(buttonId);
    if (!input || !btn) return;
    btn.onclick = () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.classList.toggle("is-open", isHidden);
      btn.setAttribute("aria-label", isHidden ? "Masquer le mot de passe" : "Afficher le mot de passe");
    };
  };
  bindPasswordToggle("login-pass", "toggle-login-pass");
  bindPasswordToggle("signup-pass", "toggle-signup-pass");
  document.getElementById("do-login").onclick = async () => {
    try {
      await signIn({
        identifier: document.getElementById("login-id").value,
        password: document.getElementById("login-pass").value,
      });
      const user = await getCurrentUser();
      await hydrateUser(user.id);
      renderApp();
    } catch (e) {
      toast(mapAuthError(e), false);
    }
  };
  document.getElementById("do-signup").onclick = async () => {
    try {
      const identifier = document.getElementById("signup-id").value;
      const password = document.getElementById("signup-pass").value;
      const displayName = document.getElementById("signup-name").value;
      await signUp({ identifier, password, displayName });
      // Tente une connexion directe (si email confirmation est désactivée).
      await signIn({ identifier, password });
      const user = await getCurrentUser();
      await hydrateUser(user.id);
      renderApp();
    } catch (e) {
      toast(mapAuthError(e), false);
    }
  };
}

function renderApp() {
  const isAdmin = state.profile?.role === "admin";
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">HugoTaSlot</div>
      <div class="muted">${state.profile.display_name || state.profile.username || state.profile.email || "Player"}</div>
      <div class="muted">Role: ${state.profile.role}</div>
      <div class="nav">
        <button data-page="hunt" class="${state.page === "hunt" ? "active" : ""}">Bonus Hunts</button>
        <button data-page="profile" class="${state.page === "profile" ? "active" : ""}">Profil</button>
        ${isAdmin ? `<button data-page="admin" class="${state.page === "admin" ? "active" : ""}">Admin</button>` : ""}
      </div>
      <div class="card" style="margin-top:16px;">
        <div class="muted">Solde joueur (lecture seule)</div>
        <div style="font-size:30px;color:var(--gold);font-weight:700;">${money(state.balance)}</div>
      </div>
      <button class="btn red" id="logout" style="margin-top:12px;width:100%;">Déconnexion</button>
    </aside>
    <main class="content" id="content"></main>
  `;
  app.querySelectorAll("[data-page]").forEach((el) => {
    el.onclick = () => {
      state.page = el.getAttribute("data-page");
      renderApp();
    };
  });
  document.getElementById("logout").onclick = async () => {
    await signOut();
    state.user = null;
    state.profile = null;
    renderAuth();
  };
  renderPage();
}

function selectedHunt() {
  return state.hunts.find((h) => h.id === state.selectedHuntId) || null;
}

function depositWheelTier(maxPlage) {
  const m = Number(maxPlage);
  if (!Number.isFinite(m)) return "large";
  if (m <= 100) return "small";
  if (m <= 300) return "med";
  return "large";
}

function depositWheelValueOk(n, tier) {
  const u = ((n % 10) + 10) % 10;
  if (tier === "small") return u === 0 || u === 5;
  if (tier === "med") return u === 0;
  const h = ((n % 100) + 100) % 100;
  return h === 0 || h === 25 || h === 50 || h === 75;
}

function listDepositWheelValidInts(lo, hi, tier) {
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (b < a) return [];
  const out = [];
  for (let n = a; n <= b; n += 1) {
    if (depositWheelValueOk(n, tier)) out.push(n);
  }
  return out;
}

function fillDepositWheelMiddle8Stratified(interior) {
  const nI = interior.length;
  const middle = [];
  for (let i = 0; i < 8; i += 1) {
    const loIdx = Math.floor((i * nI) / 8);
    const hiIdx = Math.floor(((i + 1) * nI) / 8) - 1;
    const a = Math.max(0, Math.min(nI - 1, loIdx));
    const b = Math.max(a, Math.min(nI - 1, hiIdx));
    const j = a + Math.floor(Math.random() * (b - a + 1));
    middle.push(interior[j]);
  }
  middle.sort((x, y) => x - y);
  return middle;
}

function generateDepositWheelValues(min, max) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) {
    throw new Error("Plage invalide.");
  }
  if (hi <= lo) {
    throw new Error("Le max doit être supérieur au min.");
  }
  const tier = depositWheelTier(hi);
  const valid = listDepositWheelValidInts(lo, hi, tier);
  if (valid.length < 1) {
    throw new Error("Aucun montant valide dans cette plage pour ce palier (voir max : ≤100, 100–300, >300).");
  }
  const nV = valid.length;
  const first = valid[0];
  const last = valid[nV - 1];
  const interior = valid.slice(1, nV - 1);
  const nI = interior.length;
  let middle;
  if (nI >= 8) middle = fillDepositWheelMiddle8Stratified(interior);
  else {
    const pool = nI > 0 ? interior : valid;
    middle = [];
    for (let k = 0; k < 8; k += 1) {
      middle.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    middle.sort((x, y) => x - y);
  }
  return [first, ...middle, last];
}

function formatDepositWheelFr(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return "-";
  return `${n},00`;
}

function renderPage() {
  const container = document.getElementById("content");
  if (state.page === "profile") {
    renderProfile(container);
    return;
  }
  if (state.page === "admin" && state.profile?.role === "admin") {
    renderAdmin(container);
    return;
  }
  renderHunts(container);
}

function renderProfile(container) {
  container.innerHTML = `
    <section class="card">
      <h2 style="margin:0 0 10px 0;">Mon profil</h2>
      <div class="row">
        <div class="grow">
          <label class="muted">Nom affiché</label>
          <input class="input" id="p-display" value="${state.profile.display_name || ""}" />
        </div>
        <div class="grow">
          <label class="muted">Avatar URL</label>
          <input class="input" id="p-avatar" value="${state.profile.avatar_url || ""}" />
        </div>
      </div>
      <button class="btn primary" id="save-profile" style="margin-top:10px;">Sauvegarder</button>
    </section>
  `;
  document.getElementById("save-profile").onclick = async () => {
    try {
      await updateMyProfile({
        display_name: document.getElementById("p-display").value.trim(),
        avatar_url: document.getElementById("p-avatar").value.trim(),
      });
      state.profile = await fetchProfile(state.user.id);
      renderApp();
      toast("Profil mis à jour");
    } catch (e) {
      toast(e.message || "Erreur profil", false);
    }
  };
}

function renderHunts(container) {
  const hunt = selectedHunt();
  const profits = (hunt?.hunt_bonuses || []).reduce((acc, b) => acc + Number(b.win || 0), 0) - Number(hunt?.starting_balance || 0);
  container.innerHTML = `
    <section class="stats">
      <div class="stat"><div class="label">CHASSES</div><div class="value">${state.hunts.length}</div></div>
      <div class="stat"><div class="label">BONUS (chasse active)</div><div class="value">${hunt?.hunt_bonuses?.length || 0}</div></div>
      <div class="stat"><div class="label">PROFIT</div><div class="value ${profits >= 0 ? "ok" : "ko"}">${money(profits, hunt?.currency || "EUR")}</div></div>
    </section>
    <section class="card">
      <h2 style="margin:0 0 8px 0;">Créer une hunt</h2>
      <div class="row">
        <input class="input grow" id="new-hunt-name" placeholder="Nom de la hunt" />
        <input class="input" id="new-hunt-balance" type="number" min="1" step="0.01" value="100" style="max-width:160px;" />
        <select class="select" id="new-hunt-cur" style="max-width:120px;">
          <option>EUR</option><option>USD</option><option>CAD</option><option>BRL</option>
        </select>
        <button class="btn primary" id="create-hunt">Créer</button>
      </div>
    </section>
    <section class="card">
      <h2 style="margin:0 0 8px 0;">Mes hunts</h2>
      <div class="row">
        <select class="select grow" id="hunt-select">
          ${state.hunts
            .map((h) => `<option value="${h.id}" ${h.id === state.selectedHuntId ? "selected" : ""}>${h.name} (${money(h.starting_balance, h.currency)})</option>`)
            .join("")}
        </select>
        <button class="btn red" id="delete-hunt">Supprimer hunt</button>
      </div>
    </section>
    <section class="card" id="bonus-card">
      ${hunt ? renderBonusPanel(hunt) : "<div class='muted'>Aucune hunt sélectionnée.</div>"}
    </section>
  `;
  document.getElementById("create-hunt").onclick = async () => {
    try {
      const name = document.getElementById("new-hunt-name").value.trim();
      const starting = Number(document.getElementById("new-hunt-balance").value);
      const currency = document.getElementById("new-hunt-cur").value;
      if (!name || !starting) throw new Error("Nom et solde requis.");
      await createHunt(state.user.id, { name, starting_balance: starting, currency });
      state.hunts = await listMyHunts(state.user.id);
      state.selectedHuntId = state.hunts[0]?.id || null;
      renderPage();
      toast("Hunt créée");
    } catch (e) {
      toast(e.message || "Erreur création hunt", false);
    }
  };
  const selector = document.getElementById("hunt-select");
  if (selector) {
    selector.onchange = () => {
      state.selectedHuntId = selector.value;
      renderPage();
    };
  }
  const delHunt = document.getElementById("delete-hunt");
  if (delHunt && hunt) {
    delHunt.onclick = async () => {
      try {
        await deleteHunt(hunt.id);
        state.hunts = await listMyHunts(state.user.id);
        state.selectedHuntId = state.hunts[0]?.id || null;
        renderPage();
        toast("Hunt supprimée");
      } catch (e) {
        toast(e.message || "Suppression impossible", false);
      }
    };
  }
  if (hunt) bindBonusActions(hunt);
}

function renderBonusPanel(hunt) {
  const rows = [...(hunt.hunt_bonuses || [])].sort((a, b) => a.sort_order - b.sort_order);
  const options = state.slots
    .slice(0, 2000)
    .map((s) => `<option value="${(s.name || s.slot || "").replaceAll('"', "'")}">${s.provider || "Provider"}</option>`)
    .join("");
  return `
    <h2 style="margin:0 0 8px 0;">${hunt.name}</h2>
    <div class="row">
      <input class="input grow" id="b-slot" list="slots-list" placeholder="Nom de la slot" />
      <datalist id="slots-list">${options}</datalist>
      <input class="input" id="b-provider" placeholder="Provider" style="max-width:180px;" />
      <input class="input" id="b-bet" type="number" min="0.01" step="0.01" placeholder="Mise" style="max-width:120px;" />
      <select class="select" id="b-type" style="max-width:150px;">
        <option value="normal">Normal</option>
        <option value="bounty">Bounty</option>
        <option value="epic">Epic Bonus</option>
        <option value="roue_depot">Roue du dépôt</option>
      </select>
      <button class="btn primary" id="add-bonus">Ajouter</button>
    </div>
    <div class="card wheel-card" style="margin-top:10px;">
      <h3 style="margin:0 0 8px 0;">La roue du dépôt</h3>
      <div class="muted" style="margin-bottom:10px;">
        Max ≤100 : fins 0 ou 5 · 100–300 : multiples de 10 · &gt;300 : …00, 25, 50, 75. Case 1 = min, 10 = max.
      </div>
      <div class="row">
        <input class="input" id="wheel-min-bet" type="number" min="0.01" step="0.01" placeholder="Mise min" style="max-width:140px;" />
        <input class="input" id="wheel-max-bet" type="number" min="0.01" step="0.01" placeholder="Mise max" style="max-width:140px;" />
        <button class="btn" id="wheel-generate">Générer 10 cases</button>
        <button class="btn primary" id="wheel-spin">Lancer la roue</button>
      </div>
      <div class="wheel-grid" id="wheel-grid">
        ${Array.from({ length: 10 })
          .map((_, i) => {
            const v = state.depositWheel.values[i];
            const active = state.depositWheel.selectedIndex === i ? "active" : "";
            return `<button class="wheel-cell ${active}" data-idx="${i}" type="button">${v != null ? formatDepositWheelFr(v) : "-"}</button>`;
          })
          .join("")}
      </div>
      <div class="muted" id="wheel-result" style="margin-top:8px;">
        ${state.depositWheel.selectedIndex != null ? `Case tirée: ${formatDepositWheelFr(state.depositWheel.values[state.depositWheel.selectedIndex])}` : "Aucune case tirée pour le moment."}
      </div>
    </div>
    <div class="table-wrap" style="margin-top:10px;">
      <table>
        <thead><tr><th>Slot</th><th>Provider</th><th>Type</th><th>Mise</th><th>Gain</th><th>x</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((b) => {
              const x = Number(b.bet || 0) > 0 ? Number(b.win || 0) / Number(b.bet || 1) : 0;
              return `<tr>
                <td>${b.slot_name || "-"}</td>
                <td>${b.provider || "-"}</td>
                <td>${b.bonus_type || "normal"}</td>
                <td>${money(b.bet || 0, hunt.currency)}</td>
                <td><input class="input bonus-win" data-id="${b.id}" type="number" step="0.01" min="0" value="${Number(b.win || 0).toFixed(2)}" /></td>
                <td>${x.toFixed(2)}x</td>
                <td><button class="btn red bonus-del" data-id="${b.id}">Suppr</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindBonusActions(hunt) {
  document.getElementById("add-bonus").onclick = async () => {
    try {
      const slot = document.getElementById("b-slot").value.trim();
      const provider = document.getElementById("b-provider").value.trim();
      const bet = Number(document.getElementById("b-bet").value || 0);
      const type = document.getElementById("b-type").value;
      if (!slot || !bet) throw new Error("Slot et mise requis.");
      await addBonus(hunt.id, { slot_name: slot, provider, bet, win: 0, bonus_type: type });
      state.hunts = await listMyHunts(state.user.id);
      renderPage();
    } catch (e) {
      toast(e.message || "Ajout impossible", false);
    }
  };
  const wheelMin = document.getElementById("wheel-min-bet");
  const wheelMax = document.getElementById("wheel-max-bet");
  const wheelResult = document.getElementById("wheel-result");
  const wheelCells = () => [...document.querySelectorAll(".wheel-cell")];
  const paintWheel = () => {
    wheelCells().forEach((cell, idx) => {
      const v = state.depositWheel.values[idx];
      cell.textContent = v != null ? formatDepositWheelFr(v) : "-";
      cell.classList.toggle("active", idx === state.depositWheel.selectedIndex);
    });
    if (wheelResult) {
      wheelResult.textContent =
        state.depositWheel.selectedIndex != null
          ? `Case tirée: ${formatDepositWheelFr(state.depositWheel.values[state.depositWheel.selectedIndex])}`
          : "Aucune case tirée pour le moment.";
    }
  };
  document.getElementById("wheel-generate").onclick = () => {
    try {
      state.depositWheel.values = generateDepositWheelValues(wheelMin.value, wheelMax.value);
      state.depositWheel.selectedIndex = null;
      paintWheel();
      toast("Roue du dépôt générée");
    } catch (e) {
      toast(e.message || "Plage invalide", false);
    }
  };
  document.getElementById("wheel-spin").onclick = () => {
    if (!state.depositWheel.values.length) {
      toast("Génère d'abord les 10 cases.", false);
      return;
    }
    const idx = Math.floor(Math.random() * 10);
    state.depositWheel.selectedIndex = idx;
    paintWheel();
    const betInput = document.getElementById("b-bet");
    if (betInput) betInput.value = state.depositWheel.values[idx].toFixed(2);
    const typeSelect = document.getElementById("b-type");
    if (typeSelect) typeSelect.value = "roue_depot";
    toast(`Roue: ${formatDepositWheelFr(state.depositWheel.values[idx])}`);
  };
  wheelCells().forEach((cell) => {
    cell.onclick = () => {
      const idx = Number(cell.getAttribute("data-idx"));
      if (!Number.isFinite(idx) || state.depositWheel.values[idx] == null) return;
      state.depositWheel.selectedIndex = idx;
      paintWheel();
      const betInput = document.getElementById("b-bet");
      if (betInput) betInput.value = state.depositWheel.values[idx].toFixed(2);
      const typeSelect = document.getElementById("b-type");
      if (typeSelect) typeSelect.value = "roue_depot";
    };
  });
  document.querySelectorAll(".bonus-win").forEach((el) => {
    el.onchange = async () => {
      try {
        const id = Number(el.getAttribute("data-id"));
        await updateBonus(id, { win: Number(el.value || 0) });
        state.hunts = await listMyHunts(state.user.id);
        renderPage();
      } catch (e) {
        toast(e.message || "Mise à jour impossible", false);
      }
    };
  });
  document.querySelectorAll(".bonus-del").forEach((el) => {
    el.onclick = async () => {
      try {
        const id = Number(el.getAttribute("data-id"));
        await deleteBonus(id);
        state.hunts = await listMyHunts(state.user.id);
        renderPage();
      } catch (e) {
        toast(e.message || "Suppression bonus impossible", false);
      }
    };
  });
}

async function renderAdmin(container) {
  container.innerHTML = `
    <section class="card">
      <h2 style="margin:0 0 8px 0;">Panel Admin</h2>
      <div class="muted">Gestion joueurs, soldes, profils, hunts et logs.</div>
    </section>
    <section class="card"><h3 style="margin:0 0 8px 0;">Utilisateurs</h3><div id="admin-users" class="muted">Chargement...</div></section>
    <section class="card"><h3 style="margin:0 0 8px 0;">Hunts globales</h3><div id="admin-hunts" class="muted">Chargement...</div></section>
    <section class="card"><h3 style="margin:0 0 8px 0;">Audit Logs</h3><div id="admin-logs" class="muted">Chargement...</div></section>
  `;
  try {
    const [users, hunts, logs] = await Promise.all([adminListUsers(), adminListHunts(), adminLogs(120)]);
    renderAdminUsers(users);
    renderAdminHunts(hunts);
    renderAdminLogs(logs);
  } catch (e) {
    toast(e.message || "Erreur admin", false);
  }
}

function renderAdminUsers(users) {
  const box = document.getElementById("admin-users");
  box.classList.remove("muted");
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Solde</th><th>Actions</th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `<tr>
            <td>${u.display_name || u.username || u.id}</td>
            <td>${u.email || "-"}</td>
            <td>${u.role}</td>
            <td>${u.status}</td>
            <td>${Number(u.balance_amount || 0).toFixed(2)}</td>
            <td>
              <div class="row">
                <button class="btn admin-role" data-id="${u.id}" data-role="${u.role === "admin" ? "player" : "admin"}">${u.role === "admin" ? "Retirer admin" : "Passer admin"}</button>
                <button class="btn admin-status" data-id="${u.id}" data-status="${u.status === "active" ? "suspended" : "active"}">${u.status === "active" ? "Suspendre" : "Activer"}</button>
                <button class="btn green admin-set" data-id="${u.id}">Set solde</button>
                <button class="btn admin-add" data-id="${u.id}">+/- solde</button>
              </div>
            </td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  box.querySelectorAll(".admin-role").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const role = btn.getAttribute("data-role");
      const reason = prompt("Raison (audit log):", "role update") || "role update";
      await adminSetRole(id, role, reason);
      renderPage();
    };
  });
  box.querySelectorAll(".admin-status").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const status = btn.getAttribute("data-status");
      const reason = prompt("Raison (audit log):", "status update") || "status update";
      await adminSetStatus(id, status, reason);
      renderPage();
    };
  });
  box.querySelectorAll(".admin-set").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const amount = Number(prompt("Nouveau solde:") || "0");
      const reason = prompt("Raison (audit log):", "set balance") || "set balance";
      await adminSetBalance(id, amount, reason);
      renderPage();
    };
  });
  box.querySelectorAll(".admin-add").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const delta = Number(prompt("Delta (+/-):") || "0");
      const reason = prompt("Raison (audit log):", "adjust balance") || "adjust balance";
      await adminAdjustBalance(id, delta, reason);
      renderPage();
    };
  });
}

function renderAdminHunts(hunts) {
  const box = document.getElementById("admin-hunts");
  box.classList.remove("muted");
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Joueur</th><th>Hunt</th><th>Départ</th><th>Devise</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>
          ${hunts
            .map(
              (h) => `<tr>
            <td>${h.profiles?.display_name || h.profiles?.username || h.user_id}</td>
            <td>${h.name}</td>
            <td>${Number(h.starting_balance || 0).toFixed(2)}</td>
            <td>${h.currency}</td>
            <td>${new Date(h.created_at).toLocaleString("fr-FR")}</td>
            <td>
              <div class="row">
                <button class="btn admin-arch" data-id="${h.id}" data-arch="${h.archived ? "false" : "true"}">${h.archived ? "Désarchiver" : "Archiver"}</button>
                <button class="btn red admin-delhunt" data-id="${h.id}">Suppr</button>
              </div>
            </td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  box.querySelectorAll(".admin-arch").forEach((btn) => {
    btn.onclick = async () => {
      await adminArchiveHunt(btn.getAttribute("data-id"), btn.getAttribute("data-arch") === "true");
      renderPage();
    };
  });
  box.querySelectorAll(".admin-delhunt").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Supprimer définitivement cette hunt ?")) return;
      await adminDeleteHunt(btn.getAttribute("data-id"));
      renderPage();
    };
  });
}

function renderAdminLogs(logs) {
  const box = document.getElementById("admin-logs");
  box.classList.remove("muted");
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead>
        <tbody>
          ${logs
            .map(
              (l) => `<tr>
            <td>${new Date(l.created_at).toLocaleString("fr-FR")}</td>
            <td>${l.admin_id}</td>
            <td>${l.action}</td>
            <td>${l.target_user_id || l.target_table || "-"}</td>
            <td><code>${JSON.stringify(l.payload || {})}</code></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

boot().catch((e) => {
  app.innerHTML = `<div class="auth-shell"><div class="auth-box"><h3>Erreur de démarrage</h3><pre>${mapAuthError(e)}</pre></div></div>`;
});
