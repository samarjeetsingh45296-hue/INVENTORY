'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  Boxes, Users, RefreshCw, ScrollText, LayoutDashboard,
  DatabaseBackup, LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Boxes;
  /** Shown only if the user holds at least one of these. */
  any: string[];
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, any: ['dashboard.read', 'asset.read_own'] },
  { href: '/assets', label: 'Inventory', icon: Boxes, any: ['asset.read', 'asset.read_team', 'asset.read_own'] },
  { href: '/employees', label: 'Employees', icon: Users, any: ['employee.read'] },
  { href: '/sync', label: 'Sheet Sync', icon: RefreshCw, any: ['sync.read'] },
  { href: '/backups', label: 'Backups', icon: DatabaseBackup, any: ['backup.read'] },
  { href: '/audit', label: 'Audit Trail', icon: ScrollText, any: ['audit.read'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, canAny } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm text-[rgb(var(--muted))]">Loading...</p>
      </div>
    );
  }

  const visible = NAV.filter((item) => canAny(...item.any));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-[rgb(var(--border))] bg-[rgb(var(--surface))] md:block">
        <div className="px-4 py-5">
          <p className="text-sm font-semibold">
            {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
          </p>
          <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">
            {user.roleKeys.join(', ').replace(/_/g, ' ').toLowerCase()}
          </p>
        </div>

        <nav className="space-y-0.5 px-2">
          {visible.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition
                  ${active
                    ? 'bg-brand-600 text-white'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                <Icon size={16} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-[rgb(var(--muted))]">{user.email}</p>
          </div>
          <button onClick={logout} className="btn-ghost" type="button">
            <LogOut size={15} aria-hidden />
            Sign out
          </button>
        </header>

        <main className="flex-1 overflow-x-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
