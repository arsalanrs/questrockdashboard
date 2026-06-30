/** Runs before paint to avoid theme flash. */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('qr-dashboard-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
