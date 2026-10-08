import { getRecipeSummaries, getPreparationView } from "@/lib/data";
import { PreparationView } from "@/components/preparation";
export default async function Prepare() {
  const [recipes, preparation] = await Promise.all([getRecipeSummaries(), getPreparationView()]);
  return (
    <PreparationView
      recipes={recipes}
      selections={preparation.selections}
      activeListId={preparation.active_list_id}
    />
  );
}
