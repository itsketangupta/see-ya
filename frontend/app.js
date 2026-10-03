const grants = document.querySelector("#grants");
const form = document.querySelector("#submission-form");
const status = document.querySelector("#form-status");
const authAction = document.querySelector("#auth-action");
const routeNames = ["landing", "home", "projects", "explore", "leaderboard", "shop", "faq", "submit", "me", "admin"];
const privateRoutes = new Set(["home", "projects", "explore", "leaderboard", "me", "submit", "admin"]);
let rgb = Number(localStorage.getItem("see-ya-rgb") || 0);
let projectCount = Number(localStorage.getItem("see-ya-projects") || 0);
let hours = Number(localStorage.getItem("see-ya-hours") || 0);
let currentUser = null;
let authenticated = null;
const editingSubmissionId = new URLSearchParams(window.location.search).get("edit");
const authError = new URLSearchParams(window.location.search).get("auth_error");

function currentRoute() {
  const route = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  return routeNames.includes(route) ? route : "landing";
}

function renderRoute() {
  const route = currentRoute();
  if (authenticated === false && privateRoutes.has(route)) {
    history.replaceState({}, "", "/");
    showLoginModal();
    return renderRoute();
  }
  document.body.dataset.route = route;
  const sidebar = document.querySelector("#sidebar");
  const footer = document.querySelector(".portal-footer");
  const isLanding = route === "landing";
  sidebar.hidden = isLanding;
  footer.hidden = isLanding;
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === route));
  document.querySelectorAll("main [class*='page-']").forEach((section) => {
    section.hidden = !section.classList.contains(`page-${route}`);
  });
  document.querySelector("#sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  if (route === "me" && authenticated === true) window.setTimeout(loadShopOrders, 0);
}

const loginModal = document.querySelector("#login-modal");
function showLoginModal() {
  loginModal.hidden = false;
  document.body.classList.add("modal-open");
}
function closeLoginModal() {
  loginModal.hidden = true;
  document.body.classList.remove("modal-open");
}
document.querySelector("#login-modal-close").addEventListener("click", closeLoginModal);
loginModal.addEventListener("click", (event) => { if (event.target === loginModal) closeLoginModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !loginModal.hidden) closeLoginModal(); });

function renderNavigation(isSignedIn) {
  document.querySelectorAll("[data-private-nav]").forEach((link) => {
    link.hidden = !isSignedIn;
  });
  document.querySelectorAll("[data-admin-nav]").forEach((link) => {
    link.hidden = !isSignedIn || !currentUser?.is_admin;
  });
  renderRoute();
}

document.querySelectorAll("a[data-route], .brand").forEach((link) => link.addEventListener("click", (event) => {
  const href = link.getAttribute("href");
  if (href?.startsWith("/")) {
    const route = href.slice(1).split("/")[0] || "landing";
    if (authenticated === false && privateRoutes.has(route)) {
      event.preventDefault();
      showLoginModal();
      return;
    }
    event.preventDefault();
    history.pushState({}, "", href);
    renderRoute();
    if (href === "/submit") window.setTimeout(loadDraftFromRoute, 0);
  }
}));
window.addEventListener("popstate", renderRoute);
document.querySelector("#mobile-menu").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelectorAll(".shop-track").forEach((track) => { track.innerHTML += track.innerHTML; });
renderRoute();

function renderBalance() {
  const shopBalance = document.querySelector("#shop-balance");
  if (shopBalance) shopBalance.textContent = `${rgb} RGB`;
}
renderBalance();

