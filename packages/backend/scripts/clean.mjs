#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, '..');
const distDir = resolve(packageDir, 'dist');

await rm(distDir, { recursive: true, force: true });
console.log('Cleaned dist/');
