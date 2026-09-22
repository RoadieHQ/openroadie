const listeners = new Set<() => void>();

function isDark() {
  return document.documentElement.classList.contains('dark');
}

export function toggleDarkMode() {
  const html = document.documentElement;
  const dark = html.classList.toggle('dark');
  html.classList.toggle('light', !dark);
  listeners.forEach(fn => fn());
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getIsDark() {
  return isDark();
}
