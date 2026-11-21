/**
 * The second package, `dsh-copy-file-icon`, is the same feature with one
 * constant flipped: `icon` shows a single button whose menu opens on
 * right-click, `menu` shows the button plus a chevron.
 *
 * A browser bundle cannot import across packages, so the two ship separate
 * copies of `lib/`. This module is the only place that knows how they differ;
 * `make-variant.mjs` writes the copy and `tests/variant.test.mjs` proves it is
 * still in sync.
 *
 * @module dsh-copy-file/scripts/variant
 */

/** Files mirrored into the icon package, in the order they are written. */
export const FILES = ['client.js', 'index.js', 'clipboard.mjs', 'presented.mjs'];

/** The two textual differences. Both must match exactly once in `client.js`. */
const SUBSTITUTIONS = [
  { from: "const DEFAULT_PRESENTATION = 'menu';", to: "const DEFAULT_PRESENTATION = 'icon';" },
  { from: "  id: 'dsh-copy-file',", to: "  id: 'dsh-copy-file-icon'," },
];

/**
 * Apply the icon-package differences to one source file.
 * @param {string} name - file name inside `lib/`.
 * @param {string} text - the root package's file contents.
 * @returns {string} what the icon package should contain.
 */
export function variantOf(name, text) {
  if (name !== 'client.js') return text;
  let out = text;
  for (const { from, to } of SUBSTITUTIONS) {
    if (!out.includes(from)) throw new Error(`variant anchor missing: ${from}`);
    out = out.replace(from, to);
  }
  return out;
}
