import './styles.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/montserrat/700.css';
import { toggleDarkMode, getIsDark } from './theme';

// Sync .dark class on <html> with OS preference on initial load
const mq = window.matchMedia('(prefers-color-scheme: dark)');
if (mq.matches && !getIsDark()) {
  toggleDarkMode();
}

// Keep in sync when OS preference changes (unless user has manually toggled)
mq.addEventListener('change', e => {
  if (e.matches !== getIsDark()) {
    toggleDarkMode();
  }
});

import { bootstrap } from './bootstrap';

void bootstrap();
