export type StorageMode = 'git' | 'supabase' | 'dual';

export function storageMode(value = process.env.STATUS_STORAGE): StorageMode {
  if (value === undefined || value.trim() === '') {
    return 'git';
  }

  const normalised = value.trim().toLowerCase();
  if (normalised === 'git' || normalised === 'supabase' || normalised === 'dual') {
    return normalised;
  }

  throw new Error('STATUS_STORAGE must be git, supabase, or dual');
}

export function shouldWriteGit(mode: StorageMode): boolean {
  return mode === 'git' || mode === 'dual';
}

export function shouldWriteSupabase(mode: StorageMode): boolean {
  return mode === 'supabase' || mode === 'dual';
}
