import { getShoppingList } from "@/lib/data";
import { ShoppingListView } from "@/components/shopping-list";
export default async function Shopping() {
  return <ShoppingListView list={await getShoppingList()}/>;
}
