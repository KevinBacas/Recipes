import { authenticatedClient } from "@/lib/data";
import { Shell } from "@/components/shell";
import { RealtimeRefresh } from "@/components/realtime";
export const dynamic = "force-dynamic";
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const { ownerId } = await authenticatedClient();
  return (
    <Shell>
      {children}
      <RealtimeRefresh
        ownerId={ownerId}
        tables={["workspaces", "shopping_lists", "shopping_items"]}
      />
    </Shell>
  );
}
