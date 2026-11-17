-- Já treinô?: convites do personal por e-mail, com aceite dentro do app.
-- Cole no Supabase: SQL Editor -> New query -> Run. Pode rodar de novo sem problema.
-- Precisa do supabase-perfis.sql já instalado.
--
-- Como funciona: o personal convida pelo e-mail (função do servidor "convidar-aluno").
-- Quando o aluno entra no app com esse e-mail, aparece o convite na tela Hoje, com Aceitar / Agora não.

-- Convites pendentes para o e-mail de quem está logado
create or replace function public.meus_convites()
returns table (codigo text, professor_id uuid, professor_nome text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select c.codigo, c.professor_id, p.nome, c.criado_em
  from convites c join perfis p on p.user_id = c.professor_id
  where c.usado_por is null
    and c.email is not null
    and lower(c.email) = lower(auth.email())
    and c.professor_id <> auth.uid()
    and not exists (select 1 from vinculos v where v.professor_id = c.professor_id and v.aluno_id = auth.uid())
  order by c.criado_em desc;
$$;

-- Recusar um convite enviado para o meu e-mail
create or replace function public.recusar_convite(p_codigo text) returns void
language sql security definer set search_path = public as $$
  delete from convites
  where codigo = p_codigo and usado_por is null and lower(email) = lower(auth.email());
$$;

revoke execute on function public.meus_convites(), public.recusar_convite(text) from anon, public;
grant execute on function public.meus_convites(), public.recusar_convite(text) to authenticated;
