import { getLocoStreamId } from "./platforms.js";

export function classifyHttpStatus(status) {
  if ((status >= 200 && status < 400) || status === 401 || status === 403) return "up";
  if (status === 408 || status === 425 || status === 429) return "degraded";
  return "down";
}

export function healthTargets(channelUrls = "") {
  const targets = [
    { id: "gosh-web", platform: "gosh", name: "Website", url: "https://gosh6.app/" },
    { id: "gosh-user", platform: "gosh", name: "User Info API", url: "https://gosh6.app/gosh_base/app/user/user_info" },
    { id: "gosh-profile", platform: "gosh", name: "Đổi tên API", url: "https://gosh6.app/gosh_base/app/user/user_center?scene=avatar" },
    { id: "gosh-refresh", platform: "gosh", name: "Refresh Token API", url: "https://gosh6.app/gosh_base/app/user/refresh_token" },
    { id: "loco-web", platform: "loco", name: "Website", url: "https://loco.com/" },
    { id: "loco-home", platform: "loco", name: "Discovery API", url: "https://api.loco.com/ivr/v3/homepage/sub_recipe/?limit=1&offset=0&r_id=web_home_global" },
    { id: "loco-config", platform: "loco", name: "Config API", url: "https://api.loco.com/auth/v1/ivory/config/?ivory=true" },
    { id: "loco-profile-me", platform: "loco", name: "Hồ sơ API", url: "https://api.loco.com/ivr/v1/profile/me/" },
    { id: "loco-token-refresh", platform: "loco", name: "Refresh Token API", url: "https://api.loco.com/auth/v3/user/refresh_token/" },
  ];
  const locoChannelUrl = channelUrls && typeof channelUrls === "object"
    ? channelUrls.loco || ""
    : channelUrls;
  const streamId = getLocoStreamId(locoChannelUrl);
  if (streamId) {
    targets.push({
      id: "loco-chat",
      platform: "loco",
      name: "Chat V2 API · phòng hiện tại",
      url: `https://api.loco.com/chat/v2/streams/${streamId}/history/`,
    });
  }
  return targets;
}

export async function checkTarget(target, { timeoutMs = 8_000, fetchImpl = fetch } = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(target.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "LiveComment-HealthCheck/1.0", accept: "application/json,text/html;q=0.8" },
    });
    return {
      ...target,
      status: classifyHttpStatus(response.status),
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: "",
    };
  } catch (error) {
    return {
      ...target,
      status: "down",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: error.name === "TimeoutError" ? "Quá thời gian chờ" : error.message,
    };
  }
}

export async function checkApiHealth(channelUrls, options) {
  return Promise.all(healthTargets(channelUrls).map((target) => checkTarget(target, options)));
}
