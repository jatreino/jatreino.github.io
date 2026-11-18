// Já treinô? — função do servidor (Supabase Edge Function) "convidar-aluno".
// O personal (ou o administrador) convida um aluno pelo e-mail:
//  - se o e-mail ainda não tem conta, o aluno recebe o e-mail de convite para criar a senha;
//  - se já tem conta, nenhum e-mail é enviado: o convite aparece na tela Hoje do app dele.
// Em ambos os casos o vínculo só é criado quando o aluno toca em "Aceitar" no app.
//
// Instalação: Supabase → Edge Functions → Deploy a new function → Via editor,
// nome "convidar-aluno", colar este arquivo inteiro e clicar em Deploy.
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
// Os links dos e-mails só podem levar ao próprio app
const URL_APP = 'https://jatreino.app.br/';
const LIMITE_POR_HORA = 20; // convites por personal, contra uso do app para mandar e-mails em massa

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro('Método não permitido', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Quem está chamando precisa ser personal ou administrador
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return erro('Faça login novamente.', 401);
  const { data: quem, error: erroLogin } = await admin.auth.getUser(token);
  if (erroLogin || !quem?.user) return erro('Sessão inválida. Faça login novamente.', 401);
  const { data: eu } = await admin.from('perfis').select('nome, papel').eq('user_id', quem.user.id).maybeSingle();
  if (!eu || !['professor', 'admin'].includes(eu.papel)) return erro('Somente personais podem convidar alunos.', 403);

  // 2. Dados do aluno
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return erro('Dados inválidos.'); }
  const nome = String(corpo.nome || '').trim().slice(0, 120);
  const email = String(corpo.email || '').trim().toLowerCase();
  if (!nome) return erro('Informe o nome do aluno.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('E-mail inválido.');
  if (email === (quem.user.email || '').toLowerCase()) return erro('Você não pode convidar a si mesmo.');

  // 3. Já é aluno deste personal?
  const emailBusca = email.replace(/[\\%_]/g, '\\$&'); // ilike sem curingas
  const { data: existente } = await admin.from('perfis').select('user_id').ilike('email', emailBusca).maybeSingle();
  if (existente) {
    const { data: v } = await admin.from('vinculos').select('aluno_id')
      .eq('professor_id', quem.user.id).eq('aluno_id', existente.user_id).maybeSingle();
    if (v) return erro('Esta pessoa já é sua aluna no app.', 409);
  }

  // Limite de convites por hora
  const umaHora = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('convites').select('codigo', { count: 'exact', head: true })
    .eq('professor_id', quem.user.id).gte('criado_em', umaHora);
  if ((count || 0) >= LIMITE_POR_HORA) return erro('Muitos convites em pouco tempo. Tente de novo daqui a uma hora.', 429);

  // 4. Registra o convite (um por e-mail e personal: renova se já existir)
  await admin.from('convites').delete().eq('professor_id', quem.user.id).ilike('email', emailBusca).is('usado_por', null);
  const codigo = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const { error: erroConvite } = await admin.from('convites').insert({ codigo, professor_id: quem.user.id, nome, email });
  if (erroConvite) return erro('Não foi possível registrar o convite.', 500);

  // 5. Sem conta: envia o e-mail para criar a senha. Com conta: o convite aparece no app dele.
  if (existente) return resposta({ ok: true, codigo, conta_existente: true });
  const { error: erroEmail } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { nome, personal: eu.nome || 'Seu personal' },
    redirectTo: URL_APP,
  });
  if (erroEmail) {
    const m = erroEmail.message || '';
    if (/already been registered|already exists|registered/i.test(m)) return resposta({ ok: true, codigo, conta_existente: true });
    if (/rate limit/i.test(m)) return erro('Limite de e-mails atingido. Tente de novo mais tarde.', 429);
    return erro(`Convite registrado, mas o e-mail não foi enviado: ${m}`, 500);
  }
  return resposta({ ok: true, codigo, conta_existente: false });
});
