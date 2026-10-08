-- Upgrade admissible legacy data before the stricter JSON boundary is used.
alter table public.recipes add column creation_fingerprint text;
with repaired as (
  update public.recipes
  set steps = array(select step from unnest(recipes.steps) with ordinality as item(step, position)
                    where step is not null order by position),
      revision = revision + 1
  where array_position(steps, null) is not null
  returning owner_id
)
update public.workspaces set revision = revision + 1
where owner_id in (select owner_id from repaired);

drop function public.save_recipe(uuid, bigint, text, integer, text[], jsonb, text, text);

create function public.save_recipe(
  p_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_servings integer,
  p_steps text[],
  p_ingredients jsonb,
  p_photo_action text,
  p_photo_path text,
  p_creation_id uuid default null,
  p_photo_hash text default null
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
  creation_fingerprint text;
  existing_fingerprint text;
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

    creation_fingerprint := md5(jsonb_build_object(
      'title', p_title, 'servings', p_servings, 'steps', p_steps,
      'ingredients', p_ingredients, 'photo_action', p_photo_action, 'photo_hash', p_photo_hash
    )::text);
    if p_creation_id is not null then
      select recipes.id, recipes.creation_fingerprint, recipes.photo_path
      into recipe_id, existing_fingerprint, resulting_photo_path
      from public.recipes
      where recipes.id = p_creation_id and recipes.owner_id = account_id;
      if found then
        if existing_fingerprint is distinct from creation_fingerprint then
          raise exception 'CREATE_ATTEMPT_CHANGED';
        end if;
        -- A retry recovers the original result; it never edits a committed recipe.
        return jsonb_build_object('id', recipe_id, 'previous_photo_path', null, 'photo_path', resulting_photo_path);
      end if;
      if p_photo_action = 'replace' then resulting_photo_path := p_photo_path; end if;
    end if;

    insert into public.recipes(id, owner_id, title, servings, steps, photo_path, creation_fingerprint)
    values (coalesce(p_creation_id, gen_random_uuid()), account_id, btrim(p_title), p_servings, p_steps, resulting_photo_path, creation_fingerprint)
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
    'previous_photo_path', case when p_photo_action = 'keep' then null else previous_photo_path end,
    'photo_path', resulting_photo_path
  );
end;
$$;

-- Shared aisle changes are visible edits in every recipe that references the ingredient.
create function public.invalidate_recipes_for_aisle_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.recipes set revision = revision + 1
  where recipes.owner_id = new.owner_id
    and exists (select 1 from public.recipe_ingredients
                where recipe_ingredients.recipe_id = recipes.id
                  and recipe_ingredients.owner_id = new.owner_id
                  and recipe_ingredients.ingredient_id = new.id);
  return new;
end;
$$;
revoke all on function public.invalidate_recipes_for_aisle_change() from public, anon, authenticated;
create trigger ingredient_aisle_recipe_revisions after update of aisle on public.ingredients
for each row when (old.aisle is distinct from new.aisle)
execute function public.invalidate_recipes_for_aisle_change();

-- The preparation screen needs neither quantities nor the shopping-list snapshot.
create function public.get_preparation_view()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'active_list_id', (select shopping_lists.id from public.shopping_lists where owner_id = (select auth.uid())),
    'selections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', selections.id, 'servings', selections.servings,
        'recipe', jsonb_build_object(
          'id', recipes.id, 'title', recipes.title, 'servings', recipes.servings,
          'ingredient_count', (select count(*)::integer from public.recipe_ingredients where recipe_id = recipes.id)
        )
      ) order by selections.created_at, selections.id)
      from public.meal_selections as selections
      join public.recipes on recipes.id = selections.recipe_id and recipes.owner_id = selections.owner_id
      where selections.owner_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.save_recipe(uuid, bigint, text, integer, text[], jsonb, text, text, uuid, text),
  public.get_preparation_view() from public, anon;
grant execute on function public.save_recipe(uuid, bigint, text, integer, text[], jsonb, text, text, uuid, text),
  public.get_preparation_view() to authenticated;
