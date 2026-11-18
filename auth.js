'use strict';

// Login.
// - Conta principal: e-mail e senha no Supabase (servidor.js). Os dados sincronizam com a nuvem,
//   então o mesmo login funciona em qualquer ícone, no Safari ou em outro aparelho.
// - Demonstração: login "admin" / senha "admin", perfil só deste aparelho (não vai ao servidor).
// - Contas locais da versão anterior (por CPF) deixam de ser usadas; os treinos delas sobem para
//   a conta do servidor no primeiro login (servidor.js -> dadosLocaisAntigos).

const CONTAS_KEY = 'meutreino:contas';
const SESSAO_KEY = 'meutreino:sessao'; // só a sessão da demonstração
const ITERACOES = 150000;
const DEMO = { id: 'demo', login: 'admin', senha: 'admin', nome: 'Demonstração' };

let modoLogin = 'entrar'; // 'entrar' | 'criar' | 'redefinir' | 'nova-senha'
let boasVindas = false; // chegou pelo convite enviado pelo administrador: cria a primeira senha
let avisoLogin = '';      // mensagem de sucesso mostrada na tela de login (ex.: "enviamos o e-mail")
// Link recebido por e-mail (convite, redefinição de senha, confirmação). O código só é usado quando a pessoa toca
// em "Continuar": assim os antivírus de e-mail (que abrem os links antes) não gastam o link de uso único.
let linkEmail = null; // { token, tipo }
const TEXTOS_LINK = {
  invite: ['Bem-vindo ao Já treinô?!', 'Você foi convidado. Toque em continuar para criar a sua senha.', 'Continuar'],
  recovery: ['Redefinir senha', 'Toque em continuar para escolher uma nova senha.', 'Continuar'],
  email: ['Confirmar e-mail', 'Toque no botão para confirmar seu e-mail e entrar no app.', 'Confirmar meu e-mail'],
  signup: ['Confirmar e-mail', 'Toque no botão para confirmar seu e-mail e entrar no app.', 'Confirmar meu e-mail'],
  email_change: ['Confirmar novo e-mail', 'Toque no botão para confirmar a troca do seu e-mail.', 'Confirmar'],
  magiclink: ['Entrar no app', 'Toque no botão para entrar na sua conta.', 'Entrar'],
};

// ---------- Contas locais (demonstração e contas antigas) ----------
function lerContas() {
  try { return JSON.parse(localStorage.getItem(CONTAS_KEY)) || []; } catch (e) { return []; }
}
function gravarContas(contas) { localStorage.setItem(CONTAS_KEY, JSON.stringify(contas)); }

const normEmail = (s) => (s || '').normalize('NFKC').replace(/[​-‍﻿]/g, '').trim().toLowerCase();
const emailValido = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
// Senha mínima: 8 caracteres com letras e números (vale para novas senhas; as antigas continuam entrando)
const senhaFraca = (s) => s.length < 8 || !/[a-zA-ZÀ-ÿ]/.test(s) || !/\d/.test(s);
const MSG_SENHA = 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
function mascararEmail(e) {
  const [u, d] = (e || '').split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : e || '';
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashSenha(senha, salt, iteracoes = ITERACOES) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(salt), iterations: iteracoes }, chave, 256);
  return b64(bits);
}
async function novaCredencial(senha) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iteracoes: ITERACOES, hash: await hashSenha(senha, salt) };
}
async function conferirSenha(conta, senha) {
  return (await hashSenha(senha, conta.salt, conta.iteracoes)) === conta.hash;
}
async function contaDemo() {
  const contas = lerContas();
  let demo = contas.find((c) => c.id === DEMO.id);
  if (!demo) {
    demo = { id: DEMO.id, login: DEMO.login, nome: DEMO.nome, demo: true, ...(await novaCredencial(DEMO.senha)) };
    contas.push(demo); gravarContas(contas);
  }
  return demo;
}

