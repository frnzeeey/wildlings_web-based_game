const PREFIX = 'wildlings:v1:';

/** Load persisted preferences merged over defaults. Never throws (storage may be blocked). */
export function load(name, fallback) {
  const base = structuredClone(fallback);
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return base;
    const data = JSON.parse(raw);
    if (Array.isArray(base)) return base.map((item, i) => ({ ...item, ...(Array.isArray(data) ? data[i] : null) }));
    return { ...base, ...data };
  } catch {
    return base;
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // storage unavailable: preferences just won't persist
  }
}
