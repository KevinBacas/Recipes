-- Photo intent and revision validation belong to the same serialized mutation.
alter table public.recipes
  add column revision bigint not null default 0 check (revision >= 0);

drop function public.save_recipe(uuid, text, integer, text[], jsonb, text);

create function public.save_recipe(
  p_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_servings integer,
  p_steps text[],
  p_ingredients jsonb,
  p_photo_action text,
  p_photo_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := public.lock_workspace();
  recipe_id uuid;
  previous_photo_path text;
  current_revision bigint;
  ingredient jsonb;
  ingredient_id uuid;
  ingredient_position integer := 0;
  resulting_photo_path text;
begin
  if p_steps is null
    or cardinality(p_steps) > 100
    or exists (
      select 1
      from unnest(p_steps) as item(step)
      where item.step is null or length(btrim(item.step)) not between 1 and 4000
    )
  then
    raise exception 'INVALID_STEPS';
  end if;

  if p_ingredients is null
    or jsonb_typeof(p_ingredients) <> 'array'
    or jsonb_array_length(p_ingredients) not between 1 and 200
  then
    raise exception 'INVALID_INGREDIENTS';
  end if;

  if p_photo_action is null or p_photo_action not in ('keep', 'replace', 'remove') then
    raise exception 'INVALID_PHOTO_ACTION';
  end if;

  if p_photo_action = 'replace' then
    if p_photo_path is null or p_photo_path not like account_id::text || '/%' then
      raise exception 'INVALID_PHOTO_PATH';
    end if;
    resulting_photo_path := p_photo_path;
  elsif p_photo_path is not null then
    raise exception 'INVALID_PHOTO_PATH';
  end if;

  if p_id is null then
    if p_expected_revision is not null then raise exception 'INVALID_REVISION'; end if;

    insert into public.recipes(owner_id, title, servings, steps, photo_path)
    values (account_id, btrim(p_title), p_servings, p_steps, resulting_photo_path)
    returning id into recipe_id;
  else
    select recipes.photo_path, recipes.revision
    into previous_photo_path, current_revision
    from public.recipes
    where recipes.id = p_id and recipes.owner_id = account_id
    for update;

    if not found then raise exception 'NOT_FOUND'; end if;
    if p_expected_revision is null or p_expected_revision <> current_revision then
      raise exception 'RECIPE_CHANGED';
    end if;

    if p_photo_action = 'keep' then resulting_photo_path := previous_photo_path; end if;

    update public.recipes
    set title = btrim(p_title),
        servings = p_servings,
        steps = p_steps,
        photo_path = resulting_photo_path,
        revision = revision + 1
    where recipes.id = p_id and recipes.owner_id = account_id
    returning id into recipe_id;

    delete from public.recipe_ingredients
    where recipe_ingredients.recipe_id = p_id and recipe_ingredients.owner_id = account_id;
  end if;

  for ingredient in select value from jsonb_array_elements(p_ingredients) loop
    ingredient_id := null;

    if nullif(ingredient->>'ingredient_id', '') is not null then
      update public.ingredients
      set aisle = ingredient->>'aisle'
      where id = (ingredient->>'ingredient_id')::uuid and owner_id = account_id
      returning id into ingredient_id;

      if ingredient_id is null then raise exception 'NOT_FOUND'; end if;
    else
      insert into public.ingredients(owner_id, name, aisle)
      values (account_id, btrim(ingredient->>'name'), ingredient->>'aisle')
      on conflict(owner_id, normalized_name)
      do update set aisle = excluded.aisle
      returning id into ingredient_id;
    end if;

    insert into public.recipe_ingredients(recipe_id, owner_id, ingredient_id, position, quantity, unit)
    values (
      recipe_id,
      account_id,
      ingredient_id,
      ingredient_position,
      (ingredient->>'quantity')::numeric,
      ingredient->>'unit'
    );
    ingredient_position := ingredient_position + 1;
  end loop;

  update public.workspaces set revision = revision + 1 where owner_id = account_id;

  return jsonb_build_object(
    'id', recipe_id,
    'previous_photo_path', previous_photo_path
  );
end;
$$;

drop function public.delete_recipe(uuid);

create function public.delete_recipe(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := public.lock_workspace();
  deleted_photo_path text;
begin
  delete from public.recipes
  where id = p_id and owner_id = account_id
  returning photo_path into deleted_photo_path;

  if not found then raise exception 'NOT_FOUND'; end if;

  update public.workspaces set revision = revision + 1 where owner_id = account_id;
  return jsonb_build_object('photo_path', deleted_photo_path);
end;
$$;

-- Return only the current record to recipe detail and edit routes.
create function public.get_recipe(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', recipes.id,
    'title', recipes.title,
    'servings', recipes.servings,
    'steps', recipes.steps,
    'photo_path', recipes.photo_path,
    'created_at', recipes.created_at,
    'revision', recipes.revision,
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ingredient_id', ingredients.id,
        'name', ingredients.name,
        'aisle', ingredients.aisle,
        'quantity', recipe_ingredients.quantity,
        'unit', recipe_ingredients.unit
      ) order by recipe_ingredients.position)
      from public.recipe_ingredients
      join public.ingredients
        on ingredients.id = recipe_ingredients.ingredient_id
        and ingredients.owner_id = recipe_ingredients.owner_id
      where recipe_ingredients.recipe_id = recipes.id
    ), '[]'::jsonb)
  )
  from public.recipes
  where recipes.id = p_id and recipes.owner_id = (select auth.uid());
