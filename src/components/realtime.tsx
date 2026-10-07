"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function RealtimeRefresh({ ownerId, tables }: { ownerId: string; tables: string[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tableKey = tables.join(",");
  useEffect(() => {
    const client = createClient();
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (disposed) return; clearTimeout(timeout); timeout = setTimeout(() => router.refresh(), 120); };
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
        if (error || !data.session) { setStatus("offline"); return; }
        await client.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        channel.subscribe(state => {
          if (disposed) return;
          if (state === "SUBSCRIBED") { setStatus("connected"); refresh(); }
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("offline");
        });
      } catch { if (!disposed) setStatus("offline"); }
    })();
    const online = () => { setStatus("connecting"); setConnectionAttempt(attempt => attempt + 1); refresh(); };
    const offline = () => setStatus("offline");
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; clearTimeout(timeout); void client.removeChannel(channel); window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [ownerId, tableKey, router, connectionAttempt]);
  if (status === "connected") return <div className="sync-label"><RefreshCw size={12}/> Partagé entre vos appareils</div>;
  if (status === "connecting") return <div className="sync-label"><RefreshCw size={12}/> Connexion au partage…</div>;
  return <div className="connection-warning" role="status"><WifiOff size={16}/><span>Partage en pause. Vérifiez votre connexion.</span><button className="text-button" type="button" onClick={() => { setStatus("connecting"); setConnectionAttempt(attempt => attempt + 1); router.refresh(); }}>Actualiser</button></div>;
}