// ---------- Sessão ----------
// Chamado uma vez ao abrir o app (app.js), antes da primeira tela
async function iniciarSessao() {
  const q = new URLSearchParams(location.search);
  if (q.get('token_hash')) {
    linkEmail = { token: q.get('token_hash'), tipo: TEXTOS_LINK[q.get('type')] ? q.get('type') : 'email' };
    history.replaceState(null, '', URL_APP);
    modoLogin = 'link';
    return;
  }
  // Link antigo/expirado que voltou do servidor com erro (ex.: "otp_expired")
  if (/error_code=|error=access_denied/.test(HASH_INICIAL)) {
    avisoLogin = 'Este link expirou ou já foi usado. Peça um novo convite ou use "Esqueci minha senha".';
    history.replaceState(null, '', URL_APP);
  }
  if (localStorage.getItem(SESSAO_KEY) === DEMO.id) { abrirConta(await contaDemo()); return; }
  const recuperacao = /type=(recovery|invite)/.test(HASH_INICIAL);
  boasVindas = /type=invite/.test(HASH_INICIAL);
  const veioDeLink = /access_token=/.test(HASH_INICIAL);
  let sessao = null, falhou = false;
  try {
    const { data, error } = await sb.auth.getSession();
    sessao = data.session; falhou = !!error;
  } catch (e) { falhou = true; }
  if (veioDeLink) history.replaceState(null, '', `${URL_APP}#/hoje`);
  if (sessao && recuperacao) { modoLogin = 'nova-senha'; return; }
  if (sessao) { entrarServidor(sessao.user); return; }
  // Sem internet com o token vencido: abre a cópia do último usuário e sincroniza depois
  const lembrado = usuarioLembrado();
  if (lembrado && (falhou || !navigator.onLine)) { abrirConta(contaDoUsuario(lembrado)); estadoSync.situacao = 'pendente'; }
}

function entrarServidor(user) {
  lembrarUsuario(user);
  localStorage.removeItem(SESSAO_KEY);
  abrirConta(contaDoUsuario(user));
  sincronizarAoAbrir();
  carregarPerfil().then(() => {
    const convite = localStorage.getItem(CONVITE_KEY);
    if (convite && social.disponivel && rotaAtual().pag !== 'convite') location.hash = `#/convite/${convite}`;
    else if (contaAtual) render();
  }).catch(() => {});
}

