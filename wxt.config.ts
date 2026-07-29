import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Browser Storage Suite',
    description: 'Cross-browser Management tool for LocalStorage, SessionStorage, Cookies & IndexedDB.',
    permissions: [
      'storage',
      'tabs',
      'cookies',
      'activeTab'
    ],
    host_permissions: [
      '<all_urls>'
    ],
    action: {
      default_title: 'Browser Storage Suite',
      default_icon: 'icon.png'
    },
    icons: {
      '16': 'icon.png',
      '32': 'icon.png',
      '48': 'icon.png',
      '128': 'icon.png'
    },
    browser_specific_settings: {
      gecko: {
        id: 'browser-storage-suite@extension.local',
        strict_min_version: '109.0'
      }
    }
  }
});
