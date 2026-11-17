'use strict';

// Administração (somente papel 'admin'): usuários, pedidos de professor, papéis e números gerais.
// As regras do servidor (supabase-perfis.sql) deixam o administrador ler perfis, vínculos e dados_app de todos.

const adm = { carregando: false, perfis: null, vinculos: [], dados: {}, filtro: '', formAberto: false };

async function carregarAdmin() {
  adm.carregando = true;
  const [perfis, vinculos, dados] = await Promise.all([
    sb.from('perfis').select('*').order('criado_em', { ascending: false }),
    sb.from('vinculos').select('professor_id, aluno_id'),
    sb.from('dados_app').select('user_id, conteudo, atualizado_em'),
  ]);
  adm.perfis = perfis.data || [];
  adm.vinculos = vinculos.data || [];
  adm.dados = {};
  for (const d of dados.data || []) adm.dados[d.user_id] = d;
  for (const p of adm.perfis) nomesPerfis[p.user_id] = p.nome || p.email;
  adm.carregando = false;
  render();
}
window.addEventListener('hashchange', () => { if (rotaAtual().pag === 'admin') adm.perfis = null; });

function resumoUso(userId) {
  const d = adm.dados[userId];
  const sessoes = d?.conteudo?.sessoes || [];
  const seteDias = isoDia(new Date(Date.now() - 6 * 864e5));
  const ult = sessoes.reduce((m, s) => (s.data > m ? s.data : m), '');
  return { total: sessoes.length, semana: sessoes.filter((s) => s.data >= seteDias).length, ultimo: ult };
}