fetch("/api/me").then((response) => response.json()).then(({ user, stats }) => {
  if (!user) {
    document.body.dataset.auth = "guest";
    authenticated = false;
    closeLoginModal();
    renderNavigation(false);
    if (authError) {
      document.querySelector("#login-modal-title").innerHTML = "Sign in to<br /><span>try again.</span>";
      document.querySelector(".login-modal-card > p:not(.eyebrow)")?.replaceChildren(document.createTextNode("Your previous sign-in tab expired. Start a fresh Hack Club sign-in from here."));
      showLoginModal();
    }
    authAction.textContent = "Sign in with Hack Club";
    authAction.href = "/auth/login";
    if (window.location.pathname === "/") {
      history.replaceState({}, "", "/");
      renderRoute();
    }
    return;
  }
  document.body.dataset.auth = "signed-in";
  authenticated = true;
  closeLoginModal();
  currentUser = { ...user, is_admin: Boolean(user.is_admin) };
  renderNavigation(true);
  if (window.location.pathname === "/") {
    history.replaceState({}, "", "/home");
    renderRoute();
  }
  authAction.textContent = `${user.name} · Sign out`;
  document.querySelector("#me-name").textContent = user.name;
  document.querySelector("#me-email").textContent = user.email || "";
  const hackatimeConnect = document.querySelector("#hackatime-connect");
  document.querySelector("#hackatime-status").textContent = user.hackatime_connected ? "Connected" : "Not connected";
  if (user.hackatime_connected) {
    hackatimeConnect.textContent = "Hackatime connected";
    hackatimeConnect.removeAttribute("href");
    hackatimeConnect.classList.add("connected-button");
    loadHackatimeProjects();
  }
  authAction.href = "#";
  authAction.addEventListener("click", async (event) => {
    event.preventDefault();
    await fetch("/auth/logout", { method: "POST" });
    window.location.assign("/");
  });
  rgb = Number(stats.rgb || 0);
  projectCount = Number(stats.projects || 0);
  hours = Number(stats.hours || 0);
  localStorage.removeItem("see-ya-rgb");
  localStorage.removeItem("see-ya-projects");
  localStorage.removeItem("see-ya-hours");
  renderBalance();
  if (currentUser.is_admin) loadAdmin();
}).catch(() => {
  authenticated = false;
  document.body.dataset.auth = "guest";
  renderNavigation(false);
  if (privateRoutes.has(currentRoute())) {
    history.replaceState({}, "", "/");
    renderRoute();
    showLoginModal();
  }
});

async function loadAdmin() {
  const statusNode = document.querySelector("#admin-status");
  const ordersNode = document.querySelector("#admin-orders");
  if (!ordersNode) return;
  statusNode.textContent = "Loading…";
  try {
    const ordersResponse = await fetch("/api/admin/orders");
    if (!ordersResponse.ok) throw new Error("Admin order data could not be loaded.");
    const { orders } = await ordersResponse.json();
    ordersNode.innerHTML = orders.length ? orders.map((item) => `<article class="admin-row"><div class="admin-row-main"><strong>${escapeHtml(item.grant_name)}</strong><span>${escapeHtml(item.name || "Unknown builder")} · ${escapeHtml(item.email || "No email")} · ${item.quantity || 1} item${(item.quantity || 1) === 1 ? "" : "s"} · ${item.cost} RGB</span><p>Current status: ${escapeHtml(item.status)}</p></div><div class="admin-row-controls"><select data-order-id="${item.id}" aria-label="Order status"><option value="requested" ${item.status !== "fulfilled" ? "selected" : ""}>Requested</option><option value="fulfilled" ${item.status === "fulfilled" ? "selected" : ""}>Fulfilled</option></select><textarea class="admin-update-input" data-update-order="${item.id}" maxlength="1000" placeholder="Write a fulfilment update for this builder"></textarea><button class="button outline admin-update-button" data-update-order="${item.id}" type="button">Post update</button></div></article>`).join("") : '<p class="empty-state">No shop orders yet.</p>';
    statusNode.textContent = "";
  } catch (error) {
    statusNode.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

document.querySelector("#admin-refresh")?.addEventListener("click", loadAdmin);
document.querySelector("#admin-orders")?.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order-id]");
  if (!select) return;
  const response = await fetch(`/api/admin/orders/${select.dataset.orderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    document.querySelector("#admin-status").textContent = result.error || "Order update failed.";
    return;
  }
  document.querySelector("#admin-status").textContent = "Order status saved.";
  await loadAdmin();
});
document.querySelector("#admin-orders")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-update-order]");
  if (!button) return;
  const input = button.parentElement.querySelector(`[data-update-order="${button.dataset.updateOrder}"]`);
  const message = input?.value.trim();
  if (!message) { document.querySelector("#admin-status").textContent = "Write an update first."; return; }
  button.disabled = true;
  const response = await fetch(`/api/admin/orders/${button.dataset.updateOrder}/updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) document.querySelector("#admin-status").textContent = result.error || "Update failed.";
  else { document.querySelector("#admin-status").textContent = "Fulfilment update posted."; await loadAdmin(); loadShopOrders(); }
  button.disabled = false;
});

fetch("/api/projects").then((response) => response.json()).then(({ projects }) => {
  document.querySelector("#project-grid").innerHTML = projects.map((project, index) => `<article class="project-card project-${index}"><div class="project-art"><span>${project.type}</span><b>${String(index + 1).padStart(2, "0")}</b></div><div class="project-card-copy"><div><h3>${project.name}</h3><p>by ${project.author}</p></div><span class="approved">approved</span><p>${project.description}</p><footer><span>${project.hours} hours</span><span>${project.hours * 50} RGB earned</span></footer></div></article>`).join("");
}).catch(() => { document.querySelector("#project-grid").innerHTML = "<p>Projects are taking a quick colour break.</p>"; });

