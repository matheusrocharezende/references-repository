const urlInput = document.getElementById('url');
const dateInput = document.getElementById('date');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');

const savedPassword = localStorage.getItem('admin_password');
if (savedPassword) passwordInput.value = savedPassword;

const now = new Date();
dateInput.value = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ` ${kind}` : '');
}

async function addLink() {
  const url = urlInput.value.trim();
  const password = passwordInput.value;

  if (!url) return setStatus('cole uma url', 'error');
  if (!password) return setStatus('digite a senha', 'error');

  submitBtn.disabled = true;
  setStatus('adicionando…');

  try {
    const res = await fetch('/api/admin/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, date: dateInput.value.trim(), password })
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'erro ao adicionar', 'error');
      return;
    }

    localStorage.setItem('admin_password', password);
    setStatus(`adicionado — ${data.name}\ncategory: ${data.category || '—'}\n${data.description || ''}`, 'ok');
    urlInput.value = '';
    urlInput.focus();
  } catch {
    setStatus('erro de rede', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

submitBtn.addEventListener('click', addLink);
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });
