import createIconElement from "/vendor/lucide/createElement.mjs";
import ActivityIcon from "/vendor/lucide/icons/activity.mjs";
import CalendarClockIcon from "/vendor/lucide/icons/calendar-clock.mjs";
import ChevronDownIcon from "/vendor/lucide/icons/chevron-down.mjs";
import ChevronLeftIcon from "/vendor/lucide/icons/chevron-left.mjs";
import ChevronRightIcon from "/vendor/lucide/icons/chevron-right.mjs";
import CopyIcon from "/vendor/lucide/icons/copy.mjs";
import KeyRoundIcon from "/vendor/lucide/icons/key-round.mjs";
import LogOutIcon from "/vendor/lucide/icons/log-out.mjs";
import PlayIcon from "/vendor/lucide/icons/play.mjs";
import PlusIcon from "/vendor/lucide/icons/plus.mjs";
import RadioTowerIcon from "/vendor/lucide/icons/radio-tower.mjs";
import RefreshCwIcon from "/vendor/lucide/icons/refresh-cw.mjs";
import SearchIcon from "/vendor/lucide/icons/search.mjs";
import Settings2Icon from "/vendor/lucide/icons/settings-2.mjs";
import ShuffleIcon from "/vendor/lucide/icons/shuffle.mjs";
import SquareIcon from "/vendor/lucide/icons/square.mjs";
import Trash2Icon from "/vendor/lucide/icons/trash-2.mjs";
import UserPlusIcon from "/vendor/lucide/icons/user-plus.mjs";
import UsersIcon from "/vendor/lucide/icons/users.mjs";
import XIcon from "/vendor/lucide/icons/x.mjs";

/* ---------- DOM helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const icons = {
  activity: ActivityIcon,
  "calendar-clock": CalendarClockIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  copy: CopyIcon,
  "key-round": KeyRoundIcon,
  "log-out": LogOutIcon,
  play: PlayIcon,
  plus: PlusIcon,
  "radio-tower": RadioTowerIcon,
  "refresh-cw": RefreshCwIcon,
  search: SearchIcon,
  "settings-2": Settings2Icon,
  shuffle: ShuffleIcon,
  square: SquareIcon,
  "trash-2": Trash2Icon,
  "user-plus": UserPlusIcon,
  users: UsersIcon,
  x: XIcon,
};

function icon(name) {
  const node = icons[name];
  return node ? createIconElement(node, { "stroke-width": 1.75, "aria-hidden": "true" }) : document.createTextNode("");
}

function mountIcons(root = document) {
  for (const slot of $$("[data-icon]", root)) {
    if (!slot.firstChild) slot.append(icon(slot.dataset.icon));
  }
}

// Small element factory: h("button", { class: "btn", onclick }, "Label").
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value);
    else if (key.includes("-") || !(key in element)) element.setAttribute(key, value === true ? "" : String(value));
    else element[key] = value;
  }
  element.append(...children.flat().filter((child) => child != null && child !== false));
  return element;
}

mountIcons();

/* ---------- Constants ---------- */

const PLATFORM_IDS = ["gosh", "loco", "gaquaytv"];
const PLATFORM_INFO = {
  gosh: { name: "Gosh", placeholder: "https://gosh.com/vi/16427037" },
  loco: { name: "Loco", placeholder: "https://loco.com/stream/…" },
  gaquaytv: { name: "GaQuayTV", placeholder: "https://gaquaytv.com/live/…" },
};
const MAX_ROOMS = 20;
const ACCOUNTS_PER_PAGE = 100;
const VIEWS = ["live", "schedule", "follow", "accounts", "system"];
const DAY_OPTIONS = [
  [1, "T2", "Thứ hai"],
  [2, "T3", "Thứ ba"],
  [3, "T4", "Thứ tư"],
  [4, "T5", "Thứ năm"],
  [5, "T6", "Thứ sáu"],
  [6, "T7", "Thứ bảy"],
  [0, "CN", "Chủ nhật"],
];

const numberFormat = new Intl.NumberFormat("vi-VN");
const fmt = (value) => numberFormat.format(value || 0);

const isLocalMachine = ["127.0.0.1", "localhost"].includes(window.location.hostname);
if (window.desktopUpdater) document.documentElement.classList.add("is-desktop");
if (/Mac/i.test(navigator.platform || navigator.userAgent)) document.documentElement.classList.add("is-mac");

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

/* ---------- Elements ---------- */

const el = {
  appVersion: $("#app-version"),
  navLive: $("#nav-live"),
  navSchedule: $("#nav-schedule"),
  navAccounts: $("#nav-accounts"),
  navSystemAlert: $("#nav-system-alert"),
  readinessCount: $("#readiness-count"),
  readinessBar: $("#readiness-bar"),
  authUser: $("#auth-user"),
  refreshStatus: $("#refresh-status"),
  logoutBtn: $("#logout-btn"),
  logoutBtnSecondary: $("#logout-btn-secondary"),

  runBanner: $("#run-banner"),
  runBannerTitle: $("#run-banner-title"),
  runBannerDetail: $("#run-banner-detail"),
  runBannerBar: $("#run-banner-bar"),
  runBannerCount: $("#run-banner-count"),
  runBannerStop: $("#run-banner-stop"),
  launchCard: $(".launch-card"),

  liveSummary: $("#live-summary"),
  saveState: $("#save-state"),
  platformPanels: $("#platform-panels"),
  cooldown: $("#cooldown"),
  checkRooms: $("#check-rooms"),
  checkMessages: $("#check-messages"),
  checkAccounts: $("#check-accounts"),
  delaySeconds: $("#delay-seconds"),
  goshAllocCurrent: $("#gosh-alloc-current"),
  renameSummary: $("#rename-summary"),
  nextUpList: $("#next-up-list"),
  bulkProgress: $("#bulk-progress"),
  bulkStatus: $("#bulk-status"),
  bulkCount: $("#bulk-count"),
  bulkProgressBar: $("#bulk-progress-bar"),
  bulkError: $("#bulk-error"),
  sendNext: $("#send-next"),
  sendAll: $("#send-all"),
  stopBulk: $("#stop-bulk"),
  launchNote: $("#launch-note"),

  scheduleSummary: $("#schedule-summary"),
  scheduleEnabled: $("#schedule-enabled"),
  scheduleEnabledText: $("#schedule-enabled-text"),
  addScheduleSlot: $("#add-schedule-slot"),
  weekGrid: $("#week-grid"),
  scheduleSlotList: $("#schedule-slot-list"),
  scheduleEmpty: $("#schedule-empty"),

  followSummary: $("#follow-summary"),
  followStatus: $("#follow-status"),
  followForm: $("#follow-form"),
  followTarget: $("#follow-target"),
  followCheck: $("#follow-check"),
  followCount: $("#follow-count"),
  followSubmit: $("#follow-submit"),
  unfollowSubmit: $("#unfollow-submit"),
  channelPreview: $("#channel-preview"),
  channelAvatar: $("#channel-avatar"),
  channelName: $("#channel-name"),
  channelUid: $("#channel-uid"),
  channelFollowers: $("#channel-followers"),
  channelFollowing: $("#channel-following"),
  followBefore: $("#follow-before"),
  followAfter: $("#follow-after"),
  followDelta: $("#follow-delta"),
  followRate: $("#follow-rate"),
  followHistory: $("#follow-history"),
  followHistoryEmpty: $("#follow-history-empty"),
  clearFollowHistory: $("#clear-follow-history"),

  accountSummary: $("#account-summary"),
  loadTokens: $("#load-tokens"),
  addAccountMenu: $("#add-account-menu"),
  addAccount: $("#add-account"),
  accountSearch: $("#account-search"),
  accountFilterPlatform: $("#account-filter-platform"),
  filterResult: $("#filter-result"),
  bulkMenu: $("#bulk-menu"),
  accountList: $("#account-list"),
  accountEmpty: $("#account-empty"),
  accountPageInfo: $("#account-page-info"),
  accountPrevPage: $("#account-prev-page"),
  accountNextPage: $("#account-next-page"),

  drawer: $("#drawer"),
  drawerTitle: $("#drawer-title"),
  drawerSub: $("#drawer-sub"),
  drawerBody: $("#drawer-body"),

  settingsSaveState: $("#settings-save-state"),
  displayNames: $("#display-names"),
  renameEveryComments: $("#rename-every-comments"),
  checkHealth: $("#check-health"),
  healthSummary: $("#health-summary"),
  healthList: $("#health-list"),
  healthEmpty: $("#health-empty"),
  observedList: $("#observed-list"),
  observedEmpty: $("#observed-empty"),
  observedCount: $("#observed-count"),
  webPasswordForm: $("#web-password-form"),
  webNewUsername: $("#web-new-username"),
  webCurrentPassword: $("#web-current-password"),
  webNewPassword: $("#web-new-password"),
  webPasswordSubmit: $("#web-password-submit"),
  webPasswordStatus: $("#web-password-status"),
  profileCount: $("#profile-count"),
  settingsAppVersion: $("#settings-app-version"),
  checkUpdate: $("#check-update"),
  updateStatus: $("#update-status"),

  confirmDialog: $("#confirm-dialog"),
  confirmTitle: $("#confirm-title"),
  confirmMessage: $("#confirm-message"),
  confirmOk: $("#confirm-ok"),
  toasts: $("#toasts"),

  loginOverlay: $("#login-overlay"),
  loginForm: $("#login-form"),
  loginUsername: $("#login-username"),
  loginPassword: $("#login-password"),
  loginTogglePass: $("#login-toggle-pass"),
  loginError: $("#login-error"),
  loginSubmit: $("#login-submit"),
};

/* ---------- App state ---------- */

let state = null;
let currentView = "live";
let activePlatform = PLATFORM_IDS.includes(readPref("alc-platform", "")) ? readPref("alc-platform", "") : "gosh";
let selectedAccountId = null;
let statusFilter = "all";
let accountPage = 0;
let cooldownTimer = null;
let bulkPollTimer = null;
let activeBulkRun = null;
let settingsTimer = null;
let settingsSaveRunning = false;
let settingsSavePromise = null;
let settingsDirty = false;
let statusRefreshRunning = false;
let healthChecks = [];
let observedEndpoints = [];
let webAuthenticated = true;
let followRunning = false;
const queueKeys = {};

/* ---------- Feedback: toasts, confirm, busy buttons ---------- */

function notify(message, type = "error") {
  const dotClass = { success: "ok", warning: "warn", error: "err", info: "" }[type] ?? "err";
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Đóng thông báo" }, icon("x"));
  const toast = h("div", { class: "toast", role: type === "error" ? "alert" : "status" },
    h("span", { class: `dot ${dotClass}` }),
    h("p", {}, message),
    close,
  );
  const dismiss = () => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  };
  close.addEventListener("click", dismiss);
  el.toasts.append(toast);
  while (el.toasts.children.length > 4) el.toasts.firstElementChild.remove();
  window.setTimeout(dismiss, type === "error" ? 8000 : 5000);
}

function confirmAction({ title, message, confirmLabel = "Đồng ý", danger = false }) {
  const dialog = el.confirmDialog;
  if (typeof dialog?.showModal !== "function") return Promise.resolve(window.confirm(message || title));
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message || "";
  el.confirmMessage.hidden = !message;
  el.confirmOk.textContent = confirmLabel;
  el.confirmOk.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.busyContent = [...button.childNodes];
    button.replaceChildren(label);
    button.disabled = true;
  } else {
    if (button.busyContent) button.replaceChildren(...button.busyContent);
    button.busyContent = null;
    button.disabled = false;
  }
}

