import createIconElement from "/vendor/lucide/createElement.mjs";
import ActivityIcon from "/vendor/lucide/icons/activity.mjs";
import RadioIcon from "/vendor/lucide/icons/radio.mjs";
import RefreshCwIcon from "/vendor/lucide/icons/refresh-cw.mjs";
import SettingsIcon from "/vendor/lucide/icons/settings.mjs";
import UsersIcon from "/vendor/lucide/icons/users.mjs";

const $ = (selector) => document.querySelector(selector);

const icons = {
  activity: ActivityIcon,
  radio: RadioIcon,
  "refresh-cw": RefreshCwIcon,
  settings: SettingsIcon,
  users: UsersIcon,
};

for (const slot of document.querySelectorAll("[data-icon]")) {
  const icon = icons[slot.dataset.icon];
  if (icon) slot.append(createIconElement(icon, { "stroke-width": 1.8 }));
}

const elements = {
  notice: $("#notice"),
  navStatusDot: $("#nav-status-dot"),
  navReadyCount: $("#nav-ready-count"),
  navRunningCount: $("#nav-running-count"),
  navAccountCount: $("#nav-account-count"),
  navHealthCount: $("#nav-health-count"),
  refreshStatus: $("#refresh-status"),
  liveSummary: $("#live-summary"),
  channelUrl: $("#channel-url"),
  platformSelect: $("#platform-select"),
  roomSaveState: $("#room-save-state"),
  messageForm: $("#message-form"),
  messageContent: $("#message-content"),
  messageCount: $("#message-count"),
  messageList: $("#message-list"),
  emptyState: $("#empty-state"),
  nextMessage: $("#next-message"),
  liveAccountList: $("#live-account-list"),
  cooldown: $("#cooldown"),
  sendScope: $("#send-scope"),
  sendNext: $("#send-next"),
  sendAll: $("#send-all"),
  stopBulk: $("#stop-bulk"),
  bulkProgress: $("#bulk-progress"),
  bulkStatus: $("#bulk-status"),
  bulkCount: $("#bulk-count"),
  bulkProgressBar: $("#bulk-progress-bar"),
  bulkError: $("#bulk-error"),
  accountSummary: $("#account-summary"),
  addAccount: $("#add-account"),
  accountPlatform: $("#account-platform"),
  accountList: $("#account-list"),
  accountInspector: $("#account-inspector"),
  settingsSaveState: $("#settings-save-state"),
  delaySeconds: $("#delay-seconds"),
  displayNames: $("#display-names"),
  renameEveryComments: $("#rename-every-comments"),
  profileCount: $("#profile-count"),
  addMessage: $("#message-form button[type='submit']"),
  checkHealth: $("#check-health"),
  healthSummary: $("#health-summary"),
  healthList: $("#health-list"),
  healthEmpty: $("#health-empty"),
};

