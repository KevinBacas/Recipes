-- NULL must not bypass optimistic concurrency validation through the RPC API.
create or replace function public.replace_shopping_list(p_revision bigint, p_expected_list_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace(); current_list_id uuid; new_list_id uuid; item jsonb; selected_count integer;
begin
  if p_revision is null or (select revision from public.workspaces where owner_id = account_id) <> p_revision then raise exception 'PLAN_CHANGED'; end if;
  select id into current_list_id from public.shopping_lists where owner_id = account_id;
  if current_list_id is distinct from p_expected_list_id then raise exception 'LIST_CHANGED'; end if;
  select count(*) into selected_count from public.meal_selections where owner_id = account_id;
  if selected_count = 0 then raise exception 'EMPTY_PLAN'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'INVALID_INGREDIENTS'; end if;
  delete from public.shopping_lists where owner_id = account_id;
  insert into public.shopping_lists(owner_id, dish_count) values(account_id, selected_count) returning id into new_list_id;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.shopping_items(list_id, owner_id, ingredient_id, name, aisle, quantity, unit)
    values(new_list_id, account_id, (item->>'ingredient_id')::uuid, item->>'name', item->>'aisle', (item->>'quantity')::numeric, item->>'unit');
  end loop;
  return new_list_id;
end;
$$;
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients(ingredient_id, owner_id);
create index selections_recipe_idx on public.meal_selections(recipe_id, owner_id);
create index shopping_items_ingredient_idx on public.shopping_items(ingredient_id, owner_id);
