const tableBody = document.getElementById('tableBody');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const searchToggle = document.getElementById('searchToggle');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const currentDateEl = document.getElementById('currentDate');
const sortBtns = document.querySelectorAll('.sort-btn');

// ── State ──
let links = [];
let sortField = 'date';
let sortDir = 'desc';
let query = '';
let mouseX = 0, mouseY = 0;
let previewVisible = false;

// ── Footer date ──
const now = new Date();
currentDateEl.textContent = now.toLocaleDateString('en-US', {
  month: 'long',
  year: 'numeric'
});

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
    // Primary: always group by category alphabetically
    const catCmp = (a.category || '').localeCompare(b.category || '');
    if (catCmp !== 0) return catCmp;

    // Secondary: sort within each group by selected field
    if (sortField === 'date') {
      const cmp = parseDate(a.date) - parseDate(b.date);
      return sortDir === 'asc' ? cmp : -cmp;
    } else {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    }
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

    tr.addEventListener('mouseenter', () => showPreview(link));
    tr.addEventListener('mouseleave', hidePreview);

    tr.addEventListener('click', () => {
      if (link.url) window.open(link.url, '_blank');
    });

    tableBody.appendChild(tr);
  });
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
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const field = btn.dataset.sort;
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = field === 'date' ? 'desc' : 'asc';
    }

    sortBtns.forEach(b => {
      b.classList.remove('active', 'asc', 'desc');
      b.querySelector('.arrow') && (b.querySelector('.arrow').textContent = '↑');
    });

    btn.classList.add('active', sortDir);
    let arrowEl = btn.querySelector('.arrow');
    if (!arrowEl) {
      arrowEl = document.createElement('span');
      arrowEl.className = 'arrow';
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(arrowEl);
    }
    arrowEl.textContent = sortDir === 'asc' ? '↑' : '↓';

    render();
  });
});

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
