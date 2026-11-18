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

const PLATFORM_IDS = ["gosh"];
const PLATFORM_INFO = {
  gosh: { name: "Gosh", placeholder: "https://gosh.com/zaucute00" },
  gaquaytv: { name: "GaQuayTV", placeholder: "https://gaquaytv.com/live/…" },
};
const MAX_ROOMS = 20;
const ACCOUNTS_PER_PAGE = 100;
const VIEWS = ["live", "schedule", "follow", "viewbot", "hubs", "accounts", "system"];
// link cũ #telegram chuyển sang màn mới tương ứng
const VIEW_ALIASES = { telegram: "viewbot" };
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
  openImportBtn: $("#open-import-btn"),
  openAutoregBtn: $("#open-autoreg-btn"),
  autoregBanner: $("#autoreg-banner"),
  autoregBannerStatus: $("#autoreg-banner-status"),
  autoregBannerCount: $("#autoreg-banner-count"),
  autoregBannerBar: $("#autoreg-banner-bar"),
  autoregBannerStep: $("#autoreg-banner-step"),
  autoregStopBtn: $("#autoreg-stop-btn"),
  importDialog: $("#import-dialog"),
  importForm: $("#import-form"),
  importRawInput: $("#import-raw-input"),
  importCancelBtn: $("#import-cancel-btn"),
  importSubmitBtn: $("#import-submit-btn"),
  autoregDialog: $("#autoreg-dialog"),
  autoregForm: $("#autoreg-form"),
  autoregProxy: $("#autoreg-proxy"),
  autoregCount: $("#autoreg-count"),
  autoregCancelBtn: $("#autoreg-cancel-btn"),
  autoregSubmitBtn: $("#autoreg-submit-btn"),
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
let activePlatform = "gosh";
// tab đang mở ở màn Chiến dịch: một nền tảng Gosh hoặc "telegram"
let campaignTab = ["telegram", ...PLATFORM_IDS].includes(readPref("alc-platform", "")) ? readPref("alc-platform", "") : "gosh";
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

// Text of the last /api/state poll, so an unchanged poll can skip parsing and rendering.
let lastStateText = "";

async function request(path, options = {}) {
  // The server leaves the (large) account list out when we already hold this revision.
  const sentRev = state?.accountsRev;
  const sentAccounts = state?.accounts;
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(sentRev ? { "X-Accounts-Rev": sentRev } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (response.status === 401 && body.code === "WEB_AUTH_REQUIRED") showLogin();
  if (!response.ok) throw new Error(body.error || `Yêu cầu thất bại (${response.status}).`);
  if (body.accountsUnchanged && sentAccounts) {
    body.accounts = sentAccounts;
    delete body.accountsUnchanged;
  }
  if (path !== "/api/state") lastStateText = "";
  return { body, text };
}

async function api(path, options = {}) {
  return (await request(path, options)).body;
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
  view = VIEW_ALIASES[view] || view;
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
    if (view === "accounts") {
      renderAccounts();
      renderAccountSummary();
    }
    if (view === "schedule") renderSchedule();
    if (view === "viewbot") {
      applyViewbotPlatform();
      renderViewbot();
      if (!realtimeConnected) {
        void loadViewbot();
        void loadHubs();
      }
    }
    if (view === "hubs") {
      renderHubs();
      if (!realtimeConnected) void loadHubs();
    }
    if (view === "system") renderHealth();
  }
  if (focusId) window.requestAnimationFrame(() => document.getElementById(focusId)?.focus());
}

for (const button of $$("[data-view]")) {
  button.addEventListener("click", () => switchView(button.dataset.view));
}
window.addEventListener("hashchange", () => {
  const view = window.location.hash.slice(1);
  if ((VIEWS.includes(view) || VIEW_ALIASES[view]) && view !== currentView) switchView(view);
});
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-go-view]");
  if (!trigger) return;
  if (trigger.dataset.goFilter) {
    statusFilter = trigger.dataset.goFilter;
    accountPage = 0;
  }
  if (trigger.dataset.goView === "accounts") selectAccountKind(trigger.dataset.goKind || "gosh");
  switchView(trigger.dataset.goView, { focusId: trigger.dataset.goFocus });
});

/* ---------- Menus ---------- */

function closeMenus(except = null) {
  for (const menu of $$(".menu")) {
    if (menu === except) continue;
    const pop = $(".menu-pop", menu);
    if (pop) pop.hidden = true;
    $("[aria-expanded]", menu)?.setAttribute("aria-expanded", "false");
  }
}

for (const menu of $$(".menu")) {
  const trigger = $("[aria-expanded]", menu);
  const pop = $(".menu-pop", menu);
  // A .menu wrapper without its trigger or popover is just a container; skip it.
  if (!trigger || !pop) continue;
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
  selectPlatform(campaignTab);
}

