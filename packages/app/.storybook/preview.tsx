import addonA11y from '@storybook/addon-a11y';
import React, { useEffect } from 'react';
import { definePreview } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@roadiehq/ui/tooltip';

// Pulls in Tailwind v4, @roadiehq/ui design tokens, and @source directives.
import '../src/styles.css';
// Body-level background/foreground using CSS custom properties directly
// (avoids wrapper div that breaks the Storybook measure tool).
import './storybook.css';

export default definePreview({
  initialGlobals: {
    theme: 'dark',
  },

  globalTypes: {
    theme: {
      description: 'Color mode',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },

  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    layout: 'centered',
    backgrounds: { disable: true },

    a11y: {
      // 'error' fails the story test and blocks CI; 'todo' only reports. For a
      // violation that is genuinely decorative, scope an exclusion on that
      // story (see overview-empty-preview) rather than relaxing this.
      test: 'error',
    },
  },

  decorators: [
    // Toggle .dark / .light on <html> so CSS custom properties update.
    // .light is needed to override the prefers-color-scheme: dark media query.
    (Story, context) => {
      const isDark = context.globals.theme === 'dark';
      useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('light', !isDark);
      }, [isDark]);
      return <Story />;
    },
    // MemoryRouter for components using useNavigate()/useLocation()
    Story => (
      <MemoryRouter initialEntries={['/']}>
        <Story />
      </MemoryRouter>
    ),
    // TooltipProvider for Radix tooltip components
    Story => (
      <TooltipProvider delayDuration={0}>
        <Story />
      </TooltipProvider>
    ),
  ],

  addons: [addonA11y()],
});