let state = null;
let currentView = "live";
let selectedAccountId = null;
let cooldownTimer = null;
let bulkPollTimer = null;
let activeBulkRun = null;
let settingsTimer = null;
let settingsSaveRunning = false;
let settingsDirty = false;
let statusRefreshRunning = false;
let healthChecks = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Yêu cầu thất bại (${response.status}).`);
  return body;
}

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.className = `notice${type === "success" ? " success" : type === "warning" ? " warning" : ""}`;
  elements.notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { elements.notice.hidden = true; }, 6000);
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function enabledAccounts() {
  return state?.accounts?.filter((account) => account.enabled && account.platform === state.settings.platform) || [];
}

function accountLabel(account) {
  return account.profileName || account.name;
}

function switchView(view) {
  if (!["live", "accounts", "health", "settings"].includes(view)) return;
  currentView = view;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  for (const panel of document.querySelectorAll("[data-view-panel]")) {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }
  if (view === "accounts") renderAccounts();
  if (view === "health") renderHealth();
}

function accountPresentation(account) {
  if (!account.enabled) return { label: "Tạm tắt", className: "" };
  if (account.session?.error) return { label: "Lỗi session", className: "error" };
  if (!account.session?.running) return { label: "Chưa mở", className: "" };
  if (account.session.loginState === "manual_login") return { label: "Đang đăng nhập an toàn", className: "warning" };
  if (account.session.loginState === "signed_out") return { label: "Chưa đăng nhập", className: "warning" };
  if (account.session.readyToComment) return { label: "Sẵn sàng", className: "ready" };
  return { label: "Chrome đang mở", className: "warning" };
}

function aggregateStatus() {
  const accounts = enabledAccounts();
  const ready = accounts.filter((account) => account.session?.readyToComment).length;
  const running = accounts.filter((account) => account.session?.running).length;
  return { accounts, ready, running };
}

function statusDot(className = "") {
  const dot = document.createElement("span");
  dot.className = `status-dot${className ? ` ${className}` : ""}`;
  return dot;
}

function renderAggregateStatus() {
  const { accounts, ready, running } = aggregateStatus();
  const dotClass = accounts.length && ready === accounts.length ? "ready" : running ? "warning" : "";
  elements.navStatusDot.className = `status-dot${dotClass ? ` ${dotClass}` : ""}`;
  elements.navReadyCount.textContent = `${ready}/${accounts.length} sẵn sàng`;
  elements.navRunningCount.textContent = `${running} Chrome đang mở`;
  elements.navAccountCount.textContent = state.accounts.length;
  const down = healthChecks.filter((item) => item.status === "down").length;
  elements.navHealthCount.textContent = down ? String(down) : "";
}

function renderLiveAccounts() {
  elements.liveAccountList.replaceChildren();
  for (const account of enabledAccounts()) {
    const presentation = accountPresentation(account);
    const item = document.createElement("li");
    item.className = "live-account-row";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = accountLabel(account);
    const detail = document.createElement("small");
    detail.textContent = `${account.platform === "loco" ? "Loco" : "Gosh"} · ${presentation.label}`;
    copy.append(name, detail);
    item.append(statusDot(presentation.className), copy);
    elements.liveAccountList.append(item);
  }
}

function renderMessages() {
  elements.messageList.replaceChildren();
  elements.messageCount.textContent = state.messages.length;
  elements.emptyState.hidden = state.messages.length > 0;
  elements.nextMessage.textContent = state.nextMessage?.content || "Kho bình luận đang trống.";

  for (const message of state.messages) {
    const item = document.createElement("li");
    item.className = `message-item${message.id === state.nextMessage?.id ? " is-next" : ""}`;
    const content = document.createElement("p");
    content.textContent = message.content;
    const remove = document.createElement("button");
    remove.className = "delete-message";
    remove.type = "button";
    remove.textContent = "Xóa";
    remove.disabled = Boolean(state.bulkSend?.running);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Xóa bình luận “${message.content}”?`)) return;
      try {
        state = await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
        render();
      } catch (error) {
        showNotice(error.message);
      }
    });
    item.append(content, remove);
    elements.messageList.append(item);
  }
}

function renderCooldown() {
  window.clearInterval(cooldownTimer);
  if (!state?.lastSentAt) {
    elements.cooldown.textContent = "Sẵn sàng";
    return;
  }
  const update = () => {
    const elapsed = Math.floor((Date.now() - Date.parse(state.lastSentAt)) / 1000);
    const remaining = Math.max(0, state.settings.delaySeconds - elapsed);
    elements.cooldown.textContent = remaining ? `Chờ ${remaining}s` : "Sẵn sàng";
    if (!remaining) window.clearInterval(cooldownTimer);
  };
  update();
  cooldownTimer = window.setInterval(update, 1000);
}

