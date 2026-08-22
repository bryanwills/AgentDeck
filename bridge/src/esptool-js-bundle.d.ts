/**
 * Types for `esptool-js/bundle.js`, which ships none.
 *
 * The bundle is the same library as the package root — it is what the package
 * builds for a `<script type="module">` consumer — so its declarations are the
 * root's declarations. Stating that here keeps `esptool-js-node.ts` fully typed
 * instead of degrading ESPLoader and Transport to `any`, which is what a
 * `@ts-expect-error` on the re-export would have done.
 */
declare module 'esptool-js/bundle.js' {
  export { ESPLoader, Transport, ROM, ClassicReset, CustomReset, HardReset, UsbJtagSerialReset } from 'esptool-js';
}
