const tableBody = document.getElementById('tableBody');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const searchToggle = document.getElementById('searchToggle');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const sortBtns = document.querySelectorAll('.sort-btn');

// ── State ──
let links = [];
let sortField = 'type';
let sortDir = 'asc';
let query = '';
let mouseX = 0, mouseY = 0;
let previewVisible = false;

// ── Parse date "MM/YYYY" → comparable number ──
function parseDate(str) {
  const [mm, yyyy] = str.split('/');
  return parseInt(yyyy) * 100 + parseInt(mm);
}

// ── Sort & filter ──
function getFiltered() {
  let result = [...links];

  if (query) {
    const q = query.toLowerCase();
    result = result.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.category.toLowerCase().includes(q) ||
      l.date.includes(q)
    );
  }

  result.sort((a, b) => {
    // Primary: group by category (direction controlled by type sort)
    const catCmp = (a.category || '').localeCompare(b.category || '');
    if (catCmp !== 0) return sortField === 'type' && sortDir === 'desc' ? -catCmp : catCmp;

    // Secondary: sort within group by name (when name sort active)
    if (sortField === 'name') {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    }

    // Default within-group order: keep original
    return 0;
  });

  return result;
}

// ── Render ──
function render() {
  const rows = getFiltered();
  tableBody.innerHTML = '';

  let lastCategory = null;

  rows.forEach((link, i) => {
    const tr = document.createElement('tr');

    // Is this the last row of its category group?
    const isGroupEnd = i === rows.length - 1 || rows[i + 1].category !== link.category;
    if (isGroupEnd) tr.classList.add('group-end');

    const categoryChanged = link.category !== lastCategory;
    const tdCat = document.createElement('td');
    tdCat.className = 'col-category';
    if (categoryChanged) {
      tdCat.textContent = link.category;
      lastCategory = link.category;
    }

    const tdDate = document.createElement('td');
    tdDate.className = 'col-date';
    tdDate.textContent = link.date;

    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.textContent = link.name;

    const tdDesc = document.createElement('td');
    tdDesc.className = 'col-description';
    tdDesc.textContent = link.description || '';

    tr.appendChild(tdCat);
    tr.appendChild(tdDate);
    tr.appendChild(tdName);
    tr.appendChild(tdDesc);

    tr.dataset.url = link.url || '';

    tr.addEventListener('mouseenter', () => showPreview(link));
    tr.addEventListener('mouseleave', hidePreview);

    tr.addEventListener('click', () => {
      if (link.url) window.open(link.url, '_blank');
    });

    tableBody.appendChild(tr);
  });

  // Re-trigger mobile active detection after re-render
  if (window.innerWidth < 768) {
    mobActiveRow = null;
    const first = tableBody.querySelector('tr[data-url]');
    if (first) setMobActive(first);
  }
}

// ── Preview ──
function screenshotUrl(url) {
  return `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`;
}

function showPreview(link) {
  const src = link.preview || (link.url ? screenshotUrl(link.url) : '');
  if (src) {
    previewImg.src = src;
    preview.classList.remove('no-image');
    previewImg.style.display = 'block';
  } else {
    preview.classList.add('no-image');
    previewImg.style.display = 'none';
  }
  preview.classList.add('visible');
  previewVisible = true;
  positionPreview();
}

function hidePreview() {
  preview.classList.remove('visible');
  previewVisible = false;
}

function positionPreview() {
  const pw = 280;
  const ph = 200;
  const margin = 20;
  const vh = window.innerHeight;

  const x = mouseX + margin;
  let y = mouseY - ph / 2;

  // Always to the right — only clamp vertically
  if (y < margin) y = margin;
  if (y + ph > vh - margin) y = vh - ph - margin;

  preview.style.left = x + 'px';
  preview.style.top = y + 'px';
}

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  if (previewVisible) positionPreview();
});

// ── Sort ──
function updateSortUI() {
  sortBtns.forEach(b => {
    b.classList.remove('active', 'asc', 'desc');
    const arrow = b.querySelector('.arrow');
    if (arrow) arrow.remove();
  });
  const activeBtn = document.querySelector(`.sort-btn[data-sort="${sortField}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active', sortDir);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = sortDir === 'asc' ? ' ↑' : ' ↓';
    activeBtn.appendChild(arrow);
  }
}

sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const field = btn.dataset.sort;
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'asc';
    }
    updateSortUI();
    render();
  });
});

// Set initial active state on "type" button
updateSortUI();

// ── Search ──
searchToggle.addEventListener('click', () => {
  searchBar.classList.toggle('open');
  if (searchBar.classList.contains('open')) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    query = '';
    render();
  }
});

searchInput.addEventListener('input', (e) => {
  query = e.target.value.trim();
  render();
});

// ── Mobile scroll preview ──
let mobActiveRow = null;
let mobPreviewTimer = null;
let mobScrollRaf = null;
const mobPreviewEl = document.getElementById('mob-preview');

function findCenterRow() {
  const vc = window.innerHeight / 2;
  let best = null, bestDist = Infinity;
  document.querySelectorAll('tbody tr[data-url]').forEach(tr => {
    const r = tr.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const d = Math.abs(cy - vc);
    if (d < bestDist) { bestDist = d; best = tr; }
  });
  return best;
}

function setMobActive(tr) {
  if (!tr || tr === mobActiveRow) return;
  if (mobActiveRow) mobActiveRow.classList.remove('mob-active');
  tr.classList.add('mob-active');
  mobActiveRow = tr;

  clearTimeout(mobPreviewTimer);
  mobPreviewTimer = setTimeout(() => {
    const url = tr.dataset.url;
    if (!url || !mobPreviewEl) return;
    const src = screenshotUrl(url);
    const img = new Image();
    img.onload = () => {
      mobPreviewEl.style.backgroundImage = `url('${src}')`;
      mobPreviewEl.classList.add('loaded');
    };
    img.src = src;
  }, 250);
}

function onMobScroll() {
  if (window.innerWidth >= 768) return;
  if (mobScrollRaf) cancelAnimationFrame(mobScrollRaf);
  mobScrollRaf = requestAnimationFrame(() => {
    const row = findCenterRow();
    if (row) setMobActive(row);
  });
}

window.addEventListener('scroll', onMobScroll, { passive: true });

// ── Init: fetch data from API ──
fetch('/api/links')
  .then(res => res.json())
  .then(data => {
    links = data;
    render();
  })
  .catch(err => {
    console.error('Failed to load links:', err);
  });
