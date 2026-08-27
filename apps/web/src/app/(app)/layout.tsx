'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Boxes, Users, RefreshCw, ScrollText, LayoutDashboard,
  DatabaseBackup, LogOut, Menu, X, Smartphone, KeyRound, Wrench,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';

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
  { href: '/cug', label: 'CUG lines', icon: Smartphone, any: ['cug.read'] },
  { href: '/lockers', label: 'Lockers', icon: KeyRound, any: ['locker.read'] },
  { href: '/repairs', label: 'Repairs', icon: Wrench, any: ['repair.read'] },
  { href: '/sync', label: 'Sheet Sync', icon: RefreshCw, any: ['sync.read'] },
  { href: '/backups', label: 'Backups', icon: DatabaseBackup, any: ['backup.read'] },
  { href: '/audit', label: 'Audit Trail', icon: ScrollText, any: ['audit.read'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, canAny } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-[12px] text-[rgb(var(--muted))]">Loading...</p>
      </div>
    );
  }

  const visible = NAV.filter((item) => canAny(...item.any));
  const roleLabel = user.roleKeys.join(', ').replace(/_/g, ' ').toLowerCase();

  return (
    <div className="flex min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-52 shrink-0 border-r
                    border-[rgb(var(--border))] bg-[rgb(var(--surface))]
                    transition-transform md:static md:translate-x-0
                    ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight">
              {process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite'}
            </p>
            <p className="truncate text-[10px] uppercase tracking-wider text-[rgb(var(--muted))]">
              {roleLabel}
            </p>
          </div>
          <button
            className="btn-quiet btn-icon md:hidden"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X size={14} />
          </button>
        </div>

        <nav className="space-y-px px-2 pb-3">
          {visible.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]
                  transition-colors
                  ${active
                    ? 'bg-[rgb(var(--accent))] text-[rgb(var(--accent-fg))] font-medium'
                    : 'text-[rgb(var(--text-2))] hover:bg-[rgb(var(--surface-3))] hover:text-[rgb(var(--text))]'}`}
              >
                <Icon size={15} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3
                           border-b border-[rgb(var(--border))]
                           bg-[rgb(var(--surface))]/95 px-3 py-2 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="btn-quiet btn-icon md:hidden"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={15} />
            </button>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium leading-tight">{user.displayName}</p>
              <p className="truncate text-[11px] leading-tight text-[rgb(var(--muted))]">
                {user.email}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <button onClick={logout} className="btn-ghost" type="button">
              <LogOut size={13} aria-hidden />
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-3 md:p-5">{children}</main>
      </div>
    </div>
  );
}
