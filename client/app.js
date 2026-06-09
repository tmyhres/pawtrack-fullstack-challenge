// PawTrack Booking Dashboard
// Connects to the PawTrack API at localhost:3001

const API_BASE = 'http://localhost:3001';

// Simulated auth context — in production this would come from a login flow
const AUTH_HEADERS = {
  'X-Tenant-Id': 'tenant_portland',
  'X-User-Id': 'user_staff_portland',
  'X-User-Role': 'staff',
  'Content-Type': 'application/json',
};

// Current filter state
let filters = {
  date: '',
  status: '',
  page: 1,
};

// Monotonic id for the latest issued fetch. Every fetchBookings call
// captures its own id at the top; responses that find their id no longer
// equal to currentFetchId have been superseded and are dropped before
// touching the DOM. This is what prevents the "filter reset" symptom:
// without it, a slow poll response can overwrite a freshly-filtered list.
let currentFetchId = 0;

// Extract the most useful error string from a JSON error response. Fastify
// schema-validation errors put the detail in `message` (with a generic
// `error: "Bad Request"`), while our handlers send `{ error }`. Prefer
// `message`, then `error`, then a status-coded fallback.
function errorText(result, response, fallback) {
  return (result && (result.message || result.error)) || `${fallback} (${response.status})`;
}

// A <input type="date"> yields a bare "YYYY-MM-DD". `new Date(value)` parses
// that as UTC midnight, which lands on the *previous* calendar day once the
// server projects it into a behind-UTC tenant timezone (e.g. Portland) — the
// booking would then file under the wrong day and dodge overlap checks.
// Anchoring at noon UTC keeps the selected calendar date intact for every
// real tenant timezone (UTC-12 .. UTC+11). The actual time-of-day is carried
// separately by startTime/endTime.
function scheduledDateFromInput(value) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initTenantInfo();
  initFilters();
  initNewBookingForm();
  fetchBookings(filters);
  loadPetsAndSitters();

  // Poll for booking updates every 15 seconds
  setInterval(() => {
    fetchBookings(filters);
  }, 15000);
});

function initTenantInfo() {
  const el = document.getElementById('tenant-info');
  el.textContent = `Tenant: PawTrack Portland | User: Staff`;
}

// ============================================
// Filters
// ============================================

function initFilters() {
  const dateFilter = document.getElementById('date-filter');
  const statusFilter = document.getElementById('status-filter');
  const refreshBtn = document.getElementById('refresh-btn');

  dateFilter.addEventListener('change', (e) => {
    // Reassigns filters to a new object — the polling closure still has the old one
    filters = { ...filters, date: e.target.value, page: 1 };
    fetchBookings(filters);
  });

  statusFilter.addEventListener('change', (e) => {
    filters = { ...filters, status: e.target.value, page: 1 };
    fetchBookings(filters);
  });

  refreshBtn.addEventListener('click', () => {
    fetchBookings(filters);
  });
}

// ============================================
// Fetch and Render Bookings
// ============================================

async function fetchBookings(currentFilters) {
  const fetchId = ++currentFetchId;

  const loadingEl = document.getElementById('loading-indicator');
  const errorEl = document.getElementById('error-message');
  const listEl = document.getElementById('bookings-list');

  loadingEl.style.display = 'block';
  errorEl.style.display = 'none';

  const params = new URLSearchParams();
  params.set('page', String(currentFilters.page));
  params.set('limit', '5');
  if (currentFilters.date) params.set('date', currentFilters.date);
  if (currentFilters.status) params.set('status', currentFilters.status);

  try {
    const response = await fetch(`${API_BASE}/api/bookings?${params}`, {
      headers: AUTH_HEADERS,
    });
    const result = await response.json();

    if (fetchId !== currentFetchId) return;  // superseded by newer request

    loadingEl.style.display = 'none';

    if (!response.ok) {
      errorEl.textContent = errorText(result, response, 'Request failed');
      errorEl.style.display = 'block';
      return;
    }

    renderBookings(result.data, listEl);
    renderPagination(result);
  } catch (err) {
    if (fetchId !== currentFetchId) return;  // superseded by newer request
    loadingEl.style.display = 'none';
    errorEl.textContent = 'Failed to load bookings. Is the server running?';
    errorEl.style.display = 'block';
  }
}

function renderBookings(bookings, container) {
  container.replaceChildren();

  if (!bookings || bookings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No bookings found.';
    container.appendChild(empty);
    return;
  }

  for (const booking of bookings) {
    container.appendChild(buildBookingCard(booking));
  }
}

