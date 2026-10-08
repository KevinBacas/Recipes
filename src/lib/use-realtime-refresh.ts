"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RealtimeStatus = "connecting" | "connected" | "offline";

export function useRealtimeRefresh(ownerId: string, tables: string[]) {
  const router = useRouter();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tableKey = tables.join(",");

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setConnectionAttempt(attempt => attempt + 1);
    router.refresh();
  }, [router]);

  useEffect(() => {
    const client = createClient();
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (disposed) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => router.refresh(), 120);
    };
    const channel = client.channel(`workspace:${ownerId}:${connectionAttempt}:${crypto.randomUUID()}`);

    // Workspace revisions also signal removals without subscribing to private DELETE rows.
    tableKey.split(",").forEach(table => {
      for (const event of ["INSERT", "UPDATE"] as const) {
        channel.on("postgres_changes", { event, schema: "public", table, filter: `owner_id=eq.${ownerId}` }, refresh);
      }
    });

    // Cookie-backed auth initializes asynchronously. Join only with the user JWT.
    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (disposed) return;
        if (error || !data.session) {
          setStatus("offline");
          return;
        }
        await client.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        channel.subscribe(state => {
          if (disposed) return;
          if (state === "SUBSCRIBED") {
            setStatus("connected");
            refresh();
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            setStatus("offline");
          }
        });
      } catch {
        if (!disposed) setStatus("offline");
      }
    })();

    const online = () => {
      setStatus("connecting");
      setConnectionAttempt(attempt => attempt + 1);
      refresh();
    };
    const offline = () => setStatus("offline");
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);

    return () => {
      disposed = true;
      clearTimeout(timeout);
      void client.removeChannel(channel);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [ownerId, tableKey, router, connectionAttempt]);

  return { status, reconnect };
}
