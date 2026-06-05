'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { useProjectsStore } from '@/lib/store/projects';

/**
 * Lovable-style project switcher at the top of the chat rail. The chat itself
 * is one persistent surface that re-contexts when you switch — switchProject
 * snapshots the current project and rehydrates the target's meshes/points/chat.
 */
export function ProjectSwitcher() {
  const projects = useProjectsStore((s) => s.projects);
  const order = useProjectsStore((s) => s.order);
  const currentId = useProjectsStore((s) => s.currentProjectId);
  const createProject = useProjectsStore((s) => s.createProject);
  const switchProject = useProjectsStore((s) => s.switchProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);
  const [open, setOpen] = useState(false);

  const current = currentId ? projects[currentId] : null;

  return (
    <div className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-1.5 text-sm text-[var(--fg)] hover:border-[var(--line-strong)] transition-colors"
      >
        <span className="truncate flex-1 text-left">{current?.meta.name ?? 'Untitled'}</span>
        <ChevronsUpDown size={13} className="flex-shrink-0 text-[var(--fg-dim)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-1 max-h-80 overflow-y-auto">
            <div className="px-2 py-1 mono text-[10px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
              Projects
            </div>
            {order.map((id) => {
              const p = projects[id];
              if (!p) return null;
              const active = id === currentId;
              return (
                <div
                  key={id}
                  className="group flex items-center rounded-md hover:bg-[var(--bg-surface)]"
                >
                  <button
                    onClick={() => {
                      switchProject(id);
                      setOpen(false);
                    }}
                    className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm text-left min-w-0"
                  >
                    <Check
                      size={13}
                      className={active ? 'text-[var(--flux)] flex-shrink-0' : 'opacity-0 flex-shrink-0'}
                    />
                    <span className="truncate text-[var(--fg)]">{p.meta.name}</span>
                  </button>
                  {order.length > 1 && (
                    <button
                      onClick={() => deleteProject(id)}
                      title="Delete project"
                      className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 rounded text-[var(--fg-dim)] hover:text-[var(--status-danger)]"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => {
                createProject();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 mt-0.5 rounded-md text-sm text-[var(--flux)] hover:bg-[var(--bg-surface)]"
            >
              <Plus size={14} />
              New project
            </button>
          </div>
        </>
      )}
    </div>
  );
}
