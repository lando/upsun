'use strict';

exports.unsupportedServices = (services = '') => ({
  title: 'Unsupported Platform.sh services detected',
  detail: [
    'Lando has detected services in your Fixed (.platform) config which are not yet supported.',
    'This may result in errors or reduced functionality.',
    `The unsupported services are: ${services}`,
    'See the documentation below for more detail:',
  ],
  url: 'https://docs.lando.dev/config/platformsh.html',
});

exports.unsupportedLanguages = (languages = '') => ({
  title: 'Unsupported Platform.sh languages detected',
  detail: [
    'Lando has detected application languages in your Fixed config which are not yet supported.',
    'This may result in errors or reduced functionality.',
    `The unsupported languages are: ${languages}`,
    'See the documentation below for more detail:',
  ],
  url: 'https://docs.lando.dev/config/platformsh.html',
});

exports.flexUnsupported = () => ({
  title: 'Flex unsupported until Phase 3; Fixed-only',
  detail: [
    'Found .upsun/config.yaml.',
    'This plugin is Fixed-only: .platform.app.yaml and .platform/{routes,services,applications}.yaml.',
    'An empty .upsun/ directory is ignored.',
  ],
  url: 'https://docs.upsun.com/learn/overview/yaml.html',
});
