/** Tiny DOM helper: `el('div', 'class-a class-b', 'text')`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** Restart a CSS animation on an element by toggling a class. */
export function replayClass(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}