async function copyText(text, message = "Đã copy.") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { style: "position:fixed;opacity:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  notify(message, "success");
}

/* ---------- API ---------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && body.code === "WEB_AUTH_REQUIRED") showLogin();
  if (!response.ok) throw new Error(body.error || `Yêu cầu thất bại (${response.status}).`);
  return body;
}

/* ---------- Derived data ---------- */

function platformName(platform) {
  return state?.platforms?.find((item) => item.id === platform)?.name || PLATFORM_INFO[platform]?.name || platform;
}

function channelLinksFor(platform) {
  const links = state?.settings?.channelLinks?.[platform];
  if (Array.isArray(links)) return links.filter(Boolean);
  if (state?.settings?.channelUrls && typeof state.settings.channelUrls === "object") {
    const legacy = state.settings.channelUrls[platform];
    return legacy ? [legacy] : [];
  }
  return state?.settings?.platform === platform && state.settings.channelUrl ? [state.settings.channelUrl] : [];
}

function platformMessages(platform) {
  if (state?.messagesByPlatform) return state.messagesByPlatform[platform] || [];
  return state?.settings?.platform === platform ? state.messages || [] : [];
}

function nextMessageFor(platform) {
  return state?.nextMessages?.[platform] || (state?.settings?.platform === platform ? state.nextMessage : null);
}

function accountLabel(account) {
  return account.profileName || account.name;
}

const isReady = (account) => Boolean(account.session?.readyToComment);
const isRunning = () => Boolean(state?.bulkSend?.running);

// Accounts that will actually send: switched on and their platform has rooms.
function participatingAccounts() {
  return state?.accounts?.filter((account) => account.enabled && channelLinksFor(account.platform).length) || [];
}

function activePlatforms() {
  return [...new Set(participatingAccounts().map((account) => account.platform))];
}

function sendableMessageCount() {
  return activePlatforms().reduce((total, platform) => total + platformMessages(platform).length, 0);
}

function tokenPresentation(account) {
  const session = account.session || {};
  if (session.loginState === "manual_login") return { label: "Đang đăng nhập", tone: "warn" };
  if (session.readyToComment) return { label: "Có token", tone: "ok" };
  if (session.loginState === "signed_out") return { label: "Cần đăng nhập lại", tone: "warn" };
  if (session.error) return { label: "Lỗi token", tone: "err", title: session.error };
  return { label: "Chưa có token", tone: "" };
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatClock(date) {
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ---------- Navigation ---------- */

function switchView(view, { focusId = null } = {}) {
  if (!VIEWS.includes(view)) return;
  currentView = view;
  for (const button of $$("[data-view]")) {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const panel of $$("[data-view-panel]")) panel.hidden = panel.dataset.viewPanel !== view;
  if (window.location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  $(".views").scrollTop = 0;
  if (state) {
    if (view === "accounts") renderAccounts();
    if (view === "schedule") renderSchedule();
    if (view === "system") renderHealth();
  }
  if (focusId) window.requestAnimationFrame(() => document.getElementById(focusId)?.focus());
}

for (const button of $$("[data-view]")) {
  button.addEventListener("click", () => switchView(button.dataset.view));
}
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-go-view]");
  if (!trigger) return;
  if (trigger.dataset.goFilter) {
    statusFilter = trigger.dataset.goFilter;
    accountPage = 0;
  }
  switchView(trigger.dataset.goView, { focusId: trigger.dataset.goFocus });
});

/* ---------- Menus ---------- */

function closeMenus(except = null) {
  for (const menu of $$(".menu")) {
    if (menu === except) continue;
    $(".menu-pop", menu).hidden = true;
    $("[aria-expanded]", menu)?.setAttribute("aria-expanded", "false");
  }
}

for (const menu of $$(".menu")) {
  const trigger = $("[aria-expanded]", menu);
  const pop = $(".menu-pop", menu);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = pop.hidden;
    closeMenus(menu);
    pop.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) $("button", pop)?.focus();
  });
  pop.addEventListener("click", () => closeMenus());
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu")) closeMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || el.confirmDialog.open) return;
  closeMenus();
  if (!el.drawer.hidden) closeDrawer();
});

/* ---------- Chrome: sidebar + run banner ---------- */

function renderChrome() {
  const total = state.accounts.length;
  const ready = state.accounts.filter(isReady).length;
  el.readinessCount.textContent = `${fmt(ready)}/${fmt(total)}`;
  el.readinessBar.style.width = total ? `${Math.round((ready / total) * 100)}%` : "0%";
  el.navAccounts.textContent = fmt(total);
  el.navSystemAlert.hidden = !healthChecks.some((item) => item.status === "down");
}

function bulkPhaseLabel(bulk) {
  const labels = {
    starting: "Đang chuẩn bị",
    waiting: "Đang nghỉ giữa hai lượt",
    sending: bulk.currentAccount ? `Đang gửi · ${bulk.currentAccount}` : "Đang gửi",
    renaming: "Đang đổi tên tự động",
    stopping: "Đang dừng",
    stopped: "Đã dừng",
    completed: "Đã gửi xong",
    completed_with_errors: "Đã xong, có lỗi",
    failed: bulk.error || "Gửi thất bại",
  };
  return labels[bulk.phase] || "Sẵn sàng";
}

// A scheduled run has no fixed message total, so it reports sends so far and
// the time left in the window instead of a sent/total ratio.
function bulkProgressView(bulk) {
  const attempted = (bulk.sent || 0) + (bulk.failed || 0);
  if (bulk.mode !== "schedule") {
    return {
      count: bulk.failed ? `${attempted}/${bulk.total} · ${bulk.failed} lỗi` : `${attempted}/${bulk.total}`,
      percent: bulk.total ? Math.min(100, Math.round((attempted / bulk.total) * 100)) : 0,
    };
  }
  const parts = [`${attempted} lượt`];
  if (bulk.failed) parts.push(`${bulk.failed} lỗi`);
  const startedAt = Date.parse(bulk.startedAt);
  const endsAt = Date.parse(bulk.endsAt);
  if (bulk.running && Number.isFinite(endsAt)) parts.push(`còn ${formatDuration(endsAt - Date.now())}`);
  const span = endsAt - startedAt;
  const elapsed = bulk.running ? Date.now() - startedAt : span;
  return {
    count: parts.join(" · "),
    percent: span > 0 ? Math.max(0, Math.min(100, Math.round((elapsed / span) * 100))) : 0,
  };
}

function renderRunBanner() {
  const bulk = state.bulkSend || {};
  const running = Boolean(bulk.running);
  el.runBanner.hidden = !running;
  el.navLive.hidden = !running;
  if (!running) return;
  const progress = bulkProgressView(bulk);
  el.runBannerTitle.textContent = bulk.mode === "schedule" ? "Đang chạy theo lịch" : "Đang chạy chiến dịch";
  el.runBannerDetail.textContent = bulkPhaseLabel(bulk);
  el.runBannerCount.textContent = progress.count;
  el.runBannerBar.style.width = `${progress.percent}%`;
}

/* ---------- Campaign: platform panels ---------- */

const panels = {};

function buildPlatformPanels() {
  const template = $("#platform-panel-template");
  for (const platform of PLATFORM_IDS) {
    const root = template.content.firstElementChild.cloneNode(true);
    const name = PLATFORM_INFO[platform].name;
    root.dataset.platformPanel = platform;
    root.id = `panel-${platform}`;
    root.setAttribute("aria-label", name);
    const part = (role) => $(`[data-role="${role}"]`, root);
    const refs = {
      root,
      rooms: part("rooms"),
      roomCount: part("room-count"),
      shuffle: part("shuffle"),
      clear: part("clear"),
      composer: part("composer"),
      composerInput: part("composer-input"),
      composerSubmit: part("composer-submit"),
      queue: part("queue"),
      queueEmpty: part("queue-empty"),
    };
    part("rooms-hint").textContent = `Dán link phòng ${name}, mỗi dòng một link. Tối đa ${MAX_ROOMS} phòng.`;
    refs.rooms.placeholder = PLATFORM_INFO[platform].placeholder;
    refs.rooms.id = `rooms-${platform}`;
    refs.rooms.setAttribute("aria-label", `Link phòng ${name}`);
    refs.composerInput.setAttribute("aria-label", `Thêm mẫu bình luận ${name}`);
    mountIcons(root);
    panels[platform] = refs;
    el.platformPanels.append(root);

    for (const type of ["input", "change", "blur"]) refs.rooms.addEventListener(type, queueSettingsSave);
    refs.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void addMessages(platform);
    });
    refs.composerInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        refs.composer.requestSubmit();
      }
    });
    refs.shuffle.addEventListener("click", () => shuffleMessages(platform));
    refs.clear.addEventListener("click", () => clearMessages(platform));
  }
  for (const tab of $$("[data-platform-tab]")) {
    tab.setAttribute("aria-controls", `panel-${tab.dataset.platformTab}`);
    tab.addEventListener("click", () => selectPlatform(tab.dataset.platformTab));
  }
  selectPlatform(activePlatform);
}