function selectPlatform(platform) {
  campaignTab = platform === "telegram" || PLATFORM_IDS.includes(platform) ? platform : "gosh";
  if (PLATFORM_IDS.includes(campaignTab)) activePlatform = campaignTab;
  writePref("alc-platform", campaignTab);
  for (const tab of $$("[data-platform-tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.platformTab === campaignTab));
  }
  for (const id of PLATFORM_IDS) panels[id].root.hidden = id !== campaignTab;
  const telegramActive = campaignTab === "telegram";
  const tgPanel = $("#panel-telegram");
  if (tgPanel) tgPanel.hidden = !telegramActive;
  const goshLaunch = $("#launch-gosh");
  const tgLaunch = $("#launch-telegram");
  if (goshLaunch) goshLaunch.hidden = telegramActive;
  if (tgLaunch) tgLaunch.hidden = !telegramActive;
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

function notifyBulkFinished() {
  const bulk = state?.bulkSend;
  if (!bulk || bulk.running || !activeBulkRun || bulk.startedAt !== activeBulkRun) return;
  if (bulk.phase === "completed") notify(`Đã gửi xong ${fmt(bulk.sent)} lượt bình luận.`, "success");
  else if (bulk.phase === "completed_with_errors") notify(`Đã gửi ${fmt(bulk.sent)}/${fmt(bulk.total)} lượt, ${bulk.failed} lỗi.`, "warning");
  else if (bulk.phase === "stopped") notify(`Đã dừng sau ${fmt(bulk.sent)} lượt gửi.`, "warning");
  else if (bulk.error) notify(bulk.error);
  activeBulkRun = null;
}

function pollBulkSend() {
  stopBulkPolling();
  notifyBulkFinished();
  // có realtime thì máy chủ tự đẩy tiến độ, không cần hỏi lại mỗi giây
  if (!state?.bulkSend?.running || realtimeConnected) return;
  bulkPollTimer = window.setTimeout(async () => {
    try {
      await refreshState();
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
  if (!state || document.hidden) return;
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

function normalizeFollowHistoryItem(item) {
  const total = Number(item.total ?? item.accountCount ?? 0);
  const successCount = Number(item.successCount ?? 0);
  const unfollow = Boolean(item.unfollow);
  const hasCounts = item.beforeFollowers != null && item.afterFollowers != null;
  const delta = item.delta != null
    ? Number(item.delta)
    : (hasCounts ? Number(item.afterFollowers) - Number(item.beforeFollowers) : successCount * (unfollow ? -1 : 1));
  const deltaText = item.deltaText || (hasCounts
    ? `${fmt(item.beforeFollowers)} → ${fmt(item.afterFollowers)}`
    : `${unfollow ? "−" : "+"}${fmt(successCount)}`);
  return {
    time: String(item.time || "").slice(0, 8),
    targetUid: String(item.targetUid || ""),
    nickname: String(item.nickname || item.targetUid || ""),
    unfollow,
    beforeFollowers: item.beforeFollowers ?? null,
    afterFollowers: item.afterFollowers ?? null,
    delta,
    deltaText,
    successCount,
    accountCount: total,
  };
}

function applyLatestFollowStats(entry) {
  if (!entry) return;
  const hasCounts = entry.beforeFollowers != null && entry.afterFollowers != null;
  const diff = entry.delta ?? (hasCounts ? entry.afterFollowers - entry.beforeFollowers : entry.successCount * (entry.unfollow ? -1 : 1));
  el.followBefore.textContent = entry.beforeFollowers != null ? fmt(entry.beforeFollowers) : "—";
  el.followAfter.textContent = entry.afterFollowers != null ? fmt(entry.afterFollowers) : "—";
  el.followDelta.textContent = diff >= 0 ? `+${fmt(diff)}` : `−${fmt(Math.abs(diff))}`;
  el.followDelta.className = diff > 0 ? "is-up" : diff < 0 ? "is-down" : "";
  el.followRate.textContent = `${fmt(entry.successCount)}/${fmt(entry.accountCount)}`;
}

function followValues() {
  const form = el.followForm;
  return {
    target: el.followTarget.value.trim(),
    count: Number(el.followCount.value),
    scope: form.elements["follow-scope"].value || "all",
    concurrency: Number(form.elements["follow-concurrency"].value) || 20,
  };
}

function renderFollow() {
  const goshReady = state.accounts.filter((account) => account.platform === "gosh" && isReady(account)).length;
  el.followSummary.textContent = `${fmt(goshReady)} tài khoản Gosh có token sẵn sàng. Không cần mở trình duyệt.`;
  for (const chip of $$("[data-follow-preset]")) {
    chip.classList.toggle("is-active", chip.dataset.followPreset === el.followCount.value);
  }
  if (Array.isArray(state?.followHistory)) {
    followHistory.length = 0;
    for (const item of state.followHistory) {
      followHistory.push(normalizeFollowHistoryItem(item));
    }
    renderFollowHistory();
    if (followHistory.length > 0 && (el.followAfter.textContent === "-" || el.followAfter.textContent === "—")) {
      applyLatestFollowStats(followHistory[0]);
    }
  }
  const run = state?.followRun;
  if (run?.running) {
    el.followStatus.className = "tag tag-live";
    el.followStatus.textContent = `${run.unfollow ? "Đang gỡ" : "Đang chạy"} ${run.nickname || run.targetUid}: ${fmt(run.completed)}/${fmt(run.total)}`;
    if (run.beforeFollowers != null) el.followBefore.textContent = fmt(run.beforeFollowers);
    el.followRate.textContent = `${fmt(run.successCount)}/${fmt(run.total)}`;
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

el.clearFollowHistory.addEventListener("click", async () => {
  followHistory.length = 0;
  if (state) state.followHistory = [];
  renderFollowHistory();
  try {
    await api("/api/gosh/follow/history", { method: "DELETE" });
  } catch {}
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
  const progressPoll = window.setInterval(() => {
    refreshState().catch(() => {});
  }, 1500);
  try {
    await flushSettingsBeforeSend();
    const res = await api("/api/gosh/follow", {
      method: "POST",
      body: JSON.stringify({
        target,
        ...(Number.isInteger(count) && count > 0 ? { count } : {}),
        scope,
        concurrency,
        unfollow,
      }),
    });
    const report = res?.followReport;
    if (Array.isArray(res?.followHistory) && state) {
      state.followHistory = res.followHistory;
      renderFollow();
    }
    const first = report?.targets?.[0];
    if (first) {
      applyLatestFollowStats(normalizeFollowHistoryItem({
        ...first,
        unfollow,
        total: report.accountCount,
      }));
      showChannel({ ...first, followerCount: first.afterFollowers ?? first.beforeFollowers });
    }
    statusText = first?.afterFollowers != null ? `${fmt(first.afterFollowers)} follower` : `${fmt(report?.totalSuccess)}/${fmt(report?.accountCount)} thành công`;
    const summary = first
      ? `${unfollow ? "Đã gỡ follow" : "Đã follow"} ${first.nickname}: ${fmt(report.totalSuccess)}/${fmt(report.accountCount)} tài khoản thành công.`
      : `Hoàn tất: ${fmt(report?.totalSuccess)}/${fmt(report?.accountCount)} tài khoản thành công.`;
    notify(summary, report?.totalFailure ? "warning" : "success");
  } catch (error) {
    await refreshState().catch(() => {});
    statusText = "Lỗi";
    notify(error.message);
  } finally {
    window.clearInterval(progressPoll);
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
    // The switch already flipped in the DOM; force a rebuild so it shows the real value.
    accountTableKey = [];
    drawerKey = [];
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

let accountTableKey = [];

function renderAutoReg() {
  if (!el.autoregBanner) return;
  const reg = state?.autoReg;
  if (!reg || (!reg.running && !reg.completed && !reg.error)) {
    el.autoregBanner.hidden = true;
    return;
  }
  el.autoregBanner.hidden = false;
  const total = reg.count || 1;
  const pct = Math.min(100, Math.round(((reg.completed || 0) / total) * 100));
  el.autoregBannerStatus.textContent = reg.running
    ? "Đang tự động đăng ký Gosh…"
    : reg.error ? `Tự reg dừng: ${reg.error}` : "Tự động đăng ký Gosh hoàn tất";
  el.autoregBannerCount.textContent = `${fmt(reg.completed || 0)}/${fmt(reg.count || 0)}`;
  el.autoregBannerBar.style.width = `${pct}%`;
  el.autoregBannerStep.textContent = reg.error || reg.currentStep || "";
  if (el.autoregStopBtn) el.autoregStopBtn.hidden = !reg.running;
  if (el.openAutoregBtn) el.openAutoregBtn.disabled = Boolean(reg.running);
}

function renderAccounts() {
  if (!state) return;
  renderAutoReg();
  const key = [state.accounts, statusFilter, el.accountSearch.value, el.accountFilterPlatform.value, accountPage, selectedAccountId, el.drawer.hidden, isRunning()];
  if (key.length === accountTableKey.length && key.every((part, index) => part === accountTableKey[index])) {
    renderDrawer();
    return;
  }
  accountTableKey = key;
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
el.loadTokens?.addEventListener("click", loadTokens);
if (el.loadTokens) el.loadTokens.hidden = true;

el.openImportBtn?.addEventListener("click", () => {
  el.importRawInput.value = "";
  el.importDialog?.showModal();
  el.importRawInput.focus();
});
el.importCancelBtn?.addEventListener("click", () => el.importDialog?.close());
el.importForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = el.importRawInput.value.trim();
  if (!raw) {
    notify("Vui lòng dán ít nhất 1 dòng username|password.", "warning");
    return;
  }
  setBusy(el.importSubmitBtn, true, "Đang đăng nhập…");
  try {
    const res = await api("/api/gosh/import-login", {
      method: "POST",
      body: JSON.stringify({ raw }),
    });
    const { importReport, ...nextState } = res;
    state = nextState;
    accountTableKey = [];
    render();
    el.importDialog?.close();
    const failCount = importReport?.failed?.length || 0;
    notify(
      `Đã đăng nhập thành công: thêm mới ${fmt(importReport?.added || 0)} acc, cập nhật ${fmt(importReport?.updated || 0)} acc${failCount ? `, lỗi ${fmt(failCount)} acc` : ""}.`,
      failCount ? "warning" : "success",
    );
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.importSubmitBtn, false);
  }
});

el.openAutoregBtn?.addEventListener("click", () => {
  if (state?.autoReg?.proxy && !el.autoregProxy.value) {
    el.autoregProxy.value = state.autoReg.proxy;
  }
  el.autoregDialog?.showModal();
  el.autoregCount.focus();
});
el.autoregCancelBtn?.addEventListener("click", () => el.autoregDialog?.close());
for (const chip of $$("[data-autoreg-preset]")) {
  chip.addEventListener("click", () => {
    el.autoregCount.value = chip.dataset.autoregPreset;
    for (const c of $$("[data-autoreg-preset]")) {
      c.classList.toggle("is-active", c === chip);
    }
  });
}
el.autoregForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const proxy = el.autoregProxy.value.trim();
  const count = Number(el.autoregCount.value) || 50;
  if (!proxy) {
    notify("Vui lòng nhập Proxy Geonode.", "warning");
    return;
  }
  setBusy(el.autoregSubmitBtn, true, "Đang khởi tạo…");
  try {
    state = await api("/api/gosh/auto-reg/start", {
      method: "POST",
      body: JSON.stringify({ proxy, count }),
    });
    el.autoregDialog?.close();
    render();
    notify(`Đã bắt đầu tự động đăng ký ${fmt(count)} tài khoản Gosh.`, "success");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.autoregSubmitBtn, false);
  }
});
el.autoregStopBtn?.addEventListener("click", async () => {
  setBusy(el.autoregStopBtn, true, "Đang dừng…");
  try {
    state = await api("/api/gosh/auto-reg/stop", { method: "POST" });
    render();
    notify("Đã tạm dừng tiến trình tự động đăng ký Gosh.", "info");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(el.autoregStopBtn, false);
  }
});

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

let drawerKey = [];

function renderDrawer({ force = false } = {}) {
  if (el.drawer.hidden || !state) return;
  const account = state.accounts.find((item) => item.id === selectedAccountId);
  if (!account) {
    closeDrawer();
    return;
  }
  // Do not wipe what the user is typing in the drawer during background refreshes.
  if (!force && el.drawer.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;
  const key = [account, isRunning(), state.accounts.length];
  if (!force && key.every((part, index) => part === drawerKey[index])) return;
  drawerKey = key;

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
  renderAutoReg();
  if (currentView === "accounts") renderAccounts();
  else renderDrawer();
  renderAccountSummary();
  if (currentView === "system") renderHealth();
  pollBulkSend();
}

async function refreshState() {
  const { body, text } = await request("/api/state");
  if (state && text === lastStateText) return;
  lastStateText = text;
  state = body;
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
  disconnectRealtime();
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  showLogin();
}
el.logoutBtn.addEventListener("click", logout);
el.logoutBtnSecondary.addEventListener("click", logout);

/* ---------- Boot ---------- */

async function bootDashboard() {
  connectRealtime();
  const [, health, observed, drafts] = await Promise.all([
    refreshState(),
    api("/api/health").catch(() => ({ checks: [] })),
    api("/api/endpoints/observed").catch(() => ({ endpoints: [] })),
    api("/api/drafts").catch(() => null),
    loadTelegram(),
    realtimeConnected ? null : loadHubs(),
  ]);
  if (drafts) applyDrafts(drafts, { force: true });
  healthChecks = health.checks || [];
  observedEndpoints = observed.endpoints || [];
  render();
}


/* ---------- Dữ liệu dùng chung + đồng bộ realtime ---------- */

let hubList = [];
let hubLoaded = false;
let hubLoadError = "";
let tgAccounts = [];
let tgComments = [];
let tgStatus = { running: false, joined: 0, errors: 0, busy: 0, comments: { running: false, sent: 0, errors: 0 } };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function tgRow(phone, left, right, cls = "") {
  return `<div class="tg-row ${cls}"><span class="mono">${escapeHtml(phone)}</span><span>${left}</span><span class="tg-state">${right}</span></div>`;
}

// mỗi tab trình duyệt một id để bỏ qua bản nháp do chính mình gửi lên
const clientId = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
})();

let realtimeConnected = false;
let eventSource = null;
let realtimeRetryTimer = null;
let pendingAccounts = null;
const pendingDrafts = {};
let draftTimer = null;
let draftValues = {};
let draftRev = 0;

/* --- Ô nhập đồng bộ: phần tử có data-sync="khoá" --- */

function syncedFields(key) {
  return $$(key ? `[data-sync="${key}"]` : "[data-sync]");
}

function readSyncedField(field) {
  if (field.type === "radio") {
    const checked = syncedFields(field.dataset.sync).find((item) => item.checked);
    return checked ? checked.value : null;
  }
  if (field.type === "checkbox") return field.checked;
  return field.value;
}

function writeSyncedField(field, value) {
  if (field === document.activeElement && field.type !== "radio" && field.type !== "checkbox") return false;
  if (field.type === "radio") {
    const next = field.value === String(value);
    if (field.checked === next) return false;
    field.checked = next;
    return next;
  }
  if (field.type === "checkbox") {
    if (field.checked === Boolean(value)) return false;
    field.checked = Boolean(value);
    return true;
  }
  const text = value == null ? "" : String(value);
  if (field.value === text) return false;
  field.value = text;
  return true;
}

function queueDraft(key, value) {
  pendingDrafts[key] = value;
  draftValues[key] = value;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(flushDrafts, 350);
}

function flushDrafts() {
  window.clearTimeout(draftTimer);
  const values = { ...pendingDrafts };
  if (!Object.keys(values).length) return;
  for (const key of Object.keys(values)) delete pendingDrafts[key];
  api("/api/drafts", { method: "PUT", body: JSON.stringify({ values, clientId }) }).catch(() => {
    // lần sau gõ tiếp sẽ gửi lại; giữ giá trị chưa gửi được
    for (const [key, value] of Object.entries(values)) if (!(key in pendingDrafts)) pendingDrafts[key] = value;
  });
}

// đổi giá trị bằng code (nút preset…) mà vẫn đồng bộ sang máy khác
function setSyncedValue(field, value) {
  if (!field) return;
  field.value = String(value);
  if (field.dataset.sync) queueDraft(field.dataset.sync, readSyncedField(field));
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyDrafts(snapshot, { force = false } = {}) {
  if (!snapshot || typeof snapshot.values !== "object") return;
  const rev = Number(snapshot.rev) || 0;
  if (!force && rev <= draftRev) return;
  draftRev = Math.max(draftRev, rev);
  if (!force && snapshot.origin === clientId) return;
  draftValues = { ...snapshot.values };
  const changedKeys = new Set();
  for (const field of syncedFields()) {
    const key = field.dataset.sync;
    if (key in pendingDrafts || !(key in draftValues)) continue;
    if (writeSyncedField(field, draftValues[key])) changedKeys.add(key);
  }
  if (Array.isArray(draftValues["viewbot.targets"]) && !("viewbot.targets" in pendingDrafts)) {
    applyViewbotTargetDraft(draftValues["viewbot.targets"]);
  }
  if (changedKeys.size) onDraftsApplied(changedKeys);
}

function onDraftsApplied(keys) {
  if ([...keys].some((key) => key.startsWith("viewbot."))) {
    refreshViewbotProxyCount();
    applyViewbotPlatform();
  }
  if ([...keys].some((key) => key.startsWith("tg."))) renderTgComments(true);
}

document.addEventListener("input", (event) => {
  const field = event.target.closest?.("[data-sync]");
  if (!field || !event.isTrusted) return;
  queueDraft(field.dataset.sync, readSyncedField(field));
});
document.addEventListener("change", (event) => {
  const field = event.target.closest?.("[data-sync]");
  if (!field || !event.isTrusted) return;
  queueDraft(field.dataset.sync, readSyncedField(field));
});
window.addEventListener("pagehide", flushDrafts);

/* --- Kênh realtime (Server-Sent Events) --- */

// state đẩy về không kèm danh sách acc (nặng); giữ danh sách đang có cùng đúng revision của nó
function applyStatePush(body) {
  const accounts = state?.accounts || pendingAccounts?.accounts || [];
  const rev = state?.accounts ? state.accountsRev : pendingAccounts?.rev;
  pendingAccounts = null;
  state = { ...body, accounts, accountsRev: rev };
  lastStateText = "";
  render();
}

function applyAccountsPush({ rev, accounts }) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!state) {
    pendingAccounts = { rev, accounts: list };
    return;
  }
  state = { ...state, accounts: list, accountsRev: rev };
  render();
}

function applyTelegramPush(data) {
  tgStatus = data || tgStatus;
  if (Array.isArray(data?.messages)) tgComments = data.messages;
  renderTelegram();
}

function applyTelegramAccountsPush(data) {
  tgAccounts = Array.isArray(data?.accounts) ? data.accounts : [];
  if (data?.dailyLimit != null) tgStatus = { ...tgStatus, safety: { ...(tgStatus.safety || {}), dailyLimit: data.dailyLimit } };
  renderTgAccounts();
  renderTgComments(true);
  renderViewbotEligible();
}

function setRealtimeIndicator(connected) {
  document.documentElement.classList.toggle("is-realtime", connected);
  const button = el.refreshStatus;
  if (button) button.title = connected ? "Đang đồng bộ realtime · bấm để tải lại" : "Mất kết nối realtime · bấm để tải lại";
}

function connectRealtime() {
  if (eventSource || typeof EventSource === "undefined") return;
  window.clearTimeout(realtimeRetryTimer);
  const source = new EventSource("/api/events");
  eventSource = source;
  const on = (name, handler) => source.addEventListener(name, (event) => {
    try {
      handler(JSON.parse(event.data));
    } catch (error) {
      console.warn(`[realtime] ${name}`, error);
    }
  });
  on("state", applyStatePush);
  on("accounts", applyAccountsPush);
  on("viewbot", applyViewbotData);
  on("telegram", applyTelegramPush);
  on("telegramAccounts", applyTelegramAccountsPush);
  on("drafts", (snapshot) => applyDrafts(snapshot));
  source.addEventListener("ready", () => {
    realtimeConnected = true;
    setRealtimeIndicator(true);
  });
  source.addEventListener("error", () => {
    realtimeConnected = false;
    setRealtimeIndicator(false);
    if (source.readyState === EventSource.CLOSED) {
      eventSource = null;
      // có thể phiên đăng nhập đã hết: kiểm tra rồi mới nối lại
      realtimeRetryTimer = window.setTimeout(async () => {
        try {
          const auth = await api("/api/auth/status");
          if (!auth.authenticated) return showLogin(auth.username || "admin");
        } catch {
          // mạng chập chờn: vẫn thử nối lại
        }
        connectRealtime();
      }, 3000);
    }
  });
}

function disconnectRealtime() {
  window.clearTimeout(realtimeRetryTimer);
  eventSource?.close();
  eventSource = null;
  realtimeConnected = false;
  setRealtimeIndicator(false);
}

/* ---------- Mắt xem livestream (QQ88 / Hi88 / MB66 / Coichua / Telegram) ---------- */

const viewbotEl = {
  form: $("#viewbot-form"),
  sub: $("#viewbot-sub"),
  url: $("#viewbot-url"),
  urlHint: $("#viewbot-url-hint"),
  bots: $("#viewbot-bots"),
  ramp: $("#viewbot-ramp"),
  rampField: $("#viewbot-ramp-field"),
  tgFields: $("#viewbot-tg-fields"),
  tgDelayMin: $("#viewbot-tg-delay-min"),
  tgDelayMax: $("#viewbot-tg-delay-max"),
  tgAge: $("#viewbot-tg-age"),
  tgDaily: $("#viewbot-tg-daily"),
  tgEligible: $("#viewbot-tg-eligible"),
  tgCheck: $("#viewbot-tg-check"),
  tgCheckResult: $("#viewbot-tg-check-result"),
  proxies: $("#viewbot-proxies"),
  proxyCount: $("#viewbot-proxy-count"),
  proxyHint: $("#viewbot-proxy-hint"),
  submit: $("#viewbot-submit"),
  stop: $("#viewbot-stop"),
  jobs: $("#viewbot-jobs"),
  empty: $("#viewbot-empty"),
  count: $("#viewbot-count"),
  tag: $("#viewbot-tag"),
  navMeta: $("#nav-viewbot"),
  checkHub: $("#viewbot-check-hub"),
  check: $("#viewbot-check"),
  checkResult: $("#viewbot-check-result"),
  loadStreams: $("#viewbot-load-streams"),
  targets: $("#viewbot-targets"),
  targetAll: $("#viewbot-target-all"),
  checkProxies: $("#viewbot-check-proxies"),
  proxyResult: $("#viewbot-proxy-result"),
};

const VIEWBOT_PLATFORM_COPY = {
  qq88: { placeholder: "https://www.qq88live.live/live/QQ88live-bunny", hint: "Dán link live hoặc mã phòng (vd QQ88live-bunny)." },
  hi88: { placeholder: "https://hi88live.../live/…", hint: "Dán link live hoặc mã phòng Hi88." },
  mb66: { placeholder: "https://mb66live.../live/…", hint: "Dán link live hoặc mã phòng MB66." },
  coichua: { placeholder: "https://coichua.tv/…", hint: "Dán link live hoặc matchId:profileId." },
  telegram: { placeholder: "https://t.me/tenkenh", hint: "Dán link kênh/nhóm Telegram đang livestream." },
};

let viewbotJobs = [];
let viewbotTimer = null;
let viewbotBusy = false;
let viewbotTargetsSig = "";

function viewbotPlatform() {
  return $('input[name="viewbot-platform"]:checked')?.value || "qq88";
}

const isTelegramViewbot = () => viewbotPlatform() === "telegram";

function viewbotProxyLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// 18/11: proxy dùng chung kho code-tele-v4 (settings.json của code-tele) — ô proxy chỉ để xem, sửa ở trang Cài đặt của code-tele.
let sharedProxy = null;

async function loadSharedProxies() {
  try {
    sharedProxy = await api("/api/proxies/shared");
  } catch {
    sharedProxy = null;
  }
  const box = viewbotEl.proxies;
  if (!box || !sharedProxy?.enabled) return;
  box.readOnly = true;
  box.dataset.shared = "1";
  box.removeAttribute("data-sync"); // không lưu / không bị bản nháp cũ (danh sách proxy riêng) ghi đè
  box.value = sharedProxy.proxies.join("\n");
  box.title = "Proxy dùng chung kho code-tele-v4 — thêm / bớt proxy ở trang Cài đặt của code-tele";
  const hint = $("#viewbot-proxy-hint");
  if (hint) {
    hint.textContent = "Proxy lấy từ kho proxy chung của code-tele-v4 (trang Cài đặt → Proxy bên code-tele). Hai tool dùng chung một kho: muốn thêm / bớt proxy thì sửa ở code-tele, bên này tự cập nhật.";
  }
  refreshViewbotProxyCount();
}

function refreshViewbotProxyCount() {
  if (!viewbotEl.proxyCount) return;
  if (viewbotEl.proxies?.dataset.shared && sharedProxy) {
    viewbotEl.proxyCount.textContent = `${fmt(sharedProxy.count)} proxy · kho chung code-tele`;
    return;
  }
  const lines = viewbotProxyLines(viewbotEl.proxies?.value);
  viewbotEl.proxyCount.textContent = lines.length ? `${fmt(lines.length)} proxy` : "0 proxy";
}

function viewbotUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

// acc Telegram còn dùng được theo tuổi/hạn mức đang nhập ở form
function telegramEligibleCount({ minAge, dailyLimit, field = "joinsToday" }) {
  const busy = new Set();
  const now = Date.now();
  let ready = 0;
  for (const account of tgAccounts) {
    if (!account.hasSession && !account.hasJson) continue;
    if (account.dead || account.cooldownUntil > now) continue;
    if ((account.ageDays ?? 0) < minAge) continue;
    if (dailyLimit > 0 && (account[field] ?? 0) >= dailyLimit) continue;
    if (busy.has(account.phone)) continue;
    ready += 1;
  }
  return ready;
}

function renderViewbotEligible() {
  if (!viewbotEl.tgEligible) return;
  const telegram = isTelegramViewbot();
  viewbotEl.tgEligible.hidden = !telegram;
  if (!telegram) return;
  const ready = telegramEligibleCount({
    minAge: Number(viewbotEl.tgAge?.value) || 0,
    dailyLimit: Number(viewbotEl.tgDaily?.value) || 0,
  });
  const busy = tgStatus.busy || 0;
  viewbotEl.tgEligible.textContent = tgAccounts.length
    ? `Mỗi mắt là 1 tài khoản Telegram · ${fmt(ready)}/${fmt(tgAccounts.length)} acc đủ điều kiện${busy ? ` · ${fmt(busy)} acc đang bận` : ""}.`
    : "Chưa có tài khoản Telegram — nhập ở màn Tài khoản › Telegram.";
}

function applyViewbotPlatform() {
  const platform = viewbotPlatform();
  const telegram = platform === "telegram";
  const copy = VIEWBOT_PLATFORM_COPY[platform] || VIEWBOT_PLATFORM_COPY.qq88;
  if (viewbotEl.url) viewbotEl.url.placeholder = copy.placeholder;
  if (viewbotEl.urlHint) viewbotEl.urlHint.textContent = copy.hint;
  if (viewbotEl.rampField) viewbotEl.rampField.hidden = telegram;
  if (viewbotEl.tgFields) viewbotEl.tgFields.hidden = !telegram;
  if (viewbotEl.loadStreams) viewbotEl.loadStreams.hidden = telegram;
  if (viewbotEl.tgCheck) viewbotEl.tgCheck.hidden = !telegram;
  if (viewbotEl.tgCheckResult && !telegram) viewbotEl.tgCheckResult.hidden = true;
  if (viewbotEl.sub) {
    viewbotEl.sub.textContent = telegram
      ? "Mỗi mắt là một tài khoản Telegram vào phòng livestream — giữ kết nối để số người xem tăng."
      : "Mỗi mắt là một socket vào phòng chat của livestream — số người xem hiển thị trên site tăng theo.";
  }
  if (viewbotEl.proxyHint) {
    viewbotEl.proxyHint.innerHTML = telegram
      ? "Mỗi dòng một proxy dạng ip:port:user:pass (hoặc socks5://…). Mỗi tài khoản giữ cố định một proxy; dùng <code>{i}</code> trong user để mỗi acc một IP riêng. Trống = dùng IP máy chạy."
      : "Mỗi dòng một proxy dạng ip:port:user:pass (hoặc ip:port, socks5://…). Dùng <code>{i}</code> trong user để mỗi mắt một session/IP riêng (Geonode: <code>user-session-{i}</code>, hoặc <code>{rand}</code>). Trống = dùng IP máy.";
  }
  if (viewbotEl.checkHub) viewbotEl.checkHub.placeholder = telegram ? "Link kênh Telegram" : "Mã phòng";
  if (viewbotEl.check) viewbotEl.check.textContent = telegram ? "Đọc số người xem" : "Đọc số mắt trên site";
  renderViewbotEligible();
  syncViewbotTargets(true);
}

function viewbotJobValues(job) {
  const telegram = job.platform === "telegram";
  const live = Number(job.live) || 0;
  const target = Number(job.target) || 0;
  return {
    percent: target ? Math.min(100, Math.round((live / target) * 100)) : 0,
    onsite: `${job.count == null ? "—" : fmt(job.count)} ${telegram ? "người xem" : "mắt trên site"}`,
    live: `${fmt(live)}/${fmt(target)}`,
    second: fmt(telegram ? job.total : job.joined),
    drops: fmt(job.drops),
    errors: fmt(job.errors),
    proxies: fmt(job.proxies),
    uptime: viewbotUptime(job.uptimeSeconds),
    accountsCount: `Tài khoản (${fmt(job.accounts?.length || 0)})`,
    accountsList: (job.accounts || [])
      .slice(0, 300)
      .map((row) => tgRow(
        row.phone,
        escapeHtml(row.name || "—"),
        escapeHtml(row.state === "joined" ? "trong phòng" : row.error || row.state || "—"),
        row.state === "joined" ? "is-joined" : row.state === "error" ? "is-error" : "",
      ))
      .join(""),
  };
}

// phần khung của thẻ: chỉ dựng lại khi những thứ này đổi, số liệu thì cập nhật tại chỗ
function viewbotJobShape(job) {
  const offline = job.state === "offline" || job.hubOnline === false;
  return JSON.stringify([job.platform, job.hub, job.hubName, offline, job.lastError || "", Boolean(job.accounts?.length)]);
}

function viewbotJobCard(job) {
  const telegram = job.platform === "telegram";
  const values = viewbotJobValues(job);
  const offline = job.state === "offline" || job.hubOnline === false;
  const id = escapeHtml(job.id);
  const adjust = telegram
    ? `<div class="viewbot-adjust" role="group" aria-label="Đổi số mắt">
        ${[-10, -1, 1, 10].map((step) => `<button class="tg-step" type="button" data-viewbot-adjust="${id}" data-step="${step}">${step > 0 ? "+" : "−"}${Math.abs(step)}</button>`).join("")}
      </div>`
    : "";
  const error = job.lastError ? `<p class="progress-error">${escapeHtml(job.lastError)}</p>` : "";
  const accounts = telegram && job.accounts?.length
    ? `<details class="viewbot-accounts"><summary data-f="accountsCount">${values.accountsCount}</summary><div class="tg-list" data-f="accountsList">${values.accountsList}</div></details>`
    : "";
  return `<article class="viewbot-job${offline ? " is-offline" : ""}" data-job-id="${id}">
      <div class="viewbot-job-head">
        <strong>${escapeHtml(job.platformName || job.platform)}</strong>
        <span class="mono">${escapeHtml(job.hub || "")}</span>
        <span class="tag">${escapeHtml(job.hubName || "Máy chính")}${offline ? " · offline" : ""}</span>
        <span class="tag" data-f="onsite">${values.onsite}</span>
      </div>
      <div class="meter"><span data-f="percent" style="width:${values.percent}%"></span></div>
      <dl class="viewbot-stats">
        <div><dt>${telegram ? "Acc trong phòng" : "Trong phòng"}</dt><dd data-f="live">${values.live}</dd></div>
        <div><dt>${telegram ? "Acc phân bổ" : "Join OK"}</dt><dd data-f="second">${values.second}</dd></div>
        <div><dt>Rớt</dt><dd data-f="drops">${values.drops}</dd></div>
        <div><dt>Lỗi</dt><dd data-f="errors">${values.errors}</dd></div>
        <div><dt>Proxy</dt><dd data-f="proxies">${values.proxies}</dd></div>
        <div><dt>Chạy</dt><dd data-f="uptime">${values.uptime}</dd></div>
      </dl>
      ${error}
      <div class="viewbot-job-actions">
        ${adjust}
        <button class="btn btn-ghost btn-sm" type="button" data-viewbot-stop="${id}">Dừng phiên</button>
      </div>
      ${accounts}
    </article>`;
}

function updateViewbotJobCard(card, job) {
  const values = viewbotJobValues(job);
  for (const node of card.querySelectorAll("[data-f]")) {
    const key = node.dataset.f;
    if (key === "percent") {
      const width = `${values.percent}%`;
      if (node.style.width !== width) node.style.width = width;
    } else if (key === "accountsList") {
      if (node.parentElement?.open && node.innerHTML !== values.accountsList) node.innerHTML = values.accountsList;
    } else if (node.textContent !== values[key]) {
      node.textContent = values[key];
    }
  }
}

function renderViewbot() {
  if (!viewbotEl.jobs) return;
  const totalLive = viewbotJobs.reduce((sum, job) => sum + (Number(job.live) || 0), 0);
  if (viewbotEl.count) viewbotEl.count.textContent = `${viewbotJobs.length} phiên · ${fmt(totalLive)} mắt`;
  if (viewbotEl.navMeta) {
    viewbotEl.navMeta.hidden = !viewbotJobs.length;
    viewbotEl.navMeta.textContent = fmt(totalLive);
  }
  if (viewbotEl.tag) {
    viewbotEl.tag.textContent = viewbotJobs.length ? "Đang chạy" : "Sẵn sàng";
    viewbotEl.tag.classList.toggle("tag-live", viewbotJobs.length > 0);
  }
  viewbotEl.empty.hidden = viewbotJobs.length > 0;

  const existing = new Map([...viewbotEl.jobs.children].map((node) => [node.dataset.jobId, node]));
  let previous = null;
  for (const job of viewbotJobs) {
    let card = existing.get(job.id);
    existing.delete(job.id);
    const shape = viewbotJobShape(job);
    if (!card || card.dataset.shape !== shape) {
      const holder = document.createElement("div");
      holder.innerHTML = viewbotJobCard(job);
      const fresh = holder.firstElementChild;
      fresh.dataset.shape = shape;
      if (card?.querySelector("details[open]")) fresh.querySelector("details")?.setAttribute("open", "");
      if (card) card.replaceWith(fresh);
      card = fresh;
    } else {
      updateViewbotJobCard(card, job);
    }
    const expectedPosition = previous ? previous.nextElementSibling : viewbotEl.jobs.firstElementChild;
    if (card !== expectedPosition) viewbotEl.jobs.insertBefore(card, expectedPosition);
    previous = card;
  }
  for (const stale of existing.values()) stale.remove();
}

function applyViewbotData(data) {
  viewbotJobs = Array.isArray(data.jobs) ? data.jobs : [];
  if (Array.isArray(data.hubs)) {
    hubList = data.hubs;
    hubLoaded = true;
    hubLoadError = "";
    renderHubs();
  }
  renderViewbot();
}

async function loadViewbot() {
  try {
    applyViewbotData(await api("/api/viewbot/status"));
    if (viewbotJobs.length) startViewbotPolling();
  } catch (error) {
    notify(error.message);
  }
}

function startViewbotPolling() {
  if (viewbotTimer) return;
  viewbotTimer = window.setInterval(() => {
    if (realtimeConnected || currentView !== "viewbot" || document.hidden) return;
    void loadViewbot();
  }, 2500);
}

function viewbotPayload() {
  const platform = viewbotPlatform();
  const payload = {
    platform,
    url: String(viewbotEl.url?.value || "").trim(),
    bots: Number(viewbotEl.bots?.value) || 50,
    // kho chung: máy chủ tự lấy proxy từ code-tele (ô trên trang chỉ hiện bản che mật khẩu)
    proxies: viewbotEl.proxies?.dataset.shared ? "" : viewbotProxyLines(viewbotEl.proxies?.value).join("\n"),
    targets: viewbotSelectedTargets(),
  };
  if (platform === "telegram") {
    Object.assign(payload, {
      delayMin: Number(viewbotEl.tgDelayMin?.value) || 0,
      delayMax: Number(viewbotEl.tgDelayMax?.value) || 20,
      minAgeDays: Number(viewbotEl.tgAge?.value) || 0,
      dailyLimit: Number(viewbotEl.tgDaily?.value) || 0,
    });
  } else {
    payload.ramp = Number(viewbotEl.ramp?.value) || 5;
  }
  return payload;
}

async function submitViewbot(event) {
  event.preventDefault();
  if (viewbotBusy) return;
  const payload = viewbotPayload();
  if (!payload.url) {
    notify(payload.platform === "telegram" ? "Dán link livestream Telegram trước đã." : "Dán link livestream hoặc mã phòng trước đã.");
    return;
  }
  viewbotBusy = true;
  setBusy(viewbotEl.submit, true, "Đang khởi động…");
  try {
    flushDrafts();
    const result = await api("/api/viewbot/start", { method: "POST", body: JSON.stringify(payload) });
    const label = payload.platform === "telegram" ? "Telegram" : payload.platform.toUpperCase();
    notify(`Đã bắt đầu ${fmt(payload.bots)} mắt cho ${label}${result.note ? ` — ${result.note}` : ""}`, "success");
    if (!realtimeConnected) await loadViewbot();
  } catch (error) {
    notify(error.message);
  } finally {
    viewbotBusy = false;
    setBusy(viewbotEl.submit, false);
  }
}

async function stopViewbot(id) {
  try {
    await api("/api/viewbot/stop", { method: "POST", body: JSON.stringify({ id }) });
    notify("Đã dừng phiên.", "info");
    if (!realtimeConnected) await loadViewbot();
  } catch (error) {
    notify(error.message);
  }
}

async function adjustViewbot(id, step) {
  const job = viewbotJobs.find((row) => row.id === id);
  if (!job) return;
  const target = Math.max(0, Math.min(Number(job.total) || Infinity, (Number(job.target) || 0) + step));
  job.target = target;
  renderViewbot();
  try {
    await api("/api/viewbot/adjust", { method: "POST", body: JSON.stringify({ id, target }) });
  } catch (error) {
    notify(error.message);
  }
}

async function stopAllViewbot() {
  if (!viewbotJobs.length) return notify("Không có phiên nào đang chạy.", "info");
  const confirmed = await confirmAction({
    title: "Dừng mọi phiên mắt xem?",
    message: `${viewbotJobs.length} phiên trên mọi máy sẽ dừng, kể cả Telegram.`,
    confirmLabel: "Dừng tất cả",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api("/api/viewbot/stop-all", { method: "POST", body: "{}" });
    notify("Đã dừng tất cả phiên.", "info");
    if (!realtimeConnected) await loadViewbot();
  } catch (error) {
    notify(error.message);
  }
}

async function checkTelegramLink(link, output) {
  if (!link) return notify("Dán link kênh Telegram trước đã.");
  output.hidden = false;
  output.textContent = "Đang kiểm tra…";
  try {
    const info = await api("/api/telegram/check", { method: "POST", body: JSON.stringify({ link }) });
    if (info.ok === false) {
      output.textContent = `Không kiểm tra được: ${info.error}`;
      return null;
    }
    output.textContent = [
      `${info.title || info.username || "?"} (${info.type}${info.megagroup ? " · supergroup" : ""})`,
      info.call ? `đang LIVE · ${fmt(info.participants)} người xem` : "chưa có livestream",
      info.canSend === undefined ? "" : info.canSend ? "gửi tin được" : `không gửi tin được (${info.sendError || "không rõ"})`,
    ].filter(Boolean).join(" — ");
    return info;
  } catch (error) {
    output.textContent = `Lỗi: ${error.message}`;
    return null;
  }
}

async function checkViewbotViewer() {
  const hub = String(viewbotEl.checkHub?.value || viewbotEl.url?.value || "").trim();
  if (!hub) {
    notify(isTelegramViewbot() ? "Nhập link kênh Telegram để kiểm tra." : "Nhập mã phòng để kiểm tra.");
    return;
  }
  if (isTelegramViewbot()) {
    await checkTelegramLink(hub, viewbotEl.checkResult);
    return;
  }
  viewbotEl.checkResult.textContent = "Đang đọc…";
  try {
    const info = await api(`/api/viewbot/viewer?platform=${viewbotPlatform()}&hub=${encodeURIComponent(hub)}`);
    viewbotEl.checkResult.textContent = `${fmt(info.viewer)} mắt · ${info.isStreaming ? "đang live" : "chưa live"}`;
  } catch (error) {
    viewbotEl.checkResult.textContent = "—";
    notify(error.message);
  }
}

async function loadViewbotStreams() {
  try {
    const data = await api(`/api/viewbot/streams?platform=${viewbotPlatform()}`);
    const streams = Array.isArray(data.streams) ? data.streams : [];
    if (!streams.length) {
      notify("Không lấy được danh sách phòng.", "info");
      return;
    }
    const live = streams.filter((item) => item.isStreaming);
    const chosen = live[0] || streams[0];
    setSyncedValue(viewbotEl.url, chosen.hub);
    setSyncedValue(viewbotEl.checkHub, chosen.hub);
    notify(`${streams.length} phòng, ${live.length} đang live. Đã chọn ${chosen.name}.`, "info");
  } catch (error) {
    notify(error.message);
  }
}

async function checkViewbotProxies() {
  const shared = Boolean(viewbotEl.proxies?.dataset.shared);
  const lines = shared ? [] : viewbotProxyLines(viewbotEl.proxies?.value);
  if (!shared && !lines.length) {
    notify("Dán danh sách proxy trước đã.");
    return;
  }
  viewbotEl.proxyResult.hidden = false;
  viewbotEl.proxyResult.textContent = `Đang kiểm tra ${fmt(shared ? sharedProxy?.count || 0 : lines.length)} proxy…`;
  try {
    const data = await api("/api/viewbot/proxies/check", {
      method: "POST",
      body: JSON.stringify({ proxies: lines.join("\n"), limit: 500 }),
    });
    const unit = isTelegramViewbot() ? "acc" : "mắt mỗi phòng";
    viewbotEl.proxyResult.textContent = `${fmt(data.alive)}/${fmt(data.checked)} proxy sống · ${fmt(data.uniqueIps)} IP khác nhau → tối đa ${fmt(data.uniqueIps)} ${unit} không trùng IP.`;
  } catch (error) {
    viewbotEl.proxyResult.textContent = "—";
    notify(error.message);
  }
}

if (viewbotEl.form) {
  viewbotEl.form.addEventListener("submit", submitViewbot);
  viewbotEl.checkProxies?.addEventListener("click", checkViewbotProxies);
  viewbotEl.targetAll?.addEventListener("click", () => {
    const box = viewbotEl.targets;
    if (!box) return;
    const hubs = [...box.querySelectorAll("input[value^='hub_']:not([disabled])")];
    for (const input of box.querySelectorAll("input")) input.checked = false;
    for (const input of hubs) input.checked = true;
    if (!hubs.length) {
      const main = box.querySelector("input[value='main']");
      if (main) main.checked = true;
      notify(isTelegramViewbot() ? "Chưa có hub online nào có Telegram." : "Chưa có hub nào online.", "info");
    }
    queueDraft("viewbot.targets", viewbotSelectedTargets());
  });
  viewbotEl.targets?.addEventListener("change", () => queueDraft("viewbot.targets", viewbotSelectedTargets()));
  viewbotEl.stop?.addEventListener("click", stopAllViewbot);
  viewbotEl.check?.addEventListener("click", checkViewbotViewer);
  viewbotEl.loadStreams?.addEventListener("click", loadViewbotStreams);
  viewbotEl.tgCheck?.addEventListener("click", () => {
    void checkTelegramLink(String(viewbotEl.url?.value || "").trim(), viewbotEl.tgCheckResult);
  });
  viewbotEl.proxies?.addEventListener("input", refreshViewbotProxyCount);
  for (const input of [viewbotEl.tgAge, viewbotEl.tgDaily]) input?.addEventListener("input", renderViewbotEligible);
  for (const radio of $$('input[name="viewbot-platform"]')) radio.addEventListener("change", applyViewbotPlatform);
  for (const button of $$("[data-viewbot-preset]")) {
    button.addEventListener("click", () => setSyncedValue(viewbotEl.bots, button.dataset.viewbotPreset));
  }
  viewbotEl.jobs?.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!details.open) return;
    const job = viewbotJobs.find((row) => row.id === details.closest("[data-job-id]")?.dataset.jobId);
    if (job) updateViewbotJobCard(details.closest("[data-job-id]"), job);
  }, true);
  viewbotEl.jobs?.addEventListener("click", (event) => {
    const adjust = event.target.closest("[data-viewbot-adjust]");
    if (adjust) return void adjustViewbot(adjust.dataset.viewbotAdjust, Number(adjust.dataset.step));
    const trigger = event.target.closest("[data-viewbot-stop]");
    if (trigger) void stopViewbot(trigger.dataset.viewbotStop);
  });
  refreshViewbotProxyCount();
  applyViewbotPlatform();
  renderViewbot();
  void loadSharedProxies();
  window.setInterval(() => void loadSharedProxies(), 60000); // code-tele thêm / bớt proxy: bên này tự cập nhật
}


/* ---------- Máy phụ (hub) ---------- */

const hubEl = {
  form: $("#hub-form"),
  name: $("#hub-name"),
  list: $("#hub-list"),
  empty: $("#hub-empty"),
  summary: $("#hubs-summary"),
  navMeta: $("#nav-hubs"),
  refresh: $("#hub-refresh"),
};

let hubBusy = false;
let hubTimer = null;

function hubStatusText(hub) {
  if (!hub.online) return "offline";
  const sockets = hub.stats?.sockets;
  return sockets != null ? `${sockets} socket` : "online";
}

function hubMeta(hub) {
  const stats = hub.stats || {};
  const parts = [];
  if (hub.online) {
    if (stats.rss) parts.push(`RAM ${(stats.rss / 1048576).toFixed(0)}MB`);
    if (stats.load != null) parts.push(`load ${Number(stats.load).toFixed(2)}`);
    if (stats.cpu) parts.push(`${stats.cpu} core`);
    if (stats.platform) parts.push(stats.platform);
  } else {
    parts.push("chưa kết nối");
  }
  return parts.join(" · ");
}

function startHubPolling() {
  if (hubTimer) return;
  hubTimer = window.setInterval(() => {
    if (realtimeConnected || document.hidden) return;
    void loadHubs();
  }, 4000);
}

let hubLastError = "";
let hubListHtml = "";
// lệnh cài đang mở của từng hub, giữ lại khi danh sách được vẽ lại
const hubInstallOpen = new Map();

function hubCardHtml(hub) {
  const jobRows = (hub.jobs || [])
    .map((job) => `<li>${escapeHtml(job.platform)} · ${escapeHtml(job.hub)} · ${fmt(job.live)}/${fmt(job.target)} mắt · ${fmt(job.errors)} lỗi</li>`)
    .concat(hub.telegram?.running ? [`<li>Telegram · ${escapeHtml(hub.telegram.link || "")} · ${fmt(hub.telegram.joined)}/${fmt(hub.telegram.target)} acc</li>`] : [])
    .join("");
  const telegramTag = hub.stats?.telegram
    ? '<span class="tag tag-quiet">Telegram</span>'
    : hub.online ? `<span class="tag tag-quiet" title="${escapeHtml(hubTelegramDetail(hub))}">Telegram: ${escapeHtml(hubTelegramShort(hub))}</span>` : "";
  const telegramHelp = hub.online && !hub.stats?.telegram ? `<p class="field-hint">${escapeHtml(hubTelegramDetail(hub))}</p>` : "";
  return `<article class="hub-card${hub.online ? " is-online" : ""}" data-hub-card="${escapeHtml(hub.id)}">
      <div class="hub-head">
        <span class="hub-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(hub.name)}</strong>
        <span class="tag">${escapeHtml(hubStatusText(hub))}</span>
        ${telegramTag}
        <span class="hub-meta">${escapeHtml(hubMeta(hub))}</span>
      </div>
      <div class="hub-actions">
        <button class="link-btn" type="button" data-hub-install="${escapeHtml(hub.id)}">Lệnh cài</button>
        <button class="link-btn" type="button" data-hub-rotate="${escapeHtml(hub.id)}">Đổi token</button>
        <button class="link-btn danger" type="button" data-hub-delete="${escapeHtml(hub.id)}">Xóa</button>
      </div>
      ${telegramHelp}
      <div class="hub-install" id="hub-install-${escapeHtml(hub.id)}" hidden></div>
      ${jobRows ? `<ul class="hub-jobs">${jobRows}</ul>` : ""}
    </article>`;
}

function renderHubs() {
  if (!hubEl.list) return;
  const online = hubList.filter((hub) => hub.online).length;
  if (hubEl.summary) hubEl.summary.textContent = `${online}/${hubList.length} online`;
  if (hubEl.navMeta) hubEl.navMeta.textContent = String(hubList.length);
  hubEl.empty.hidden = hubList.length > 0;
  if (!hubList.length) {
    hubEl.empty.textContent = !hubLoaded
      ? "Đang tải danh sách hub…"
      : hubLoadError
        ? `Không tải được danh sách hub: ${hubLoadError} — thử tải lại trang hoặc khởi động lại server.`
        : "Chưa có hub nào. Tạo một cái ở bên trái.";
  }
  const html = hubList.map(hubCardHtml).join("");
  if (html !== hubListHtml) {
    hubListHtml = html;
    hubEl.list.innerHTML = html;
    for (const [hubId, installHtml] of hubInstallOpen) {
      const box = document.getElementById(`hub-install-${hubId}`);
      if (!box) {
        hubInstallOpen.delete(hubId);
        continue;
      }
      box.innerHTML = installHtml;
      box.hidden = false;
    }
  }
  syncViewbotTargets();
}

// trạng thái Telegram của hub: agent mới tự cài python + telethon và báo tiến độ
function hubTelegramDetail(hub) {
  if (hub.stats?.telegram) return "Telegram sẵn sàng";
  return hub.stats?.telegramNote || "Agent bản cũ — chạy lại lệnh cài hub để tự cài Telegram";
}

function hubTelegramShort(hub) {
  const note = hub.stats?.telegramNote || "";
  if (!note) return "cần cập nhật agent";
  if (/đang/.test(note)) return "đang cài telethon…";
  if (/chưa có Python/i.test(note)) return "chưa có Python";
  return "lỗi cài telethon";
}

function viewbotTargetRows() {
  const telegram = isTelegramViewbot();
  return [
    { id: "main", label: "Máy chính", available: true, note: "" },
    ...hubList.map((hub) => {
      const missingTelegram = telegram && !hub.stats?.telegram;
      return {
        id: hub.id,
        label: hub.name,
        available: hub.online && !missingTelegram,
        note: !hub.online ? "offline" : missingTelegram ? hubTelegramShort(hub) : "",
        title: missingTelegram ? hubTelegramDetail(hub) : "",
      };
    }),
  ];
}

function syncViewbotTargets(force = false) {
  const box = viewbotEl.targets;
  if (!box) return;
  const rows = viewbotTargetRows();
  const sig = JSON.stringify(rows);
  if (!force && sig === viewbotTargetsSig) return;
  viewbotTargetsSig = sig;
  const wanted = Array.isArray(draftValues["viewbot.targets"]) ? draftValues["viewbot.targets"] : null;
  const previous = new Set(wanted || [...box.querySelectorAll("input:checked")].map((input) => input.value));
  if (!previous.size) previous.add("main");
  box.innerHTML = rows
    .map((row) => {
      const checked = previous.has(row.id) && row.available ? "checked" : "";
      const disabled = row.available ? "" : "disabled";
      const note = row.note ? `<span class="target-note">${escapeHtml(row.note)}</span>` : "";
      return `<label class="target-item${row.available ? "" : " is-offline"}"${row.title ? ` title="${escapeHtml(row.title)}"` : ""}>
        <input type="checkbox" value="${escapeHtml(row.id)}" ${checked} ${disabled} />
        <span>${escapeHtml(row.label)}</span>${note}
      </label>`;
    })
    .join("");
}

function applyViewbotTargetDraft(list) {
  const box = viewbotEl.targets;
  if (!box) return;
  const wanted = new Set(list.length ? list : ["main"]);
  for (const input of box.querySelectorAll("input")) {
    if (!input.disabled) input.checked = wanted.has(input.value);
  }
}

function viewbotSelectedTargets() {
  const box = viewbotEl.targets;
  if (!box) return ["main"];
  const picked = [...box.querySelectorAll("input:checked")].map((input) => input.value);
  return picked.length ? picked : ["main"];
}

async function loadHubs() {
  try {
    const data = await api("/api/hubs");
    hubList = Array.isArray(data.hubs) ? data.hubs : [];
    hubLoadError = "";
    hubLastError = "";
    hubLoaded = true;
    renderHubs();
  } catch (error) {
    hubLoadError = error.message;
    hubLoaded = true;
    renderHubs();
    if (error.message !== hubLastError) notify(error.message);
    hubLastError = error.message;
  }
}

async function hubInstall(hubId) {
  const box = $(`#hub-install-${hubId}`);
  if (!box) return;
  if (!box.hidden) {
    box.hidden = true;
    hubInstallOpen.delete(hubId);
    return;
  }
  try {
    const data = await api(`/api/hubs/${hubId}/install`);
    const { sh, ps } = data.install;
    box.innerHTML = `
      <div class="hub-cmd">
        <span class="field-label">macOS / Linux</span>
        <pre class="mono">${escapeHtml(sh)}</pre>
        <button class="link-btn" type="button" data-hub-copy="${encodeURIComponent(sh)}">Copy</button>
      </div>
      <div class="hub-cmd">
        <span class="field-label">Windows (PowerShell)</span>
        <pre class="mono">${escapeHtml(ps)}</pre>
        <button class="link-btn" type="button" data-hub-copy="${encodeURIComponent(ps)}">Copy</button>
      </div>`;
    box.hidden = false;
    hubInstallOpen.set(hubId, box.innerHTML);
  } catch (error) {
    notify(error.message);
  }
}

async function createHub(event) {
  event.preventDefault();
  if (hubBusy) return;
  hubBusy = true;
  try {
    const name = String(hubEl.name?.value || "").trim() || "hub";
    const data = await api("/api/hubs", { method: "POST", body: JSON.stringify({ name }) });
    notify(`Đã tạo ${data.hub.name}. Copy lệnh cài bên phải.`, "info");
    if (hubEl.name) hubEl.name.value = "";
    await loadHubs();
    const box = $(`#hub-install-${data.hub.id}`);
    if (box) {
      box.innerHTML = `
        <div class="hub-cmd">
          <span class="field-label">macOS / Linux</span>
          <pre class="mono">${data.install.sh}</pre>
          <button class="link-btn" type="button" data-hub-copy="${encodeURIComponent(data.install.sh)}">Copy</button>
        </div>
        <div class="hub-cmd">
          <span class="field-label">Windows (PowerShell)</span>
          <pre class="mono">${data.install.ps}</pre>
          <button class="link-btn" type="button" data-hub-copy="${encodeURIComponent(data.install.ps)}">Copy</button>
        </div>`;
      box.hidden = false;
    }
  } catch (error) {
    notify(error.message);
  } finally {
    hubBusy = false;
  }
}

async function deleteHub(hubId) {
  try {
    await api(`/api/hubs/${hubId}`, { method: "DELETE" });
    notify("Đã xóa hub.", "info");
    await loadHubs();
  } catch (error) {
    notify(error.message);
  }
}

async function rotateHub(hubId) {
  try {
    const data = await api(`/api/hubs/${hubId}/rotate`, { method: "POST", body: "{}" });
    notify("Đã đổi token — dán lại lệnh cài trên máy đó.", "info");
    await loadHubs();
    const box = $(`#hub-install-${hubId}`);
    if (box) {
      box.innerHTML = `
        <div class="hub-cmd">
          <span class="field-label">macOS / Linux</span>
          <pre class="mono">${data.install.sh}</pre>
          <button class="link-btn" type="button" data-hub-copy="${encodeURIComponent(data.install.sh)}">Copy</button>
        </div>`;
      box.hidden = false;
    }
  } catch (error) {
    notify(error.message);
  }
}

if (hubEl.form) {
  hubEl.form.addEventListener("submit", createHub);
  hubEl.refresh?.addEventListener("click", () => void loadHubs());
  hubEl.list?.addEventListener("click", (event) => {
    const install = event.target.closest("[data-hub-install]");
    if (install) return void hubInstall(install.dataset.hubInstall);
    const copy = event.target.closest("[data-hub-copy]");
    if (copy) return void copyText(decodeURIComponent(copy.dataset.hubCopy));
    const rotate = event.target.closest("[data-hub-rotate]");
    if (rotate) return void rotateHub(rotate.dataset.hubRotate);
    const remove = event.target.closest("[data-hub-delete]");
    if (remove) return void deleteHub(remove.dataset.hubDelete);
  });
}


/* ---------- Telegram: bình luận (màn Chiến dịch) + tài khoản (màn Tài khoản) ---------- */

const tgEl = {
  // chiến dịch
  commentInput: $("#tg-comment-input"),
  composer: $("#tg-composer"),
  commentShuffle: $("#tg-comment-shuffle"),
  commentClear: $("#tg-comment-clear"),
  commentList: $("#tg-comment-list"),
  commentEmpty: $("#tg-comment-empty"),
  commentLink: $("#tg-comment-link"),
  check: $("#tg-check"),
  checkResult: $("#tg-check-result"),
  commentAccounts: $("#tg-comment-accounts"),
  commentPer: $("#tg-comment-per"),
  commentDaily: $("#tg-comment-daily"),
  commentAge: $("#tg-comment-age"),
  commentDelayMin: $("#tg-comment-delay-min"),
  commentDelayMax: $("#tg-comment-delay-max"),
  commentContinuous: $("#tg-comment-continuous"),
  commentRound: $("#tg-comment-round"),
  commentRoundField: $("#tg-comment-round-field"),
  commentRounds: $("#tg-comment-rounds"),
  commentStart: $("#tg-comment-start"),
  commentStop: $("#tg-comment-stop"),
  commentSent: $("#tg-comment-sent"),
  commentErrors: $("#tg-comment-errors"),
  commentNote: $("#tg-comment-note"),
  commentState: $("#tg-comment-state"),
  commentResult: $("#tg-comment-result"),
  commentLogCard: $("#tg-comment-log-card"),
  checkLink: $("#tg-check-link"),
  checkKho: $("#tg-check-kho"),
  checkAcc: $("#tg-check-acc"),
  tabMeta: $('[data-tab-meta="telegram"]'),
  // tài khoản
  accountsGosh: $("#accounts-gosh"),
  accountsTelegram: $("#accounts-telegram"),
  accountsTitle: $("#accounts-title"),
  kindButtons: $$("[data-account-kind]"),
  kindCountGosh: $("#kind-count-gosh"),
  kindCountTelegram: $("#kind-count-telegram"),
  goshActions: [$("#open-import-btn"), $("#open-autoreg-btn")],
  upload: $("#tg-upload"),
  path: $("#tg-path"),
  importPath: $("#tg-import-path"),
  search: $("#tg-account-search"),
  list: $("#tg-account-list"),
  empty: $("#tg-empty"),
  total: $("#tg-total"),
  statReady: $("#tg-acc-ready"),
  statBusy: $("#tg-acc-busy"),
  statYoung: $("#tg-acc-young"),
  statDead: $("#tg-acc-dead"),
};

const TG_ACCOUNT_RENDER_LIMIT = 500;
let tgBusy = false;
let tgCommentSig = "";
let tgAccountsSig = "";
let accountKind = readPref("alc-account-kind", "gosh") === "telegram" ? "telegram" : "gosh";

function selectAccountKind(kind) {
  accountKind = kind === "telegram" ? "telegram" : "gosh";
  writePref("alc-account-kind", accountKind);
  for (const button of tgEl.kindButtons) button.setAttribute("aria-selected", String(button.dataset.accountKind === accountKind));
  const telegram = accountKind === "telegram";
  if (tgEl.accountsGosh) tgEl.accountsGosh.hidden = telegram;
  if (tgEl.accountsTelegram) tgEl.accountsTelegram.hidden = !telegram;
  for (const button of tgEl.goshActions) if (button) button.hidden = telegram;
  if (tgEl.accountsTitle) tgEl.accountsTitle.textContent = telegram ? "Tài khoản Telegram" : "Tài khoản Gosh";
  if (telegram) renderTgAccounts(true);
  renderAccountSummary();
}

function renderAccountSummary() {
  if (tgEl.kindCountTelegram) tgEl.kindCountTelegram.textContent = tgAccounts.length ? fmt(tgAccounts.length) : "";
  if (tgEl.kindCountGosh && state?.accounts) tgEl.kindCountGosh.textContent = fmt(state.accounts.length);
  const summary = $("#account-summary");
  if (!summary) return;
  if (accountKind === "telegram") {
    summary.textContent = `${fmt(tgAccounts.length)} tài khoản Telegram · ${fmt(tgStatus.busy || 0)} đang dùng`;
  } else if (state?.accounts) {
    const ready = state.accounts.filter(isReady).length;
    const enabled = state.accounts.filter((account) => account.enabled).length;
    summary.textContent = `${fmt(state.accounts.length)} tài khoản · ${fmt(ready)} có token · ${fmt(enabled)} đang tham gia`;
  }
}

function tgDailyLimit() {
  return tgStatus.safety?.dailyLimit ?? 3;
}

function renderTgAccounts(force = false) {
  if (!tgEl.list) return;
  const query = String(tgEl.search?.value || "").trim().toLowerCase();
  const limit = tgDailyLimit();
  const sig = JSON.stringify([tgAccounts.length, query, limit, tgStatus.busy, tgAccounts.map((a) => `${a.phone}:${a.joinsToday}:${a.commentsToday}:${a.dead ? 1 : 0}:${a.cooldownUntil}`).join(",")]);
  renderAccountSummary();
  if (!force && sig === tgAccountsSig) return;
  tgAccountsSig = sig;
  const now = Date.now();
  let ready = 0;
  let young = 0;
  let dead = 0;
  for (const account of tgAccounts) {
    if (account.dead) dead += 1;
    else if ((account.ageDays ?? 0) < 7) young += 1;
    else if ((account.hasSession || account.hasJson) && !(account.cooldownUntil > now)) ready += 1;
  }
  if (tgEl.statReady) tgEl.statReady.textContent = fmt(ready);
  if (tgEl.statBusy) tgEl.statBusy.textContent = fmt(tgStatus.busy || 0);
  if (tgEl.statYoung) tgEl.statYoung.textContent = fmt(young);
  if (tgEl.statDead) tgEl.statDead.textContent = fmt(dead);
  if (tgEl.total) tgEl.total.textContent = fmt(tgAccounts.length);

  const rows = query
    ? tgAccounts.filter((account) => `${account.phone} ${account.name || ""} ${account.username || ""}`.toLowerCase().includes(query))
    : tgAccounts;
  tgEl.empty.hidden = rows.length > 0;
  tgEl.empty.textContent = tgAccounts.length ? "Không có tài khoản nào khớp." : "Chưa có tài khoản nào.";
  const shown = rows.slice(0, TG_ACCOUNT_RENDER_LIMIT);
  tgEl.list.innerHTML = shown
    .map((account) => {
      const age = account.ageDays != null ? `${account.ageDays} ngày` : "?";
      const name = escapeHtml(account.name || account.username || "—");
      const usage = `vào ${account.joinsToday ?? 0}${limit > 0 ? `/${limit}` : ""} · cmt ${account.commentsToday ?? 0}`;
      let stateText = "sẵn sàng";
      let cls = "";
      if (account.dead) {
        stateText = "chết session";
        cls = "is-error";
      } else if (!account.hasSession && !account.hasJson) {
        stateText = "thiếu session";
        cls = "is-error";
      } else if (account.cooldownUntil > now) {
        stateText = `chờ ${Math.ceil((account.cooldownUntil - now) / 60000)} phút`;
        cls = "is-error";
      }
      return tgRow(account.phone, `${name} · ${age} · ${usage}`, stateText, cls);
    })
    .join("") + (rows.length > shown.length ? `<p class="field-hint">… và ${fmt(rows.length - shown.length)} tài khoản nữa — gõ để tìm.</p>` : "");
}

function renderTgComments(force = false) {
  if (!tgEl.commentList) return;
  const data = tgStatus.comments || {};
  const linkValue = String(tgEl.commentLink?.value || "").trim();
  const sig = JSON.stringify([
    data.sent, data.errors, data.running, data.rounds, data.lastError, data.accounts?.length,
    tgComments, linkValue, tgEl.commentAge?.value, tgEl.commentDaily?.value, tgEl.commentContinuous?.checked,
    tgAccounts.length, tgStatus.busy,
  ]);
  if (!force && sig === tgCommentSig) return;
  tgCommentSig = sig;

  const running = Boolean(data.running);
  tgEl.commentSent.textContent = fmt(data.sent || 0);
  tgEl.commentErrors.textContent = fmt(data.errors || 0);
  tgEl.commentRounds.textContent = fmt(data.rounds || 0);
  tgEl.commentState.textContent = running ? (data.continuous ? "Đang chạy liên tục" : "Đang chạy") : "Chưa chạy";
  tgEl.commentState.classList.toggle("tag-live", running);
  tgEl.commentStart.disabled = running || tgBusy;
  tgEl.commentStop.disabled = !running;
  if (tgEl.commentRoundField) tgEl.commentRoundField.hidden = !tgEl.commentContinuous?.checked;
  if (tgEl.tabMeta) tgEl.tabMeta.textContent = running ? "Đang chạy" : tgComments.length ? `${tgComments.length} mẫu` : "";

  if (data.lastError) {
    tgEl.commentNote.hidden = false;
    tgEl.commentNote.textContent = data.lastError;
  } else if (!running && data.rounds) {
    tgEl.commentNote.hidden = false;
    tgEl.commentNote.textContent = `Đã chạy ${data.rounds} đợt, gửi ${fmt(data.sent || 0)} câu.`;
  } else {
    tgEl.commentNote.hidden = true;
  }

  const rows = data.accounts || [];
  tgEl.commentLogCard.hidden = rows.length === 0;
  tgEl.commentResult.innerHTML = rows
    .map((row) => tgRow(
      row.phone,
      escapeHtml(row.state === "sent" ? row.text || "đã gửi" : "—"),
      escapeHtml(row.state === "sent" ? `đã gửi ${row.sent ?? ""}` : row.error || row.state),
      row.state === "sent" ? "is-joined" : "is-error",
    ))
    .join("");

  tgEl.commentEmpty.hidden = tgComments.length > 0;
  tgEl.commentShuffle.disabled = tgComments.length < 2;
  tgEl.commentClear.disabled = !tgComments.length;
  tgEl.commentList.replaceChildren(...tgComments.map((text, index) => h("li", {},
    h("span", { class: "queue-index" }, String(index + 1).padStart(2, "0")),
    h("span", { class: "queue-text" }, text),
    h("span"),
    h("button", {
      class: "icon-btn queue-delete",
      type: "button",
      title: "Xóa mẫu",
      "aria-label": `Xóa mẫu “${text}”`,
      onclick: () => deleteTelegramComment(index),
    }, icon("trash-2")),
  )));

  setCheck(tgEl.checkLink, linkValue ? "ok" : "warn", linkValue ? linkValue.replace(/^https?:\/\//, "") : "Chưa dán link");
  setCheck(tgEl.checkKho, tgComments.length ? "ok" : "warn", tgComments.length ? `${fmt(tgComments.length)} mẫu trong kho` : "Thêm ít nhất 1 mẫu");
  const minAge = Number(tgEl.commentAge?.value) || 0;
  const daily = Number(tgEl.commentDaily?.value) || 0;
  const eligible = telegramEligibleCount({ minAge, dailyLimit: daily, field: "commentsToday" });
  setCheck(
    tgEl.checkAcc,
    eligible ? "ok" : "warn",
    tgAccounts.length
      ? `${fmt(eligible)}/${fmt(tgAccounts.length)} acc (tuổi ≥ ${minAge} ngày, còn lượt)`
      : "Chưa có tài khoản — nhập ở Tài khoản › Telegram",
  );
}

function renderTelegram() {
  renderTgAccounts();
  renderTgComments();
  renderViewbotEligible();
  renderAccountSummary();
}

async function loadTelegram() {
  try {
    const [accounts, status] = await Promise.all([api("/api/telegram/accounts"), api("/api/telegram/status")]);
    tgAccounts = Array.isArray(accounts.accounts) ? accounts.accounts : [];
    tgStatus = status || tgStatus;
    const comments = await api("/api/telegram/comments");
    tgComments = Array.isArray(comments.messages) ? comments.messages : [];
    renderTgAccounts(true);
    renderTgComments(true);
    renderViewbotEligible();
  } catch (error) {
    notify(error.message);
  }
}

async function importTelegramZip(file) {
  const response = await fetch("/api/telegram/accounts/upload", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error || `Tải lên thất bại (${response.status})`);
  return body;
}

async function startTelegramComments() {
  if (tgBusy) return;
  const link = String(tgEl.commentLink?.value || "").trim();
  if (!link) return notify("Dán link kênh/nhóm Telegram trước đã.");
  if (!tgComments.length) return notify("Kho bình luận đang trống — thêm mẫu trước đã.");
  tgBusy = true;
  setBusy(tgEl.commentStart, true, "Đang bắt đầu…");
  try {
    flushDrafts();
    tgStatus = await api("/api/telegram/comments/start", {
      method: "POST",
      body: JSON.stringify({
        link,
        accountLimit: Number(tgEl.commentAccounts?.value) || 10,
        perAccount: Number(tgEl.commentPer?.value) || 1,
        dailyLimit: Number(tgEl.commentDaily?.value) || 5,
        minAgeDays: Number(tgEl.commentAge?.value) || 0,
        sendDelayMin: Number(tgEl.commentDelayMin?.value) || 25,
        sendDelayMax: Number(tgEl.commentDelayMax?.value) || 90,
        continuous: Boolean(tgEl.commentContinuous?.checked),
        roundDelay: Number(tgEl.commentRound?.value) || 60,
      }),
    });
    notify("Đã bắt đầu gửi bình luận Telegram.", "success");
  } catch (error) {
    notify(error.message);
  } finally {
    tgBusy = false;
    setBusy(tgEl.commentStart, false);
    renderTgComments(true);
  }
}

async function stopTelegramComments() {
  try {
    await api("/api/telegram/boost/stop", { method: "POST", body: JSON.stringify({ mode: "comment" }) });
    notify("Đã dừng gửi bình luận Telegram.", "info");
    if (!realtimeConnected) await loadTelegram();
  } catch (error) {
    notify(error.message);
  }
}

function setTelegramComments(data) {
  tgComments = Array.isArray(data?.messages) ? data.messages : tgComments;
  renderTgComments(true);
}

async function addTelegramComments() {
  const text = String(tgEl.commentInput?.value || "").trim();
  if (!text) return notify("Nhập nội dung trước đã.");
  try {
    setTelegramComments(await api("/api/telegram/comments", { method: "POST", body: JSON.stringify({ text }) }));
    setSyncedValue(tgEl.commentInput, "");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteTelegramComment(index) {
  try {
    setTelegramComments(await api(`/api/telegram/comments/${index}`, { method: "DELETE" }));
  } catch (error) {
    notify(error.message);
  }
}

async function shuffleTelegramComments() {
  try {
    setTelegramComments(await api("/api/telegram/comments/shuffle", { method: "POST", body: "{}" }));
  } catch (error) {
    notify(error.message);
  }
}

async function clearTelegramComments() {
  const confirmed = await confirmAction({
    title: "Xóa hết kho bình luận Telegram?",
    message: `${tgComments.length} mẫu sẽ bị xóa trên mọi thiết bị.`,
    confirmLabel: "Xóa hết",
    danger: true,
  });
  if (!confirmed) return;
  try {
    setTelegramComments(await api("/api/telegram/comments/clear", { method: "POST", body: "{}" }));
  } catch (error) {
    notify(error.message);
  }
}

if (tgEl.commentList) {
  tgEl.commentStart?.addEventListener("click", startTelegramComments);
  tgEl.commentStop?.addEventListener("click", stopTelegramComments);
  tgEl.check?.addEventListener("click", () => {
    void checkTelegramLink(String(tgEl.commentLink?.value || "").trim(), tgEl.checkResult);
  });
  tgEl.composer?.addEventListener("submit", (event) => {
    event.preventDefault();
    void addTelegramComments();
  });
  tgEl.commentInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      tgEl.composer?.requestSubmit();
    }
  });
  tgEl.commentShuffle?.addEventListener("click", shuffleTelegramComments);
  tgEl.commentClear?.addEventListener("click", clearTelegramComments);
  for (const field of [tgEl.commentLink, tgEl.commentAge, tgEl.commentDaily, tgEl.commentContinuous]) {
    field?.addEventListener(field?.type === "checkbox" ? "change" : "input", () => renderTgComments(true));
  }
}

for (const button of tgEl.kindButtons) button.addEventListener("click", () => selectAccountKind(button.dataset.accountKind));
tgEl.search?.addEventListener("input", () => renderTgAccounts(true));
tgEl.upload?.addEventListener("change", async () => {
  const file = tgEl.upload.files?.[0];
  if (!file) return;
  notify(`Đang tải lên ${file.name}…`, "info");
  try {
    const data = await importTelegramZip(file);
    notify(`Đã nhập ${fmt(data.imported)} tài khoản Telegram.`, "success");
    if (!realtimeConnected) await loadTelegram();
  } catch (error) {
    notify(error.message);
  } finally {
    tgEl.upload.value = "";
  }
});
tgEl.importPath?.addEventListener("click", async () => {
  const path = String(tgEl.path?.value || "").trim();
  if (!path) return notify("Nhập đường dẫn zip hoặc thư mục.");
  setBusy(tgEl.importPath, true, "Đang nhập…");
  try {
    const data = await api("/api/telegram/accounts/import", { method: "POST", body: JSON.stringify({ path }) });
    notify(`Đã nhập ${fmt(data.imported)} tài khoản Telegram.`, "success");
    if (!realtimeConnected) await loadTelegram();
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(tgEl.importPath, false);
  }
});
selectAccountKind(accountKind);
renderTelegram();

buildPlatformPanels();
renderFollowHistory();
startHubPolling();
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !webAuthenticated) return;
  // quay lại tab: nối lại realtime nếu đã rớt, chỉ tự tải khi không có realtime
  if (!eventSource) connectRealtime();
  if (!realtimeConnected) {
    void loadHubs();
    if (currentView === "viewbot") void loadViewbot();
  }
});
{
  const initialView = window.location.hash.slice(1);
  switchView(VIEWS.includes(initialView) || VIEW_ALIASES[initialView] ? initialView : "live");
}
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

// chỉ tự hỏi máy chủ khi kênh realtime đang rớt
window.setInterval(async () => {
  if (realtimeConnected || !webAuthenticated || document.hidden || statusRefreshRunning || isRunning()) return;
  const focused = document.activeElement;
  if (!state?.autoReg?.running && (currentView === "accounts" || !el.drawer.hidden) && ["INPUT", "TEXTAREA"].includes(focused?.tagName)) return;
  statusRefreshRunning = true;
  try {
    await refreshState();
  } catch {
    // Keep the last known state; an explicit refresh still reports errors.
  } finally {
    statusRefreshRunning = false;
  }
}, 3_000);
