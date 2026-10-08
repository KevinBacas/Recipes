import type { Database } from "./database.types";

// Keep nullability and additions to the generated snapshot in this maintained adapter.
// SQL/TypeScript contract tests validate these extensions against every migration.
type Functions = Database["public"]["Functions"];
type NullableArgs<K extends keyof Functions, P extends keyof Functions[K]["Args"]> = Omit<
  Functions[K],
  "Args"
> & {
  Args: Omit<Functions[K]["Args"], P> & { [Key in P]: Functions[K]["Args"][Key] | null };
};
export type AppDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions" | "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "recipes"> & {
      recipes: Omit<Database["public"]["Tables"]["recipes"], "Row" | "Insert" | "Update"> & {
        Row: Database["public"]["Tables"]["recipes"]["Row"] & {
          creation_fingerprint: string | null;
        };
        Insert: Database["public"]["Tables"]["recipes"]["Insert"] & {
          creation_fingerprint?: string | null;
        };
        Update: Database["public"]["Tables"]["recipes"]["Update"] & {
          creation_fingerprint?: string | null;
        };
      };
    };
    Functions: Omit<Functions, "save_recipe" | "save_selection" | "replace_shopping_list"> & {
      save_recipe: Omit<
        NullableArgs<"save_recipe", "p_id" | "p_expected_revision" | "p_photo_path">,
        "Args"
      > & {
        Args: NullableArgs<
          "save_recipe",
          "p_id" | "p_expected_revision" | "p_photo_path"
        >["Args"] & { p_creation_id: string | null; p_photo_hash: string | null };
      };
      get_preparation_view: { Args: never; Returns: Functions["get_preparation"]["Returns"] };
      save_selection: NullableArgs<"save_selection", "p_id">;
      replace_shopping_list: NullableArgs<"replace_shopping_list", "p_expected_list_id">;
    };
  };
};