function irParaApp() {
  avisoLogin = ''; modoLogin = 'entrar';
  if (!/^#\/[a-z]/.test(location.hash)) location.hash = '#/hoje';
  render();
}

// Espera no máximo `ms`: sem internet (ou com a rede travada) a saída não pode ficar presa
const comLimite = (promessa, ms) => Promise.race([Promise.resolve(promessa).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

async function sair() {
  if (contaAtual?.servidor) try {
    await comLimite(enviarAoServidor(), 4000);
    // scope 'local': apaga a sessão deste aparelho sem depender do servidor responder
    await comLimite(sb.auth.signOut({ scope: 'local' }), 3000);
    try { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); } catch (e) { /* ok */ }
    localStorage.removeItem(USUARIO_KEY);
    // Privacidade em aparelho compartilhado: apaga a cópia local dos treinos, se tudo já foi enviado ao servidor.
    // (Se algo ficou pendente, por estar sem internet, a cópia fica para não perder dados; sobe no próximo login.)
    const id = contaAtual.id;
    if (!localStorage.getItem(pendenteKey(id))) {
      for (const k of Object.keys(localStorage)) if (k.includes(id) && !k.startsWith('meutreino:migrado')) localStorage.removeItem(k);
    }
  } catch (e) { /* segue saindo mesmo assim */ }
  localStorage.removeItem(SESSAO_KEY);
  contaAtual = null;
  db = novoDb();
  bio.lista = null; fb.lista = null; fb.abertos = null;
  meuPerfil = null; social.disponivel = false; social.naoLidas = 0; social.prescricoes = []; social.professores = [];
  if (typeof prof !== 'undefined') { prof.alunos = null; prof.usuarios = {}; }
  modoLogin = 'entrar';
  render();
}

// Mensagens do Supabase em português
function traduzErro(error) {
  const m = (error && error.message) || '';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos (veja também a caixa de spam).';
  if (/already registered|already been registered/i.test(m)) return 'Já existe uma conta com esse e-mail. Use "Entrar" ou "Esqueci minha senha".';
  if (/Error sending|sending (recovery|confirmation|invite|magic link) email|smtp/i.test(m)) return 'Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos; se continuar, fale com o suporte.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas ou e-mails seguidos. Aguarde alguns minutos e tente de novo.';
  if (/Password should be|weak|pwned|leaked/i.test(m)) return 'Senha fraca ou já vazada em outros sites: use pelo menos 8 caracteres, com letras e números, e evite senhas comuns.';
  if (/fetch|network|Failed to/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return m || 'Não foi possível concluir. Tente de novo.';
}

// ---------- Telas ----------
function telaLogin() {
  const subtitulo = {
    entrar: 'Entre para acessar seus treinos', criar: 'Crie sua conta',
    redefinir: 'Redefina a sua senha', 'nova-senha': boasVindas ? 'Bem-vindo! Crie a sua senha para começar' : 'Escolha a nova senha', link: '',
  }[modoLogin];
  const topo = `<div class="login-topo"><h1 class="login-marca"><img src="marca/logotipo_horizontal.svg" alt="Já treinô?" class="login-logo"></h1>
    <p class="login-beta small">${seloBeta()} Versão de testes: pode haver falhas.</p>
    <p class="muted small">${subtitulo}</p></div>`;
  const erro = '<p class="login-erro small" id="login-erro" hidden></p>';
  const aviso = (avisoLogin ? `<div class="card destaque small">${esc(avisoLogin)}</div>` : '')
    + (localStorage.getItem(CONVITE_KEY) && !avisoLogin ? '<div class="card destaque small">Você recebeu um convite do seu personal. Entre ou crie sua conta para aceitar.</div>' : '');
  const voltar = '<button class="btn sec" data-acao="login-modo" data-modo="entrar">Voltar ao login</button>';

  if (modoLogin === 'link' && linkEmail) {
    const [titulo, texto, botao] = TEXTOS_LINK[linkEmail.tipo];
    return `<div class="login">${botaoTemaLogin()}<div class="login-topo"><h1 class="login-marca"><img src="marca/logotipo_horizontal.svg" alt="Já treinô?" class="login-logo"></h1></div>
      <div class="card form"><h2 style="margin:0">${titulo}</h2><p class="small" style="margin:0">${texto}</p>
        ${erro}<button class="btn" data-acao="link-confirmar">${botao}</button></div>
      <button class="link-btn small" data-acao="login-modo" data-modo="entrar" style="display:block;margin:12px auto">Ir para o login</button></div>`;
  }
  if (modoLogin === 'nova-senha') {
    return `<div class="login">${botaoTemaLogin()}${topo}
      <form class="card form" data-form="nova-senha">
        <label>${boasVindas ? 'Senha' : 'Nova senha'} (mínimo 8, com letras e números)<input class="input-texto" type="password" name="senha" autocomplete="new-password" required></label>
        <label>Confirme a ${boasVindas ? '' : 'nova '}senha<input class="input-texto" type="password" name="senha2" autocomplete="new-password" required></label>
        ${erro}<button class="btn" type="submit">Salvar e entrar</button>
      </form></div>`;
  }
  if (modoLogin === 'redefinir') {
    return `<div class="login">${botaoTemaLogin()}${topo}${aviso}
      <form class="card form" data-form="redefinir">
        <label>E-mail da conta<input class="input-texto" type="email" name="email" autocomplete="email" autocapitalize="none" required></label>
        <p class="muted small" style="margin:0">Enviamos um link para criar uma nova senha. Abra o link no próprio celular.</p>
        ${erro}<button class="btn" type="submit">Enviar link</button>
      </form>${voltar}</div>`;
  }
  if (modoLogin === 'criar') {
    return `<div class="login">${botaoTemaLogin()}${topo}${aviso}
      <form class="card form" data-form="criar">
        <label>Seu nome<input class="input-texto" name="nome" autocomplete="name" required></label>
        <label>E-mail<input class="input-texto" type="email" name="email" autocomplete="email" autocapitalize="none" required></label>
        <label>Senha (mínimo 8, com letras e números)<input class="input-texto" type="password" name="senha" autocomplete="new-password" required></label>
        <label>Confirme a senha<input class="input-texto" type="password" name="senha2" autocomplete="new-password" required></label>
        <p class="muted small" style="margin:0">Os treinos que já estão neste celular vão para a sua conta.</p>
        ${erro}<button class="btn" type="submit">Criar conta</button>
      </form>${voltar}</div>`;
  }
  return `<div class="login">${botaoTemaLogin()}${topo}${aviso}
    <form class="card form" data-form="entrar">
      <label>E-mail<input class="input-texto" name="email" inputmode="email" autocomplete="username" autocapitalize="none" required></label>
      <label>Senha<div class="linha"><input class="input-texto cresce" type="password" name="senha" autocomplete="current-password" required>
        <button type="button" class="btn-mini" data-acao="ver-senha" aria-label="Mostrar senha">👁</button></div></label>
      ${erro}<button class="btn" type="submit">Entrar</button>
      ${botaoBiometriaLogin()}
      <button type="button" class="link-btn" data-acao="login-modo" data-modo="redefinir">Esqueci minha senha</button>
    </form>
    <div class="card small">Ainda não tem conta?
      <button class="btn sec" data-acao="login-modo" data-modo="criar">Criar conta</button></div>${linksLegais()}</div>`;
}

function erroLogin(msg) {
  const el = $('#login-erro');
  if (el) { el.textContent = msg; el.hidden = false; } else toast(msg);
}
function ocupado(form, texto) {
  const b = form.querySelector('button[type=submit]');
  const original = b.textContent;
  b.disabled = true; b.textContent = texto;
  return () => { b.disabled = false; b.textContent = original; };
}

async function enviarLogin(form) {
  const email = normEmail(form.email.value), senha = form.senha.value;
  if (email === DEMO.login) {
    const demo = await contaDemo();
    if (!(await conferirSenha(demo, senha))) return erroLogin('Senha incorreta.');
    localStorage.setItem(SESSAO_KEY, DEMO.id);
    abrirConta(demo);
    return irParaApp();
  }
  if (!emailValido(email)) return erroLogin('Informe o e-mail da conta.');
  const pronto = ocupado(form, 'Entrando...');
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  pronto();
  if (error) return erroLogin(traduzErro(error));
  entrarServidor(data.user);
  irParaApp();
}

async function enviarCriacao(form) {
  const nome = form.nome.value.trim(), email = normEmail(form.email.value), senha = form.senha.value;
  if (!nome) return erroLogin('Informe seu nome.');
  if (!emailValido(email)) return erroLogin('Informe um e-mail válido.');
  if (senhaFraca(senha)) return erroLogin(MSG_SENHA);
  if (senha !== form.senha2.value) return erroLogin('As senhas não conferem.');
  const pronto = ocupado(form, 'Criando...');
  const { data, error } = await sb.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: URL_APP } });
  pronto();
  if (error) return erroLogin(traduzErro(error));
  if (data.session) { toast(`Bem-vindo, ${nome.split(' ')[0]}!`); entrarServidor(data.user); return irParaApp(); }
  avisoLogin = `Conta criada. Enviamos um e-mail para ${email}: toque no link para confirmar e depois entre aqui.`;
  modoLogin = 'entrar'; render();
}