$$;

create function public.get_recipe_summaries()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recipes.id,
    'title', recipes.title,
    'servings', recipes.servings,
    'ingredient_count', (
      select count(*)::integer
      from public.recipe_ingredients
      where recipe_ingredients.recipe_id = recipes.id
    )
  ) order by recipes.created_at desc), '[]'::jsonb)
  from public.recipes
  where recipes.owner_id = (select auth.uid());
$$;

-- Preparation pages receive only the fields used for selecting and calculating dishes.
create or replace function public.get_preparation()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'revision', coalesce((
      select workspaces.revision from public.workspaces where workspaces.owner_id = (select auth.uid())
    ), 0),
    'selections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', selections.id,
        'servings', selections.servings,
        'recipe', jsonb_build_object(
          'id', recipes.id,
          'title', recipes.title,
          'servings', recipes.servings,
          'ingredients', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ingredient_id', ingredients.id,
              'name', ingredients.name,
              'aisle', ingredients.aisle,
              'quantity', recipe_ingredients.quantity,
              'unit', recipe_ingredients.unit
            ) order by recipe_ingredients.position)
            from public.recipe_ingredients
            join public.ingredients
              on ingredients.id = recipe_ingredients.ingredient_id
              and ingredients.owner_id = recipe_ingredients.owner_id
            where recipe_ingredients.recipe_id = recipes.id
          ), '[]'::jsonb)
        )
      ) order by selections.created_at, selections.id)
      from public.meal_selections as selections
      join public.recipes on recipes.id = selections.recipe_id and recipes.owner_id = selections.owner_id
      where selections.owner_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

-- Updated records expose the revision used for optimistic conflict detection.
create or replace function public.get_recipes()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(r.data order by r.created_at desc), '[]'::jsonb)
  from (
    select recipes.created_at, jsonb_build_object(
      'id', recipes.id,
      'title', recipes.title,
      'servings', recipes.servings,
      'steps', recipes.steps,
      'photo_path', recipes.photo_path,
      'created_at', recipes.created_at,
      'revision', recipes.revision,
      'ingredients', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ingredient_id', ingredients.id,
          'name', ingredients.name,
          'aisle', ingredients.aisle,
          'quantity', recipe_ingredients.quantity,
          'unit', recipe_ingredients.unit
        ) order by recipe_ingredients.position)
        from public.recipe_ingredients
        join public.ingredients
          on ingredients.id = recipe_ingredients.ingredient_id
          and ingredients.owner_id = recipe_ingredients.owner_id
        where recipe_ingredients.recipe_id = recipes.id
      ), '[]'::jsonb)
    ) data
    from public.recipes
    where recipes.owner_id = (select auth.uid())
  ) r;
$$;

revoke all on function public.save_recipe(uuid, bigint, text, integer, text[], jsonb, text, text),
  public.delete_recipe(uuid), public.get_recipe(uuid), public.get_recipe_summaries()
  from public, anon;
grant execute on function public.save_recipe(uuid, bigint, text, integer, text[], jsonb, text, text),
  public.delete_recipe(uuid), public.get_recipe(uuid), public.get_recipe_summaries()
  to authenticated;
