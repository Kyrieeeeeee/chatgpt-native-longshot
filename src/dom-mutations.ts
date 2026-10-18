/** Ignore our own UI, including its insertion outside a ShadowRoot. */
export function isUiMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest('[data-native-longshot-ui]')) return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return record.type === 'childList' && changed.length > 0 && changed.every(node =>
    node instanceof Element && node.hasAttribute('data-native-longshot-ui'));
}
