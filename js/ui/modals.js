// ── Modal System ─────────────────────────────────────

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => {
    m.classList.remove('open');
  });
}

// Generic form modal builder
export function showFormModal({ title, fields, onSubmit, submitLabel = 'Save', id = 'modal-dynamic' }) {
  // Remove existing dynamic modal
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = id;

  const fieldsHtml = fields.map(f => {
    let input = '';
    if (f.type === 'textarea') {
      input = `<textarea id="${f.id}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
    } else if (f.type === 'select') {
      input = `<select id="${f.id}">${f.options.map(o =>
        `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`
      ).join('')}</select>`;
    } else if (f.type === 'file') {
      input = `<input type="file" id="${f.id}" accept="${f.accept || 'image/*'}" />`;
    } else {
      input = `<input type="${f.type || 'text'}" id="${f.id}" value="${esc(f.value || '')}"
        placeholder="${esc(f.placeholder || '')}" ${f.min !== undefined ? `min="${f.min}"` : ''}
        ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} />`;
    }
    return `<div class="form-group">
      <label>${esc(f.label)}${f.required ? ' *' : ''}</label>
      ${input}
    </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal">
      <h2>${esc(title)}</h2>
      ${fieldsHtml}
      <div class="modal-actions">
        <button class="btn-cancel" data-action="cancel">Cancel</button>
        <button class="btn-confirm" data-action="submit">${esc(submitLabel)}</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') {
      overlay.remove();
    }
    if (e.target.dataset.action === 'submit') {
      const values = {};
      for (const f of fields) {
        const el = document.getElementById(f.id);
        if (!el) continue;
        if (f.type === 'number') values[f.id] = parseFloat(el.value) || 0;
        else if (f.type === 'file') values[f.id] = el.files?.[0] || null;
        else if (f.type === 'checkbox') values[f.id] = el.checked;
        else values[f.id] = el.value.trim();
      }
      if (onSubmit(values) !== false) {
        overlay.remove();
      }
    }
  });

  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape' && document.getElementById(id)) {
      overlay.remove();
      document.removeEventListener('keydown', handler);
    }
  });

  document.body.appendChild(overlay);

  // Conditional field visibility (dependsOn)
  for (const f of fields) {
    if (f.dependsOn) {
      const controlEl = document.getElementById(f.dependsOn.field);
      const groupEl = document.getElementById(f.id)?.closest('.form-group');
      if (controlEl && groupEl) {
        const toggle = () => {
          const show = f.dependsOn.values.includes(controlEl.value);
          groupEl.style.display = show ? '' : 'none';
        };
        controlEl.addEventListener('change', toggle);
        toggle(); // set initial state
      }
    }
  }

  // Focus first input
  const firstInput = overlay.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);

  return overlay;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { esc as escHtml };