function projectRow(project) {
  const statusLabel = String(project.status || "pending").replace("_", " ");
  const link = project.link ? `<a href="${project.link}" target="_blank" rel="noreferrer">${project.link}</a>` : "<span class=\"draft-note\">Finish the links before submitting for review.</span>";
  return `<article class="my-project-row"><div class="project-number">◈</div><div class="my-project-info"><h3>${project.name}</h3>${link}</div><div class="my-project-hours"><span>${project.hours}h</span></div><span class="project-status status-${project.status}">${statusLabel}</span><strong>${project.status === "approved" ? `${project.rgb} RGB` : "—"}</strong></article>`;
}

function renderMyProjects(projects) {
  const empty = '<div class="empty-state">You have not shipped a project yet. Your first experiment belongs here.</div>';
  const cards = projects.length ? projects.map((project, index) => {
    const statusLabel = String(project.status || "pending").replace("_", " ");
    const link = project.link ? `<p>${project.link}</p>` : "<p class=\"draft-note\">Draft saved — add your links and submit when ready.</p>";
    const edit = ["draft", "changes_needed"].includes(project.status) ? `<a class="edit-project-link" href="/submit?edit=${project.id}" data-route="submit">Edit draft ↗</a>` : "";
    return `<article class="home-project-card project-${index % 3}"><div class="home-card-art"><span>${statusLabel}</span><b>${String(index + 1).padStart(2, "0")}</b></div><div class="home-card-copy"><div><h3>${project.name}</h3><span class="project-status status-${project.status}">${statusLabel}</span></div>${link}<footer><span>${project.hours} hours</span><strong>${project.status === "approved" ? `${project.rgb} RGB` : "—"}</strong></footer>${edit}</div></article>`;
  }).join("") : empty;
  document.querySelector("#home-project-grid").innerHTML = cards;
  document.querySelector("#my-project-list").innerHTML = projects.length ? projects.map(projectRow).join("") : empty;
  const totalHours = projects.reduce((total, project) => total + Number(project.hours || 0), 0);
  document.querySelector("#home-hours").textContent = `${totalHours}h`;
  document.querySelector("#activity-list").innerHTML = projects.length ? projects.slice(0, 5).map((project) => `<p><b>${project.status === "approved" ? "Project approved" : "Project submitted"}</b><span>${project.name} · ${project.hours}h</span></p>`).join("") : "<p>New submissions and reviews will appear here.</p>";
}

fetch("/api/my-projects").then((response) => response.ok ? response.json() : { projects: [] }).then(({ projects }) => renderMyProjects(projects)).catch(() => renderMyProjects([]));

