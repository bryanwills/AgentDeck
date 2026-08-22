/**
 * esptool-js, imported the one way Node can actually load it.
 *
 * The package's `main` (`lib/index.js`) is ESM whose relative imports are
 * EXTENSIONLESS — `from "./util"`. A bundler resolves that; Node's ESM loader
 * does not, and refuses with ERR_MODULE_NOT_FOUND on the very first import. The
 * browser flasher never hits this because Vite bundles the library.
 *
 * `bundle.js` is the same library pre-bundled into one self-contained ESM file,
 * exporting exactly what is needed. It ships no `.d.ts`, so the declarations are
 * supplied by `esptool-js-bundle.d.ts` alongside this file.
 *
 * Every Node-side consumer imports from here, so the workaround exists once and
 * is explained once.
 */
export { ESPLoader, Transport } from 'esptool-js/bundle.js';