function selectPlatform(platform) {
  activePlatform = platform;
  writePref("alc-platform", platform);
  for (const tab of $$("[data-platform-tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.platformTab === platform));
  }
  for (const id of PLATFORM_IDS) panels[id].root.hidden = id !== platform;
}

async function addMessages(platform) {
  const refs = panels[platform];
  const content = refs.composerInput.value.trim();
  if (!content) {
    refs.composerInput.focus();
    return;
  }
  setBusy(refs.composerSubmit, true, "Đang thêm…");
  try {
    const before = platformMessages(platform).length;
    state = await api("/api/messages", { method: "POST", body: JSON.stringify({ content, platform }) });
    refs.composerInput.value = "";
    render();
    const added = platformMessages(platform).length - before;
    if (added > 1) notify(`Đã thêm ${added} mẫu vào kho ${platformName(platform)}.`, "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(refs.composerSubmit, false);
    refs.composerInput.focus();
  }
}

async function deleteMessage(platform, message) {
  try {
    state = await api(`/api/messages/${encodeURIComponent(message.id)}?platform=${platform}`, { method: "DELETE" });
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function shuffleMessages(platform) {
  const button = panels[platform].shuffle;
  setBusy(button, true, "Đang trộn…");
  try {
    state = await api("/api/messages/shuffle", { method: "POST", body: JSON.stringify({ platform }) });
    render();
    notify(`Đã trộn thứ tự kho ${platformName(platform)}.`, "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(button, false);
    renderLive();
  }
}

async function clearMessages(platform) {
  const count = platformMessages(platform).length;
  if (!count) return;
  const confirmed = await confirmAction({
    title: `Xóa toàn bộ kho ${platformName(platform)}?`,
    message: `${fmt(count)} mẫu bình luận sẽ bị xóa và không thể khôi phục.`,
    confirmLabel: "Xóa kho",
    danger: true,
  });
  if (!confirmed) return;
  try {
    state = await api(`/api/messages?platform=${platform}`, { method: "DELETE" });
    render();
    notify(`Đã xóa ${fmt(count)} mẫu ${platformName(platform)}.`, "success");
  } catch (error) {
    notify(error.message);
  }
}

function renderQueue(platform) {
  const refs = panels[platform];
  const messages = platformMessages(platform);
  const next = nextMessageFor(platform);
  const running = isRunning();
  const key = JSON.stringify([messages.map((message) => message.id), next?.id, running]);
  refs.queueEmpty.hidden = messages.length > 0;
  refs.shuffle.disabled = running || messages.length < 2;
  refs.clear.disabled = running || !messages.length;
  if (queueKeys[platform] === key) return;
  queueKeys[platform] = key;
  refs.queue.replaceChildren(...messages.map((message, index) => {
    const isNext = message.id === next?.id;
    return h("li", { class: isNext ? "is-next" : "" },
      h("span", { class: "queue-index" }, String(index + 1).padStart(2, "0")),
      h("span", { class: "queue-text" }, message.content),
      isNext ? h("span", { class: "tag tag-ok tag-quiet" }, "Tiếp theo") : h("span"),
      h("button", {
        class: "icon-btn queue-delete",
        type: "button",
        title: "Xóa mẫu",
        "aria-label": `Xóa mẫu “${message.content}”`,
        disabled: running,
        onclick: () => deleteMessage(platform, message),
      }, icon("trash-2")),
    );
  }));
}

/* ---------- Campaign: launch panel ---------- */

function setCheck(item, status, detail) {
  item.classList.toggle("is-ok", status === "ok");
  item.classList.toggle("is-warn", status === "warn");
  $(".check-detail", item).textContent = detail;
}

function renderChecklist() {
  const roomsByPlatform = PLATFORM_IDS.map((platform) => [platform, channelLinksFor(platform).length]).filter(([, count]) => count);
  const roomTotal = roomsByPlatform.reduce((sum, [, count]) => sum + count, 0);
  setCheck(
    el.checkRooms,
    roomTotal ? "ok" : "",
    roomTotal
      ? roomsByPlatform.map(([platform, count]) => `${platformName(platform)} ${count}`).join(" · ")
      : "Chưa nhập link phòng nào",
  );

  const emptyQueues = roomsByPlatform.filter(([platform]) => !platformMessages(platform).length).map(([platform]) => platformName(platform));
  const messageTotal = roomsByPlatform.reduce((sum, [platform]) => sum + platformMessages(platform).length, 0);
  const storedMessages = PLATFORM_IDS.reduce((sum, platform) => sum + platformMessages(platform).length, 0);
  if (!roomTotal) setCheck(el.checkMessages, storedMessages ? "ok" : "", storedMessages ? `${fmt(storedMessages)} mẫu trong kho` : "Kho bình luận đang trống");
  else if (!messageTotal) setCheck(el.checkMessages, "", "Kho của các nền tảng có phòng đang trống");
  else if (emptyQueues.length) setCheck(el.checkMessages, "warn", `${fmt(messageTotal)} mẫu · kho ${emptyQueues.join(", ")} trống`);
  else setCheck(el.checkMessages, "ok", `${fmt(messageTotal)} mẫu sẵn sàng gửi`);

  const participating = participatingAccounts();
  const ready = participating.filter(isReady).length;
  const missingPlatforms = roomsByPlatform
    .filter(([platform]) => !participating.some((account) => account.platform === platform))
    .map(([platform]) => platformName(platform));
  if (!roomTotal) {
    const enabled = state.accounts.filter((account) => account.enabled).length;
    setCheck(el.checkAccounts, "", `${fmt(enabled)} tài khoản đang bật`);
  } else if (!participating.length) {
    setCheck(el.checkAccounts, "", "Chưa bật tài khoản nào cho nền tảng có phòng");
  } else if (!ready) {
    setCheck(el.checkAccounts, "warn", `${fmt(participating.length)} tham gia · chưa tài khoản nào có token`);
  } else if (missingPlatforms.length) {
    setCheck(el.checkAccounts, "warn", `${fmt(ready)}/${fmt(participating.length)} có token · ${missingPlatforms.join(", ")} chưa có tài khoản`);
  } else {
    setCheck(el.checkAccounts, ready === participating.length ? "ok" : "warn", `${fmt(ready)}/${fmt(participating.length)} tài khoản có token`);
  }
}

function renderLaunchControls() {
  const running = isRunning();
  const delay = Number(el.delaySeconds.value);
  for (const chip of $$("[data-delay-preset]")) {
    chip.classList.toggle("is-active", Number(chip.dataset.delayPreset) === delay && el.delaySeconds.value !== "");
    chip.disabled = running;
  }

  const gosh = state.accounts.filter((account) => account.platform === "gosh");
  const goshEnabled = gosh.filter((account) => account.enabled);
  const goshEnabledReady = goshEnabled.filter(isReady).length;
  el.goshAllocCurrent.textContent = gosh.length
    ? `${fmt(goshEnabled.length)} đang bật · ${fmt(goshEnabledReady)} có token`
    : "Chưa có tài khoản Gosh";
  const activeAlloc = !goshEnabled.length
    ? "0"
    : goshEnabled.length === gosh.length ? "all" : String(goshEnabled.length);
  for (const chip of $$("[data-gosh-alloc]")) {
    chip.classList.toggle("is-active", chip.dataset.goshAlloc === activeAlloc);
    chip.disabled = running || !gosh.length;
  }

  const names = state.settings.displayNames?.length || 0;
  el.renameSummary.textContent = names
    ? `${names} tên · mỗi ${state.settings.renameEveryComments} lượt`
    : "Đang tắt";

  el.nextUpList.replaceChildren(...PLATFORM_IDS.map((platform) => {
    const hasRooms = channelLinksFor(platform).length > 0;
    const next = nextMessageFor(platform);
    const text = !hasRooms ? "Không có phòng" : next?.content || "Kho trống";
    return h("li", { class: hasRooms && next ? "" : "is-empty" },
      h("span", { class: `pf-dot ${platform}` }),
      h("span", { class: "pf-label" }, platformName(platform)),
      h("span", { class: "next-text", title: next?.content || "" }, text),
    );
  }));
}

function renderCooldown() {
  window.clearInterval(cooldownTimer);
  if (isRunning()) {
    el.cooldown.className = "tag tag-live";
    el.cooldown.textContent = state.bulkSend.mode === "schedule" ? "Đang chạy theo lịch" : "Đang chạy";
    return;
  }
  const update = () => {
    const elapsed = state?.lastSentAt ? Math.floor((Date.now() - Date.parse(state.lastSentAt)) / 1000) : Infinity;
    const remaining = Math.max(0, (state?.settings?.delaySeconds || 0) - elapsed);
    el.cooldown.className = remaining ? "tag tag-warn" : "tag";
    el.cooldown.textContent = remaining ? `Chờ ${remaining}s` : "Sẵn sàng";
    if (!remaining) window.clearInterval(cooldownTimer);
  };
  update();
  cooldownTimer = window.setInterval(update, 1000);
}

function renderBulkSend() {
  const bulk = state.bulkSend || { running: false, total: 0, sent: 0, failed: 0, phase: "idle" };
  const running = Boolean(bulk.running);
  const participating = participatingAccounts().length;
  const messageCount = sendableMessageCount();
  const linkCount = activePlatforms().reduce((sum, platform) => sum + channelLinksFor(platform).length, 0);
  const canSend = !running && messageCount > 0 && participating > 0;
  const progress = bulkProgressView(bulk);
  const failures = bulk.failures || [];

  el.bulkProgress.hidden = bulk.phase === "idle" || !bulk.phase;
  // While running, the card's tag already says the run comes from the schedule.
  el.bulkStatus.textContent = bulk.mode === "schedule" && !running && bulk.phase !== "idle"
    ? `Theo lịch · ${bulkPhaseLabel(bulk)}`
    : bulkPhaseLabel(bulk);
  el.bulkCount.textContent = progress.count;
  el.bulkProgressBar.style.width = `${progress.percent}%`;
  el.bulkProgress.classList.toggle("is-failed", bulk.phase === "failed");
  el.bulkProgress.classList.toggle("has-errors", Boolean(bulk.failed) && bulk.phase !== "failed");
  el.bulkError.hidden = !failures.length;
  if (failures.length) {
    const failure = failures.at(-1);
    const room = Number.isInteger(failure.linkIndex) ? ` phòng ${failure.linkIndex + 1}` : "";
    el.bulkError.textContent = `${platformName(failure.platform)}${room} · ${failure.accountName}: ${failure.error}`;
  }

  el.launchCard.classList.toggle("is-running", running);
  el.sendNext.hidden = running;
  el.sendAll.hidden = running;
  el.stopBulk.hidden = !running;
  el.stopBulk.disabled = bulk.phase === "stopping";
  el.runBannerStop.disabled = bulk.phase === "stopping";
  el.sendNext.disabled = !canSend;
  el.sendAll.disabled = !canSend;
  el.sendNext.title = "Gửi mẫu kế tiếp của mỗi nền tảng tới tất cả phòng, một lần";

  if (running) {
    el.launchNote.textContent = "Kho bình luận, link phòng và tài khoản bị khóa cho tới khi dừng.";
  } else if (canSend) {
    const delay = Number(state.settings.delaySeconds) || 0;
    el.launchNote.textContent = `“Chạy toàn bộ kho” gửi lần lượt ${fmt(messageCount)} mẫu tới ${fmt(linkCount)} phòng, nghỉ ${delay}s giữa các lượt.`;
  } else {
    el.launchNote.textContent = "Cần ít nhất một phòng live, một mẫu bình luận và một tài khoản tham gia trên cùng nền tảng.";
  }

  for (const platform of PLATFORM_IDS) {
    const refs = panels[platform];
    refs.rooms.disabled = running;
    refs.composerInput.disabled = running;
    refs.composerSubmit.disabled = running;
  }
  el.delaySeconds.disabled = running;
  el.displayNames.disabled = running;
  el.renameEveryComments.disabled = running;
  el.addAccount.disabled = running;
  el.loadTokens.disabled = running;
}

function renderLive() {
  const roomTotal = PLATFORM_IDS.reduce((sum, platform) => sum + channelLinksFor(platform).length, 0);
  const platformsWithRooms = PLATFORM_IDS.filter((platform) => channelLinksFor(platform).length).length;
  const messageTotal = PLATFORM_IDS.reduce((sum, platform) => sum + platformMessages(platform).length, 0);
  el.liveSummary.textContent = [
    roomTotal ? `${fmt(roomTotal)} phòng trên ${platformsWithRooms} nền tảng` : "Chưa có phòng live",
    `${fmt(messageTotal)} mẫu bình luận`,
    `${fmt(participatingAccounts().length)} tài khoản tham gia`,
  ].join(" · ");

  for (const platform of PLATFORM_IDS) {
    const rooms = channelLinksFor(platform).length;
    const messages = platformMessages(platform).length;
    $(`[data-tab-meta="${platform}"]`).textContent = `${rooms} phòng · ${messages} mẫu`;
    panels[platform].roomCount.textContent = `${rooms}/${MAX_ROOMS}`;
    renderQueue(platform);
  }
  renderChecklist();
  renderLaunchControls();
  renderCooldown();
  renderBulkSend();
}

/* ---------- Campaign: actions ---------- */

for (const chip of $$("[data-delay-preset]")) {
  chip.addEventListener("click", () => {
    el.delaySeconds.value = chip.dataset.delayPreset;
    queueSettingsSave();
    renderLaunchControls();
  });
}
for (const type of ["input", "change"]) {
  el.delaySeconds.addEventListener(type, () => {
    queueSettingsSave();
    renderLaunchControls();
  });
}

for (const chip of $$("[data-gosh-alloc]")) {
  chip.addEventListener("click", async () => {
    if (!state?.accounts) return;
    const choice = chip.dataset.goshAlloc;
    const goshReady = state.accounts.filter((account) => account.platform === "gosh" && isReady(account));
    if (!["0", "all"].includes(choice) && !goshReady.length) {
      notify("Chưa có tài khoản Gosh nào có token để chọn.", "warning");
      return;
    }
    setBusy(chip, true, "…");
    try {
      if (choice === "0" || choice === "all") {
        state = await api("/api/accounts/bulk-toggle", {
          method: "POST",
          body: JSON.stringify({ platform: "gosh", enabled: choice === "all" }),
        });
        notify(choice === "all" ? "Đã bật mọi tài khoản Gosh." : "Đã tắt mọi tài khoản Gosh.", "success");
      } else {
        const count = Math.min(Number(choice) || 50, goshReady.length);
        const chosen = new Set(goshReady.slice(0, count).map((account) => account.id));
        const toDisable = state.accounts
          .filter((account) => account.platform === "gosh" && account.enabled && !chosen.has(account.id))
          .map((account) => account.id);
        if (toDisable.length) {
          await api("/api/accounts/bulk-toggle", { method: "POST", body: JSON.stringify({ enabled: false, accountIds: toDisable }) });
        }
        state = await api("/api/accounts/bulk-toggle", { method: "POST", body: JSON.stringify({ enabled: true, accountIds: [...chosen] }) });
        notify(`Đã chọn ${fmt(count)} tài khoản Gosh có token tham gia.`, "success");
      }
      render();
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(chip, false);
      renderLaunchControls();
    }
  });
}

el.sendNext.addEventListener("click", async () => {
  setBusy(el.sendNext, true, "Đang gửi…");
  try {
    await flushSettingsBeforeSend();
    state = await api("/api/comments/send-next", { method: "POST" });
    render();
    const result = state.result;
    const linkCount = result?.totalLinks || result?.successCount || 0;
    if (result?.failureCount) notify(`Đã gửi ${result.successCount}/${linkCount} phòng; ${result.failureCount} phòng lỗi.`, "warning");
    else notify(`Đã gửi tới ${linkCount} phòng.`, "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.sendNext, false);
    renderBulkSend();
  }
});

el.sendAll.addEventListener("click", async () => {
  setBusy(el.sendAll, true, "Đang bắt đầu…");
  try {
    await flushSettingsBeforeSend();
    state = await api("/api/comments/send-all", { method: "POST" });
    activeBulkRun = state.bulkSend.startedAt;
    render();
    notify(`Đã bắt đầu chạy ${fmt(state.bulkSend.total)} lượt gửi.`, "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.sendAll, false);
    renderBulkSend();
  }
});

async function stopBulkRun(button) {
  const confirmed = await confirmAction({
    title: "Dừng lượt đang chạy?",
    message: state?.bulkSend?.mode === "schedule"
      ? "Khung giờ hiện tại sẽ không tự chạy lại cho tới lần sau."
      : "Các mẫu chưa gửi sẽ được giữ nguyên trong kho.",
    confirmLabel: "Dừng",
    danger: true,
  });
  if (!confirmed) return;
  setBusy(button, true, "Đang dừng…");
  try {
    state = await api("/api/comments/send-all/stop", { method: "POST" });
    render();
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(button, false);
    renderBulkSend();
  }
}
el.stopBulk.addEventListener("click", () => stopBulkRun(el.stopBulk));
el.runBannerStop.addEventListener("click", () => stopBulkRun(el.runBannerStop));

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
      const bulk = state.bulkSend;
      if (!bulk.running && bulk.startedAt === activeBulkRun) {
        if (bulk.phase === "completed") notify(`Đã gửi xong ${fmt(bulk.sent)} lượt bình luận.`, "success");
        else if (bulk.phase === "completed_with_errors") notify(`Đã gửi ${fmt(bulk.sent)}/${fmt(bulk.total)} lượt, ${bulk.failed} lỗi.`, "warning");
        else if (bulk.phase === "stopped") notify(`Đã dừng sau ${fmt(bulk.sent)} lượt gửi.`, "warning");
        else if (bulk.error) notify(bulk.error);
        activeBulkRun = null;
      }
    } catch (error) {
      notify(error.message);
    }
    pollBulkSend();
  }, 1000);
}

/* ---------- Settings persistence ---------- */

function setSaveState(status, message) {
  for (const element of [el.saveState, el.settingsSaveState]) {
    element.textContent = message;
    element.className = `save-state${status ? ` ${status}` : ""}`;
  }
}

function syncControl(control, value) {
  if (document.activeElement !== control) control.value = value;
}

function renderSettings() {
  // Background refreshes must not overwrite fields whose edit is still waiting to be saved.
  if (settingsDirty || settingsSaveRunning) return;
  for (const platform of PLATFORM_IDS) syncControl(panels[platform].rooms, channelLinksFor(platform).join("\n"));
  syncControl(el.delaySeconds, state.settings.delaySeconds);
  syncControl(el.displayNames, state.settings.displayNames.join("\n"));
  syncControl(el.renameEveryComments, state.settings.renameEveryComments);
  el.profileCount.textContent = `${fmt(state.accounts.length)} tài khoản đã lưu trên máy chủ.`;
}

function settingsPayload() {
  return {
    channelLinks: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, panels[platform].rooms.value.split(/\r?\n/)])),
    delaySeconds: Number(el.delaySeconds.value),
    displayNames: el.displayNames.value,
    renameEveryComments: Number(el.renameEveryComments.value),
  };
}

