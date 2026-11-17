-- Já treinô?: exclusão da própria conta (exigida pela Google Play, pela App Store e pela LGPD).
-- Cole no Supabase: SQL Editor -> New query -> Run. Pode rodar de novo sem problema.
--
-- A pessoa logada chama excluir_minha_conta() pelo app. Apagar o usuário em auth.users apaga em cascata
-- perfil, treinos (dados_app), vínculos, convites, prescrições, mensagens e chaves de biometria.
-- Comentários enviados (feedback) são apagados também.

create or replace function public.excluir_minha_conta() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  eu uuid := auth.uid();
begin
  if eu is null then raise exception 'Faça login novamente'; end if;
  -- O último administrador não pode se excluir (o app ficaria sem ninguém para administrar)
  if exists (select 1 from public.perfis where user_id = eu and papel = 'admin')
     and (select count(*) from public.perfis where papel = 'admin') <= 1 then
    raise exception 'Você é o único administrador. Passe a administração para outra pessoa antes de excluir a conta.';
  end if;
  delete from public.feedback where user_id = eu;
  delete from auth.users where id = eu; -- o resto sai em cascata
end $$;

revoke execute on function public.excluir_minha_conta() from anon, public;
grant execute on function public.excluir_minha_conta() to authenticated;
