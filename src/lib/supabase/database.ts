import type { Database } from "./database.types";

// Postgres accepts NULL for these RPC arguments. Generated types cannot infer that.
type Functions = Database["public"]["Functions"];
type NullableArgs<K extends keyof Functions, P extends keyof Functions[K]["Args"]> = Omit<Functions[K], "Args"> & {
  Args: Omit<Functions[K]["Args"], P> & { [Key in P]: Functions[K]["Args"][Key] | null };
};
export type AppDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Omit<Functions, "save_recipe" | "save_selection" | "replace_shopping_list"> & {
      save_recipe: NullableArgs<"save_recipe", "p_id" | "p_photo_path">;
      save_selection: NullableArgs<"save_selection", "p_id">;
      replace_shopping_list: NullableArgs<"replace_shopping_list", "p_expected_list_id">;
    };
  };
};
