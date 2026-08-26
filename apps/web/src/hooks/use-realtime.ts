'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(`${WS_URL}/realtime`, {
      auth: { token: tokenStore.getAccess() },
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

/**
 * Subscribes to live updates and re-runs `onEvent` whenever one arrives.
 * Screens using this stay current without polling or a manual refresh.
 */
export function useRealtime(
  events: string[],
  onEvent: (event: string, payload: unknown) => void,
  rooms: string[] = [],
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!tokenStore.getAccess()) return;
    const s = getSocket();

    const listeners = events.map((event) => {
      const fn = (payload: unknown) => handler.current(event, payload);
      s.on(event, fn);
      return { event, fn };
    });

    if (rooms.length) s.emit('subscribe', { rooms });

    return () => {
      for (const { event, fn } of listeners) s.off(event, fn);
      if (rooms.length) s.emit('unsubscribe', { rooms });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join(','), rooms.join(',')]);
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
