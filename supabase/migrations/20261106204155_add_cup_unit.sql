-- Cups keep their original measure; no automatic conversion to mass or volume.
-- Quantity, ownership and access constraints remain unchanged.
alter table public.recipe_ingredients
  drop constraint recipe_ingredients_unit_check,
  add constraint recipe_ingredients_unit_check
    check (unit in ('g', 'kg', 'ml', 'cl', 'l', 'cup', 'piece', 'tbsp', 'tsp', 'pinch', 'to_taste'));

alter table public.shopping_items
  drop constraint shopping_items_unit_check,
  add constraint shopping_items_unit_check
    check (unit in ('g', 'kg', 'ml', 'cl', 'l', 'cup', 'piece', 'tbsp', 'tsp', 'pinch', 'to_taste'));
