import { Workspace } from '@/components/Workspace';

/**
 * The actual Printable product UI. Gated by auth middleware on /app/*.
 * (See apps/web/src/middleware.ts.)
 */
export default function AppPage() {
  return <Workspace />;
}
