'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {expect} = require('chai');

const fixture = name => path.join(__dirname, 'fixtures', name);
const project = () => require('../lib/project');

describe('local project metadata', () => {
  it('reads the Flex local project id', () => {
    expect(project().readLocalProjectId(fixture('flex-local-project'), 'flex')).to.equal('abcdefg123456');
    expect(project().readLocalProject(fixture('flex-local-project'), 'flex')).to.deep.equal({
      id: 'abcdefg123456',
      host: 'api.upsun.com',
    });
  });

  it('reads the Fixed local project id', () => {
    expect(project().readLocalProjectId(fixture('fixed-local-project'), 'fixed')).to.equal('fixedproj');
  });

  it('tries both flavors when none is given', () => {
    expect(project().readLocalProjectId(fixture('fixed-local-project'))).to.equal('fixedproj');
    expect(project().readLocalProjectId(fixture('flex-drupal'))).to.equal(null);
  });

  it('returns null for missing files, bad YAML or missing id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsun-project-'));
    const local = path.join(root, '.upsun', 'local');
    fs.mkdirSync(local, {recursive: true});
    try {
      expect(project().readLocalProjectId(root)).to.equal(null);
      fs.writeFileSync(path.join(local, 'project.yaml'), ': : :');
      expect(project().readLocalProjectId(root)).to.equal(null);
      fs.writeFileSync(path.join(local, 'project.yaml'), 'host: x\n');
      expect(project().readLocalProjectId(root)).to.equal(null);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('resolves the local project file path per flavor', () => {
    expect(project().getLocalProjectFile('/tmp/project', 'flex'))
        .to.equal(path.join('/tmp/project', '.upsun', 'local', 'project.yaml'));
    expect(project().getLocalProjectFile('/tmp/project', 'fixed'))
        .to.equal(path.join('/tmp/project', '.platform', 'local', 'project.yaml'));
  });
});
