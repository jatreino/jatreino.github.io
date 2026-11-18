// Já treinô? — função do servidor (Supabase Edge Function) "admin-usuarios".
// Cria um usuário e envia o convite por e-mail. Só atende quem tem papel 'admin' na tabela perfis.
// A chave secreta (service role) fica no servidor do Supabase, nunca no app.
//
// Instalação: Supabase → Edge Functions → Deploy a new function → Via editor,
// nome "admin-usuarios", colar este arquivo inteiro e clicar em Deploy.
// Depois, nos detalhes da função, desligar "Verify JWT" (a própria função confere o login abaixo).

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const erro = (mensagem: string, status = 400) => resposta({ erro: mensagem }, status);
const URL_APP = 'https://jatreino.app.br/'; // os links dos e-mails só podem levar ao próprio app

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro('Método não permitido', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Quem está chamando? (token do login enviado pelo app)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return erro('Faça login novamente.', 401);
  const { data: quem, error: erroLogin } = await admin.auth.getUser(token);
  if (erroLogin || !quem?.user) return erro('Sessão inválida. Faça login novamente.', 401);

  // 2. É administrador?
  const { data: perfil } = await admin.from('perfis').select('papel').eq('user_id', quem.user.id).maybeSingle();
  if (perfil?.papel !== 'admin') return erro('Somente o administrador pode criar usuários.', 403);

  // 3. Dados do novo usuário
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return erro('Dados inválidos.'); }
  const nome = String(corpo.nome || '').trim().slice(0, 120);
  const email = String(corpo.email || '').trim().toLowerCase();
  const papel = String(corpo.papel || 'aluno');
  const professorId = corpo.professor_id ? String(corpo.professor_id) : null;
  if (!nome) return erro('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('E-mail inválido.');
  if (!['aluno', 'professor'].includes(papel)) return erro('Papel inválido.');

  if (professorId) {
    const { data: prof } = await admin.from('perfis').select('papel').eq('user_id', professorId).maybeSingle();
    if (!prof || !['professor', 'admin'].includes(prof.papel)) return erro('Professor não encontrado.');
  }

  // 4. Cria a conta e envia o e-mail de convite (o link leva ao app para a pessoa criar a senha)
  const { data: convite, error: erroConvite } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { nome },
    redirectTo: URL_APP,
  });
  if (erroConvite) {
    const m = erroConvite.message || '';
    if (/already been registered|already exists|registered/i.test(m)) return erro('Já existe uma conta com este e-mail.', 409);
    if (/rate limit/i.test(m)) return erro('Limite de e-mails atingido. Tente de novo mais tarde (ou configure um SMTP próprio no Supabase).', 429);
    return erro(`Não foi possível enviar o convite: ${m}`, 500);
  }
  const novoId = convite.user.id;

  // 5. Perfil (criado pelo gatilho do banco), papel e vínculo com o professor
  await admin.from('perfis').upsert({ user_id: novoId, nome, email, papel, pedido_professor: false }, { onConflict: 'user_id' });
  if (professorId && papel === 'aluno') {
    await admin.from('vinculos').upsert({ professor_id: professorId, aluno_id: novoId }, { onConflict: 'professor_id,aluno_id' });
  }

  return resposta({ ok: true, user_id: novoId, email });
});