function bulkPhaseLabel(bulk) {
  const labels = {
    starting: "Đang chuẩn bị…",
    waiting: "Đang chờ giữa hai mẫu…",
    sending: bulk.currentAccount ? `Đang gửi · ${bulk.currentAccount}` : "Đang gửi…",
    renaming: "Đang đổi tên tự động…",
    stopping: "Đang dừng…",
    stopped: "Đã dừng",
    completed: "Đã gửi xong",
    completed_with_errors: "Đã xong, có lỗi",
    failed: bulk.error || "Gửi thất bại",
  };
  return labels[bulk.phase] || "Sẵn sàng";
}

function renderBulkSend() {
  const bulk = state.bulkSend || { running: false, total: 0, sent: 0, failed: 0, phase: "idle" };
  const accountCount = enabledAccounts().length;
  const attempted = (bulk.sent || 0) + (bulk.failed || 0);
  const percent = bulk.total ? Math.min(100, Math.round((attempted / bulk.total) * 100)) : 0;
  const failures = bulk.failures || [];
  const running = Boolean(bulk.running);

  elements.bulkProgress.hidden = bulk.phase === "idle";
  elements.bulkStatus.textContent = bulkPhaseLabel(bulk);
  elements.bulkCount.textContent = bulk.failed ? `${attempted}/${bulk.total} · ${bulk.failed} lỗi` : `${attempted}/${bulk.total}`;
  elements.bulkProgressBar.style.width = `${percent}%`;
  elements.bulkProgress.classList.toggle("failed", bulk.phase === "failed");
  elements.bulkProgress.classList.toggle("has-errors", Boolean(bulk.failed) && bulk.phase !== "failed");
  elements.bulkError.hidden = !failures.length;
  elements.bulkError.textContent = failures.length ? `${failures.at(-1).accountName}: ${failures.at(-1).error}` : "";

  elements.sendScope.textContent = `${accountCount} tài khoản`;
  elements.sendNext.textContent = accountCount > 1 ? `Gửi một ×${accountCount}` : "Gửi một";
  elements.sendNext.disabled = running || !state.nextMessage || !accountCount;
  elements.sendAll.disabled = running || !state.messages.length || !accountCount;
  elements.stopBulk.hidden = !running;
  elements.stopBulk.disabled = bulk.phase === "stopping";

  for (const control of [elements.channelUrl, elements.messageContent, elements.addMessage, elements.addAccount, elements.delaySeconds, elements.displayNames, elements.renameEveryComments]) {
    control.disabled = running;
  }
}

function renderLive() {
  const accountCount = enabledAccounts().length;
  elements.liveSummary.textContent = `${state.messages.length} bình luận · ${accountCount} tài khoản`;
  renderMessages();
  renderLiveAccounts();
  renderCooldown();
  renderBulkSend();
}

