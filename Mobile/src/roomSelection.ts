export function resolveStreamSelection(selectedId: string | undefined, availableIds: string[]) {
  if (!selectedId) return undefined;
  return availableIds.includes(selectedId) ? selectedId : undefined;
}

export function getStreamPreview(availableIds: string[]) {
  return availableIds[0];
}
