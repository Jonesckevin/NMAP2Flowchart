// Paint the stored theme and accent before the app boots, so a saved choice does
// not flash the defaults for a frame. Kept in its own file rather than inline in
// index.html so the production Content-Security-Policy can stay `script-src 'self'`.
try {
  if (localStorage.getItem('nmap2flowchart.canvasTheme') === 'light') {
    document.documentElement.dataset.theme = 'light';
  }
  const accent = localStorage.getItem('nmap2flowchart.accent');
  if (accent === 'orange' || accent === 'purple') {
    document.documentElement.dataset.accent = accent;
  }
} catch {
  /* storage blocked: stay with the dark default */
}
