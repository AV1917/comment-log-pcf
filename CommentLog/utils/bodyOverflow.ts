export const measureCollapsedBody = (node: HTMLElement): boolean => {
  const wasCollapsed = node.classList.contains('is-collapsed');
  node.classList.add('is-collapsed');
  try {
    return node.scrollHeight > node.clientHeight + 1;
  } finally {
    if (!wasCollapsed) node.classList.remove('is-collapsed');
  }
};
