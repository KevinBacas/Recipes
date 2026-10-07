export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ingredients: {
        Row: {
          aisle: string
          id: string
          name: string
          normalized_name: string | null
          owner_id: string
        }
        Insert: {
          aisle: string
          id?: string
          name: string
          normalized_name?: string | null
          owner_id: string
        }
        Update: {
          aisle?: string
          id?: string
          name?: string
          normalized_name?: string | null
          owner_id?: string
        }
        Relationships: []
      }
      meal_selections: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          recipe_id: string
          servings: number
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          recipe_id: string
          servings: number
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          recipe_id?: string
          servings?: number
        }
        Relationships: [
          {
            foreignKeyName: "meal_selections_recipe_id_owner_id_fkey"
            columns: ["recipe_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          ingredient_id: string
          owner_id: string
          position: number
          quantity: number | null
          recipe_id: string
          unit: string
        }
        Insert: {
          ingredient_id: string
          owner_id: string
          position: number
          quantity?: number | null
          recipe_id: string
          unit: string
        }
        Update: {
          ingredient_id?: string
          owner_id?: string
          position?: number
          quantity?: number | null
          recipe_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_owner_id_fkey"
            columns: ["ingredient_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_owner_id_fkey"
            columns: ["recipe_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          photo_path: string | null
          servings: number
          steps: string[]
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          photo_path?: string | null
          servings: number
          steps?: string[]
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          photo_path?: string | null
          servings?: number
          steps?: string[]
          title?: string
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          aisle: string
          checked: boolean
          id: string
          ingredient_id: string
          list_id: string
          name: string
          owner_id: string
          quantity: number | null
          unit: string
        }
        Insert: {
          aisle: string
          checked?: boolean
          id?: string
          ingredient_id: string
          list_id: string
          name: string
          owner_id: string
          quantity?: number | null
          unit: string
        }
        Update: {
          aisle?: string
          checked?: boolean
          id?: string
          ingredient_id?: string
          list_id?: string
          name?: string
          owner_id?: string
          quantity?: number | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_ingredient_id_owner_id_fkey"
            columns: ["ingredient_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "shopping_items_list_id_owner_id_fkey"
            columns: ["list_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          dish_count: number
          id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          dish_count: number
          id?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          dish_count?: number
          id?: string
          owner_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          owner_id: string
          revision: number
        }
        Insert: {
          owner_id: string
          revision?: number
        }
        Update: {
          owner_id?: string
          revision?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_recipe: { Args: { p_id: string }; Returns: undefined }
      delete_selection: { Args: { p_id: string }; Returns: undefined }
      get_preparation: { Args: never; Returns: Json }
      get_recipes: { Args: never; Returns: Json }
      get_shopping_list: { Args: never; Returns: Json }
      lock_workspace: { Args: never; Returns: string }
      replace_shopping_list: {
        Args: { p_expected_list_id: string; p_items: Json; p_revision: number }
        Returns: string
      }
      save_recipe: {
        Args: {
          p_id: string
          p_ingredients: Json
          p_photo_path: string
          p_servings: number
          p_steps: string[]
          p_title: string
        }
        Returns: string
      }
      save_selection: {
        Args: { p_id: string; p_recipe_id: string; p_servings: number }
        Returns: string
      }
      set_shopping_item_checked: {
        Args: { p_checked: boolean; p_id: string; p_list_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

