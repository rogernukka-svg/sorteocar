create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null unique,
  role text not null check (role in ('admin', 'seller')),
  password_hash text not null,
  seller_code text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  commission numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  fecha text not null,
  vendedor text not null,
  codigo_vendedor text not null,
  telefono text default '',
  nombre text not null,
  ci text not null,
  numeros text not null,
  cantidad integer not null default 1,
  total numeric not null default 0,
  comision numeric not null default 0,
  monto_pagado numeric not null default 0,
  comprobante text default '',
  boletas text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  fecha text not null,
  vendedor text default '',
  codigo_vendedor text default '',
  telefono text default '',
  mensaje text default '',
  estado text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.qr_scans (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  seller text default '',
  ci text default '',
  ok boolean not null default false,
  signed boolean not null default false,
  signature_ok boolean not null default false,
  duplicate boolean not null default false,
  scanned_by text default '',
  created_at timestamptz not null default now()
);

create index if not exists sales_codigo_vendedor_idx on public.sales (codigo_vendedor);
create index if not exists sales_ci_idx on public.sales (ci);
create index if not exists sellers_code_idx on public.sellers (code);
create index if not exists qr_scans_number_idx on public.qr_scans (number);

alter table public.app_users enable row level security;
alter table public.sellers enable row level security;
alter table public.sales enable row level security;
alter table public.leads enable row level security;
alter table public.qr_scans enable row level security;
