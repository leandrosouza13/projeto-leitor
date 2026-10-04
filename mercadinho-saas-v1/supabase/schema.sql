-- Esquema do MercadoFlow para trabalhar com várias lojas no Supabase.
-- Execute este arquivo no editor SQL antes de conectar a aplicação ao projeto.

-- Extensão usada para gerar identificadores UUID no banco.
create extension if not exists pgcrypto;

-- Lojas, membros e preferências gerais de cada loja.
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner','admin','operator','read_only')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table if not exists public.store_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  target_margin numeric(5,2) not null default 35 check (target_margin > 0 and target_margin < 100),
  sales_tax_rate numeric(6,3) not null default 0 check (sales_tax_rate >= 0 and sales_tax_rate <= 100),
  sales_fee_rate numeric(6,3) not null default 0 check (sales_fee_rate >= 0 and sales_fee_rate <= 100),
  expected_loss_rate numeric(6,3) not null default 0 check (expected_loss_rate >= 0 and expected_loss_rate <= 100),
  pricing_configured boolean not null default false,
  currency_code text not null default 'BRL' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_settings_price_denominator_positive
    check (target_margin + sales_tax_rate + sales_fee_rate < 100)
);

alter table public.store_settings
  add column if not exists sales_tax_rate numeric(6,3) not null default 0 check (sales_tax_rate >= 0 and sales_tax_rate <= 100),
  add column if not exists sales_fee_rate numeric(6,3) not null default 0 check (sales_fee_rate >= 0 and sales_fee_rate <= 100),
  add column if not exists expected_loss_rate numeric(6,3) not null default 0 check (expected_loss_rate >= 0 and expected_loss_rate <= 100),
  add column if not exists pricing_configured boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_settings_price_denominator_positive'
      and conrelid = 'public.store_settings'::regclass
  ) then
    alter table public.store_settings
      add constraint store_settings_price_denominator_positive
      check (target_margin + sales_tax_rate + sales_fee_rate < 100);
  end if;
end;
$$;

-- Cadastro de fornecedores e catálogo compartilhado dentro de cada loja.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 240),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, cnpj)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 240),
  category text,
  sku text,
  planogram_product_id text,
  shelf_capacity numeric(14,3) not null default 0 check (shelf_capacity >= 0),
  planogram_type text,
  current_purchase_cost numeric(14,4) not null default 0 check (current_purchase_cost >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  target_stock numeric(14,3) not null default 0 check (target_stock >= 0),
  average_daily_sales numeric(14,3) not null default 0 check (average_daily_sales >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id)
);

alter table public.products
  add column if not exists planogram_product_id text,
  add column if not exists shelf_capacity numeric(14,3) not null default 0 check (shelf_capacity >= 0),
  add column if not exists planogram_type text;

create unique index if not exists products_store_sku_unique
  on public.products (store_id, lower(trim(sku))) where sku is not null and trim(sku) <> '';
create unique index if not exists products_store_planogram_id_unique
  on public.products (store_id, planogram_product_id)
  where planogram_product_id is not null and trim(planogram_product_id) <> '';
create unique index if not exists products_store_normalized_name_unique
  on public.products (store_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')))
  where is_active;
create index if not exists products_store_name_idx on public.products (store_id, lower(name));

-- Identificadores adicionais que associam produtos a códigos EAN ou do fornecedor.
create table if not exists public.product_eans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  ean text not null check (ean ~ '^[0-9]{8,14}$'),
  created_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete cascade,
  unique (store_id, ean),
  unique (store_id, product_id, ean)
);