// Build each card with explicit DOM nodes — never innerHTML on values from
// the server. notes / IDs / status / time strings all go through textContent,
// so an `<img onerror=...>` in a booking note renders as literal text.
function buildBookingCard(booking) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const info = document.createElement('div');
  info.className = 'booking-info';

  const h3 = document.createElement('h3');
  h3.textContent = `Booking ${booking.id.replace('booking_', '#')}`;
  info.appendChild(h3);

  const meta = document.createElement('div');
  meta.className = 'booking-meta';
  const date = new Date(booking.scheduledDate).toLocaleDateString();
  for (const label of [
    `Pet: ${booking.petId}`,
    `Sitter: ${booking.sitterId}`,
    `Date: ${date}`,
    `Time: ${booking.startTime} - ${booking.endTime}`,
  ]) {
    const span = document.createElement('span');
    span.textContent = label;
    meta.appendChild(span);
  }
  info.appendChild(meta);

  const notes = document.createElement('div');
  notes.className = 'booking-notes';
  notes.textContent = booking.notes;
  info.appendChild(notes);

  card.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'booking-actions';

  const badge = document.createElement('span');
  badge.className = `status-badge status-${booking.status}`;
  badge.textContent = booking.status.replace('_', ' ');
  actions.appendChild(badge);

  for (const btn of buildStatusActionButtons(booking)) {
    actions.appendChild(btn);
  }

  card.appendChild(actions);
  return card;
}

const NEXT_STATUSES = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

function buildStatusActionButtons(booking) {
  const next = NEXT_STATUSES[booking.status] || [];
  return next.map(status => {
    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${status === 'cancelled' ? 'btn-secondary' : 'btn-primary'}`;
    btn.textContent = status.replace('_', ' ');
    btn.addEventListener('click', () => transitionStatus(booking.id, status));
    return btn;
  });
}

async function transitionStatus(bookingId, newStatus) {
  try {
    const response = await fetch(`${API_BASE}/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ status: newStatus }),
    });
    const result = await response.json();

    if (response.ok) {
      showToast(`Booking updated to ${newStatus.replace('_', ' ')}`, 'success');
      fetchBookings(filters);
    } else {
      showToast(errorText(result, response, 'Failed to update status'), 'error');
    }
  } catch (err) {
    showToast('Network error. Please try again.', 'error');
  }
}

// ============================================
// Pagination
// ============================================

function renderPagination(result) {
  const paginationEl = document.getElementById('pagination');
  const { page, totalPages } = result;

  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  let html = '';
  html += `<button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">Prev</button>`;

  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">Next</button>`;
  paginationEl.innerHTML = html;
}

function goToPage(page) {
  filters = { ...filters, page };
  fetchBookings(filters);
}

// ============================================
// New Booking Form
// ============================================

function initNewBookingForm() {
  const modal = document.getElementById('booking-modal');
  const openBtn = document.getElementById('new-booking-btn');
  const cancelBtn = document.getElementById('cancel-booking');
  const form = document.getElementById('booking-form');

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    form.reset();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      form.reset();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createBooking();
  });
}

async function loadPetsAndSitters() {
  try {
    const [petsRes, sittersRes] = await Promise.all([
      fetch(`${API_BASE}/api/pets`, { headers: AUTH_HEADERS }),
      fetch(`${API_BASE}/api/sitters`, { headers: AUTH_HEADERS }),
    ]);

    const petsData = await petsRes.json();
    const sittersData = await sittersRes.json();

    const petSelect = document.getElementById('pet-select');
    for (const pet of petsData.data) {
      const option = document.createElement('option');
      option.value = pet.id;
      option.textContent = `${pet.name} (${pet.species} - ${pet.ownerName})`;
      petSelect.appendChild(option);
    }

    const sitterSelect = document.getElementById('sitter-select');
    for (const sitter of sittersData.data) {
      const option = document.createElement('option');
      option.value = sitter.id;
      option.textContent = `${sitter.name}`;
      sitterSelect.appendChild(option);
    }
  } catch (err) {
    console.error('Failed to load pets and sitters:', err);
  }
}

async function createBooking() {
  const form = document.getElementById('booking-form');
  const modal = document.getElementById('booking-modal');

  const body = {
    petId: document.getElementById('pet-select').value,
    sitterId: document.getElementById('sitter-select').value,
    scheduledDate: scheduledDateFromInput(document.getElementById('booking-date').value),
    startTime: document.getElementById('start-time').value,
    endTime: document.getElementById('end-time').value,
    notes: document.getElementById('booking-notes').value,
  };

  try {
    const response = await fetch(`${API_BASE}/api/bookings`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (response.ok) {
      showToast('Booking created!', 'success');
      modal.style.display = 'none';
      form.reset();
      fetchBookings(filters);
    } else {
      showToast(errorText(result, response, 'Failed to create booking'), 'error');
    }
  } catch (err) {
    showToast('Network error. Please try again.', 'error');
  }
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// Make goToPage available globally for inline onclick handlers
window.goToPage = goToPage;
