import type { createClient } from "./supabase/client";

export type RealtimeStatus = "connecting" | "connected" | "offline";
type Client = ReturnType<typeof createClient>;

/** One subscription lifetime. React owns recreation; this controller owns disposal. */
export function startRealtimeRefresh({
  client,
  ownerId,
  tables,
  refreshPage,
  onStatus,
  reconnect,
  windowEvents,
  documentEvents,
}: {
  client: Client;
  ownerId: string;
  tables: string[];
  refreshPage: () => void;
  onStatus: (status: RealtimeStatus) => void;
  reconnect: () => void;
  windowEvents: Pick<Window, "addEventListener" | "removeEventListener">;
  documentEvents: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
}) {
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (disposed) return;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (!disposed) refreshPage();
    }, 120);
  };
  const channel = client.channel(`workspace:${ownerId}:${crypto.randomUUID()}`);
  for (const table of tables) {
    for (const event of ["INSERT", "UPDATE"] as const) {
      channel.on(
        "postgres_changes",
        { event, schema: "public", table, filter: `owner_id=eq.${ownerId}` },
        refresh,
      );
    }
  }
  const ready = (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (disposed) return;
      if (error || !data.session) {
        onStatus("offline");
        return;
      }
      await client.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      channel.subscribe((state) => {
        if (disposed) return;
        if (state === "SUBSCRIBED") {
          onStatus("connected");
          refresh();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) onStatus("offline");
      });
    } catch {
      if (!disposed) onStatus("offline");
    }
  })();
  const online = () => {
    if (!disposed) reconnect();
  };
  const offline = () => {
    if (!disposed) onStatus("offline");
  };
  const visible = () => {
    if (documentEvents.visibilityState === "visible") refresh();
  };
  windowEvents.addEventListener("online", online);
  windowEvents.addEventListener("offline", offline);
  windowEvents.addEventListener("focus", refresh);
  documentEvents.addEventListener("visibilitychange", visible);
  return {
    ready,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      void client.removeChannel(channel);
      windowEvents.removeEventListener("online", online);
      windowEvents.removeEventListener("offline", offline);
      windowEvents.removeEventListener("focus", refresh);
      documentEvents.removeEventListener("visibilitychange", visible);
    },
  };
}
