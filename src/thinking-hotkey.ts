// macOS maps Fn+Right/Left to End/Home. Dedicated End/Home are equivalent.
export function installThinkingHotkey(cycle: (direction: 1 | -1) => void): void {
  // Capture at window level, before page/other extension document handlers.
  // Do not gate End on navigator.platform: browser privacy tools can mask it.
  window.addEventListener('keydown', e => {
    // Let extension panels retain their own keyboard navigation.
    if(e.composedPath().some(node=>node instanceof HTMLElement&&node.hasAttribute('data-native-longshot-ui')))return;
    // Slider navigation dispatched by this extension must reach the slider.
    if (!e.isTrusted || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const fnRight = ((e.code === 'ArrowRight' || e.key === 'ArrowRight') && e.getModifierState('Fn')) ||
      e.key === 'End' || e.code === 'End' || e.keyCode === 35;
    const fnLeft = ((e.code === 'ArrowLeft' || e.key === 'ArrowLeft') && e.getModifierState('Fn')) ||
      e.key === 'Home' || e.code === 'Home' || e.keyCode === 36;
    if (!fnRight && !fnLeft) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) cycle(fnLeft ? -1 : 1);
  }, true);
}
