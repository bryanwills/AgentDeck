/**
 * The web flasher does not own a board table — it consumes the repo SSOT.
 *
 * `shared/src/esp32-boards.ts` is the single source; this module only re-exports
 * it under the names the flasher UI uses. When the spike started this file WAS
 * a hand-transcribed copy, which is exactly the duplication the SSOT exists to
 * end, so nothing may be redeclared here.
 */
export {
  ESP32_BOARDS as BOARDS,
  ESP32_BOOTLOADER_OFFSET as BOOTLOADER_OFFSET,
  esp32BoardById as boardById,
  esp32ChipFamilyOf as chipFamilyOf,
} from "../../shared/src/esp32-boards.js";

export type {
  Esp32BoardSpec as BoardProfile,
  Esp32ChipFamily as ChipFamily,
  Esp32ResetBefore as Before,
  Esp32ResetAfter as After,
} from "../../shared/src/esp32-boards.js";
