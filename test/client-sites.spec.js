'use strict';

const fs = require('fs');
const path = require('path');
const chai = require('chai');
chai.should();

describe('platformsh-client call sites', () => {
  it('keeps the pinned platformsh-client dependency', () => {
    const pkg = require('../package.json');
    pkg.dependencies['platformsh-client'].should.equal('0.1.230');
    pkg.bundleDependencies.should.include('platformsh-client');
  });

  it('init and app still require platformsh-client', () => {
    const init = fs.readFileSync(path.join(__dirname, '..', 'recipes', 'upsun', 'init.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    init.should.match(/require\('platformsh-client'\)/);
    init.should.match(/getAccountInfo/);
    init.should.match(/getProject/);
    init.should.match(/addSshKey/);
    init.should.match(/getAccessToken/);
    app.should.match(/require\('platformsh-client'\)/);
    app.should.match(/getAccountInfo/);
  });
});
