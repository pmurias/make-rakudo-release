const fs = require('fs');
const path = require('path');

if (process.argv.length !== 5) {
  console.error('USAGE: node make-release.js VERSION PATH-TO-RAKUDO PATH-TO-NQP-REPO');
  process.exit();
}

const version = process.argv[2];
const rakudoPath = path.resolve(process.argv[3]);
const nqpPath = path.resolve(process.argv[4]);

function stripSourceMappingUrl(js) {
  const found = js.lastIndexOf('//# sourceMappingURL');
  return found === -1 ? js : js.substring(0, found);
}

function mkdirMightExists(dir) {
    try {
      fs.mkdirSync(dir);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
}


const dir = path.join(nqpPath, 'src/vm/js/nqp-runtime');


const files = fs.readdirSync(dir);
const ext = 'nqp-raw-runtime';

const deps = [];

function addBuiltins(contents) {
  if (/\bBuffer\b/.test(contents)) {
    contents = 'const Buffer = require("buffer").Buffer;\n' + contents;
  }

  if (/\bprocess\b/.test(contents)) {
    contents = 'const process = require("process");\n' + contents;
  }

  return contents;
}

function processPerl6File(input, output, customPreprocess, noMap, depth=0) {
  let contents = fs.readFileSync(input, 'utf8');

  contents = stripSourceMappingUrl(contents);

  contents = contents.replace(/^#!\/usr\/bin\/env node/, '');

  contents = contents.replace('nqp.extraRuntime(\'perl6\', module);', 'nqp.extraRuntime("perl6", "nqp-browser-runtime/perl6-runtime.nqp-raw-runtime");\n');

  contents = '__filename = "Fake filename";\n' + contents;

  if (customPreprocess) {
    contents = customPreprocess(contents);
  }

  const runtimePrefix = depth == 0 ? './' : '../'.repeat(depth);


  /* Potentially problematic */
  contents = contents.replace(/require\("nqp-runtime"\)/g, `require('${runtimePrefix}runtime.nqp-raw-runtime')`);

  deps.push('/* dependency ' + './' + output + '*/\n');
  console.log(output);

  if (!noMap) {
    fs.copyFileSync(input + '.map', path.join('nqp-browser-runtime', output + '.map'));
  }

  fs.writeFileSync(path.join('nqp-browser-runtime', output), contents);
}

processPerl6File(path.join(rakudoPath, 'perl6.js'), 'rakudo.nqp-raw-runtime'); 
processPerl6File(path.join(rakudoPath, 'src/vm/js/rakudo-library.js'), 'rakudo-library.nqp-raw-runtime', contents => {

  return addBuiltins(contents.replace(
    `require('nqp-runtime')`,
    `require('./runtime.nqp-raw-runtime')`
  ).replace(
    `require('nqp-runtime/core.js')`,
    `require('./core.nqp-raw-runtime')`
  ).replace(
    `require('./rakudo.js')`,
    `require('./rakudo.nqp-raw-runtime')`
  ));
}, true);

processPerl6File(path.join(rakudoPath, 'src/vm/js/perl6-runtime/runtime.js'), 'perl6-runtime.nqp-raw-runtime', undefined, true);


function processAll(dir, subdirs) {
  const subdir = path.join(...subdirs);
  if (subdir) mkdirMightExists(path.join('nqp-browser-runtime', subdir));
  for (const file of fs.readdirSync(path.join(dir, subdir))) {
    if (!/\.js$/.test(file) || file == 'nqp-bootstrapped.js') continue;
    if (file === 'rakudo-library.js') continue;
    let newFile = file.replace(/\./g, '_').replace(/\_js$/, '.nqp-raw-runtime');
    if (subdir) newFile = path.join(subdir, newFile);
    processPerl6File(path.join(dir, subdir, file), newFile, undefined, false, subdirs.length);
  }
}

const blib = path.join(rakudoPath, 'release');
processAll(blib, '');
processAll(blib, ['Perl6']);
processAll(blib, ['Perl6', 'BOOTSTRAP']);

const precompiledNqp = path.join(nqpPath, 'nqp-js-on-js');
function processNqpFiles(dir, subdirs=[]) {
  const subdir = path.join(...subdirs);
  if (subdir) mkdirMightExists(path.join('nqp-browser-runtime', subdir));
  for (const file of fs.readdirSync(path.join(dir, subdir))) {
    if (!/\.js$/.test(file) || file == 'nqp-bootstrapped.js') continue;
    const newFile = path.join(subdir, file.replace(/\.js$/, '.nqp-raw-runtime').replace(/\.setting/g, '_setting'));
    const newPath = path.join('nqp-browser-runtime', newFile);
    let contents = fs.readFileSync(path.join(dir, subdir, file), 'utf8');

    contents = stripSourceMappingUrl(contents);

    contents = '__filename = "Fake filename";\n' + contents;

    const runtimePrefix = subdirs.length == 0 ? './' : '../'.repeat(subdirs.length);

    /* Potentially problematic */
    contents = contents.replace(/require\("nqp-runtime"\)/g, `require('${runtimePrefix}runtime.nqp-raw-runtime')`);

    deps.push('/* dependency ' + './' + newFile + '*/\n');
    console.log(newPath);

    fs.copyFileSync(path.join(dir, subdir, file) + '.map', newPath + '.map');
    fs.writeFileSync(newPath, contents);
  }
}

processNqpFiles(precompiledNqp);
processNqpFiles(precompiledNqp, ['QAST']);

mkdirMightExists(path.join('nqp-browser-runtime', 'tables'));

fs.copyFileSync(path.join(dir, 'tables/shiftjis.json'), path.join('nqp-browser-runtime', 'tables/shiftjis.json'));

for (const file of files) {
  if (!/\.js$/.test(file)) continue;
  const newPath = path.join('nqp-browser-runtime', file.replace(/\.js$/, '.nqp-raw-runtime'));

  let contents = fs.readFileSync(path.join(dir, file), 'utf8');

  
  contents = contents.replace(/\/\*\s*dependencies\s\*\//, deps.join(''));

  contents = contents.replace(/require\('\.\/([_0-9A-Za-z-]+?)\.js'\)/g,
    (match, name) => `require('./${name}.${ext}')`
  );

  contents = addBuiltins(contents);

  fs.writeFileSync(newPath, contents);
}

function updateVersionFor(keyword, version, content) {
  const regexp = new RegExp('("' + keyword + '": ")' + '\\d+\\.\\d+\\.\\d+');
  return content.replace(regexp,
    (whole, before) => before + version);
}

function bumpVersion(path, version, bumpDeps=[]) {
  let content = fs.readFileSync(path, 'utf8');

  content = updateVersionFor('version', version, content);

  for (const dep of bumpDeps) {
    content = updateVersionFor(dep, version, content);
  }

  fs.writeFileSync(path, content);
}


fs.copyFileSync('nqp-browser-runtime-package.json', 'nqp-browser-runtime/package.json');

if (process.argv[2]) {
  bumpVersion('nqp-browser-runtime/package.json', process.argv[2]);
}

const mappingsBuffer = fs.readFileSync(path.join(path.dirname(require.resolve('source-map/lib/read-wasm.js')), 'mappings.wasm'));

const createBuffer = `new Buffer(${JSON.stringify(mappingsBuffer.toString('base64'))}, 'base64')`; 

fs.writeFileSync('nqp-browser-runtime/mappings-wasm-base64.nqp-raw-runtime',
  addBuiltins('module.exports = ' + createBuffer + ';\n'));
