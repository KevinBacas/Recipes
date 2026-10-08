"use client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { WifiOff, RefreshCw } from "lucide-react";

export function RealtimeRefresh({ ownerId, tables }: { ownerId: string; tables: string[] }) {
  const { status, reconnect } = useRealtimeRefresh(ownerId, tables);
  if (status === "connected") return <div className="sync-label"><RefreshCw size={12}/> Partagé entre vos appareils</div>;
  if (status === "connecting") return <div className="sync-label"><RefreshCw size={12}/> Connexion au partage…</div>;
  return <div className="connection-warning" role="status"><WifiOff size={16}/><span>Partage en pause. Vérifiez votre connexion.</span><button className="text-button" type="button" onClick={reconnect}>Actualiser</button></div>;
}