async function saveSettings() {
  window.clearTimeout(settingsTimer);
  if (settingsSaveRunning) return settingsSavePromise;
  if (isRunning()) return false;
  settingsSaveRunning = true;
  settingsDirty = false;
  setSaveState("saving", "Đang lưu…");
  settingsSavePromise = api("/api/settings", { method: "PUT", body: JSON.stringify(settingsPayload()) });
  try {
    state = await settingsSavePromise;
    setSaveState("", "Đã lưu");
    render();
    return true;
  } catch (error) {
    setSaveState("error", "Chưa lưu được");
    notify(error.message);
    return false;
  } finally {
    settingsSaveRunning = false;
    settingsSavePromise = null;
    if (settingsDirty) settingsTimer = window.setTimeout(saveSettings, 150);
  }
}

async function flushSettingsBeforeSend() {
  window.clearTimeout(settingsTimer);
  if (settingsSaveRunning) await settingsSavePromise;
  while (settingsDirty) {
    const saved = await saveSettings();
    if (!saved) throw new Error("Không thể lưu link phòng live. Hãy kiểm tra lại URL.");
    if (settingsSaveRunning) await settingsSavePromise;
  }
}

function queueSettingsSave() {
  window.clearTimeout(settingsTimer);
  settingsDirty = true;
  setSaveState("saving", "Đang lưu…");
  settingsTimer = window.setTimeout(saveSettings, 700);
}

for (const control of [el.displayNames, el.renameEveryComments]) {
  control.addEventListener("input", queueSettingsSave);
  control.addEventListener("change", queueSettingsSave);
}

/* ---------- Schedule ---------- */

let scheduleSlotsKey = "";
// Slots whose room-link section the user has expanded; kept across rebuilds.
const openScheduleLinkSlots = new Set();

function scheduleState() {
  return state?.schedule || { enabled: false, slots: [] };
}

function formatNextStart(iso) {
  const date = new Date(iso);
  const dayStart = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.round((dayStart(date) - dayStart(new Date())) / 86_400_000);
  const pad = (value) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diffDays === 0) return `hôm nay lúc ${time}`;
  if (diffDays === 1) return `ngày mai lúc ${time}`;
  const dayName = DAY_OPTIONS.find(([day]) => day === date.getDay())?.[2] || "";
  return `${dayName} ${pad(date.getDate())}/${pad(date.getMonth() + 1)} lúc ${time}`;
}

const toMinutes = (value) => {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
};

function renderWeek() {
  const { enabled, slots } = scheduleState();
  const runningId = state.scheduleStatus?.runningSlotId;
  const blocksByDay = new Map(DAY_OPTIONS.map(([day]) => [day, []]));
  for (const slot of slots) {
    const start = toMinutes(slot.start);
    const end = toMinutes(slot.end);
    const off = !enabled || !slot.enabled;
    const className = `week-block${off ? " is-off" : ""}${slot.id === runningId ? " is-running" : ""}`;
    const title = `${slot.start} – ${slot.end}${off ? " (đang tắt)" : ""}`;
    for (const day of slot.days) {
      if (end > start) {
        blocksByDay.get(day)?.push({ from: start, to: end, className, title });
      } else {
        blocksByDay.get(day)?.push({ from: start, to: 1440, className, title });
        blocksByDay.get((day + 1) % 7)?.push({ from: 0, to: end, className, title });
      }
    }
  }
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rows = DAY_OPTIONS.map(([day, short, full]) => {
    const today = day === now.getDay();
    const track = h("div", { class: "week-track" },
      blocksByDay.get(day).map((block) => h("span", {
        class: block.className,
        title: block.title,
        style: `left:${(block.from / 1440) * 100}%;width:${((block.to - block.from) / 1440) * 100}%`,
      })),
      today ? h("span", { class: "week-now", style: `left:${(nowMinutes / 1440) * 100}%`, title: "Bây giờ" }) : null,
    );
    return h("div", { class: `week-row${today ? " is-today" : ""}` },
      h("span", { class: "week-day", title: full }, short),
      track,
    );
  });
  const scale = h("div", { class: "week-scale", "aria-hidden": "true" },
    h("span"),
    h("div", {}, ["00", "06", "12", "18", "24"].map((label) => h("span", {}, label))),
  );
  el.weekGrid.replaceChildren(...rows, scale);
}