create table if not exists public.product_supplier_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  supplier_id uuid not null,
  supplier_code text not null check (length(trim(supplier_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete cascade,
  foreign key (store_id, supplier_id) references public.suppliers(store_id, id) on delete cascade,
  unique (store_id, supplier_id, supplier_code),
  unique (store_id, product_id, supplier_id, supplier_code)
);

-- Compras e linhas da nota; a chave de acesso identifica notas fiscais sem duplicação.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid,
  invoice_number text,
  invoice_series text,
  invoice_key text check (invoice_key is null or invoice_key ~ '^[0-9]{44}$'),
  issue_date date,
  entry_date date not null default current_date,
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  source text not null check (source in ('xml','pdf','photo','csv','manual')),
  document_path text,
  document_name text,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (store_id, supplier_id) references public.suppliers(store_id, id),
  unique (store_id, id)
);

create unique index if not exists purchases_store_invoice_key_unique
  on public.purchases (store_id, invoice_key) where invoice_key is not null;
create index if not exists purchases_store_issue_date_idx on public.purchases (store_id, issue_date desc);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  purchase_id uuid not null,
  product_id uuid,
  line_number text,
  supplier_code text,
  ean text,
  description text not null,
  ncm text,
  cfop text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text,
  unit_cost numeric(14,4) not null check (unit_cost > 0),
  total_cost numeric(14,2) not null check (total_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (store_id, purchase_id) references public.purchases(store_id, id) on delete cascade,
  foreign key (store_id, product_id) references public.products(store_id, id),
  unique (store_id, purchase_id, id)
);

create index if not exists purchase_items_store_product_idx on public.purchase_items (store_id, product_id);

-- Históricos de custo, preço e alterações para auditoria da operação.
create table if not exists public.cost_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  purchase_id uuid not null,
  purchase_item_id uuid not null unique,
  previous_unit_cost numeric(14,4) not null default 0 check (previous_unit_cost >= 0),
  unit_cost numeric(14,4) not null check (unit_cost > 0),
  quantity numeric(14,3) not null check (quantity > 0),
  supplier_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id),
  foreign key (store_id, purchase_id) references public.purchases(store_id, id) on delete cascade,
  foreign key (store_id, supplier_id) references public.suppliers(store_id, id),
  foreign key (store_id, purchase_id, purchase_item_id)
    references public.purchase_items(store_id, purchase_id, id) on delete cascade
);

create index if not exists cost_history_store_product_date_idx
  on public.cost_history (store_id, product_id, occurred_at desc);
create index if not exists cost_history_store_supplier_date_idx
  on public.cost_history (store_id, supplier_id, occurred_at desc);

create table if not exists public.sale_price_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  previous_price numeric(14,2) not null check (previous_price >= 0),
  new_price numeric(14,2) not null check (new_price >= 0),
  source text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete cascade
);

