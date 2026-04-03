// ── Toast Notification System ─────────────────────────

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  container.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 200;
    display: flex; flex-direction: column-reverse; gap: 8px;
    pointer-events: none;
  `;
  document.body.appendChild(container);
  return container;
}

export function toast(message, type = 'info', duration = 3000) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.style.cssText = `
    padding: 12px 18px; border-radius: 8px; font-size: 0.88rem;
    pointer-events: auto; cursor: pointer; max-width: 360px;
    animation: toast-in 0.3s ease both;
    font-family: var(--font-ui, 'Outfit', sans-serif);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  `;

  const colors = {
    info:    { bg: 'var(--surface2)', border: 'var(--accent)', color: 'var(--text)' },
    success: { bg: 'var(--success-bg)', border: 'var(--success)', color: 'var(--success)' },
    error:   { bg: 'var(--danger-bg)', border: 'var(--danger)', color: 'var(--danger)' },
    warning: { bg: 'var(--warning-bg)', border: 'var(--warning)', color: 'var(--warning)' },
  };
  const c2 = colors[type] || colors.info;
  el.style.background = c2.bg;
  el.style.border = `1px solid ${c2.border}`;
  el.style.color = c2.color;

  el.textContent = message;
  el.addEventListener('click', () => dismiss(el));
  c.appendChild(el);

  if (duration > 0) {
    setTimeout(() => dismiss(el), duration);
  }

  return el;
}

function dismiss(el) {
  el.style.animation = 'toast-out 0.2s ease both';
  el.addEventListener('animationend', () => el.remove());
}

// Inject toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
`;
document.head.appendChild(style);
