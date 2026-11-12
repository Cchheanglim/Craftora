import { invoke } from "@tauri-apps/api/core";
import { libraryFont } from "../project/model";

const loading = new Map<string, Promise<void>>();
/** Library fonts on the page (document.fonts.check says yes for a family it has never seen, so it can't tell). */
const ready = new Set<string>();

/**
 * Makes a library font usable on the page (and its file ready for the export: fonts.rs), downloading it the first time;
 * nothing to do for the fonts Windows has. Fails (and is tried again next time) when it can't be downloaded.
 */
export function loadFont(id?: string): Promise<void> {
  const font = libraryFont(id);
  if (!font) return Promise.resolve();
  let done = loading.get(font.id);
  if (!done) {
    done = invoke<ArrayBuffer>("font_file", { id: font.id, path: font.file }).then(async (bytes) => {
      // Every weight draws this one file, so bold text isn't thickened by the browser (the export can't do that).
      const face = new FontFace(`Craftora ${font.label}`, bytes, { weight: "100 900" });
      document.fonts.add(await face.load());
      ready.add(font.id);
    });
    done.catch(() => loading.delete(font.id));
    loading.set(font.id, done);
  }
  return done;
}

/** Whether a library font is ready on the page now. */
export const fontLoaded = (id?: string) => !libraryFont(id) || ready.has(id!);
