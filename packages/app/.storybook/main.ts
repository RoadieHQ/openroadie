import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(ts|tsx)',
    '../../../packages/ui/src/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-mcp',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    // Accurate prop extraction for the AI component manifests
    // (/manifests/components.json) served by addon-mcp.
    reactDocgen: 'react-docgen-typescript',
  },
  viteFinal: async config => {
    // Storybook does NOT reuse the app's vite.config.ts, so we must
    // explicitly add the Tailwind CSS v4 Vite plugin here.
    config.plugins = config.plugins || [];
    config.plugins.push(tailwindcss());

    const existingOutput = config.build?.rollupOptions?.output as
      | { manualChunks?: ((id: string) => string | undefined) | undefined }
      | undefined;
    const existingManualChunks =
      typeof existingOutput?.manualChunks === 'function'
        ? existingOutput.manualChunks
        : undefined;

    config.build = {
      ...config.build,
      // Storybook preview bundles all loaded stories into iframe runtime.
      // Keep app build warning threshold strict; relax only Storybook noise.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        ...config.build?.rollupOptions,
        output: {
          ...existingOutput,
          manualChunks: (id: string) => {
            if (id.includes('/node_modules/react-dom/')) return 'sb-react-dom';
            if (id.includes('/node_modules/react/')) return 'sb-react';
            if (id.includes('/node_modules/@storybook/'))
              return 'sb-storybook-vendor';
            if (id.includes('/node_modules/@radix-ui/')) return 'sb-radix';
            if (id.includes('/node_modules/@floating-ui/'))
              return 'sb-floating-ui';
            if (id.includes('/node_modules/lucide-react/')) return 'sb-icons';
            if (id.includes('/packages/ui/src/components/item-list/'))
              return 'sb-item-list';
            return existingManualChunks?.(id);
          },
        },
      },
    };
    return config;
  },
};

export default config;