create index if not exists sale_price_history_store_product_date_idx
  on public.sale_price_history (store_id, product_id, changed_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  source text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists audit_log_store_date_idx on public.audit_log (store_id, changed_at desc);

-- Funções auxiliares e gatilhos que mantêm datas e registram mudanças no catálogo.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at before update on public.stores
for each row execute function public.set_updated_at();
drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at before update on public.store_settings
for each row execute function public.set_updated_at();
drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.log_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_value text := coalesce(nullif(current_setting('app.change_source', true), ''),
    'Edição de produto');
  user_id_value uuid := (select auth.uid());
begin
  if old.current_purchase_cost is distinct from new.current_purchase_cost then
    insert into public.audit_log (
      store_id, entity, entity_id, field_name, old_value, new_value, source, changed_by
    ) values (
      new.store_id, 'product', new.id, 'current_purchase_cost',
      to_jsonb(old.current_purchase_cost), to_jsonb(new.current_purchase_cost), source_value, user_id_value
    );
  end if;
  if old.sale_price is distinct from new.sale_price then
    insert into public.sale_price_history (
      store_id, product_id, previous_price, new_price, source, changed_by
    ) values (
      new.store_id, new.id, old.sale_price, new.sale_price, source_value, user_id_value
    );
    insert into public.audit_log (
      store_id, entity, entity_id, field_name, old_value, new_value, source, changed_by
    ) values (
      new.store_id, 'product', new.id, 'sale_price',
      to_jsonb(old.sale_price), to_jsonb(new.sale_price), source_value, user_id_value
    );
  end if;
  if old.stock is distinct from new.stock then
    insert into public.audit_log (
      store_id, entity, entity_id, field_name, old_value, new_value, source, changed_by
    ) values (
      new.store_id, 'product', new.id, 'stock',
      to_jsonb(old.stock), to_jsonb(new.stock), source_value, user_id_value
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_log_changes on public.products;
create trigger products_log_changes after update on public.products
for each row execute function public.log_product_changes();

-- Verificações de acesso usadas pelas políticas de segurança por linha (RLS).
create or replace function public.has_store_access(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_memberships m
    where m.store_id = target_store_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_store_write_access(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_memberships m
    where m.store_id = target_store_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin','operator')
  );
$$;

-- Cria uma loja e torna o usuário autenticado seu proprietário inicial.
create or replace function public.create_store(store_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_store_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(coalesce(store_name, ''))) not between 1 and 160 then
    raise exception 'Store name must contain 1 to 160 characters';
  end if;
  insert into public.stores (name) values (trim(store_name)) returning id into new_store_id;
  insert into public.store_memberships (store_id, user_id, role)
    values (new_store_id, (select auth.uid()), 'owner');
  insert into public.store_settings (store_id) values (new_store_id);
  return new_store_id;
end;
$$;

create or replace function public.add_store_member(target_store_id uuid, target_user_id uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.store_memberships m
    where m.store_id = target_store_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  ) then
    raise exception 'Only a store owner or admin can manage memberships';
  end if;
  if target_role not in ('admin','operator','read_only') then
    raise exception 'Invalid member role';
  end if;
  if exists (
    select 1 from public.store_memberships m
    where m.store_id = target_store_id and m.user_id = target_user_id and m.role = 'owner'
  ) then
    raise exception 'A store owner cannot be demoted through this function';
  end if;
  insert into public.store_memberships (store_id, user_id, role)
    values (target_store_id, target_user_id, target_role)
    on conflict (store_id, user_id) do update set role = excluded.role;
end;
$$;

-- Confirma a compra numa transação: cabeçalho, itens, estoque e históricos juntos.
create or replace function public.confirm_purchase(purchase_data jsonb, item_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_store_id uuid := (purchase_data->>'store_id')::uuid;
  new_purchase_id uuid;
  supplier_id_value uuid;
  line jsonb;
  product_id_value uuid;
  purchase_item_id uuid;
  previous_cost numeric(14,4);
  quantity_value numeric(14,3);
  unit_cost_value numeric(14,4);
  total_cost_value numeric(14,2);
  user_id_value uuid := (select auth.uid());
begin
  if user_id_value is null or not public.has_store_write_access(target_store_id) then
    raise exception 'Not authorized to write to this store';
  end if;
  if jsonb_typeof(item_data) <> 'array' or jsonb_array_length(item_data) = 0 then
    raise exception 'A purchase must include at least one item';
  end if;
  if purchase_data->>'invoice_key' is not null
     and purchase_data->>'invoice_key' !~ '^[0-9]{44}$' then
    raise exception 'Invalid invoice access key';
  end if;
  if nullif(purchase_data->>'document_path', '') is not null
     and left(purchase_data->>'document_path', length(target_store_id::text) + 1)
       <> target_store_id::text || '/' then
    raise exception 'Purchase document must be stored under its store folder';
  end if;

  if nullif(trim(purchase_data->>'supplier_name'), '') is not null then
    insert into public.suppliers (store_id, name, cnpj)
      values (target_store_id, trim(purchase_data->>'supplier_name'),
        nullif(regexp_replace(coalesce(purchase_data->>'supplier_cnpj', ''), '\D', '', 'g'), ''))
      on conflict (store_id, cnpj) do update
        set name = excluded.name
      returning id into supplier_id_value;
    if supplier_id_value is null then
      select id into supplier_id_value from public.suppliers
      where store_id = target_store_id
        and cnpj = nullif(regexp_replace(coalesce(purchase_data->>'supplier_cnpj', ''), '\D', '', 'g'), '');
    end if;
  end if;

  insert into public.purchases (
    store_id, supplier_id, invoice_number, invoice_series, invoice_key,
    issue_date, entry_date, total_value, source, document_path, document_name, imported_by
  ) values (
    target_store_id, supplier_id_value, nullif(purchase_data->>'invoice_number', ''),
    nullif(purchase_data->>'invoice_series', ''), nullif(purchase_data->>'invoice_key', ''),
    nullif(purchase_data->>'issue_date', '')::date,
    coalesce(nullif(purchase_data->>'entry_date', '')::date, current_date),
    coalesce(nullif(purchase_data->>'total_value', '')::numeric, 0),
    purchase_data->>'source', nullif(purchase_data->>'document_path', ''),
    nullif(purchase_data->>'document_name', ''), user_id_value
  ) returning id into new_purchase_id;

  for line in select value from jsonb_array_elements(item_data)
  loop
    if coalesce(line->>'action', 'match') not in ('match','create','ignore') then
      raise exception 'Invalid purchase item action';
    end if;
    quantity_value := (line->>'quantity')::numeric;
    unit_cost_value := (line->>'unit_cost')::numeric;
    if coalesce(line->>'action', 'match') <> 'ignore'
       and (quantity_value <= 0 or unit_cost_value <= 0) then
      raise exception 'Every purchase item must have a positive quantity and unit cost';
    end if;

    product_id_value := nullif(line->>'product_id', '')::uuid;
    if coalesce(line->>'action', 'match') = 'create' then
      insert into public.products (
        store_id, name, sku, category, current_purchase_cost, sale_price, stock
      ) values (
        target_store_id, trim(line->>'product_name'), nullif(line->>'gtin', ''),
        nullif(line->>'ncm', ''), 0, 0, 0
      ) returning id into product_id_value;
    end if;
    if product_id_value is null and coalesce(line->>'action', 'match') <> 'ignore' then
      raise exception 'Each purchase item must be matched, created, or ignored';
    end if;
    if coalesce(line->>'action', 'match') = 'ignore' then
      continue;
    end if;

    select current_purchase_cost into previous_cost from public.products
      where id = product_id_value and store_id = target_store_id for update;
    if not found then
      raise exception 'Product does not belong to this store';
    end if;

    total_cost_value := coalesce(nullif(line->>'total_cost', '')::numeric, quantity_value * unit_cost_value);
    insert into public.purchase_items (
      store_id, purchase_id, product_id, line_number, supplier_code, ean,
      description, ncm, cfop, quantity, unit, unit_cost, total_cost
    ) values (
      target_store_id, new_purchase_id, product_id_value, nullif(line->>'line_number', ''),
      nullif(line->>'supplier_code', ''), nullif(line->>'ean', ''),
      trim(line->>'description'), nullif(line->>'ncm', ''), nullif(line->>'cfop', ''),
      quantity_value, nullif(line->>'unit', ''), unit_cost_value, total_cost_value
    ) returning id into purchase_item_id;

    perform set_config('app.change_source',
      'NF ' || coalesce(purchase_data->>'invoice_number', purchase_data->>'invoice_key', ''), true);
    update public.products set
      current_purchase_cost = unit_cost_value,
      stock = stock + quantity_value,
      updated_at = now()
    where id = product_id_value and store_id = target_store_id;
    perform set_config('app.change_source', '', true);

    insert into public.cost_history (
      store_id, product_id, purchase_id, purchase_item_id,
      previous_unit_cost, unit_cost, quantity, supplier_id
    ) values (
      target_store_id, product_id_value, new_purchase_id, purchase_item_id,
      previous_cost, unit_cost_value, quantity_value, supplier_id_value
    );

    if supplier_id_value is not null and nullif(line->>'supplier_code', '') is not null then
      insert into public.product_supplier_codes (store_id, product_id, supplier_id, supplier_code)
      values (target_store_id, product_id_value, supplier_id_value, trim(line->>'supplier_code'))
      on conflict (store_id, supplier_id, supplier_code) do nothing;
    end if;
    if nullif(line->>'ean', '') is not null then
      insert into public.product_eans (store_id, product_id, ean)
      values (target_store_id, product_id_value, line->>'ean')
      on conflict (store_id, ean) do nothing;
    end if;

  end loop;

  return new_purchase_id;
end;
$$;

-- Ativa o isolamento por loja e define leituras e gravações permitidas a cada função.
alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.store_settings enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_eans enable row level security;
alter table public.product_supplier_codes enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.cost_history enable row level security;
alter table public.sale_price_history enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists stores_read_member on public.stores;
create policy stores_read_member on public.stores for select to authenticated
  using (public.has_store_access(id));
drop policy if exists memberships_read_self_or_store_admin on public.store_memberships;
create policy memberships_read_self_or_store_admin on public.store_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.has_store_access(store_id));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'store_settings','suppliers','products'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_store_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_store_access(store_id))',
      table_name || '_store_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_store_write', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_store_write_access(store_id)) with check (public.has_store_write_access(store_id))',
      table_name || '_store_write', table_name);
  end loop;
  foreach table_name in array array[
    'purchases','purchase_items','cost_history','sale_price_history'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_store_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_store_access(store_id))',
      table_name || '_store_read', table_name);
  end loop;
