'use strict';

const chai = require('chai');
chai.should();
const warnings = require('../lib/warnings');

describe('warnings', () => {
  it('points service/language help at this repo, not docs.lando.dev/config/platformsh.html', () => {
    const svc = warnings.unsupportedServices('solr (solr:8.6)');
    const lang = warnings.unsupportedLanguages('node (nodejs:16)');
    svc.url.should.equal('https://github.com/AaronFeledy/upsun/blob/main/docs/config.md');
    lang.url.should.equal('https://github.com/AaronFeledy/upsun/blob/main/docs/config.md');
    svc.url.should.not.match(/docs\.lando\.dev\/config\/platformsh/);
    lang.url.should.not.match(/docs\.lando\.dev\/config\/platformsh/);
    svc.title.should.match(/Upsun Fixed/);
    lang.title.should.match(/Upsun Fixed/);
  });

  it('flexUnsupported is the Phase-3 Fixed-only warning', () => {
    const flex = warnings.flexUnsupported();
    flex.title.should.match(/Flex unsupported until Phase 3/);
    flex.detail.join(' ').should.match(/\.upsun\/config\.yaml/);
  });
});
