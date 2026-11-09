import { fr } from './planches';

/** A new element of the document, with an optional class (a list, separated by spaces) and French-typeset text. */
export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls !== undefined) node.className = cls;
  if (text !== undefined) node.textContent = fr(text);
  return node;
}
