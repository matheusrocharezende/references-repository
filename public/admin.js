const loginScreen = document.getElementById('loginScreen');
const addScreen = document.getElementById('addScreen');
const passwordInput = document.getElementById('password');
const signInBtn = document.getElementById('signInBtn');
const loginError = document.getElementById('loginError');
const urlInput = document.getElementById('url');
const statusEl = document.getElementById('status');

function showAddScreen() {
  loginScreen.hidden = true;
  addScreen.hidden = false;
  urlInput.focus();
}

function showLoginScreen() {
  localStorage.removeItem('admin_password');
  addScreen.hidden = true;
  loginScreen.hidden = false;
  passwordInput.value = '';
  passwordInput.focus();
}

async function signIn() {
  const password = passwordInput.value;
  if (!password) return;

  signInBtn.disabled = true;
  loginError.textContent = '';

  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      loginError.textContent = 'wrong password';
      return;
    }

    localStorage.setItem('admin_password', password);
    showAddScreen();
  } catch {
    loginError.textContent = 'network error';
  } finally {
    signInBtn.disabled = false;
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'add-status' + (kind ? ` ${kind}` : '');
}

async function addLink() {
  const url = urlInput.value.trim();
  if (!url) return;

  const password = localStorage.getItem('admin_password');
  if (!password) return showLoginScreen();

  urlInput.disabled = true;
  setStatus('adding…');

  try {
    const res = await fetch('/api/admin/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, password })
    });

    if (res.status === 401) return showLoginScreen();

    const data = await res.json();

    if (res.status === 409) {
      setStatus(`already added — ${data.name}\n${data.category || '—'}`, 'warn');
      return;
    }

    if (!res.ok) {
      setStatus(data.error || 'error', 'error');
      return;
    }

    setStatus(`added — ${data.name}\n${data.category || '—'}`, 'ok');
    urlInput.value = '';
  } catch {
    setStatus('network error', 'error');
  } finally {
    urlInput.disabled = false;
    urlInput.focus();
  }
}

signInBtn.addEventListener('click', signIn);
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });

if (localStorage.getItem('admin_password')) {
  showAddScreen();
} else {
  passwordInput.focus();
}
