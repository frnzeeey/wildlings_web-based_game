export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function seg(group: string, key: string, current: unknown, options: [unknown, string][], disabled = false): string {
  return `<div class="seg${disabled ? ' disabled' : ''}">${options
    .map(([v, label]) => `<button class="seg-btn ${String(v) === String(current) ? 'active' : ''}" ${disabled ? 'disabled' : ''} data-action="set" data-group="${group}" data-key="${key}" data-value="${esc(v)}">${label}</button>`)
    .join('')}</div>`;
}

export function parseValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
