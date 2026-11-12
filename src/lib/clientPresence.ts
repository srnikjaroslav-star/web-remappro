import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const CLIENT_PRESENCE_CHANNEL = 'remappro-client-presence';

const HEARTBEAT_MS = 3 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const STALE_MS = 20 * 60 * 1000;
const IDLE_WATCH_MS = 15 * 1000;
const STALE_WATCH_MS = 10 * 1000;

type PresenceMeta = {
  user_id?: string;
  role?: string;
  seen?: number;
};

const seenFrom = (channel: RealtimeChannel) => {
  const state = channel.presenceState<PresenceMeta>();
  const seen = new Map<string, number>();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      if (entry?.role !== 'client' || typeof entry.user_id !== 'string' || !entry.user_id) continue;
      const at = typeof entry.seen === 'number' && Number.isFinite(entry.seen) ? entry.seen : 0;
      const previous = seen.get(entry.user_id) ?? 0;
      if (at > previous) seen.set(entry.user_id, at);
    }
  }
  return seen;
};

const freshIds = (seen: Map<string, number>, now = Date.now()) => {
  const ids = new Set<string>();
  for (const [id, at] of seen) {
    if (now - at <= STALE_MS) ids.add(id);
  }
  return ids;
};

const sameIds = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false;
  for (const id of right) {
    if (!left.has(id)) return false;
  }
  return true;
};

export const useClientPresence = (userId: string | null) => {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!userId) {
      setOnline(false);
      return;
    }

    let active = true;
    let tracked = false;
    let subscribed = false;
    let resumePending = false;
    let lastActivity = Date.now();
    const channel = supabase.channel(CLIENT_PRESENCE_CHANNEL, {
      config: {
        presence: { key: userId, enabled: true },
        private: false,
      },
    });

    const announce = async () => {
      if (!active || !subscribed || Date.now() - lastActivity > IDLE_MS) return;
      const result = await channel.track({
        user_id: userId,
        role: 'client',
        seen: Date.now(),
      });
      if (!active || Date.now() - lastActivity > IDLE_MS) {
        tracked = false;
        setOnline(false);
        void channel.untrack();
        return;
      }
      if (result === 'ok') {
        tracked = true;
        setOnline(true);
      }
    };

    const dropIfIdle = () => {
      if (!active || !tracked || Date.now() - lastActivity <= IDLE_MS) return;
      tracked = false;
      setOnline(false);
      void channel.untrack();
    };

    const noteActivity = () => {
      lastActivity = Date.now();
      if (!active || !subscribed || tracked || resumePending) return;
      resumePending = true;
      void announce().finally(() => {
        resumePending = false;
      });
    };

    channel.on('presence', { event: 'sync' }, () => {
      if (active && tracked && freshIds(seenFrom(channel)).has(userId)) setOnline(true);
    });

    channel.subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        lastActivity = Date.now();
        void announce();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
        tracked = false;
        setOnline(false);
      }
    });

    const leave = () => {
      tracked = false;
      void channel.untrack();
    };
    const resume = () => {
      if (!active) return;
      lastActivity = Date.now();
      void announce();
    };

    const heartbeat = window.setInterval(() => {
      if (!active) return;
      if (Date.now() - lastActivity > IDLE_MS) {
        dropIfIdle();
        return;
      }
      void announce();
    }, HEARTBEAT_MS);
    const idleWatch = window.setInterval(dropIfIdle, IDLE_WATCH_MS);

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, noteActivity, { passive: true });
    }
    window.addEventListener('scroll', noteActivity, { passive: true, capture: true });
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);

    return () => {
      active = false;
      tracked = false;
      window.clearInterval(heartbeat);
      window.clearInterval(idleWatch);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, noteActivity);
      }
      window.removeEventListener('scroll', noteActivity, { capture: true });
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      setOnline(false);
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return online;
};

export const useOnlineClients = (enabled: boolean) => {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled) {
      setOnlineIds((current) => (current.size === 0 ? current : new Set()));
      return;
    }

    let active = true;
    const channel = supabase.channel(CLIENT_PRESENCE_CHANNEL, {
      config: {
        presence: { key: `observer-${crypto.randomUUID()}`, enabled: true },
        private: false,
      },
    });

    const publish = () => {
      if (!active) return;
      const ids = freshIds(seenFrom(channel));
      setOnlineIds((current) => (sameIds(current, ids) ? current : ids));
    };

    channel.on('presence', { event: 'sync' }, publish);
    channel.on('presence', { event: 'join' }, publish);
    channel.on('presence', { event: 'leave' }, publish);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') publish();
    });

    const staleWatch = window.setInterval(publish, STALE_WATCH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') publish();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(staleWatch);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return onlineIds;
};
