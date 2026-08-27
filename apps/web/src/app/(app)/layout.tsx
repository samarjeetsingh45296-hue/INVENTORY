'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Boxes, Users, RefreshCw, ScrollText, LayoutDashboard,
  DatabaseBackup, LogOut, Menu, X, Smartphone, KeyRound, Wrench,
  Armchair, Ticket,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Boxes;
  /** Shown only if the user holds at least one of these. */
  any: string[];
}

interface NavGroup {
  title: string | null;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, any: ['dashboard.read', 'asset.read_own'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/assets', label: 'All assets', icon: Boxes, any: ['asset.read', 'asset.read_team', 'asset.read_own'] },
      { href: '/workstations', label: 'Workstations', icon: Armchair, any: ['workspace.read'] },
      { href: '/cug', label: 'CUG lines', icon: Smartphone, any: ['cug.read'] },
      { href: '/vouchers', label: 'PVR cards', icon: Ticket, any: ['asset.read'] },
      { href: '/lockers', label: 'Lockers', icon: KeyRound, any: ['locker.read'] },
      { href: '/repairs', label: 'Repairs', icon: Wrench, any: ['repair.read'] },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/employees', label: 'Employees', icon: Users, any: ['employee.read'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/sync', label: 'Sheet Sync', icon: RefreshCw, any: ['sync.read'] },
      { href: '/backups', label: 'Backups', icon: DatabaseBackup, any: ['backup.read'] },
      { href: '/audit', label: 'Change History', icon: ScrollText, any: ['audit.read'] },
    ],
  },
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
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[rgb(var(--accent))] text-[13px] font-bold text-[rgb(var(--accent-fg))]">
            IS
          </div>
          <p className="text-[12px] text-[rgb(var(--muted))]">Loading...</p>
        </div>
      </div>
    );
  }

  const roleLabel = user.roleKeys.join(', ').replace(/_/g, ' ').toLowerCase();
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => canAny(...i.any)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[13.5rem] shrink-0 flex-col
                    border-r border-[rgb(var(--border))] bg-[rgb(var(--surface))]
                    transition-transform md:static md:translate-x-0
                    ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg
                            bg-[rgb(var(--accent))] text-[12px] font-bold
                            text-[rgb(var(--accent-fg))]"
                 style={{ boxShadow: 'var(--shadow-sm)' }}>
              IS
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                Inventory Suite
              </p>
              <p className="eyebrow truncate leading-tight">{roleLabel}</p>
            </div>
          </div>
          <button className="btn-quiet btn-icon md:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={14} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((g) => (
            <div key={g.title ?? 'top'}>
              {g.title && <p className="nav-section">{g.title}</p>}
              {!g.title && <div className="pt-3" />}
              <div className="space-y-px">
                {g.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link key={href} href={href}
                          className={`nav-item ${active ? 'nav-item-active' : ''}`}>
                      <Icon size={15} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[rgb(var(--border))] p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Avatar name={user.displayName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium leading-tight">{user.displayName}</p>
              <p className="truncate text-[10px] leading-tight text-[rgb(var(--muted))]">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3
                           border-b border-[rgb(var(--border))]
                           bg-[rgb(var(--surface))]/90 px-3 py-1.5 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2">
            <button className="btn-quiet btn-icon md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Menu size={15} />
            </button>
            <p className="eyebrow hidden sm:block">Central Contact Center - Parul University</p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <button onClick={logout} className="btn-ghost" type="button">
              <LogOut size={13} aria-hidden />
              Sign out
            </button>
          </div>
        </header>

        <main className="fade-in mx-auto w-full max-w-[90rem] flex-1 p-3 md:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