function renderScheduleStatus() {
  if (!state) return;
  const schedule = scheduleState();
  const status = state.scheduleStatus || {};
  const running = Boolean(status.runningSlotId);
  let summary;
  if (!schedule.enabled) summary = "Lịch đang tắt. Bật công tắc để chiến dịch tự chạy theo khung giờ.";
  else if (running) summary = `Đang chạy theo lịch · còn ${formatDuration(Date.parse(status.endsAt) - Date.now())}`;
  else if (status.error) summary = `Chưa chạy được: ${status.error}`;
  else if (!schedule.slots.some((slot) => slot.enabled)) summary = "Lịch đang bật nhưng chưa có khung giờ nào được bật.";
  else if (status.nextStartAt) summary = `Lần chạy kế tiếp: ${formatNextStart(status.nextStartAt)}`;
  else summary = "Lịch đang bật, chưa có lần chạy nào sắp tới.";
  el.scheduleSummary.textContent = summary;
  el.scheduleSummary.classList.toggle("form-error", Boolean(schedule.enabled && status.error && !running));

  el.scheduleEnabled.checked = schedule.enabled;
  el.scheduleEnabledText.textContent = schedule.enabled ? "Lịch đang bật" : "Lịch đang tắt";
  el.navSchedule.textContent = !schedule.enabled
    ? ""
    : running ? "Đang chạy" : status.nextStartAt ? new Date(status.nextStartAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "Bật";

  const runningTag = $(".slot.is-running [data-role='slot-status']", el.scheduleSlotList);
  if (runningTag && running) runningTag.textContent = `Đang chạy · còn ${formatDuration(Date.parse(status.endsAt) - Date.now())}`;
}

async function patchScheduleSlot(id, body, { rebuildOnError = true } = {}) {
  try {
    state = await api(`/api/schedule/slots/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  } catch (error) {
    notify(error.message);
    // Link edits stay on screen so a typo does not cost the user a pasted list.
    if (!rebuildOnError) return;
  }
  scheduleSlotsKey = "";
  render();
}

function scheduleLinksSummary(slot) {
  const own = PLATFORM_IDS
    .filter((platform) => slot.channelLinks?.[platform]?.length)
    .map((platform) => `${platformName(platform)} ${slot.channelLinks[platform].length}`);
  return own.length ? `Phòng riêng: ${own.join(" · ")}` : "Phòng: dùng link ở màn Chiến dịch";
}

function createScheduleLinks(slot) {
  const details = h("details", { class: "disclosure", open: openScheduleLinkSlots.has(slot.id) });
  details.addEventListener("toggle", () => {
    if (details.open) openScheduleLinkSlots.add(slot.id);
    else openScheduleLinkSlots.delete(slot.id);
  });
  const inputs = new Map();
  const fields = PLATFORM_IDS.map((platform) => {
    const id = `slot-${slot.id}-${platform}`;
    const textarea = h("textarea", {
      id,
      class: "mono",
      rows: 3,
      autocomplete: "off",
      placeholder: PLATFORM_INFO[platform].placeholder,
    });
    textarea.spellcheck = false;
    textarea.value = (slot.channelLinks?.[platform] || []).join("\n");
    textarea.addEventListener("change", () => {
      const channelLinks = Object.fromEntries([...inputs].map(([item, input]) => [item, input.value.split(/\r?\n/)]));
      void patchScheduleSlot(slot.id, { channelLinks }, { rebuildOnError: false });
    });
    inputs.set(platform, textarea);
    return h("div", { class: "slot-link-field" },
      h("label", { htmlFor: id }, h("span", { class: `pf-dot ${platform}` }), platformName(platform)),
      textarea,
    );
  });
  details.append(
    h("summary", {}, scheduleLinksSummary(slot)),
    h("div", { class: "slot-link-fields" }, fields),
    h("p", { class: "slot-link-hint" }, "Để trống cả ba thì khung này gửi tới các phòng ở màn Chiến dịch. Nhập ở đây thì khung chỉ gửi tới các link này."),
  );
  return details;
}

function createScheduleSlotRow(slot, status) {
  const running = status.runningSlotId === slot.id;
  const skipped = (status.skippedSlotIds || []).includes(slot.id);
  const overnight = slot.end <= slot.start;

  const toggle = h("input", { type: "checkbox", role: "switch", checked: slot.enabled, "aria-label": `Bật khung ${slot.start} – ${slot.end}` });
  toggle.addEventListener("change", () => patchScheduleSlot(slot.id, { enabled: toggle.checked }));

  const timeInput = (field, label) => {
    const input = h("input", { type: "time", required: true, "aria-label": label });
    input.value = slot[field];
    input.addEventListener("change", () => {
      if (!input.value) {
        input.value = slot[field];
        return;
      }
      void patchScheduleSlot(slot.id, { [field]: input.value });
    });
    return input;
  };

  const days = DAY_OPTIONS.map(([day, short, full]) => h("button", {
    class: "day-chip",
    type: "button",
    title: full,
    "aria-label": full,
    "aria-pressed": String(slot.days.includes(day)),
    onclick: () => {
      const nextDays = slot.days.includes(day) ? slot.days.filter((item) => item !== day) : [...slot.days, day];
      if (!nextDays.length) {
        notify("Khung giờ cần ít nhất một ngày.", "warning");
        return;
      }
      void patchScheduleSlot(slot.id, { days: nextDays });
    },
  }, short));

  const statusTag = running
    ? h("span", { class: "tag tag-live", dataset: { role: "slot-status" } }, "Đang chạy")
    : skipped
      ? h("span", { class: "tag tag-warn", title: "Sẽ chạy lại ở lần sau" }, "Đã dừng tay")
      : status.nextSlotId === slot.id && scheduleState().enabled
        ? h("span", { class: "tag" }, "Chạy kế tiếp")
        : null;

  const remove = h("button", {
    class: "icon-btn",
    type: "button",
    title: "Xóa khung giờ",
    "aria-label": `Xóa khung ${slot.start} – ${slot.end}`,
    onclick: async () => {
      const confirmed = await confirmAction({
        title: `Xóa khung ${slot.start} – ${slot.end}?`,
        message: running ? "Lượt đang chạy theo khung này sẽ dừng lại." : "",
        confirmLabel: "Xóa",
        danger: true,
      });
      if (!confirmed) return;
      try {
        state = await api(`/api/schedule/slots/${encodeURIComponent(slot.id)}`, { method: "DELETE" });
      } catch (error) {
        notify(error.message);
      }
      scheduleSlotsKey = "";
      render();
    },
  }, icon("trash-2"));

  return h("li", { class: `slot${slot.enabled ? "" : " is-off"}${running ? " is-running" : ""}` },
    h("label", { class: "switch-field" }, toggle, h("span", { class: "switch", "aria-hidden": "true" })),
    h("div", { class: "slot-times" }, timeInput("start", "Giờ bắt đầu"), h("span", { "aria-hidden": "true" }, "–"), timeInput("end", "Giờ kết thúc")),
    h("div", { class: "slot-days", role: "group", "aria-label": "Ngày trong tuần" }, days),
    h("div", { class: "slot-side" }, statusTag, remove),
    h("div", { class: "slot-foot" },
      overnight ? h("span", { class: "field-meta" }, "Kết thúc vào ngày hôm sau") : null,
      createScheduleLinks(slot),
    ),
  );
}

function renderSchedule() {
  if (!state) return;
  const { slots } = scheduleState();
  const status = state.scheduleStatus || {};
  el.scheduleEmpty.hidden = slots.length > 0;
  $(".week-card").hidden = !slots.length;
  const key = JSON.stringify([slots, status.runningSlotId, status.skippedSlotIds, status.nextSlotId, scheduleState().enabled]);
  const editing = el.scheduleSlotList.contains(document.activeElement)
    && document.activeElement.matches("input[type=time], textarea");
  // Rebuilding while a time or link field has focus would drop the user's edit.
  if (key !== scheduleSlotsKey && !editing) {
    scheduleSlotsKey = key;
    el.scheduleSlotList.replaceChildren(...slots.map((slot) => createScheduleSlotRow(slot, status)));
  }
  if (slots.length) renderWeek();
  renderScheduleStatus();
}

el.scheduleEnabled.addEventListener("change", async () => {
  const enabled = el.scheduleEnabled.checked;
  el.scheduleEnabled.disabled = true;
  try {
    state = await api("/api/schedule", { method: "PUT", body: JSON.stringify({ enabled }) });
    render();
    const error = state.scheduleStatus?.error;
    if (enabled && error) notify(`Đã bật lịch nhưng chưa gửi được: ${error}`, "warning");
    else notify(enabled ? "Đã bật lịch chạy." : "Đã tắt lịch chạy.", "success");
  } catch (error) {
    notify(error.message);
    render();
  } finally {
    el.scheduleEnabled.disabled = false;
  }
});

el.addScheduleSlot.addEventListener("click", async () => {
  setBusy(el.addScheduleSlot, true, "Đang thêm…");
  try {
    // New slots start switched off so they cannot begin sending before they are set up.
    state = await api("/api/schedule/slots", {
      method: "POST",
      body: JSON.stringify({ start: "19:30", end: "21:30", days: DAY_OPTIONS.map(([day]) => day), enabled: false }),
    });
    scheduleSlotsKey = "";
    render();
    notify("Đã thêm khung giờ mới (đang tắt). Chỉnh giờ rồi bật công tắc của khung.", "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.addScheduleSlot, false);
  }
});

// Keeps the countdowns moving between state refreshes.
function tickClock() {
  if (!state) return;
  const bulk = state.bulkSend;
  if (bulk?.running && bulk.mode === "schedule") {
    const progress = bulkProgressView(bulk);
    el.bulkCount.textContent = progress.count;
    el.bulkProgressBar.style.width = `${progress.percent}%`;
    el.runBannerCount.textContent = progress.count;
    el.runBannerBar.style.width = `${progress.percent}%`;
  }
  renderScheduleStatus();
}

/* ---------- Follow ---------- */

const followHistory = [];

function followValues() {
  const form = el.followForm;
  return {
    target: el.followTarget.value.trim(),
    count: Number(el.followCount.value),
    scope: form.elements["follow-scope"].value || "all",
    concurrency: Number(form.elements["follow-concurrency"].value) || 15,
  };
}

function renderFollow() {
  const goshReady = state.accounts.filter((account) => account.platform === "gosh" && isReady(account)).length;
  el.followSummary.textContent = `${fmt(goshReady)} tài khoản Gosh có token sẵn sàng. Không cần mở trình duyệt.`;
  for (const chip of $$("[data-follow-preset]")) {
    chip.classList.toggle("is-active", chip.dataset.followPreset === el.followCount.value);
  }
}

function setFollowRunning(running, unfollow = false) {
  followRunning = running;
  for (const control of el.followForm.querySelectorAll("input, textarea, button")) control.disabled = running;
  el.followStatus.className = running ? "tag tag-live" : "tag";
  el.followStatus.textContent = running ? (unfollow ? "Đang gỡ follow…" : "Đang chạy…") : el.followStatus.textContent;
}

function showChannel(channel) {
  el.channelPreview.hidden = false;
  const name = channel.nickname || channel.targetUid;
  el.channelAvatar.textContent = String(name || "G").trim().charAt(0).toUpperCase() || "G";
  el.channelName.textContent = name;
  el.channelUid.textContent = `UID ${channel.targetUid}${channel.showId && channel.showId !== channel.targetUid ? ` · ID ${channel.showId}` : ""}`;
  if (channel.followerCount != null) el.channelFollowers.textContent = fmt(channel.followerCount);
  if (channel.followingCount != null) el.channelFollowing.textContent = fmt(channel.followingCount);
}

function renderFollowHistory() {
  el.followHistoryEmpty.hidden = followHistory.length > 0;
  el.followHistory.parentElement.hidden = !followHistory.length;
  el.clearFollowHistory.hidden = !followHistory.length;
  el.followHistory.replaceChildren(...followHistory.map((item) => h("li", {},
    h("span", { class: "cell-muted tabular" }, item.time),
    h("span", { class: "account-name" },
      h("strong", {}, item.nickname),
      h("span", { class: "mono" }, `${item.unfollow ? "Gỡ follow · " : ""}UID ${item.targetUid}`),
    ),
    h("span", { class: `col-delta tabular ${item.delta >= 0 ? "delta-up" : "delta-down"}` }, item.deltaText),
    h("span", { class: "tabular" }, `${fmt(item.successCount)}/${fmt(item.accountCount)}`),
  )));
}

el.clearFollowHistory.addEventListener("click", () => {
  followHistory.length = 0;
  renderFollowHistory();
});

el.followCheck.addEventListener("click", async () => {
  const target = el.followTarget.value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  if (!target) {
    notify("Nhập link hoặc UID kênh Gosh trước khi kiểm tra.", "warning");
    el.followTarget.focus();
    return;
  }
  setBusy(el.followCheck, true, "Đang tra cứu…");
  try {
    const { channel } = await api(`/api/gosh/channel?target=${encodeURIComponent(target)}`);
    if (channel) {
      showChannel(channel);
      el.followBefore.textContent = fmt(channel.followerCount ?? 0);
    }
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.followCheck, false);
  }
});

el.followCount.addEventListener("input", renderFollowChips);
function renderFollowChips() {
  for (const chip of $$("[data-follow-preset]")) {
    chip.classList.toggle("is-active", chip.dataset.followPreset === el.followCount.value);
  }
}
for (const chip of $$("[data-follow-preset]")) {
  chip.addEventListener("click", () => {
    el.followCount.value = chip.dataset.followPreset;
    renderFollowChips();
  });
}

async function executeFollow(unfollow = false) {
  if (followRunning) return;
  const { target, count, scope, concurrency } = followValues();
  if (!target) {
    notify("Nhập link hoặc UID kênh Gosh cần follow.", "warning");
    el.followTarget.focus();
    return;
  }
  if (unfollow) {
    const confirmed = await confirmAction({
      title: "Gỡ follow kênh này?",
      message: `Các tài khoản Gosh ${Number.isInteger(count) && count > 0 ? `(tối đa ${fmt(count)})` : "đang chọn"} sẽ bỏ follow kênh mục tiêu.`,
      confirmLabel: "Gỡ follow",
      danger: true,
    });
    if (!confirmed) return;
  }
  const button = unfollow ? el.unfollowSubmit : el.followSubmit;
  setBusy(button, true, unfollow ? "Đang gỡ…" : "Đang chạy…");
  setFollowRunning(true, unfollow);
  let statusText = "Sẵn sàng";
  try {
    await flushSettingsBeforeSend();
    const { followReport: report } = await api("/api/gosh/follow", {
      method: "POST",
      body: JSON.stringify({
        target,
        ...(Number.isInteger(count) && count > 0 ? { count } : {}),
        scope,
        concurrency,
        unfollow,
      }),
    });
    const first = report?.targets?.[0];
    if (first) {
      const hasCounts = first.beforeFollowers != null && first.afterFollowers != null;
      const diff = hasCounts ? first.afterFollowers - first.beforeFollowers : report.totalSuccess * (unfollow ? -1 : 1);
      el.followBefore.textContent = first.beforeFollowers != null ? fmt(first.beforeFollowers) : "—";
      el.followAfter.textContent = first.afterFollowers != null ? fmt(first.afterFollowers) : "—";
      el.followDelta.textContent = diff >= 0 ? `+${fmt(diff)}` : `−${fmt(Math.abs(diff))}`;
      el.followDelta.className = diff > 0 ? "is-up" : diff < 0 ? "is-down" : "";
      el.followRate.textContent = `${fmt(report.totalSuccess)}/${fmt(report.accountCount)}`;
      showChannel({ ...first, followerCount: first.afterFollowers ?? first.beforeFollowers });
    }
    const now = formatClock(new Date());
    for (const item of report?.targets || []) {
      const hasCounts = item.beforeFollowers != null && item.afterFollowers != null;
      const delta = hasCounts ? item.afterFollowers - item.beforeFollowers : item.successCount * (unfollow ? -1 : 1);
      followHistory.unshift({
        time: now.slice(0, 5),
        targetUid: item.targetUid,
        nickname: item.nickname || item.targetUid,
        unfollow,
        delta,
        deltaText: hasCounts
          ? `${fmt(item.beforeFollowers)} → ${fmt(item.afterFollowers)}`
          : `${unfollow ? "−" : "+"}${fmt(item.successCount)}`,
        successCount: item.successCount,
        accountCount: report.accountCount,
      });
    }
    renderFollowHistory();
    statusText = first?.afterFollowers != null ? `${fmt(first.afterFollowers)} follower` : `${fmt(report?.totalSuccess)}/${fmt(report?.accountCount)} thành công`;
    const summary = first
      ? `${unfollow ? "Đã gỡ follow" : "Đã follow"} ${first.nickname}: ${fmt(report.totalSuccess)}/${fmt(report.accountCount)} tài khoản thành công.`
      : `Hoàn tất: ${fmt(report?.totalSuccess)}/${fmt(report?.accountCount)} tài khoản thành công.`;
    notify(summary, report?.totalFailure ? "warning" : "success");
  } catch (error) {
    statusText = "Lỗi";
    notify(error.message);
  } finally {
    setBusy(button, false);
    setFollowRunning(false);
    el.followStatus.textContent = statusText;
    el.followStatus.className = statusText === "Lỗi" ? "tag tag-err" : "tag";
  }
}

el.followForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void executeFollow(false);
});
el.unfollowSubmit.addEventListener("click", () => void executeFollow(true));

/* ---------- Accounts ---------- */

function accountsMatchingSearch() {
  const query = el.accountSearch.value.trim().toLowerCase();
  const platform = el.accountFilterPlatform.value;
  return state.accounts.filter((account) => {
    if (platform !== "all" && account.platform !== platform) return false;
    if (!query) return true;
    const haystack = `${account.name || ""} ${account.profileName || ""} ${account.loginInfo?.username || ""} ${account.loginInfo?.uid || ""} ${account.id || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

const STATUS_FILTERS = {
  all: () => true,
  ready: (account) => isReady(account),
  notready: (account) => !isReady(account),
  enabled: (account) => account.enabled,
  disabled: (account) => !account.enabled,
};

function filteredAccounts() {
  if (!state?.accounts) return [];
  return accountsMatchingSearch().filter(STATUS_FILTERS[statusFilter] || STATUS_FILTERS.all);
}

async function setAccountEnabled(account, enabled) {
  try {
    state = await api(`/api/accounts/${encodeURIComponent(account.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    render();
  } catch (error) {
    notify(error.message);
    render();
  }
}

function createAccountRow(account) {
  const token = tokenPresentation(account);
  const label = accountLabel(account);
  const sub = account.loginInfo?.username || (account.name !== label ? account.name : `ID ${account.id.slice(0, 8)}`);
  const toggle = h("input", {
    type: "checkbox",
    role: "switch",
    checked: account.enabled,
    disabled: isRunning(),
    "aria-label": `${label} tham gia chiến dịch`,
  });
  toggle.addEventListener("change", () => setAccountEnabled(account, toggle.checked));
  const toggleLabel = h("label", { class: "switch-field", onclick: (event) => event.stopPropagation() },
    toggle, h("span", { class: "switch", "aria-hidden": "true" }));

  const row = h("li", {
    class: `${account.id === selectedAccountId && !el.drawer.hidden ? "is-selected" : ""}${account.enabled ? "" : " is-disabled"}`,
    tabIndex: 0,
    "aria-label": `Mở chi tiết ${label}`,
  },
    h("span", { class: "account-name" }, h("strong", {}, label), h("span", {}, sub)),
    h("span", { class: "col-platform pf-tag" }, h("span", { class: `pf-dot ${account.platform}` }), platformName(account.platform)),
    h("span", { class: "col-token cell-status", title: token.title || "" }, h("span", { class: `dot ${token.tone}` }), h("span", {}, token.label)),
    toggleLabel,
    h("span", { class: "row-chevron", "aria-hidden": "true" }, icon("chevron-right")),
  );
  row.addEventListener("click", () => openDrawer(account.id));
  row.addEventListener("keydown", (event) => {
    if (event.target !== row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrawer(account.id);
    }
  });
  return row;
}

function renderAccounts() {
  if (!state) return;
  const searchMatches = accountsMatchingSearch();
  for (const tab of $$("[data-status-filter]")) {
    const filter = tab.dataset.statusFilter;
    tab.setAttribute("aria-selected", String(filter === statusFilter));
    $("[data-filter-count]", tab).textContent = fmt(searchMatches.filter(STATUS_FILTERS[filter]).length);
  }

  const matching = filteredAccounts();
  const totalPages = Math.max(1, Math.ceil(matching.length / ACCOUNTS_PER_PAGE));
  accountPage = Math.min(Math.max(accountPage, 0), totalPages - 1);
  const start = accountPage * ACCOUNTS_PER_PAGE;
  const pageSlice = matching.slice(start, start + ACCOUNTS_PER_PAGE);

  const total = state.accounts.length;
  const ready = state.accounts.filter(isReady).length;
  const enabled = state.accounts.filter((account) => account.enabled).length;
  el.accountSummary.textContent = `${fmt(total)} tài khoản · ${fmt(ready)} có token · ${fmt(enabled)} đang tham gia`;
  el.filterResult.textContent = matching.length === total ? "" : `${fmt(matching.length)} kết quả`;

  el.accountList.replaceChildren(...pageSlice.map(createAccountRow));
  el.accountEmpty.hidden = matching.length > 0;
  el.accountPageInfo.textContent = matching.length
    ? `${fmt(start + 1)}–${fmt(start + pageSlice.length)} trên ${fmt(matching.length)}`
    : "";
  el.accountPrevPage.disabled = accountPage <= 0;
  el.accountNextPage.disabled = accountPage >= totalPages - 1;
  $(".pager").hidden = !matching.length;
  renderDrawer();
}

for (const tab of $$("[data-status-filter]")) {
  tab.addEventListener("click", () => {
    statusFilter = tab.dataset.statusFilter;
    accountPage = 0;
    renderAccounts();
  });
}
for (const control of [el.accountSearch, el.accountFilterPlatform]) {
  control.addEventListener("input", () => {
    accountPage = 0;
    renderAccounts();
  });
}
el.accountPrevPage.addEventListener("click", () => {
  accountPage -= 1;
  renderAccounts();
  $(".views").scrollTop = 0;
});
el.accountNextPage.addEventListener("click", () => {
  accountPage += 1;
  renderAccounts();
  $(".views").scrollTop = 0;
});

for (const item of $$("[data-bulk]", el.bulkMenu)) {
  item.addEventListener("click", async () => {
    const matching = filteredAccounts();
    if (item.dataset.bulk === "copy") {
      const withCreds = matching.filter((account) => account.loginInfo?.username && account.loginInfo?.password);
      if (!withCreds.length) {
        notify("Danh sách đang lọc không có tài khoản nào lưu username và password.", "warning");
        return;
      }
      const lines = withCreds.map((account) => `${account.loginInfo.username} | ${account.loginInfo.password}`).join("\n");
      void copyText(lines, `Đã copy ${fmt(withCreds.length)} tài khoản (username | password).`);
      return;
    }
    if (!matching.length) return;
    const enabled = item.dataset.bulk === "enable";
    const confirmed = await confirmAction({
      title: `${enabled ? "Bật" : "Tắt"} tham gia cho ${fmt(matching.length)} tài khoản?`,
      message: "Áp dụng cho toàn bộ danh sách đang lọc, kể cả các trang khác.",
      confirmLabel: enabled ? "Bật tham gia" : "Tắt tham gia",
    });
    if (!confirmed) return;
    const trigger = $("[aria-expanded]", el.bulkMenu);
    setBusy(trigger, true, "Đang cập nhật…");
    try {
      state = await api("/api/accounts/bulk-toggle", {
        method: "POST",
        body: JSON.stringify({ enabled, accountIds: matching.map((account) => account.id) }),
      });
      render();
      notify(`Đã ${enabled ? "bật" : "tắt"} tham gia cho ${fmt(matching.length)} tài khoản.`, "success");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(trigger, false);
    }
  });
}

function nextAccountName() {
  const names = new Set(state.accounts.map((account) => account.name.toLocaleLowerCase("vi")));
  let index = 1;
  while (names.has(`tài khoản ${index}`)) index += 1;
  return `Tài khoản ${index}`;
}

async function addAccount(platform) {
  setBusy(el.addAccount, true, "Đang thêm…");
  const previousIds = new Set(state.accounts.map((account) => account.id));
  try {
    state = await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name: nextAccountName(), platform }),
    });
    const account = state.accounts.find((item) => !previousIds.has(item.id));
    render();
    if (account) openDrawer(account.id);
    if (account && isLocalMachine) {
      await api(`/api/accounts/${encodeURIComponent(account.id)}/browser/login`, {
        method: "POST",
        body: JSON.stringify({ targetUrl: channelLinksFor(platform)[0] || undefined }),
      });
      await refreshState();
      notify("Đã mở Chrome cho tài khoản mới. Đăng nhập xong, tên và token sẽ tự đồng bộ.", "success");
    } else if (account) {
      notify(`Đã thêm tài khoản ${platformName(platform)}. Đăng nhập trong bảng chi tiết để lấy token.`, "success");
    }
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.addAccount, false);
  }
}

for (const item of $$("[data-add-platform]")) {
  item.addEventListener("click", () => addAccount(item.dataset.addPlatform));
}

async function loadTokens() {
  setBusy(el.loadTokens, true, "Đang nạp token…");
  try {
    const { tokenLoad, ...nextState } = await api("/api/accounts/tokens/load", { method: "POST", body: "{}" });
    state = nextState;
    render();
    const failed = tokenLoad.failed.length;
    notify(
      `Đã nạp ${fmt(tokenLoad.loaded)} token mới, ${fmt(tokenLoad.skipped)} tài khoản đã có sẵn${failed ? `, ${fmt(failed)} tài khoản cần đăng nhập lại` : ""}.`,
      failed ? "warning" : "success",
    );
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.loadTokens, false);
  }
}
el.loadTokens.addEventListener("click", loadTokens);
el.loadTokens.hidden = !isLocalMachine;

/* ---------- Account drawer ---------- */

let drawerReturnFocus = null;

function openDrawer(accountId) {
  selectedAccountId = accountId;
  if (el.drawer.hidden) drawerReturnFocus = document.activeElement;
  el.drawer.hidden = false;
  renderDrawer({ force: true });
  if (currentView === "accounts") renderAccounts();
  window.requestAnimationFrame(() => $(".drawer-panel [data-drawer-close].icon-btn")?.focus());
}

function closeDrawer() {
  el.drawer.hidden = true;
  if (currentView === "accounts") renderAccounts();
  drawerReturnFocus?.focus?.();
}

for (const closer of $$("[data-drawer-close]")) closer.addEventListener("click", closeDrawer);

function drawerSection(title, description, ...children) {
  return h("section", { class: "drawer-section" },
    h("h3", {}, title),
    description ? h("p", {}, description) : null,
    ...children,
  );
}

function credentialLine(label, value, copyMessage) {
  return h("div", { class: "cred" },
    h("div", {}, h("small", {}, label), h("code", {}, value)),
    h("button", {
      class: "icon-btn",
      type: "button",
      title: `Copy ${label.toLowerCase()}`,
      "aria-label": `Copy ${label.toLowerCase()}`,
      onclick: () => copyText(value, copyMessage),
    }, icon("copy")),
  );
}

async function openAccountBrowser(account, button, profile = false) {
  setBusy(button, true, "Đang mở…");
  try {
    const suffix = profile ? "profile" : account.session?.loginState === "signed_out" ? "login" : "open";
    await api(`/api/accounts/${encodeURIComponent(account.id)}/browser/${suffix}`, {
      method: "POST",
      body: profile ? "{}" : JSON.stringify({ targetUrl: channelLinksFor(account.platform)[0] || undefined }),
    });
    await refreshState();
    notify(
      suffix === "login"
        ? "Hãy đăng nhập trong Chrome. Đăng nhập xong, cửa sổ tự đóng và token được lưu."
        : `Đã mở Chrome cho “${accountLabel(account)}”.`,
      "success",
    );
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function deleteAccount(account) {
  const confirmed = await confirmAction({
    title: `Xóa “${accountLabel(account)}”?`,
    message: "Tài khoản, token và hồ sơ đăng nhập của nó sẽ bị xóa khỏi máy chủ.",
    confirmLabel: "Xóa tài khoản",
    danger: true,
  });
  if (!confirmed) return;
  try {
    state = await api(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    closeDrawer();
    render();
    notify(`Đã xóa “${accountLabel(account)}”.`, "success");
  } catch (error) {
    notify(error.message);
  }
}

function renderDrawer({ force = false } = {}) {
  if (el.drawer.hidden || !state) return;
  const account = state.accounts.find((item) => item.id === selectedAccountId);
  if (!account) {
    closeDrawer();
    return;
  }
  // Do not wipe what the user is typing in the drawer during background refreshes.
  if (!force && el.drawer.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;

  const running = isRunning();
  const token = tokenPresentation(account);
  const platform = platformName(account.platform);
  const supportsApiLogin = account.platform === "gosh" || account.platform === "gaquaytv";
  el.drawerTitle.textContent = accountLabel(account);
  el.drawerSub.textContent = `${platform} · ${token.label}`;

  const sections = [];

  const participate = h("input", { type: "checkbox", role: "switch", checked: account.enabled, disabled: running });
  participate.addEventListener("change", () => setAccountEnabled(account, participate.checked));
  const tokenUpdated = account.session?.tokenUpdatedAt
    ? new Date(account.session.tokenUpdatedAt).toLocaleString("vi-VN")
    : null;
  sections.push(drawerSection("Tổng quan", null,
    h("label", { class: "switch-field" }, participate, h("span", { class: "switch", "aria-hidden": "true" }), "Tham gia chiến dịch"),
    h("dl", { class: "facts" },
      h("dt", {}, "Token"),
      h("dd", { class: "cell-status", title: token.title || "" }, h("span", { class: `dot ${token.tone}` }), h("span", {}, token.title ? `${token.label}: ${token.title}` : token.label)),
      tokenUpdated ? [h("dt", {}, "Cập nhật token"), h("dd", {}, tokenUpdated)] : null,
      h("dt", {}, "Tên nội bộ"),
      h("dd", {}, account.name),
      h("dt", {}, "ID"),
      h("dd", { class: "mono" }, account.id),
    ),
  ));

  if (supportsApiLogin) {
    const user = h("input", { type: "text", placeholder: "Email hoặc tên đăng nhập", autocomplete: "off", "aria-label": `Tài khoản ${platform}` });
    const pass = h("input", { type: "password", placeholder: "Mật khẩu", autocomplete: "new-password", "aria-label": `Mật khẩu ${platform}` });
    user.value = account.loginInfo?.username || "";
    pass.value = account.loginInfo?.password || "";
    const submit = h("button", { class: "btn btn-primary", type: "submit" }, "Đăng nhập và lấy token");
    user.disabled = pass.disabled = submit.disabled = running;
    const form = h("form", { class: "field" }, user, pass, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!user.value.trim() || !pass.value) {
        notify("Nhập tài khoản và mật khẩu.", "warning");
        return;
      }
      setBusy(submit, true, "Đang đăng nhập…");
      try {
        state = await api(`/api/accounts/${encodeURIComponent(account.id)}/login`, {
          method: "POST",
          body: JSON.stringify({ usernameOrEmail: user.value.trim(), password: pass.value }),
        });
        notify(`Đăng nhập ${platform} thành công, đã lưu token.`, "success");
        render();
        renderDrawer({ force: true });
      } catch (error) {
        notify(error.message);
      } finally {
        setBusy(submit, false);
      }
    });
    sections.push(drawerSection("Đăng nhập", `Đăng nhập trực tiếp qua API ${platform}, không cần mở Chrome.`, form));
  }

  if (account.loginInfo?.username && account.loginInfo?.password) {
    const pair = `${account.loginInfo.username} | ${account.loginInfo.password}`;
    sections.push(drawerSection("Thông tin đăng nhập đã lưu", null,
      credentialLine("Username", account.loginInfo.username, "Đã copy username."),
      credentialLine("Password", account.loginInfo.password, "Đã copy mật khẩu."),
      h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => copyText(pair, "Đã copy username | password.") },
        icon("copy"), "Copy cả hai"),
    ));
  }

  if (supportsApiLogin) {
    const nameInput = h("input", { type: "text", maxLength: 20, placeholder: "Tên mới", "aria-label": "Tên hiển thị mới" });
    const nameSubmit = h("button", { class: "btn btn-secondary", type: "submit" }, "Cập nhật");
    nameInput.disabled = nameSubmit.disabled = running;
    const form = h("form", { class: "drawer-row" }, nameInput, nameSubmit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!nameInput.value.trim()) return;
      setBusy(nameSubmit, true, "Đang đổi…");
      try {
        const response = await api(`/api/accounts/${encodeURIComponent(account.id)}/display-name`, {
          method: "POST",
          body: JSON.stringify({ displayName: nameInput.value }),
        });
        nameInput.value = "";
        // The endpoint returns only the operation result; refresh so the list shows the new name.
        await refreshState();
        renderDrawer({ force: true });
        notify(`Đã đổi tên thành “${response.result.displayName}”.`, "success");
      } catch (error) {
        notify(error.message);
      } finally {
        setBusy(nameSubmit, false);
      }
    });
    sections.push(drawerSection("Tên hiển thị", `Tên đang hiện trên ${platform}: ${accountLabel(account)}. Tối đa 20 ký tự.`, form));
  }

  const proxyInput = h("input", { type: "text", class: "mono", placeholder: "http://user:pass@host:port", "aria-label": "Proxy", autocomplete: "off" });
  proxyInput.value = account.proxy || "";
  const proxySubmit = h("button", { class: "btn btn-secondary", type: "submit" }, "Lưu");
  proxyInput.disabled = proxySubmit.disabled = running;
  const proxyForm = h("form", { class: "drawer-row" }, proxyInput, proxySubmit);
  proxyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(proxySubmit, true, "Đang lưu…");
    try {
      state = await api(`/api/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ proxy: proxyInput.value.trim() }),
      });
      render();
      renderDrawer({ force: true });
      notify(proxyInput.value.trim() ? "Đã lưu proxy." : "Đã bỏ proxy.", "success");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(proxySubmit, false);
    }
  });
  sections.push(drawerSection("Proxy", "Chỉ hỗ trợ HTTP/HTTPS: http://user:pass@host:port hoặc host:port:user:pass. Để trống nếu không dùng.", proxyForm));

  if (isLocalMachine) {
    const openButton = h("button", { class: "btn btn-secondary", type: "button" },
      account.session?.loginState === "signed_out" ? "Đăng nhập trong Chrome" : "Mở Chrome");
    const profileButton = h("button", { class: "btn btn-ghost", type: "button" }, "Mở hồ sơ");
    openButton.disabled = profileButton.disabled = running;
    openButton.addEventListener("click", () => openAccountBrowser(account, openButton));
    profileButton.addEventListener("click", () => openAccountBrowser(account, profileButton, true));
    sections.push(drawerSection("Trình duyệt trên máy chủ", "Mở hồ sơ Chrome riêng của tài khoản này.", h("div", { class: "drawer-row" }, openButton, profileButton)));
  }

  const remove = h("button", { class: "btn btn-danger-ghost btn-sm", type: "button" }, icon("trash-2"), "Xóa tài khoản");
  remove.disabled = running || state.accounts.length === 1;
  remove.addEventListener("click", () => deleteAccount(account));
  sections.push(drawerSection("Xóa tài khoản", "Xóa tài khoản cùng token và hồ sơ đăng nhập. Không thể hoàn tác.", h("div", {}, remove)));

  el.drawerBody.replaceChildren(...sections);
}

