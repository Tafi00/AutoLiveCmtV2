const MB = 1024 * 1024;

// macOS compresses idle pages, so RSS alone can read a few hundred MB while the
// process really holds gigabytes. V8's committed heap plus external memory
// tracks what the process keeps regardless of compression.
export function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    footprint: Math.max(usage.rss, usage.heapTotal + usage.external),
  };
}

export function formatMemory(snapshot, details = {}) {
  const fields = ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers", "footprint"]
    .map((key) => `${key}=${Math.round(snapshot[key] / MB)}MB`);
  const extra = Object.entries(details).map(([key, value]) => `${key}=${value}`);
  return `[mem] ${new Date().toISOString()} ${[...fields, ...extra].join(" ")}`;
}

// Logs memory every few minutes and, once the footprint passes limitMb, calls
// onLimit (a graceful exit, so launchd starts a fresh process). It waits while
// isBusy() reports a run in progress, unless the footprint passes hardLimitMb.
export function startMemoryGuard({
  limitMb = 1024,
  hardLimitMb = limitMb * 1.5,
  checkEveryMs = 60_000,
  logEveryMs = 5 * 60_000,
  isBusy = () => false,
  onLimit = null,
  details = () => ({}),
  log = console.log,
  sample = memorySnapshot,
} = {}) {
  let lastLogAt = 0;
  let waitingLogged = false;
  let triggered = false;

  const check = () => {
    const snapshot = sample();
    const now = Date.now();
    if (now - lastLogAt >= logEveryMs) {
      lastLogAt = now;
      log(formatMemory(snapshot, details()));
    }
    if (triggered || !onLimit || !(limitMb > 0)) return;
    const footprintMb = Math.round(snapshot.footprint / MB);
    if (footprintMb < limitMb) {
      waitingLogged = false;
      return;
    }
    const busy = isBusy();
    if (busy && footprintMb < hardLimitMb) {
      if (!waitingLogged) {
        waitingLogged = true;
        log(`[mem] ${footprintMb}MB vượt giới hạn ${limitMb}MB; chờ lượt gửi đang chạy xong rồi khởi động lại.`);
      }
      return;
    }
    triggered = true;
    log(`[mem] ${footprintMb}MB vượt giới hạn ${limitMb}MB${busy ? ` (quá ${hardLimitMb}MB nên thoát dù đang chạy)` : ""}; thoát để launchd khởi động lại.`);
    log(formatMemory(snapshot, details()));
    Promise.resolve()
      .then(onLimit)
      .catch((error) => log(`[mem] Lỗi khi thoát: ${error?.message || error}`));
  };

  const timer = setInterval(check, checkEveryMs);
  timer.unref?.();
  check();
  return { check, stop: () => clearInterval(timer) };
}
