'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Any address that doesn't exist lands on the dashboard rather than a 404 -
 * mistyped or stale links always recover to somewhere useful. Signed-out
 * visitors go to sign-in instead, same as everywhere else.
 */
export default function NotFound() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, loading, router]);

  return (
    <main className="grid min-h-screen place-items-center">
      <p className="text-sm text-[rgb(var(--muted))]">Taking you to the dashboard...</p>
    </main>
  );
}