async function enviarRedefinicao(form) {
  const email = normEmail(form.email.value);
  if (!emailValido(email)) return erroLogin('Informe um e-mail válido.');
  const pronto = ocupado(form, 'Enviando...');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: URL_APP });
  pronto();
  if (error) return erroLogin(traduzErro(error));
  avisoLogin = `Se houver uma conta com ${email}, você vai receber um e-mail com o link para criar a nova senha (veja também o spam).`;
  render();
}

async function confirmarLinkEmail(botao) {
  if (!linkEmail) return;
  botao.disabled = true; botao.textContent = 'Confirmando...';
  let data = null, error = null;
  try { ({ data, error } = await sb.auth.verifyOtp({ token_hash: linkEmail.token, type: linkEmail.tipo })); } catch (e) { error = e; }
  const tipo = linkEmail.tipo;
  if (error || !data?.session) {
    botao.disabled = false; botao.textContent = TEXTOS_LINK[tipo][2];
    const m = `${error?.code || ''} ${error?.message || ''}`;
    linkEmail = null; modoLogin = tipo === 'recovery' ? 'redefinir' : 'entrar';
    avisoLogin = /expired|invalid|not found|otp/i.test(m)
      ? (tipo === 'invite' ? 'Este convite expirou ou já foi usado. Use "Esqueci minha senha" com o e-mail do convite para criar sua senha, ou peça um novo convite.'
        : tipo === 'recovery' ? 'Este link expirou ou já foi usado. Peça um novo abaixo.'
        : 'Este link expirou ou já foi usado. Se a conta já foi confirmada, é só entrar.')
      : traduzErro(error);
    return render();
  }
  linkEmail = null;
  if (tipo === 'invite' || tipo === 'recovery') { boasVindas = tipo === 'invite'; modoLogin = 'nova-senha'; return render(); }
  modoLogin = 'entrar';
  toast(tipo === 'email_change' ? 'E-mail atualizado' : 'E-mail confirmado. Bem-vindo!');
  entrarServidor(data.user);
  irParaApp();
}

