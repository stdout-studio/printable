'use client';

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type ViewMode = 'hosted' | 'selfhost';

const ViewModeContext = createContext<{
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}>({
  mode: 'hosted',
  setMode: () => {},
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('hosted');
  return (
    <ViewModeContext.Provider value={{ mode, setMode }}>{children}</ViewModeContext.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeContext);
}

/** Renders its children only when the landing is in hosted (user) view. */
export function HostedOnly({ children }: { children: ReactNode }) {
  const { mode } = useViewMode();
  return mode === 'hosted' ? <>{children}</> : null;
}

/** Renders its children only when the landing is in self-host view. */
export function SelfHostOnly({ children }: { children: ReactNode }) {
  const { mode } = useViewMode();
  return mode === 'selfhost' ? <>{children}</> : null;
}
