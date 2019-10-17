This repo contains a yarn workspace (https://yarnpkg.com/lang/en/docs/workspaces/) to make a rakudo.js release.

In examples replace VERSION with the version you want to release

First update all the submodules.

```bash
git submodule update --init --recursive
```

Then build nqp

```bash
(cd nqp; perl Configure.pl --backends=moar,js; make js-install)
```

Then build rakudo

```bash
(cd rakudo; perl Configure.pl --with-nqp=../nqp/install/bin/nqp-js; make js-all blib/load-compiler.js)
```

Build the rakudo npm package

```bash
(cd rakudo; node src/vm/js/make-release.js VERSION . ../nqp/install/ ../nqp/ ../parcel-plugin-nqp/)
```

Build nqp-browser-runtime

```bash

(cd build-nqp-browser-runtime; node build.js ../rakudo ../nqp)

```

Last publish everything.

(cd rakudo/release ; yarn publish) 
(cd rakudo/src/vm/js/perl6-runtime ; yarn publish) 
(cd nqp/nqp-js-on-js ; yarn publish) 
(cd nqp/src/vm/js/nqp-runtime ; yarn publish) 
(cd parcel-plugin-nqp ; yarn publish) 
(cd build-nqp-browser-runtime/nqp-browser-runtime; yarn publish)