/* ---------- System ---------- */

function healthLabel(item) {
  if (item.status === "up" && [401, 403].includes(item.httpStatus)) return { text: "Có phản hồi, cần đăng nhập", tone: "warn" };
  if (item.status === "up") return { text: "Hoạt động", tone: "ok" };
  if (item.status === "degraded") return { text: "Chậm hoặc bị giới hạn", tone: "warn" };
  if (item.status === "down") return { text: "Không phản hồi", tone: "err" };
  return { text: "Chưa kiểm tra", tone: "" };
}

function renderHealth() {
  const checked = healthChecks.filter((item) => item.checkedAt);
  const down = checked.filter((item) => item.status === "down").length;
  el.healthSummary.textContent = !checked.length
    ? "Đo phản hồi của các endpoint Gosh, Loco và GaQuayTV mà công cụ đang dùng."
    : down ? `${down}/${checked.length} endpoint đang lỗi.` : `Cả ${checked.length} endpoint đều phản hồi.`;
  el.healthEmpty.hidden = checked.length > 0;
  el.healthList.parentElement.hidden = !checked.length;
  el.healthList.replaceChildren(...checked.map((item) => {
    const label = healthLabel(item);
    let path = item.url;
    try {
      const url = new URL(item.url);
      path = url.pathname + url.search;
    } catch {}
    return h("li", {},
      h("span", { class: "account-name" },
        h("strong", { class: "cell-status" }, h("span", { class: `dot ${label.tone}` }), h("span", {}, `${platformName(item.platform)} · ${item.name}`)),
        h("span", { title: item.error || "" }, item.error || label.text),
      ),
      h("code", { class: "col-endpoint cell-truncate", title: item.url }, path),
      h("span", { class: "tabular" }, item.httpStatus ?? "—"),
      h("span", { class: "tabular cell-muted" }, item.latencyMs == null ? "—" : `${item.latencyMs} ms`),
    );
  }));

  el.observedCount.textContent = String(observedEndpoints.length);
  el.observedEmpty.hidden = observedEndpoints.length > 0;
  el.observedList.parentElement.hidden = !observedEndpoints.length;
  el.observedList.replaceChildren(...observedEndpoints.map((item) => {
    let time = "vừa xong";
    const seen = new Date(item.lastSeen);
    if (!Number.isNaN(seen.getTime())) time = formatClock(seen);
    return h("li", {},
      h("span", { class: "cell-truncate" }, item.name || item.category),
      h("code", { class: "col-endpoint cell-truncate", title: item.fullUrl }, `${item.host}${item.path}`),
      h("span", { class: "cell-muted" }, `${item.method || "GET"} ${item.status || 200}`),
      h("span", { class: "tabular cell-muted" }, time),
    );
  }));
}

