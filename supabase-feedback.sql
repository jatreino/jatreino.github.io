-- Já treinô?: comentários, sugestões e problemas enviados pelos usuários (versão BETA).
-- Cole no Supabase: SQL Editor -> New query -> Run. Pode rodar de novo sem problema.
-- Precisa do supabase-perfis.sql já instalado (usa a função eh_admin).

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  nome text,
  email text,
  tipo text not null default 'comentario' check (tipo in ('problema', 'sugestao', 'comentario')),
  texto text not null check (char_length(texto) between 1 and 4000),
  versao text,
  aparelho text,
  tela text,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists feedback_abertos on public.feedback (resolvido_em, criado_em desc);

alter table public.feedback enable row level security;

-- Qualquer usuário logado envia (sempre em nome dele mesmo)
drop policy if exists "feedback: enviar" on public.feedback;
create policy "feedback: enviar" on public.feedback for insert to authenticated with check (
  user_id = (select auth.uid()) and resolvido_em is null
);
-- Cada um vê o que mandou; o administrador vê tudo
drop policy if exists "feedback: ler" on public.feedback;
create policy "feedback: ler" on public.feedback for select to authenticated using (
  user_id = (select auth.uid()) or public.eh_admin()
);
-- Só o administrador marca como resolvido
drop policy if exists "feedback: admin atualiza" on public.feedback;
create policy "feedback: admin atualiza" on public.feedback for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());
drop policy if exists "feedback: admin apaga" on public.feedback;
create policy "feedback: admin apaga" on public.feedback for delete to authenticated using (public.eh_admin());
