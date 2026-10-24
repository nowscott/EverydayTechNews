// Shared by API and UI so optional absence never becomes a read-failure warning.
export function isEvidenceFailure(entry: {state: string}): boolean {
  return entry.state !== 'ok' && entry.state !== 'not_recorded';
}