end;
$$;

drop policy if exists audit_log_store_read on public.audit_log;
create policy audit_log_store_read on public.audit_log for select to authenticated
  using (public.has_store_access(store_id));

drop policy if exists product_eans_store_read on public.product_eans;
create policy product_eans_store_read on public.product_eans for select to authenticated
  using (public.has_store_access(store_id));
drop policy if exists product_eans_store_write on public.product_eans;
create policy product_eans_store_write on public.product_eans for all to authenticated
  using (public.has_store_write_access(store_id)) with check (public.has_store_write_access(store_id));
drop policy if exists product_supplier_codes_store_read on public.product_supplier_codes;
create policy product_supplier_codes_store_read on public.product_supplier_codes for select to authenticated
  using (public.has_store_access(store_id));
drop policy if exists product_supplier_codes_store_write on public.product_supplier_codes;
create policy product_supplier_codes_store_write on public.product_supplier_codes for all to authenticated
  using (public.has_store_write_access(store_id)) with check (public.has_store_write_access(store_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.stores, public.store_memberships, public.suppliers, public.products,
  public.store_settings,
  public.product_eans, public.product_supplier_codes, public.purchases,
  public.purchase_items, public.cost_history, public.sale_price_history, public.audit_log
to authenticated;
grant execute on function public.create_store(text) to authenticated;
grant execute on function public.add_store_member(uuid, uuid, text) to authenticated;
grant execute on function public.confirm_purchase(jsonb, jsonb) to authenticated;
revoke all on function public.create_store(text) from public, anon;
revoke all on function public.add_store_member(uuid, uuid, text) from public, anon;
revoke all on function public.confirm_purchase(jsonb, jsonb) from public, anon;
revoke all on function public.log_product_changes() from public, anon, authenticated;
revoke all on function public.has_store_access(uuid) from public, anon;
revoke all on function public.has_store_write_access(uuid) from public, anon;
grant execute on function public.has_store_access(uuid) to authenticated;
grant execute on function public.has_store_write_access(uuid) to authenticated;

-- Bucket privado para documentos fiscais, com acesso limitado aos membros da loja.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-documents', 'purchase-documents', false, 20971520,
  array['application/xml','text/xml','application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists purchase_documents_read on storage.objects;
create policy purchase_documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'purchase-documents'
    and public.has_store_access((storage.foldername(name))[1]::uuid)
  );
drop policy if exists purchase_documents_write on storage.objects;
create policy purchase_documents_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-documents'
    and public.has_store_write_access((storage.foldername(name))[1]::uuid)
  );
drop policy if exists purchase_documents_update on storage.objects;
create policy purchase_documents_update on storage.objects for update to authenticated
  using (
    bucket_id = 'purchase-documents'
    and public.has_store_write_access((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'purchase-documents'
    and public.has_store_write_access((storage.foldername(name))[1]::uuid)
  );
drop policy if exists purchase_documents_delete on storage.objects;
create policy purchase_documents_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'purchase-documents'
    and exists (
      select 1 from public.store_memberships m
      where m.store_id = (storage.foldername(name))[1]::uuid
        and m.user_id = (select auth.uid())
        and m.role in ('owner','admin')
    )
  );