function loadDraftFromRoute() {
  const id = new URLSearchParams(window.location.search).get("edit");
  if (!id) return;
  fetch(`/api/submissions/${encodeURIComponent(id)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("Draft could not be loaded."))).then(({ submission }) => {
    window.pendingHackatimeProject = submission.hackatime_project;
    const fields = { project: submission.project, projectType: submission.project_type, description: submission.description, codeUrl: submission.code_url, demoUrl: submission.demo_url, readmeUrl: submission.readme_url, screenshotUrl: submission.screenshot_url, hackatimeProject: submission.hackatime_project, hackatimeTimeUrl: submission.hackatime_time_url, aiDescription: submission.ai_description, otherHcProgram: submission.other_hc_program, hours: submission.hours };
    Object.entries(fields).forEach(([key, value]) => { if (form.elements[key] && value !== null && value !== undefined) form.elements[key].value = value; });
    if (form.elements.aiUsed) form.elements.aiUsed.checked = submission.ai_used;
    document.querySelector(".submit-intro .eyebrow").textContent = "03 — Edit your draft";
  }).catch((error) => { status.className = "form-status error"; status.textContent = error.message; });
}
if (editingSubmissionId) loadDraftFromRoute();

fetch("/api/leaderboard").then((response) => response.json()).then(({ leaderboard }) => {
  document.querySelector("#leaderboard-list").innerHTML = leaderboard.length ? leaderboard.map((person, index) => `<div class="leaderboard-row ${index < 3 ? "top-rank" : ""}"><b>${String(index + 1).padStart(2, "0")}</b><span class="leader-avatar">${String(person.name || "?").slice(0, 1).toUpperCase()}</span><strong>${person.name}</strong><span>${person.projects} projects</span><span>${person.hours}h</span><em>${person.rgb} RGB</em></div>`).join("") : '<div class="empty-state">The leaderboard will appear after projects are approved.</div>';
}).catch(() => {});

fetch("/api/shop").then((response) => response.json()).then(({ grants: items }) => {
  grants.innerHTML = items.map((item, index) => `<article class="grant-card shop-grant-${index}" tabindex="0" role="button" data-grant="${encodeURIComponent(JSON.stringify(item))}" style="--accent:${item.color}"><div class="grant-art">${item.image ? `<img src="${item.image}" alt="${item.name}" />` : ""}<span>${String(index + 1).padStart(2, "0")}</span><b>${item.icon}</b></div><div class="grant-card-copy"><p class="grant-cost">${item.cost} RGB</p><h3>${item.name}</h3><p>${item.description}</p><button class="shop-button" data-id="${item.id}" data-cost="${item.cost}" data-name="${item.name}" type="button">${rgb >= item.cost ? "Request this grant" : "Save for this"} <span>↗</span></button></div></article>`).join("");
  document.querySelectorAll(".grant-card").forEach((card) => {
    const open = () => openGrantModal(JSON.parse(decodeURIComponent(card.dataset.grant)));
    card.addEventListener("click", (event) => { if (!event.target.closest(".shop-button")) open(); });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
  document.querySelectorAll(".shop-button").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const card = button.closest(".grant-card");
    if (card) openGrantModal(JSON.parse(decodeURIComponent(card.dataset.grant)));
  }));
}).catch(() => { grants.innerHTML = "<p>Grants are taking a quick colour break. Refresh to try again.</p>"; });

const grantModal = document.querySelector("#grant-modal");
let selectedGrant = null;
let grantQuantity = 1;
function openGrantModal(item) {
  selectedGrant = item;
  grantQuantity = 1;
  document.querySelector("#grant-modal-title").textContent = item.name;
  document.querySelector("#grant-modal-description").textContent = item.description;
  document.querySelector("#grant-modal-cost").textContent = `${item.cost} RGB each`;
  updateGrantQuantity();
  document.querySelector("#grant-modal-balance").textContent = `${rgb} RGB`;
  document.querySelector("#grant-modal-status").textContent = rgb >= item.cost ? "You have enough RGB to request this grant." : `You need ${item.cost - rgb} more RGB. Keep building!`;
  document.querySelector("#grant-modal-request").textContent = rgb >= item.cost ? "Request this grant ↗" : "Keep building ↗";
  const art = document.querySelector("#grant-modal-art");
  art.innerHTML = item.image ? `<img src="${item.image}" alt="${item.name}" />` : `<span>${item.icon}</span>`;
  grantModal.hidden = false;
  document.body.classList.add("modal-open");
}
function closeGrantModal() { grantModal.hidden = true; selectedGrant = null; document.body.classList.remove("modal-open"); }
document.querySelector("#grant-modal-close").addEventListener("click", closeGrantModal);
grantModal.addEventListener("click", (event) => { if (event.target === grantModal) closeGrantModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !grantModal.hidden) closeGrantModal(); });
document.querySelector("#grant-modal-request").addEventListener("click", () => {
  if (!selectedGrant) return;
  const requestButton = document.querySelector("#grant-modal-request");
  requestButton.disabled = true;
  fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId: selectedGrant.id, quantity: grantQuantity }) }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The order could not be placed.");
    rgb -= result.order.cost;
    localStorage.setItem("see-ya-rgb", String(rgb));
    renderBalance();
    document.querySelector("#grant-modal-status").textContent = `Order placed for ${grantQuantity} item${grantQuantity === 1 ? "" : "s"}.`;
    loadShopOrders();
    window.addEventListener("focus", () => {
      if (currentRoute() === "me" && authenticated === true) loadShopOrders();
    });
    window.addEventListener("pageshow", () => {
      if (currentRoute() === "me" && authenticated === true) loadShopOrders();
    });
    window.setInterval(() => {
      if (currentRoute() === "me" && authenticated === true && document.visibilityState === "visible") loadShopOrders();
    }, 15000);
    window.setTimeout(closeGrantModal, 900);
  }).catch((error) => {
    document.querySelector("#grant-modal-status").textContent = error.message;
  }).finally(() => { requestButton.disabled = false; });
});

function updateGrantQuantity() {
  if (!selectedGrant) return;
  const total = selectedGrant.cost * grantQuantity;
  document.querySelector("#grant-quantity").textContent = String(grantQuantity);
  document.querySelector("#grant-modal-total").textContent = `${total} RGB`;
  document.querySelector("#grant-modal-balance").textContent = `${rgb} RGB`;
  document.querySelector("#grant-modal-status").textContent = rgb >= total ? "You have enough RGB to request this quantity." : `You need ${total - rgb} more RGB. Keep building!`;
  document.querySelector("#grant-modal-request").textContent = rgb >= total ? "Request this grant ↗" : "Keep building ↗";
}
document.querySelector("#grant-quantity-minus").addEventListener("click", () => { if (grantQuantity > 1) { grantQuantity -= 1; updateGrantQuantity(); } });
document.querySelector("#grant-quantity-plus").addEventListener("click", () => { if (grantQuantity < 100) { grantQuantity += 1; updateGrantQuantity(); } });

function loadShopOrders() {
  const orders = document.querySelector("#shop-orders");
  if (!orders) return;
  fetch("/api/orders").then((response) => {
    if (!response.ok) throw new Error("Sign in to view requests");
    return response.json();
  }).then(({ orders: items }) => {
    const markup = items.length ? items.map((item) => `<div class="shop-order"><div><strong>${item.cost} RGB · ${item.quantity || 1} × ${escapeHtml(item.grant_name)}</strong><span>${new Date(item.created_at).toLocaleDateString()}</span>${(item.updates || []).map((update) => `<p class="fulfillment-update"><b>${new Date(update.created_at).toLocaleDateString()}</b> ${escapeHtml(update.message)}</p>`).join("")}</div><b>${item.status || "requested"}</b></div>`).join("") : '<div class="empty-state">Your requests will appear here after you choose a grant.</div>';
    orders.innerHTML = markup;
    const meOrders = document.querySelector("#me-orders");
    if (meOrders) meOrders.innerHTML = markup;
  }).catch((error) => { orders.innerHTML = `<div class="empty-state">${error.message}</div>`; });
}
loadShopOrders();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = event.submitter?.value || "submit";
  if (action === "submit") {
    const requiredForReview = ["project", "projectType", "description", "codeUrl", "demoUrl", "readmeUrl", "hours", "hackatimeProject"];
    const missing = requiredForReview.some((name) => !String(new FormData(form).get(name) || "").trim());
    if (missing || !form.elements.reviewConsent.checked) {
      status.className = "form-status error";
      status.textContent = "Complete the project details, links, hours, and review confirmation before submitting.";
      return;
    }
  }
  const button = form.querySelector("button");
  form.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  status.className = "form-status";
  status.textContent = action === "save" ? "Saving your draft…" : "Sending your project into review…";
  try {
    const values = Object.fromEntries(new FormData(form));
    values.action = action;
    if (action === "save") values.reviewConsent = true;
    if (action === "submit" && !currentUser?.hackatime_connected) throw new Error("Connect Hackatime from the Me page before submitting.");
    const endpoint = editingSubmissionId ? `/api/submissions/${encodeURIComponent(editingSubmissionId)}` : "/api/submissions";
    const response = await fetch(endpoint, { method: editingSubmissionId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (result.submission.status === "approved") rgb += result.submission.rgb;
    projectCount += 1;
    hours += Number(result.submission.hours);
    localStorage.setItem("see-ya-rgb", String(rgb));
    localStorage.setItem("see-ya-projects", String(projectCount));
    localStorage.setItem("see-ya-hours", String(hours));
    renderBalance();
    status.className = "form-status success";
    status.textContent = action === "save" ? "Draft saved. Returning home…" : "Submitted for review! Returning home…";
    form.reset();
    window.setTimeout(() => window.location.assign("/home"), 350);
  } catch (error) {
    status.className = "form-status error";
    status.textContent = error.message || "Could not submit right now.";
  } finally { form.querySelectorAll("button").forEach((item) => { item.disabled = false; }); }
});

function loadHackatimeProjects() {
  fetch("/api/hackatime/projects").then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load Hackatime projects."))).then(({ projects = [] }) => {
    const select = document.querySelector("#hackatime-project-select");
    select.innerHTML = `<option value="">Choose a Hackatime project…</option>${projects.map((project) => `<option value="${String(project.name).replace(/"/g, "&quot;")}">${project.name} — ${Math.round(Number(project.total_seconds || 0) / 3600 * 10) / 10}h</option>`).join("")}`;
    if (window.pendingHackatimeProject) select.value = window.pendingHackatimeProject;
  }).catch(() => {});
}