el.checkHealth.addEventListener("click", async () => {
  setBusy(el.checkHealth, true, "Đang kiểm tra…");
  try {
    const [result, observed] = await Promise.all([
      api("/api/health/check", { method: "POST" }),
      api("/api/endpoints/observed").catch(() => ({ endpoints: [] })),
    ]);
    healthChecks = result.checks || [];
    observedEndpoints = observed.endpoints || [];
    renderHealth();
    renderChrome();
    const down = healthChecks.filter((item) => item.status === "down").length;
    notify(down ? `Có ${down} endpoint đang lỗi.` : "Tất cả endpoint đều phản hồi.", down ? "warning" : "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.checkHealth, false);
  }
});

el.webPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(el.webPasswordSubmit, true, "Đang lưu…");
  el.webPasswordStatus.textContent = "";
  try {
    const result = await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        newUsername: el.webNewUsername.value,
        currentPassword: el.webCurrentPassword.value,
        newPassword: el.webNewPassword.value,
      }),
    });
    el.webCurrentPassword.value = "";
    el.webNewPassword.value = "";
    setAuthenticatedUi(result.username, true);
    el.webPasswordStatus.textContent = "Đã cập nhật";
    el.webPasswordStatus.className = "save-state success";
    notify("Đã cập nhật tài khoản quản trị.", "success");
  } catch (error) {
    el.webPasswordStatus.textContent = error.message;
    el.webPasswordStatus.className = "save-state error";
  } finally {
    setBusy(el.webPasswordSubmit, false);
  }
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  writePref("alc-theme", theme);
}
const savedTheme = readPref("alc-theme", "dark");
for (const radio of $$("input[name='theme']")) {
  radio.checked = radio.value === savedTheme;
  radio.addEventListener("change", () => applyTheme(radio.value));
}