const NOME_PAPEL = { aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' };

function telaAdmin() {
  if (!ehAdmin()) return '<div class="vazio">Área do administrador.</div>';
  if (!adm.perfis && !adm.carregando) carregarAdmin();
  if (!adm.perfis) return '<h1>Administração</h1><div class="vazio">Carregando...</div>';
  const usos = Object.fromEntries(adm.perfis.map((p) => [p.user_id, resumoUso(p.user_id)]));
  const ativos = adm.perfis.filter((p) => usos[p.user_id].semana > 0).length;
  const treinosSemana = Object.values(usos).reduce((s, u) => s + u.semana, 0);
  const contar = (papel) => adm.perfis.filter((p) => p.papel === papel).length;
  const pedidos = adm.perfis.filter((p) => p.pedido_professor && p.papel === 'aluno');
  const f = adm.filtro.toLowerCase();
  const lista = adm.perfis.filter((p) => !f || `${p.nome} ${p.email}`.toLowerCase().includes(f));

  let h = `<a href="#/ajustes" class="small">‹ Ajustes</a><h1>Administração</h1>
    <div class="stats">
      <div class="stat"><b>${adm.perfis.length}</b><span>usuários</span></div>
      <div class="stat"><b>${contar('professor')}</b><span>professores</span></div>
      <div class="stat"><b>${adm.vinculos.length}</b><span>vínculos</span></div>
      <div class="stat"><b>${ativos}</b><span>ativos em 7 dias</span></div>
      <div class="stat"><b>${treinosSemana}</b><span>treinos em 7 dias</span></div>
      <div class="stat"><b>${contar('admin')}</b><span>administradores</span></div>
    </div>`;
  const profs = adm.perfis.filter((p) => ['professor', 'admin'].includes(p.papel));
  h += `<details class="card" ${adm.formAberto ? 'open' : ''} id="adm-novo"><summary class="linha entre"><b>+ Novo usuário</b><span class="seta">▾</span></summary>
    <div class="form">
      <label>Nome<input class="input-texto" id="nu-nome" autocomplete="off"></label>
      <label>E-mail<input class="input-texto" type="email" id="nu-email" autocapitalize="none" autocomplete="off"></label>
      <label>Papel<select id="nu-papel"><option value="aluno">Aluno</option><option value="professor">Professor</option></select></label>
      <label>Professor que vai acompanhar (opcional)<select id="nu-prof"><option value="">Nenhum</option>
        ${profs.map((p) => `<option value="${p.user_id}">${esc(p.nome || p.email)}</option>`).join('')}</select></label>
      <button class="btn" data-acao="adm-criar">Criar e enviar convite</button>
      <p class="muted small" style="margin:0">A pessoa recebe um e-mail com o link para entrar no app e criar a própria senha.</p>
    </div></details>`;
  if (pedidos.length) {
    h += `<h3>Pedidos para ser professor</h3><div class="card">${pedidos.map((p) => `<div class="linha entre small" style="padding:8px 0;border-top:1px solid var(--line)">
      <span><b>${esc(p.nome || '(sem nome)')}</b><br><span class="muted">${esc(p.email || '')}${p.cref ? ` · CREF ${esc(p.cref)}` : ''}</span></span>
      <span class="linha" style="gap:6px"><button class="btn-mini" data-acao="adm-aprovar" data-id="${p.user_id}">Aprovar</button>
      <button class="btn-mini" data-acao="adm-recusar" data-id="${p.user_id}">Recusar</button></span></div>`).join('')}</div>`;
  }
  h += `<h3>Usuários</h3><input class="input-texto" id="adm-filtro" placeholder="Buscar por nome ou e-mail" value="${esc(adm.filtro)}">
    <div class="card">${lista.map((p) => {
      const u = usos[p.user_id];
      const alunos = adm.vinculos.filter((v) => v.professor_id === p.user_id).length;
      const profs = adm.vinculos.filter((v) => v.aluno_id === p.user_id).map((v) => nomeDe(v.professor_id));
      const eu = p.user_id === contaAtual.id;
      return `<div style="padding:10px 0;border-top:1px solid var(--line)">
        <div class="linha entre"><a href="#/aluno/${p.user_id}" style="color:inherit"><b>${esc(p.nome || '(sem nome)')}</b></a>
          <select data-acao-select="adm-papel" data-id="${p.user_id}" ${eu ? 'disabled' : ''} style="width:auto">
            ${Object.entries(NOME_PAPEL).map(([v, t]) => `<option value="${v}" ${p.papel === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="muted small">${esc(p.email || '')}${p.cref ? ` · CREF ${esc(p.cref)}` : ''}</div>
        <div class="small">${u.total} treinos · ${u.semana} na semana${u.ultimo ? ` · último em ${fmtData(u.ultimo)}` : ''}
          ${alunos ? ` · ${alunos} aluno${alunos === 1 ? '' : 's'}` : ''}${profs.length ? ` · professor: ${esc(profs.join(', '))}` : ''}</div></div>`;
    }).join('') || '<p class="muted small">Nenhum usuário encontrado.</p>'}</div>
    <p class="muted small">Toque no nome para ver treinos e relatórios do usuário (somente leitura).</p>`;
  return h;
}

async function mudarPapel(id, papel, extra = {}) {
  const { error } = await sb.from('perfis').update({ papel, pedido_professor: false, ...extra }).eq('user_id', id);
  if (error) { toast('Não foi possível alterar o papel'); return false; }
  const p = adm.perfis.find((x) => x.user_id === id);
  if (p) Object.assign(p, { papel, pedido_professor: false });
  return true;
}

// Chama a função do servidor (supabase/functions/admin-usuarios), que guarda a chave secreta
async function criarUsuario(botao) {
  const dados = {
    nome: $('#nu-nome').value.trim(), email: normEmail($('#nu-email').value),
    papel: $('#nu-papel').value, professor_id: $('#nu-prof').value || null, redirect_to: URL_APP,
  };
  if (!dados.nome) return toast('Informe o nome');
  if (!emailValido(dados.email)) return toast('Informe um e-mail válido');
  if (dados.papel === 'professor') dados.professor_id = null;
  botao.disabled = true; botao.textContent = 'Enviando convite...';
  let msg = null;
  try {
    const { data, error } = await sb.functions.invoke('admin-usuarios', { body: dados });
    if (error) {
      try { msg = (await error.context.json()).erro; } catch (e) { /* resposta sem corpo */ }
      msg ||= /Failed to send|fetch|404/i.test(error.message || '') ? 'A função admin-usuarios ainda não foi instalada no Supabase.' : 'Não foi possível criar o usuário.';
    } else if (!data?.ok) msg = data?.erro || 'Não foi possível criar o usuário.';
  } catch (e) { msg = 'Sem conexão com o servidor.'; }
  botao.disabled = false; botao.textContent = 'Criar e enviar convite';
  if (msg) return toast(msg);
  toast(`Convite enviado para ${dados.email}`);
  adm.formAberto = false; adm.perfis = null; render();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el || !el.dataset.acao.startsWith('adm-')) return;
  const id = el.dataset.id;
  if (el.dataset.acao === 'adm-criar') { adm.formAberto = true; return criarUsuario(el); }
  if (el.dataset.acao === 'adm-aprovar') { if (await mudarPapel(id, 'professor')) { toast(`${nomeDe(id)} agora é professor`); render(); } }
  else if (el.dataset.acao === 'adm-recusar') {
    const { error } = await sb.from('perfis').update({ pedido_professor: false }).eq('user_id', id);
    if (error) return toast('Não foi possível recusar');
    adm.perfis.find((x) => x.user_id === id).pedido_professor = false; render();
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.acaoSelect !== 'adm-papel') return;
  const p = adm.perfis.find((x) => x.user_id === el.dataset.id);
  if (!confirm(`Mudar ${nomeDe(el.dataset.id)} para ${NOME_PAPEL[el.value]}?`)) { el.value = p.papel; return; }
  if (await mudarPapel(el.dataset.id, el.value)) toast('Papel alterado'); else el.value = p.papel;
  render();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'adm-filtro') return;
  adm.filtro = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const campo = $('#adm-filtro'); campo.focus(); campo.setSelectionRange(pos, pos);
});
