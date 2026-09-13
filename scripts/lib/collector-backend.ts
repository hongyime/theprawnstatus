/** Opt in only after the storage migration and trusted target configuration exist. */
export function atomicCollectorEnabled(): boolean {
  const value = process.env.STATUS_COLLECTION_BACKEND?.trim() || 'legacy';
  if (value !== 'legacy' && value !== 'atomic') {
    throw new Error('STATUS_COLLECTION_BACKEND must be legacy or atomic');
  }
  return value === 'atomic';
}
