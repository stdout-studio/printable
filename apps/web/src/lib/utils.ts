import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
