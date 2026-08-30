import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverMarketplace, installPlugin, scanPlugins } from '../plugins.js';

describe('plugins', () => {
  it('scans global and trusted project plugins', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plugins-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plugins-home-'));
    const previousHome = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = home;
    try {
      await fs.mkdir(path.join(root, '.auraxis', 'plugins', 'demo'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.auraxis', 'plugins', 'demo', 'plugin.json'),
        JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0' }),
        'utf8',
      );
      const trusted = await scanPlugins(root, true);
      expect(trusted).toHaveLength(1);
      expect(trusted[0].manifest.id).toBe('demo');
    } finally {
      if (previousHome === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('installs a local plugin directory and discovers marketplace json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plugin-install-'));
    const pluginDir = path.join(root, 'src-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({ id: 'local', name: 'Local' }), 'utf8');
    const installed = await installPlugin(pluginDir, root);
    expect(installed.manifest.id).toBe('local');
    const marketplace = path.join(root, 'marketplace.json');
    await fs.writeFile(marketplace, JSON.stringify([{ id: 'remote', name: 'Remote' }]), 'utf8');
    const previous = process.env.AURAXIS_PLUGIN_MARKETPLACE;
    process.env.AURAXIS_PLUGIN_MARKETPLACE = marketplace;
    try {
      expect(await discoverMarketplace()).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.AURAXIS_PLUGIN_MARKETPLACE;
      else process.env.AURAXIS_PLUGIN_MARKETPLACE = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