let appVersionCached = "";
async function updateVersionDisplay() {
  if (!appVersionCached && window.desktopUpdater?.getVersion) {
    try { appVersionCached = await window.desktopUpdater.getVersion(); } catch {}
  }
  if (!appVersionCached && state?.version) appVersionCached = state.version;
  if (!appVersionCached) return;
  const formatted = appVersionCached.startsWith("v") ? appVersionCached : `v${appVersionCached}`;
  el.appVersion.textContent = formatted;
  el.settingsAppVersion.textContent = `Phiên bản ${formatted}`;
}

function setUpdateStatus(message, type = "") {
  el.updateStatus.textContent = message;
  el.updateStatus.className = `save-state${type ? ` ${type}` : ""}`;
}

if (window.desktopUpdater) {
  el.checkUpdate.addEventListener("click", async () => {
    setBusy(el.checkUpdate, true, "Đang kiểm tra…");
    try {
      const result = await window.desktopUpdater.check();
      if (result.status === "available") setUpdateStatus(`Có bản ${result.version}, đang tải`, "saving");
      else if (result.status === "up-to-date") setUpdateStatus("Đang dùng bản mới nhất", "success");
      else setUpdateStatus(result.message || "Không thể kiểm tra", "error");
    } catch (error) {
      setUpdateStatus(error.message, "error");
    } finally {
      setBusy(el.checkUpdate, false);
    }
  });
  window.desktopUpdater.onStatus((event) => {
    if (event.status === "downloading") setUpdateStatus(`Đang tải ${event.percent}%`, "saving");
    else if (event.status === "downloaded") setUpdateStatus("Đã tải xong. Đóng ứng dụng để cài bản mới.", "success");
    else if (event.status === "available") setUpdateStatus(`Có bản ${event.version}, đang tải`, "saving");
    else if (event.status === "error") setUpdateStatus(event.message, "error");
  });
} else {
  el.checkUpdate.hidden = true;
  setUpdateStatus("Cập nhật được thực hiện trên ứng dụng desktop.");
}

/* ---------- Render loop ---------- */

function render() {
  if (!state) return;
  void updateVersionDisplay();
  renderChrome();
  renderRunBanner();
  renderSettings();
  renderLive();
  renderSchedule();
  renderFollow();
  if (currentView === "accounts") renderAccounts();
  else renderDrawer();
  if (currentView === "system") renderHealth();
  pollBulkSend();
}

async function refreshState() {
  state = await api("/api/state");
  render();
}

el.refreshStatus.addEventListener("click", async () => {
  el.refreshStatus.disabled = true;
  el.refreshStatus.classList.add("is-spinning");
  try {
    await refreshState();
  } catch (error) {
    notify(error.message);
  } finally {
    el.refreshStatus.disabled = false;
    el.refreshStatus.classList.remove("is-spinning");
  }
});

/* ---------- Auth ---------- */

function showLogin(usernameHint = "") {
  webAuthenticated = false;
  el.loginOverlay.hidden = false;
  el.logoutBtn.hidden = true;
  el.logoutBtnSecondary.hidden = true;
  if (usernameHint && !el.loginUsername.value) el.loginUsername.value = usernameHint;
  (el.loginUsername.value ? el.loginPassword : el.loginUsername).focus();
}

function setAuthenticatedUi(username = "admin", requireAuth = true) {
  webAuthenticated = true;
  el.loginOverlay.hidden = true;
  el.authUser.textContent = requireAuth ? username : "Máy chủ cục bộ";
  el.authUser.title = requireAuth ? `Đăng nhập với ${username}` : "";
  el.logoutBtn.hidden = !requireAuth;
  el.logoutBtnSecondary.hidden = !requireAuth;
  if (!el.webNewUsername.value) el.webNewUsername.value = username;
}

el.loginTogglePass.addEventListener("click", () => {
  const hidden = el.loginPassword.type === "password";
  el.loginPassword.type = hidden ? "text" : "password";
  el.loginTogglePass.textContent = hidden ? "Ẩn" : "Hiện";
});

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.loginError.hidden = true;
  setBusy(el.loginSubmit, true, "Đang đăng nhập…");
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: el.loginUsername.value, password: el.loginPassword.value }),
    });
    el.loginPassword.value = "";
    setAuthenticatedUi(result.username, true);
    await bootDashboard();
  } catch (error) {
    el.loginError.textContent = error.message;
    el.loginError.hidden = false;
  } finally {
    setBusy(el.loginSubmit, false);
  }
});

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  showLogin();
}
el.logoutBtn.addEventListener("click", logout);
el.logoutBtnSecondary.addEventListener("click", logout);

/* ---------- Boot ---------- */

async function bootDashboard() {
  const [, health, observed] = await Promise.all([
    refreshState(),
    api("/api/health").catch(() => ({ checks: [] })),
    api("/api/endpoints/observed").catch(() => ({ endpoints: [] })),
  ]);
  healthChecks = health.checks || [];
  observedEndpoints = observed.endpoints || [];
  render();
}

buildPlatformPanels();
renderFollowHistory();
switchView(VIEWS.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "live");
void updateVersionDisplay();
window.setInterval(tickClock, 1000);

api("/api/auth/status")
  .then((auth) => {
    if (!auth.authenticated) {
      showLogin(auth.username || "admin");
      return;
    }
    setAuthenticatedUi(auth.username || "admin", auth.requireAuth);
    return bootDashboard();
  })
  .catch((error) => notify(error.message));

window.setInterval(async () => {
  if (!webAuthenticated || document.hidden || statusRefreshRunning || isRunning()) return;
  const focused = document.activeElement;
  if ((currentView === "accounts" || !el.drawer.hidden) && ["INPUT", "TEXTAREA"].includes(focused?.tagName)) return;
  statusRefreshRunning = true;
  try {
    state = await api("/api/state");
    render();
  } catch {
    // Keep the last known state; an explicit refresh still reports errors.
  } finally {
    statusRefreshRunning = false;
  }
}, 3_000);