async function enviarNovaSenha(form) {
  const senha = form.senha.value;
  if (senhaFraca(senha)) return erroLogin(MSG_SENHA);
  if (senha !== form.senha2.value) return erroLogin('As senhas não conferem.');
  const pronto = ocupado(form, 'Salvando...');
  const { data, error } = await sb.auth.updateUser({ password: senha });
  pronto();
  if (error) return erroLogin(traduzErro(error));
  toast(boasVindas ? 'Senha criada. Bem-vindo ao Já treinô?!' : 'Senha alterada');
  boasVindas = false;
  entrarServidor(data.user);
  irParaApp();
}

// ---------- Ajustes: conta ----------
function cartaoConta() {
  const c = contaAtual;
  if (c.demo) {
    return `<div class="card"><h2>Conta</h2>
      <div><b>${esc(c.nome)}</b><div class="muted small">admin · demonstração</div></div>
      <p class="muted small" style="margin-top:10px">Perfil para mostrar o app. Fica só neste aparelho e não afeta a sua conta.</p>
      <button class="btn sec" data-acao="demo-gerar">Carregar treinos de exemplo</button></div>`;
  }
  return `<div class="card"><h2>Conta</h2>
    <div><b>${esc(c.nome)}</b><div class="muted small">${esc(c.email || '')}</div></div>
    <div class="linha entre small" style="margin-top:10px"><span class="muted" id="texto-sync">${esc(textoSync())}</span>
      <button class="btn-mini" data-acao="sincronizar">Sincronizar</button></div>
    <details style="margin-top:10px"><summary class="small muted">Trocar senha ▾</summary>
      <form class="form" data-form="trocar-senha">
        <label>Nova senha<input class="input-texto" type="password" name="senha" autocomplete="new-password" required></label>
        <label>Confirme a nova senha<input class="input-texto" type="password" name="senha2" autocomplete="new-password" required></label>
        <button class="btn" type="submit">Salvar nova senha</button>
      </form></details></div>`;
}

async function trocarSenha(form) {
  if (senhaFraca(form.senha.value)) return toast(MSG_SENHA);
  if (form.senha.value !== form.senha2.value) return toast('As senhas não conferem');
  const { error } = await sb.auth.updateUser({ password: form.senha.value });
  if (error) return toast(traduzErro(error));
  toast('Senha alterada'); render();
}

