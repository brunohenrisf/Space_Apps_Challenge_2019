/* =========================================================
   ConectaVoucher — temas (claro/escuro + cor de destaque)
   Persistidos em localStorage e aplicados em toda a app.
   Controles por atributos data-*:
     [data-theme-toggle]      -> alterna claro/escuro
     [data-set-theme="light"] -> define o tema
     [data-accent-opt="jade"] -> define a cor de destaque
   ========================================================= */
(function () {
  const root = document.documentElement;
  const THEME_KEY = 'cv-theme';
  const ACCENT_KEY = 'cv-accent';

  const getTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark');
  const getAccent = () => root.dataset.accent || 'padrao';

  function setTheme(t) {
    root.dataset.theme = t === 'light' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getTheme() === 'light' ? '#eef1fa' : '#070b16');
    reflect();
  }
  function toggleTheme() { setTheme(getTheme() === 'light' ? 'dark' : 'light'); }

  function setAccent(a) {
    if (a && a !== 'padrao') root.dataset.accent = a;
    else { delete root.dataset.accent; a = 'padrao'; }
    try { localStorage.setItem(ACCENT_KEY, a); } catch (e) {}
    reflect();
  }

  function reflect() {
    document.querySelectorAll('[data-set-theme]').forEach((el) =>
      el.classList.toggle('on', el.dataset.setTheme === getTheme()));
    document.querySelectorAll('[data-accent-opt]').forEach((el) =>
      el.classList.toggle('on', el.dataset.accentOpt === getAccent()));
    document.querySelectorAll('[data-theme-icon]').forEach((el) => {
      el.textContent = getTheme() === 'light' ? '🌙' : '☀️';
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) return toggleTheme();
    const st = e.target.closest('[data-set-theme]');
    if (st) return setTheme(st.dataset.setTheme);
    const ac = e.target.closest('[data-accent-opt]');
    if (ac) return setAccent(ac.dataset.accentOpt);
  });

  window.CVTheme = { setTheme, toggleTheme, setAccent, getTheme, getAccent };
  reflect();
})();
