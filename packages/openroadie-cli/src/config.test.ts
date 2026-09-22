import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, configPath } from './config';

describe('config', () => {
  let dir: string;
  let file: string;
  const originalOverride = process.env.OPENROADIE_CONFIG;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openroadie-cfg-'));
    file = join(dir, 'config.json');
    process.env.OPENROADIE_CONFIG = file;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.OPENROADIE_CONFIG;
    } else {
      process.env.OPENROADIE_CONFIG = originalOverride;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('honors OPENROADIE_CONFIG as the path override', () => {
    expect(configPath()).toBe(file);
  });

  it('returns a default backend url when no file exists', () => {
    const config = loadConfig();
    expect(config.backendUrl).toBe('http://localhost:7008');
  });

  it('reads backendUrl from the file', () => {
    writeFileSync(file, JSON.stringify({ backendUrl: 'http://host:9000' }));
    const config = loadConfig();
    expect(config).toEqual({ backendUrl: 'http://host:9000' });
  });

  it('ignores unrelated keys, carrying only the backend url forward', () => {
    writeFileSync(
      file,
      JSON.stringify({ backendUrl: 'http://host:9000', token: 'rst_x' }),
    );
    const config = loadConfig();
    expect(config).toEqual({ backendUrl: 'http://host:9000' });
    expect(Object.keys(config)).toEqual(['backendUrl']);
  });

  it('throws a clear error on a malformed config file', () => {
    writeFileSync(file, '{ not json');
    expect(() => loadConfig()).toThrow(/Could not read config/);
  });
});
