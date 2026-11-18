-- Já treinô?: reforços de segurança (auditoria de 17/11/2026).
-- Cole no Supabase: SQL Editor -> New query -> Run. Pode rodar de novo sem problema.
-- Precisa dos arquivos anteriores já instalados (supabase.sql, supabase-perfis.sql, supabase-feedback.sql,
-- supabase-convites-email.sql). Nada aqui apaga dados.

-- ============================================================================================
-- 1. Perfis: o próprio usuário só altera nome, CREF e o pedido de personal.
--    O e-mail do perfil acompanha sempre o e-mail real da conta (não dá para se passar por outra pessoa).
-- ============================================================================================
create or replace function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.eh_admin() then
    if tg_op = 'INSERT' then
      new.email := auth.email();
    else
      if new.user_id is distinct from old.user_id or new.email is distinct from old.email
         or new.criado_em is distinct from old.criado_em then
        raise exception 'Alteração não permitida';
      end if;
    end if;
  end if;
  new.nome := left(coalesce(new.nome, ''), 120);
  new.cref := left(new.cref, 30);
  return new;
end $$;
drop trigger if exists perfis_proteger_perfil on public.perfis;
create trigger perfis_proteger_perfil before insert or update on public.perfis
  for each row execute function public.proteger_perfil();

-- Quando a pessoa troca o e-mail da conta, o perfil acompanha
create or replace function public.sincronizar_email_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update perfis set email = new.email where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists ao_trocar_email on auth.users;
create trigger ao_trocar_email after update of email on auth.users
  for each row execute function public.sincronizar_email_perfil();
-- Corrige perfis que estejam com e-mail diferente da conta
update public.perfis p set email = u.email from auth.users u where u.id = p.user_id and p.email is distinct from u.email;

-- ============================================================================================
-- 2. Mensagens: quem recebe só pode marcar como lida (não altera o texto de quem enviou).
--    Limite contra spam: até 60 mensagens a cada 10 minutos por pessoa.
-- ============================================================================================
create or replace function public.proteger_mensagem() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- painel do Supabase / funções do servidor
  if tg_op = 'UPDATE' then
    if new.de is distinct from old.de or new.para is distinct from old.para or new.texto is distinct from old.texto
       or new.sessao_id is distinct from old.sessao_id or new.criado_em is distinct from old.criado_em then
      raise exception 'Só é possível marcar a mensagem como lida';
    end if;
  else
    new.criado_em := now();
    if (select count(*) from mensagens where de = auth.uid() and criado_em > now() - interval '10 minutes') >= 60 then
      raise exception 'Muitas mensagens em pouco tempo. Aguarde alguns minutos.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mensagens_proteger on public.mensagens;
create trigger mensagens_proteger before insert or update on public.mensagens
  for each row execute function public.proteger_mensagem();

-- ============================================================================================
-- 3. Prescrições: o aluno só marca como aplicada (não altera o programa nem a mensagem do personal).
-- ============================================================================================
create or replace function public.proteger_prescricao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and auth.uid() = old.aluno_id and auth.uid() <> old.professor_id then
    if new.programa is distinct from old.programa or new.mensagem is distinct from old.mensagem
       or new.professor_id is distinct from old.professor_id or new.aluno_id is distinct from old.aluno_id
       or new.criado_em is distinct from old.criado_em then
      raise exception 'Só é possível marcar o programa como aplicado';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.criado_em := now();
    if pg_column_size(new.programa) > 1000000 then raise exception 'Programa grande demais'; end if;
    if (select count(*) from prescricoes where professor_id = auth.uid() and criado_em > now() - interval '1 hour') >= 100 then
      raise exception 'Muitos envios em pouco tempo. Aguarde um pouco.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists prescricoes_proteger on public.prescricoes;
create trigger prescricoes_proteger before insert or update on public.prescricoes
  for each row execute function public.proteger_prescricao();

-- ============================================================================================
-- 4. Dados do app: limite de tamanho por usuário (evita que alguém encha o banco de propósito).
--    5 MB comporta muitos anos de treinos.
-- ============================================================================================
create or replace function public.limitar_dados_app() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(new.conteudo) > 5000000 then
    raise exception 'Dados grandes demais. Fale com o suporte.';
  end if;
  return new;
end $$;
drop trigger if exists dados_app_limite on public.dados_app;
create trigger dados_app_limite before insert or update on public.dados_app
  for each row execute function public.limitar_dados_app();

-- ============================================================================================
-- 5. Comentários e convites: limites contra abuso.
-- ============================================================================================
create or replace function public.limitar_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.criado_em := now();
  new.versao := left(new.versao, 40); new.aparelho := left(new.aparelho, 200); new.tela := left(new.tela, 200);
  new.nome := left(new.nome, 120); new.email := auth.email();
  if (select count(*) from feedback where user_id = auth.uid() and criado_em > now() - interval '1 hour') >= 10 then
    raise exception 'Você já enviou várias mensagens nesta hora. Tente de novo mais tarde.';
  end if;
  return new;
end $$;
drop trigger if exists feedback_limite on public.feedback;
create trigger feedback_limite before insert on public.feedback
  for each row execute function public.limitar_feedback();

create or replace function public.limitar_convites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- a função do servidor tem o próprio limite
  if char_length(new.codigo) < 12 then raise exception 'Código de convite inválido'; end if;
  new.nome := left(new.nome, 120); new.email := left(lower(new.email), 254); new.criado_em := now();
  if (select count(*) from convites where professor_id = auth.uid() and criado_em > now() - interval '1 hour') >= 30 then
    raise exception 'Muitos convites em pouco tempo. Aguarde um pouco.';
  end if;
  return new;
end $$;
drop trigger if exists convites_limite on public.convites;
create trigger convites_limite before insert on public.convites
  for each row execute function public.limitar_convites();

-- ============================================================================================
-- 6. Funções internas: ninguém de fora precisa chamá-las diretamente.
-- ============================================================================================
revoke execute on function public.eh_admin(), public.eh_professor_de(uuid), public.eh_meu_professor(uuid) from public, anon;
grant execute on function public.eh_admin(), public.eh_professor_de(uuid), public.eh_meu_professor(uuid) to authenticated;
revoke execute on function public.proteger_perfil(), public.proteger_mensagem(), public.proteger_prescricao(),
  public.limitar_dados_app(), public.limitar_feedback(), public.limitar_convites(), public.sincronizar_email_perfil(),
  public.criar_perfil(), public.proteger_papel() from anon, authenticated, public;