function createAccountRow(account) {
  const presentation = accountPresentation(account);
  const row = document.createElement("li");
  row.className = `account-row${account.id === selectedAccountId ? " selected" : ""}${account.enabled ? "" : " disabled-account"}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Chọn ${accountLabel(account)}`);

  const nameCell = document.createElement("span");
  nameCell.className = "account-name-cell";
  const name = document.createElement("strong");
  name.textContent = accountLabel(account);
  nameCell.append(statusDot(presentation.className), name);

  const status = document.createElement("span");
  status.className = "account-status-text";
  status.textContent = presentation.label;

  const platform = document.createElement("span");
  platform.className = `platform-badge ${account.platform}`;
  platform.textContent = account.platform === "loco" ? "Loco" : "Gosh";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "account-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = account.enabled;
  toggle.disabled = Boolean(state.bulkSend?.running);
  const toggleText = document.createElement("span");
  toggleText.textContent = account.enabled ? "Bật" : "Tắt";
  toggle.addEventListener("click", (event) => event.stopPropagation());
  toggle.addEventListener("change", async () => {
    try {
      state = await api(`/api/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: toggle.checked }),
      });
      render();
    } catch (error) {
      showNotice(error.message);
      renderAccounts();
    }
  });
  toggleLabel.addEventListener("click", (event) => event.stopPropagation());
  toggleLabel.append(toggle, toggleText);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "row-action";
  open.textContent = account.session?.loginState === "signed_out" ? "Đăng nhập an toàn" : "Mở Chrome";
  open.disabled = Boolean(state.bulkSend?.running);
  open.addEventListener("click", (event) => {
    event.stopPropagation();
    void openAccount(account, open);
  });

  const select = () => {
    selectedAccountId = account.id;
    renderAccounts();
  };
  row.addEventListener("click", select);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  row.append(nameCell, platform, status, toggleLabel, open);
  return row;
}

function inspectorSection(title) {
  const section = document.createElement("section");
  section.className = "inspector-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  return section;
}

function renderInspector(account) {
  elements.accountInspector.replaceChildren();
  if (!account) {
    const empty = document.createElement("div");
    empty.className = "inspector-empty";
    empty.textContent = "Chọn một tài khoản";
    elements.accountInspector.append(empty);
    return;
  }

  const presentation = accountPresentation(account);
  const head = document.createElement("div");
  head.className = "inspector-head";
  const copy = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = accountLabel(account);
  const sub = document.createElement("p");
  sub.textContent = `${account.platform === "loco" ? "Loco" : "Gosh"} · ${presentation.label}`;
  copy.append(heading, sub);
  head.append(statusDot(presentation.className), copy);

  const sessionSection = inspectorSection("Phiên đăng nhập");
  const sessionActions = document.createElement("div");
  sessionActions.className = "inspector-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "primary";
  open.textContent = account.session?.loginState === "signed_out" ? "Đăng nhập an toàn" : "Mở Chrome";
  const profile = document.createElement("button");
  profile.type = "button";
  profile.className = "secondary";
  profile.textContent = "Mở hồ sơ";
  open.disabled = profile.disabled = Boolean(state.bulkSend?.running);
  open.addEventListener("click", () => openAccount(account, open));
  profile.addEventListener("click", () => openAccount(account, profile, true));
  sessionActions.append(open, profile);
  sessionSection.append(sessionActions);

  const displaySection = inspectorSection(account.platform === "loco" ? "Tên hiển thị trên Loco" : "Tên hiển thị trên Gosh");
  const displayForm = document.createElement("form");
  displayForm.className = "inspector-form";
  const displayWrap = document.createElement("div");
  displayWrap.className = "inline-form";
  const displayInput = document.createElement("input");
  displayInput.type = "text";
  displayInput.maxLength = account.platform === "loco" ? 30 : 20;
  displayInput.placeholder = "Tên mới";
  displayInput.setAttribute("aria-label", "Tên hiển thị mới");
  const update = document.createElement("button");
  update.type = "submit";
  update.className = "secondary";
  update.textContent = "Cập nhật";
  displayInput.disabled = update.disabled = Boolean(state.bulkSend?.running);
  displayWrap.append(displayInput, update);
  displayForm.append(displayWrap);
  displayForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(update, true, "Đang đổi…");
    try {
      const response = await api(`/api/accounts/${encodeURIComponent(account.id)}/display-name`, {
        method: "POST",
        body: JSON.stringify({ displayName: displayInput.value }),
      });
      displayInput.value = "";
      showNotice(`Đã đổi tên thành “${response.result.displayName}”.`, "success");
    } catch (error) {
      showNotice(error.message);
    } finally {
      setBusy(update, false);
    }
  });
  displaySection.append(displayForm);

  const danger = document.createElement("div");
  danger.className = "danger-zone";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-account";
  remove.textContent = "Xóa tài khoản và session";
  remove.disabled = Boolean(state.bulkSend?.running) || state.accounts.length === 1;
  remove.addEventListener("click", () => deleteAccount(account));
  danger.append(remove);

  elements.accountInspector.append(head, sessionSection, displaySection, danger);
}

function renderAccounts() {
  if (!state) return;
  if (!state.accounts.some((account) => account.id === selectedAccountId)) {
    selectedAccountId = state.accounts[0]?.id || null;
  }
  elements.accountSummary.textContent = `${enabledAccounts().length}/${state.accounts.length} đang sử dụng`;
  elements.accountList.replaceChildren(...state.accounts.map(createAccountRow));
  renderInspector(state.accounts.find((account) => account.id === selectedAccountId));
}

function syncSettingControl(control, value) {
  if (document.activeElement !== control) control.value = value;
}

function renderSettings() {
  syncSettingControl(elements.channelUrl, state.settings.channelUrl);
  syncSettingControl(elements.platformSelect, state.settings.platform);
  if (document.activeElement !== elements.accountPlatform) elements.accountPlatform.value = state.settings.platform;
  elements.channelUrl.placeholder = state.settings.platform === "loco"
    ? "https://loco.com/stream/…"
    : "https://gosh6.app/…";
  syncSettingControl(elements.delaySeconds, state.settings.delaySeconds);
  syncSettingControl(elements.displayNames, state.settings.displayNames.join("\n"));
  syncSettingControl(elements.renameEveryComments, state.settings.renameEveryComments);
  elements.profileCount.textContent = `${state.accounts.length} hồ sơ Chrome`;
}

function healthLabel(item) {
  if (item.status === "up" && [401, 403].includes(item.httpStatus)) {
    return { text: "Có phản hồi · cần session", className: "warning" };
  }
  if (item.status === "up") return { text: "Hoạt động", className: "ready" };
  if (item.status === "degraded") return { text: "Chậm / giới hạn", className: "warning" };
  if (item.status === "down") return { text: "Không phản hồi", className: "error" };
  return { text: "Chưa kiểm tra", className: "" };
}

function renderHealth() {
  elements.healthList.replaceChildren();
  elements.healthEmpty.hidden = healthChecks.length > 0;
  const checked = healthChecks.filter((item) => item.checkedAt);
  const down = checked.filter((item) => item.status === "down").length;
  elements.healthSummary.textContent = !checked.length
    ? "Chưa kiểm tra"
    : down ? `${down}/${checked.length} endpoint có lỗi` : `${checked.length} endpoint hoạt động`;
  for (const item of healthChecks) {
    const presentation = healthLabel(item);
    const row = document.createElement("li");
    row.className = "health-row";
    const service = document.createElement("span");
    service.className = "health-service";
    service.append(statusDot(presentation.className), document.createTextNode(`${item.platform === "loco" ? "Loco" : "Gosh"} · ${item.name}`));
    const endpoint = document.createElement("code");
    try { endpoint.textContent = new URL(item.url).pathname + new URL(item.url).search; } catch { endpoint.textContent = item.url; }
    endpoint.title = item.url;
    const http = document.createElement("span");
    http.textContent = item.httpStatus ?? "—";
    const latency = document.createElement("span");
    latency.textContent = item.latencyMs == null ? "—" : `${item.latencyMs} ms`;
    const status = document.createElement("span");
    status.className = `health-status ${presentation.className}`;
    status.textContent = item.error || presentation.text;
    row.append(service, endpoint, http, latency, status);
    elements.healthList.append(row);
  }
}

function stopBulkPolling() {
  window.clearTimeout(bulkPollTimer);
  bulkPollTimer = null;
}

function pollBulkSend() {
  stopBulkPolling();
  if (!state?.bulkSend?.running) return;
  bulkPollTimer = window.setTimeout(async () => {
    try {
      await refreshState();
      if (!state.bulkSend.running && state.bulkSend.startedAt === activeBulkRun) {
        if (state.bulkSend.phase === "completed") showNotice(`Đã gửi ${state.bulkSend.sent} lượt bình luận.`, "success");
        else if (state.bulkSend.phase === "completed_with_errors") showNotice(`Đã gửi ${state.bulkSend.sent}/${state.bulkSend.total} lượt, ${state.bulkSend.failed} lỗi.`, "warning");
        else if (state.bulkSend.phase === "stopped") showNotice(`Đã dừng sau ${state.bulkSend.sent} lượt gửi.`, "warning");
        else if (state.bulkSend.error) showNotice(state.bulkSend.error);
        activeBulkRun = null;
      }
    } catch (error) {
      showNotice(error.message);
    }
    pollBulkSend();
  }, 1000);
}

function render() {
  if (!state) return;
  renderAggregateStatus();
  renderLive();
  renderSettings();
  if (currentView === "accounts") renderAccounts();
  if (currentView === "health") renderHealth();
  pollBulkSend();
}

async function refreshState() {
  state = await api("/api/state");
  render();
}

function setSaveState(status, message) {
  for (const element of [elements.roomSaveState, elements.settingsSaveState]) {
    element.textContent = message;
    element.className = `save-state${status ? ` ${status}` : ""}`;
  }
}

function settingsPayload() {
  return {
    channelUrl: elements.channelUrl.value,
    platform: elements.platformSelect.value,
    delaySeconds: Number(elements.delaySeconds.value),
    displayNames: elements.displayNames.value,
    renameEveryComments: Number(elements.renameEveryComments.value),
  };
}

async function saveSettings() {
  window.clearTimeout(settingsTimer);
  if (settingsSaveRunning || state.bulkSend?.running) return;
  settingsSaveRunning = true;
  settingsDirty = false;
  setSaveState("saving", "Đang lưu…");
  try {
    state = await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
    setSaveState("", "Đã lưu");
    render();
  } catch (error) {
    setSaveState("error", "Chưa lưu");
    showNotice(error.message);
  } finally {
    settingsSaveRunning = false;
    if (settingsDirty) settingsTimer = window.setTimeout(saveSettings, 150);
  }
}

function queueSettingsSave() {
  window.clearTimeout(settingsTimer);
  settingsDirty = true;
  setSaveState("saving", "Đang lưu…");
  settingsTimer = window.setTimeout(saveSettings, 700);
}

async function openAccount(account, button, profile = false) {
  setBusy(button, true, "Đang mở…");
  try {
    const suffix = profile
      ? "profile"
      : account.session?.loginState === "signed_out" ? "login" : "open";
    await api(`/api/accounts/${encodeURIComponent(account.id)}/browser/${suffix}`, {
      method: "POST",
      body: profile ? "{}" : JSON.stringify({ targetUrl: elements.channelUrl.value || undefined }),
    });
    await refreshState();
    showNotice(
      suffix === "login"
        ? "Hãy đăng nhập trong Chrome; sau khi đăng nhập thành công, trình duyệt sẽ tự động tắt và nhận diện tài khoản."
        : `Đã mở “${accountLabel(account)}”.`,
      "success",
    );
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(button, false);
  }
}

function nextAccountName() {
  const names = new Set(state.accounts.map((account) => account.name.toLocaleLowerCase("vi")));
  let index = 1;
  while (names.has(`tài khoản ${index}`)) index += 1;
  return `Tài khoản ${index}`;
}

async function addAccount() {
  setBusy(elements.addAccount, true, "Đang thêm…");
  const previousIds = new Set(state.accounts.map((account) => account.id));
  try {
    state = await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name: nextAccountName(), platform: elements.accountPlatform.value }),
    });
    const account = state.accounts.find((item) => !previousIds.has(item.id));
    selectedAccountId = account?.id || state.accounts.at(-1)?.id;
    render();
    if (account) {
      await api(`/api/accounts/${encodeURIComponent(account.id)}/browser/login`, {
        method: "POST",
        body: JSON.stringify({ targetUrl: elements.channelUrl.value || undefined }),
      });
      await refreshState();
      showNotice(`Đã tạo phiên mới. Hãy đăng nhập trong Chrome; tên sẽ tự đồng bộ.`, "success");
    }
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(elements.addAccount, false);
  }
}

async function deleteAccount(account) {
  if (!window.confirm(`Xóa “${accountLabel(account)}” và toàn bộ session đăng nhập của tài khoản này?`)) return;
  try {
    state = await api(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    selectedAccountId = state.accounts[0]?.id || null;
    render();
    showNotice(`Đã xóa “${accountLabel(account)}”.`, "success");
  } catch (error) {
    showNotice(error.message);
  }
}

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => switchView(button.dataset.view));
}
for (const button of document.querySelectorAll("[data-go-view]")) {
  button.addEventListener("click", () => switchView(button.dataset.goView));
}

elements.messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state = await api("/api/messages", { method: "POST", body: JSON.stringify({ content: elements.messageContent.value }) });
    elements.messageContent.value = "";
    render();
  } catch (error) {
    showNotice(error.message);
  }
});

for (const control of [elements.delaySeconds, elements.displayNames, elements.renameEveryComments]) {
  control.addEventListener("input", queueSettingsSave);
  control.addEventListener("change", queueSettingsSave);
}
elements.channelUrl.addEventListener("change", queueSettingsSave);
elements.channelUrl.addEventListener("blur", queueSettingsSave);
elements.platformSelect.addEventListener("change", () => {
  elements.channelUrl.value = "";
  queueSettingsSave();
});

elements.addAccount.addEventListener("click", addAccount);
elements.refreshStatus.addEventListener("click", async () => {
  elements.refreshStatus.disabled = true;
  elements.refreshStatus.classList.add("is-spinning");
  try { await refreshState(); } catch (error) { showNotice(error.message); }
  finally {
    elements.refreshStatus.disabled = false;
    elements.refreshStatus.classList.remove("is-spinning");
  }
});

elements.checkHealth.addEventListener("click", async () => {
  setBusy(elements.checkHealth, true, "Đang kiểm tra…");
  try {
    const result = await api("/api/health/check", { method: "POST" });
    healthChecks = result.checks || [];
    renderHealth();
    renderAggregateStatus();
    const down = healthChecks.filter((item) => item.status === "down").length;
    showNotice(down ? `Có ${down} endpoint đang lỗi.` : "Tất cả endpoint đang hoạt động.", down ? "warning" : "success");
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(elements.checkHealth, false);
  }
});

elements.sendNext.addEventListener("click", async () => {
  setBusy(elements.sendNext, true, "Đang gửi…");
  try {
    state = await api("/api/comments/send-next", { method: "POST" });
    render();
    const result = state.result;
    showNotice(`Đã gửi từ ${result.successCount}/${result.totalAccounts} tài khoản${result.failureCount ? ` · ${result.failureCount} lỗi` : ""}.`, result.failureCount ? "warning" : "success");
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(elements.sendNext, false);
    renderBulkSend();
  }
});

elements.sendAll.addEventListener("click", async () => {
  setBusy(elements.sendAll, true, "Đang bắt đầu…");
  try {
    state = await api("/api/comments/send-all", { method: "POST" });
    activeBulkRun = state.bulkSend.startedAt;
    render();
    showNotice(`Đã bắt đầu ${state.bulkSend.total} lượt gửi.`, "success");
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(elements.sendAll, false);
    renderBulkSend();
  }
});

elements.stopBulk.addEventListener("click", async () => {
  if (!window.confirm("Dừng lượt gửi đang chạy?")) return;
  setBusy(elements.stopBulk, true, "Đang dừng…");
  try {
    state = await api("/api/comments/send-all/stop", { method: "POST" });
    render();
  } catch (error) {
    showNotice(error.message);
  } finally {
    setBusy(elements.stopBulk, false);
  }
});

Promise.all([refreshState(), api("/api/health")])
  .then(([, health]) => { healthChecks = health.checks || []; render(); })
  .catch((error) => showNotice(error.message));

window.setInterval(async () => {
  if (document.hidden || statusRefreshRunning || state?.bulkSend?.running) return;
  if (currentView === "accounts" && ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  statusRefreshRunning = true;
  try {
    state = await api("/api/state");
    render();
  } catch {
    // Keep the last known state; explicit refresh still reports errors.
  } finally {
    statusRefreshRunning = false;
  }
}, 3_000);
