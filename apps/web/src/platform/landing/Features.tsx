'use client';

import type { ReactNode } from 'react';

export interface FeatureItem {
  title: string;
  description: string;
  icon?: ReactNode;
}

/**
 * A grid of feature blocks. Each app populates with its own list.
 */
export function Features({ items }: { items: FeatureItem[] }) {
  return (
    <section className="px-6 py-16">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6"
          >
            {item.icon && (
              <div className="text-[var(--color-accent)] mb-3">{item.icon}</div>
            )}
            <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
            <p className="text-sm text-[var(--color-fg-dim)] leading-relaxed">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
