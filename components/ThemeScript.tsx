/** Runs before paint to avoid theme flash. */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('qr-dashboard-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