// ---------- Perfil de demonstração: treinos de exemplo ----------
function gerarDemo() {
  const sessoes = [];
  let k = 0;
  for (let n = 21; n >= 1; n--) {
    const d = new Date(); d.setDate(d.getDate() - n);
    if (d.getDay() === 0 || n % 7 === 3) continue; // domingos e algumas folgas
    const f = FICHAS[k % FICHAS.length]; // demonstração: modelo AB
    const t = TREINOS[f];
    const semana = Math.floor((21 - n) / 7);
    const series = {}, nomes = {};
    for (const b of t.blocos) for (const ex of b.exercicios) {
      nomes[ex.id] = { nome: ex.nome, grupo: ex.grupo, carga: ex.carga, reps: ex.reps, lado: ex.lado || '' };
      const base = { halter: 12, total: 30, unico: 14, assist: 30 }[ex.carga];
      const kg = ex.carga === 'corporal' ? '' : ex.carga === 'elastico' ? 'verde'
        : String(ex.carga === 'assist' ? base - semana * 5 : base + semana * 2);
      series[ex.id] = Array.from({ length: b.voltas }, (_, i) => ({ kg, reps: String(i === 0 ? ex.reps[1] : ex.reps[0] + 1), ok: true }));
    }
    const inicio = new Date(d); inicio.setHours(7, 0, 0, 0);
    const min = 65 + (k % 3) * 5;
    sessoes.push({
      id: uid(), treino: f, data: isoDia(d), inicio: +inicio, termino: +inicio + min * 60000, duracaoMin: min,
      series, nomes, planejadas: contarSeries(t, {}).total, extras: {},
      checks: { cardioIni: true, prep: [], core: [], mob: [] },
      cardioFinal: k % 2 ? 'feito' : 'dispensado', esforco: 6 + (k % 3), notas: '',
    });
    k++;
  }
  const inicioPeso = new Date(); inicioPeso.setDate(inicioPeso.getDate() - 21);
  db = Object.assign(novoDb(), {
    sessoes: sessoes.map((s) => ({ ...s, programa: ID_PADRAO })), programas: [programaPadrao()], programaAtivo: ID_PADRAO,
    perfil: { nascimento: '1990-01-01', altura: '175', pesos: [{ data: isoDia(inicioPeso), kg: 80 }, { data: isoDia(), kg: 78.5 }] },
  });
  salvar();
}

// ---------- Eventos ----------
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const acoes = {
    entrar: enviarLogin, criar: enviarCriacao, redefinir: enviarRedefinicao,
    'nova-senha': enviarNovaSenha, 'trocar-senha': trocarSenha,
  };
  const fn = acoes[form.dataset.form];
  if (fn) fn(form).catch((err) => erroLogin(traduzErro(err)));
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el) return;
  const acao = el.dataset.acao;
  if (acao === 'login-modo') { modoLogin = el.dataset.modo; avisoLogin = ''; linkEmail = null; render(); }
  else if (acao === 'link-confirmar') confirmarLinkEmail(el);
  else if (acao === 'ver-senha') {
    const inp = el.parentElement.querySelector('input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  } else if (acao === 'sair') {
    // Confirmação dentro do próprio botão (o aviso nativo do navegador falha em alguns apps instalados no iPhone)
    if (el.dataset.confirmando !== '1') {
      el.dataset.confirmando = '1';
      el.textContent = 'Toque de novo para sair';
      el.classList.add('perigo');
      clearTimeout(el._volta);
      el._volta = setTimeout(() => { el.dataset.confirmando = ''; el.textContent = 'Sair'; el.classList.remove('perigo'); }, 4000);
      return;
    }
    clearTimeout(el._volta);
    el.disabled = true; el.textContent = 'Saindo...';
    sair();
  } else if (acao === 'sincronizar' && contaAtual?.servidor) {
    toast('Sincronizando...');
    sincronizarAoAbrir().then(() => toast(textoSync()));
  } else if (acao === 'demo-gerar' && contaAtual?.demo) {
    if (db.sessoes.length && !confirm('Substituir os dados deste perfil de demonstração por treinos de exemplo?')) return;
    gerarDemo(); toast('Treinos de exemplo carregados'); location.hash = '#/relatorios';
  }
});

// Mantém o texto de sincronização atualizado quando a tela de Ajustes está aberta
setInterval(() => { const el = $('#texto-sync'); if (el && contaAtual?.servidor) el.textContent = textoSync(); }, 2000);
