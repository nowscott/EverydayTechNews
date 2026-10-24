// Shared by API and UI so optional absence never becomes a read-failure warning.
export function isEvidenceFailure(entry: Record<string, unknown>): boolean {
  return entry.state !== 'ok' && entry.state !== 'not_recorded';
}
