-- Já treinô?: perfis (aluno, professor, administrador), vínculos, convites, prescrições e mensagens.
-- Cole no Supabase: SQL Editor -> New query -> Run. Pode rodar de novo sem problema.
-- Depois, rode a última parte (no fim do arquivo) com o seu e-mail para virar administrador.

-- ---------- Tabelas ----------
create table if not exists public.perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text,
  papel text not null default 'aluno' check (papel in ('aluno', 'professor', 'admin')),
  pedido_professor boolean not null default false,
  cref text,
  criado_em timestamptz not null default now()
);

create table if not exists public.vinculos (
  professor_id uuid not null references auth.users (id) on delete cascade,
  aluno_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (professor_id, aluno_id)
);
create index if not exists vinculos_aluno on public.vinculos (aluno_id);

create table if not exists public.convites (
  codigo text primary key,
  professor_id uuid not null references auth.users (id) on delete cascade,
  nome text,
  email text,
  criado_em timestamptz not null default now(),
  usado_por uuid references auth.users (id) on delete set null,
  usado_em timestamptz
);

create table if not exists public.prescricoes (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references auth.users (id) on delete cascade,
  aluno_id uuid not null references auth.users (id) on delete cascade,
  programa jsonb not null,
  mensagem text,
  criado_em timestamptz not null default now(),
  aplicada_em timestamptz
);
create index if not exists prescricoes_aluno on public.prescricoes (aluno_id);

create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  de uuid not null references auth.users (id) on delete cascade,
  para uuid not null references auth.users (id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 4000),
  sessao_id text, -- comentário sobre um treino feito
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index if not exists mensagens_para on public.mensagens (para, lida_em);
create index if not exists mensagens_de on public.mensagens (de);

-- ---------- Funções de apoio (rodam com permissão do dono, sem recursão nas regras) ----------
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where user_id = auth.uid() and papel = 'admin');
$$;

create or replace function public.eh_professor_de(aluno uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vinculos v join perfis p on p.user_id = v.professor_id
    where v.professor_id = auth.uid() and v.aluno_id = aluno and p.papel in ('professor', 'admin')
  );
$$;

create or replace function public.eh_meu_professor(professor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vinculos where professor_id = professor and aluno_id = auth.uid());
$$;

