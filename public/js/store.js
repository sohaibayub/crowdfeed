// Local state kept on the phone: the unfinished session (so a survey can be
// resumed after an interruption), saved coupons, and push opt-ins.

const KEYS = { session: 'cf.session', rewards: 'cf.rewards', push: 'cf.push' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing; the app still works for one session.
  }
}

export const store = {
  getSession: () => read(KEYS.session, null),
  setSession: (session) => write(KEYS.session, session),
  clearSession: () => write(KEYS.session, null),

  getRewards: () => read(KEYS.rewards, []),
  saveReward(coupon) {
    const list = read(KEYS.rewards, []).filter((c) => c.token !== coupon.token);
    list.unshift(coupon);
    write(KEYS.rewards, list.slice(0, 50));
  },
  updateReward(token, patch) {
    const list = read(KEYS.rewards, []).map((c) => (c.token === token ? { ...c, ...patch } : c));
    write(KEYS.rewards, list);
  },
  removeReward(token) {
    write(KEYS.rewards, read(KEYS.rewards, []).filter((c) => c.token !== token));
  },

  getPushVenues: () => read(KEYS.push, {}),
  setPushVenue(slug, on) {
    const map = read(KEYS.push, {});
    if (on) map[slug] = true;
    else delete map[slug];
    write(KEYS.push, map);
  }
};
