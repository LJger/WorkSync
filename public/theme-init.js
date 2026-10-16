// A same-origin, blocking script applies the saved appearance before CSS paints.
// Keep the preference key and colors aligned with client/theme.tsx.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('worksync:theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Storage can be unavailable in private or restricted browsers. */ }
  const theme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101b27' : '#f5f8fc');
})();