-- Perfil criado automaticamente para cada conta nova
create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (user_id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', ''), new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users for each row execute function public.criar_perfil();

-- Perfis das contas que já existiam
insert into public.perfis (user_id, nome, email)
select id, coalesce(raw_user_meta_data ->> 'nome', ''), email from auth.users
on conflict (user_id) do nothing;

-- Só o administrador muda o papel (no SQL Editor, sem usuário logado, é permitido)
create or replace function public.proteger_papel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.papel is distinct from old.papel and auth.uid() is not null and not public.eh_admin() then
    raise exception 'Somente o administrador altera o papel';
  end if;
  return new;
end $$;
drop trigger if exists perfis_proteger_papel on public.perfis;
create trigger perfis_proteger_papel before update on public.perfis for each row execute function public.proteger_papel();

-- Convites: ver de quem é e aceitar (cria o vínculo)
create or replace function public.ver_convite(p_codigo text) returns table (professor_nome text, valido boolean)
language sql stable security definer set search_path = public as $$
  select p.nome, (c.usado_por is null or c.usado_por = auth.uid())
  from convites c join perfis p on p.user_id = c.professor_id
  where c.codigo = p_codigo;
$$;

create or replace function public.aceitar_convite(p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c convites;
begin
  select * into c from convites where codigo = p_codigo for update;
  if not found then raise exception 'Convite não encontrado'; end if;
  if c.usado_por is not null and c.usado_por <> auth.uid() then raise exception 'Este convite já foi usado'; end if;
  if c.professor_id = auth.uid() then raise exception 'Você não pode aceitar o próprio convite'; end if;
  insert into vinculos (professor_id, aluno_id) values (c.professor_id, auth.uid()) on conflict do nothing;
  update convites set usado_por = auth.uid(), usado_em = now() where codigo = p_codigo;
  return (select nome from perfis where user_id = c.professor_id);
end $$;

revoke execute on function public.ver_convite(text), public.aceitar_convite(text) from anon, public;
grant execute on function public.ver_convite(text), public.aceitar_convite(text) to authenticated;

-- ---------- Regras de acesso (Row Level Security) ----------
alter table public.perfis enable row level security;
alter table public.vinculos enable row level security;
alter table public.convites enable row level security;
alter table public.prescricoes enable row level security;
alter table public.mensagens enable row level security;

drop policy if exists "perfis: ler" on public.perfis;
create policy "perfis: ler" on public.perfis for select to authenticated using (
  user_id = (select auth.uid()) or public.eh_admin() or public.eh_professor_de(user_id) or public.eh_meu_professor(user_id)
);
drop policy if exists "perfis: criar o próprio" on public.perfis;
create policy "perfis: criar o próprio" on public.perfis for insert to authenticated with check (
  user_id = (select auth.uid()) and papel = 'aluno'
);
drop policy if exists "perfis: atualizar" on public.perfis;
create policy "perfis: atualizar" on public.perfis for update to authenticated
  using (user_id = (select auth.uid()) or public.eh_admin())
  with check (user_id = (select auth.uid()) or public.eh_admin());

drop policy if exists "vinculos: ler" on public.vinculos;
create policy "vinculos: ler" on public.vinculos for select to authenticated using (
  professor_id = (select auth.uid()) or aluno_id = (select auth.uid()) or public.eh_admin()
);
drop policy if exists "vinculos: desfazer" on public.vinculos;
create policy "vinculos: desfazer" on public.vinculos for delete to authenticated using (
  professor_id = (select auth.uid()) or aluno_id = (select auth.uid()) or public.eh_admin()
);

drop policy if exists "convites: professor gerencia os seus" on public.convites;
create policy "convites: professor gerencia os seus" on public.convites for all to authenticated
  using (professor_id = (select auth.uid()) or public.eh_admin())
  with check (
    professor_id = (select auth.uid())
    and exists (select 1 from public.perfis where user_id = (select auth.uid()) and papel in ('professor', 'admin'))
  );

drop policy if exists "prescricoes: ler" on public.prescricoes;
create policy "prescricoes: ler" on public.prescricoes for select to authenticated using (
  aluno_id = (select auth.uid()) or professor_id = (select auth.uid()) or public.eh_admin()
);
drop policy if exists "prescricoes: professor envia" on public.prescricoes;
create policy "prescricoes: professor envia" on public.prescricoes for insert to authenticated with check (
  professor_id = (select auth.uid()) and public.eh_professor_de(aluno_id)
);
drop policy if exists "prescricoes: aluno marca como aplicada" on public.prescricoes;
create policy "prescricoes: aluno marca como aplicada" on public.prescricoes for update to authenticated
  using (aluno_id = (select auth.uid())) with check (aluno_id = (select auth.uid()));

drop policy if exists "mensagens: ler as minhas" on public.mensagens;
create policy "mensagens: ler as minhas" on public.mensagens for select to authenticated using (
  de = (select auth.uid()) or para = (select auth.uid())
);
drop policy if exists "mensagens: enviar a quem está vinculado" on public.mensagens;
create policy "mensagens: enviar a quem está vinculado" on public.mensagens for insert to authenticated with check (
  de = (select auth.uid()) and (public.eh_professor_de(para) or public.eh_meu_professor(para) or public.eh_admin())
);
drop policy if exists "mensagens: marcar como lida" on public.mensagens;
create policy "mensagens: marcar como lida" on public.mensagens for update to authenticated
  using (para = (select auth.uid())) with check (para = (select auth.uid()));

-- O professor (e o administrador) lê os treinos dos alunos vinculados; continua sem poder alterá-los
drop policy if exists "dados_app: professor e admin leem" on public.dados_app;
create policy "dados_app: professor e admin leem" on public.dados_app for select to authenticated using (
  public.eh_professor_de(user_id) or public.eh_admin()
);

-- ---------- Administrador ----------
-- Troque o e-mail abaixo pelo seu e rode só esta linha (ou o arquivo todo de novo):
update public.perfis set papel = 'admin' where email = 'SEU-EMAIL@exemplo.com';
