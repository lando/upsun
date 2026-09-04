import {createRequire} from 'module';

import {defineConfig} from '@lando/vitepress-theme-default-plus/config';

const require = createRequire(import.meta.url);

const {name, version} = require('../../package.json');
const landoPlugin = name.replace('@lando/', '');

export default defineConfig({
  title: 'Lando Upsun Plugin (Fixed)',
  description: 'Lando plugin for Upsun Fixed. platform CLI / PLATFORMSH_CLI_TOKEN. Flex is not supported.',
  landoDocs: 3,
  landoPlugin,
  version,
  head: [
    ['meta', {name: 'viewport', content: 'width=device-width, initial-scale=1'}],
    ['link', {rel: 'icon', href: '/plugins/upsun/favicon.ico', size: 'any'}],
    ['link', {rel: 'icon', href: '/plugins/upsun/favicon.svg', type: 'image/svg+xml'}],
  ],
  themeConfig: {
    multiVersionBuild: {
      satisfies: '>=1.0.0',
    },
    sidebar: sidebar(),
  },
});

/**
 * Generates the sidebar configuration for the documentation.
 * @returns {Array} An array of sidebar items.
 */
function sidebar() {
  return [
    {
      text: 'Introduction',
      collapsed: false,
      items: [
        {text: 'Introduction', link: '/'},
        {text: 'Installation', link: '/install'},
        {text: 'Getting Started', link: '/getting-started'},
        {text: 'Configuration', link: '/config'},
        {text: 'Tooling', link: '/tooling'},
        {text: 'Syncing', link: '/sync'},
        {text: 'Lifecycle', link: '/lifecycle'},
        {text: 'Caveats', link: '/caveats'},
      ],
    },
    {
      text: 'Contribution',
      collapsed: false,
      items: [
        {text: 'Development', link: '/development'},
        {text: 'Team', link: '/team'},
      ],
    },
    {
      text: 'Help & Support',
      collapsed: false,
      items: [
        {text: 'GitHub', link: 'https://github.com/lando/upsun/issues/new'},
        {text: 'Slack', link: 'https://www.launchpass.com/devwithlando'},
        {text: 'Contact Us', link: '/support'},
        {text: 'Examples', link: 'https://github.com/lando/upsun/tree/main/examples'},
      ],
    },
    {text: 'Guides', link: '/guides', activeMatch: '/guides'},
  ];
};
