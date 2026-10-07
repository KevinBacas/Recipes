-- Shared-account application. Every record belongs to an authenticated user.
create table public.workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  aisle text not null check (aisle in ('produce','meat','fish','dairy','bakery','pantry','sweet','frozen','drinks','other')),
  unique(owner_id, normalized_name), unique(id, owner_id)
);
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  servings integer not null check (servings between 1 and 1000),
  steps text[] not null default '{}',
  photo_path text check (photo_path is null or photo_path like owner_id::text || '/%'),
  created_at timestamptz not null default now(),
  unique(id, owner_id)
);
create table public.recipe_ingredients (
  recipe_id uuid not null,
  owner_id uuid not null,
  ingredient_id uuid not null,
  position integer not null check (position >= 0),
  quantity numeric check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('g','kg','ml','cl','l','piece','tbsp','tsp','pinch','to_taste')),
  check ((unit = 'to_taste' and quantity is null) or (unit <> 'to_taste' and quantity is not null)),
  primary key (recipe_id, position),
  foreign key (recipe_id, owner_id) references public.recipes(id, owner_id) on delete cascade,
  foreign key (ingredient_id, owner_id) references public.ingredients(id, owner_id)
);
create table public.meal_selections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  recipe_id uuid not null,
  servings integer not null check (servings between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (recipe_id, owner_id) references public.recipes(id, owner_id) on delete cascade
);
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  dish_count integer not null check (dish_count > 0),
  unique(id, owner_id)
);
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  owner_id uuid not null,
  ingredient_id uuid not null,
  name text not null,
  aisle text not null check (aisle in ('produce','meat','fish','dairy','bakery','pantry','sweet','frozen','drinks','other')),
  quantity numeric check (quantity > 0),
  unit text not null check (unit in ('g','kg','ml','cl','l','piece','tbsp','tsp','pinch','to_taste')),
  checked boolean not null default false,
  check ((unit = 'to_taste' and quantity is null) or (unit <> 'to_taste' and quantity is not null)),
  foreign key (list_id, owner_id) references public.shopping_lists(id, owner_id) on delete cascade,
  foreign key (ingredient_id, owner_id) references public.ingredients(id, owner_id),
  unique (list_id, ingredient_id, unit)
);
create index recipes_owner_idx on public.recipes(owner_id);
create index recipe_ingredients_owner_idx on public.recipe_ingredients(owner_id);
create index selections_owner_idx on public.meal_selections(owner_id);
create index shopping_items_owner_idx on public.shopping_items(owner_id, list_id);

alter table public.workspaces enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.meal_selections enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

create policy own_workspace on public.workspaces for select to authenticated using (owner_id = (select auth.uid()));
create policy own_ingredients on public.ingredients for select to authenticated using (owner_id = (select auth.uid()));
create policy own_recipes on public.recipes for select to authenticated using (owner_id = (select auth.uid()));
create policy own_recipe_ingredients on public.recipe_ingredients for select to authenticated using (owner_id = (select auth.uid()));
create policy own_selections on public.meal_selections for select to authenticated using (owner_id = (select auth.uid()));
create policy own_lists on public.shopping_lists for select to authenticated using (owner_id = (select auth.uid()));
create policy own_items on public.shopping_items for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.workspaces, public.ingredients, public.recipes, public.recipe_ingredients,
  public.meal_selections, public.shopping_lists, public.shopping_items from anon, authenticated;
grant select on public.workspaces, public.ingredients, public.recipes, public.recipe_ingredients,
  public.meal_selections, public.shopping_lists, public.shopping_items to authenticated;

-- All mutations take this lock first: preparation revisions and replacement are atomic.
create function public.lock_workspace() returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := auth.uid();
begin
  if account_id is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.workspaces(owner_id) values (account_id) on conflict do nothing;
  perform 1 from public.workspaces where owner_id = account_id for update;
  return account_id;
end;
$$;
revoke all on function public.lock_workspace() from public, anon, authenticated;

create function public.save_recipe(p_id uuid, p_title text, p_servings integer, p_steps text[], p_ingredients jsonb, p_photo_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace(); recipe_id uuid; ingredient jsonb; ingredient_id uuid; ingredient_position integer := 0;
begin
  if p_steps is null or cardinality(p_steps) > 100 or exists(select 1 from unnest(p_steps) step where length(btrim(step)) not between 1 and 4000) then raise exception 'INVALID_STEPS'; end if;
  if p_ingredients is null or jsonb_typeof(p_ingredients) <> 'array' or jsonb_array_length(p_ingredients) not between 1 and 200 then raise exception 'INVALID_INGREDIENTS'; end if;
  if p_id is null then
    insert into public.recipes(owner_id, title, servings, steps, photo_path) values(account_id, btrim(p_title), p_servings, p_steps, p_photo_path) returning id into recipe_id;
  else
    update public.recipes set title = btrim(p_title), servings = p_servings, steps = p_steps, photo_path = p_photo_path where id = p_id and owner_id = account_id returning id into recipe_id;
    if recipe_id is null then raise exception 'NOT_FOUND'; end if;
    delete from public.recipe_ingredients where recipe_ingredients.recipe_id = p_id and owner_id = account_id;
  end if;
  for ingredient in select value from jsonb_array_elements(p_ingredients) loop
    ingredient_id := null;
    if nullif(ingredient->>'ingredient_id', '') is not null then
      update public.ingredients set aisle = ingredient->>'aisle' where id = (ingredient->>'ingredient_id')::uuid and owner_id = account_id returning id into ingredient_id;
      if ingredient_id is null then raise exception 'NOT_FOUND'; end if;
    else
      insert into public.ingredients(owner_id, name, aisle) values(account_id, btrim(ingredient->>'name'), ingredient->>'aisle')
      on conflict(owner_id, normalized_name) do update set aisle = excluded.aisle returning id into ingredient_id;
    end if;
    insert into public.recipe_ingredients(recipe_id, owner_id, ingredient_id, position, quantity, unit)
      values(recipe_id, account_id, ingredient_id, ingredient_position, (ingredient->>'quantity')::numeric, ingredient->>'unit');
    ingredient_position := ingredient_position + 1;
  end loop;
  update public.workspaces set revision = revision + 1 where owner_id = account_id;
  return recipe_id;
end;
$$;

create function public.delete_recipe(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace();
begin
  delete from public.recipes where id = p_id and owner_id = account_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.workspaces set revision = revision + 1 where owner_id = account_id;
end;
$$;
create function public.save_selection(p_id uuid, p_recipe_id uuid, p_servings integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace(); selection_id uuid;
begin
  if not exists(select 1 from public.recipes where id = p_recipe_id and owner_id = account_id) then raise exception 'NOT_FOUND'; end if;
  if p_id is null then
    insert into public.meal_selections(owner_id, recipe_id, servings) values(account_id, p_recipe_id, p_servings) returning id into selection_id;
  else
    update public.meal_selections set recipe_id = p_recipe_id, servings = p_servings where id = p_id and owner_id = account_id returning id into selection_id;
    if selection_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  update public.workspaces set revision = revision + 1 where owner_id = account_id;
  return selection_id;
end;
$$;
create function public.delete_selection(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace();
begin
  delete from public.meal_selections where id = p_id and owner_id = account_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.workspaces set revision = revision + 1 where owner_id = account_id;
end;
$$;

-- Security-invoker readers: SELECT privileges and RLS also apply inside these functions.
create function public.get_recipes() returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(r.data order by r.created_at desc), '[]'::jsonb) from (
    select recipes.created_at, jsonb_build_object('id', recipes.id, 'title', title, 'servings', servings, 'steps', steps, 'photo_path', photo_path, 'created_at', recipes.created_at,
      'ingredients', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', i.id, 'name', i.name, 'aisle', i.aisle, 'quantity', ri.quantity, 'unit', ri.unit) order by ri.position)
      from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id and i.owner_id = ri.owner_id where ri.recipe_id = recipes.id), '[]'::jsonb)) data
    from public.recipes where owner_id = auth.uid()
  ) r;
$$;
create function public.get_preparation() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('revision', coalesce((select revision from public.workspaces where owner_id = auth.uid()), 0),
    'selections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'servings', s.servings, 'recipe', r.value) order by s.created_at, s.id)
    from public.meal_selections s join jsonb_array_elements(public.get_recipes()) r(value) on (r.value->>'id')::uuid = s.recipe_id where s.owner_id = auth.uid()), '[]'::jsonb));
$$;
create function public.get_shopping_list() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'created_at', l.created_at, 'dish_count', l.dish_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'list_id', i.list_id, 'ingredient_id', i.ingredient_id, 'name', i.name, 'aisle', i.aisle, 'quantity', i.quantity, 'unit', i.unit, 'checked', i.checked) order by i.name, i.unit)
    from public.shopping_items i where i.list_id = l.id), '[]'::jsonb))
  from public.shopping_lists l where l.owner_id = auth.uid();
$$;

create function public.replace_shopping_list(p_revision bigint, p_expected_list_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace(); current_list_id uuid; new_list_id uuid; item jsonb; selected_count integer;
begin
  if (select revision from public.workspaces where owner_id = account_id) <> p_revision then raise exception 'PLAN_CHANGED'; end if;
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
create function public.set_shopping_item_checked(p_id uuid, p_list_id uuid, p_checked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := public.lock_workspace();
begin
  update public.shopping_items set checked = p_checked where id = p_id and list_id = p_list_id and owner_id = account_id;
  if not found then raise exception 'LIST_CHANGED'; end if;
end;
$$;

revoke all on function public.save_recipe(uuid,text,integer,text[],jsonb,text), public.delete_recipe(uuid),
  public.save_selection(uuid,uuid,integer), public.delete_selection(uuid), public.replace_shopping_list(bigint,uuid,jsonb),
  public.set_shopping_item_checked(uuid,uuid,boolean), public.get_recipes(), public.get_preparation(), public.get_shopping_list() from public, anon;
grant execute on function public.save_recipe(uuid,text,integer,text[],jsonb,text), public.delete_recipe(uuid),
  public.save_selection(uuid,uuid,integer), public.delete_selection(uuid), public.replace_shopping_list(bigint,uuid,jsonb),
  public.set_shopping_item_checked(uuid,uuid,boolean), public.get_recipes(), public.get_preparation(), public.get_shopping_list() to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('recipe-photos', 'recipe-photos', false, 5242880, array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy own_photo_read on storage.objects for select to authenticated using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy own_photo_insert on storage.objects for insert to authenticated with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy own_photo_delete on storage.objects for delete to authenticated using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter publication supabase_realtime add table public.shopping_lists, public.shopping_items, public.meal_selections, public.recipes;
