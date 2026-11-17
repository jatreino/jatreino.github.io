'use strict';

// Módulo do professor: alunos, convites, acompanhamento e envio de programas.
// Os dados do aluno são lidos de dados_app (permitido pelas regras do servidor para professores
// vinculados e para o administrador) e mostrados com as mesmas telas do app, só para leitura.

const prof = { alunos: null, convites: [], carregando: false, usuarios: {} };
let criandoParaAluno = null; // programa novo criado a partir da tela do aluno (gerador.js / programas.js)

// Roda uma tela do app com os dados de outro usuário, sem gravar nada
function comDadosDe(dados, fn) {
  const antes = db, leituraAntes = somenteLeitura;
  db = Object.assign(novoDb(), structuredClone(dados || {}));
  migrarProgramas(db);
  somenteLeitura = true;
  try { return fn(); } finally { db = antes; somenteLeitura = leituraAntes; }
}

async function carregarUsuario(id, forcar = false) {
  const atual = prof.usuarios[id];
  if (atual && !forcar && Date.now() - atual.em < 30000) return atual;
  const [perfil, dados, vinc] = await Promise.all([
    sb.from('perfis').select('*').eq('user_id', id).maybeSingle(),
    sb.from('dados_app').select('conteudo, atualizado_em').eq('user_id', id).maybeSingle(),
    sb.from('vinculos').select('aluno_id').eq('professor_id', contaAtual.id).eq('aluno_id', id).maybeSingle(),
  ]);
  const u = { id, perfil: perfil.data, vinculado: !!vinc.data, dados: dados.data?.conteudo || novoDb(), atualizado: dados.data?.atualizado_em, em: Date.now() };
  if (u.perfil) nomesPerfis[id] = u.perfil.nome || u.perfil.email;
  prof.usuarios[id] = u;
  return u;
}

async function carregarAlunos() {
  prof.carregando = true;
  const eu = contaAtual.id;
  const [vinc, conv] = await Promise.all([
    sb.from('vinculos').select('aluno_id, criado_em').eq('professor_id', eu),
    sb.from('convites').select('*').eq('professor_id', eu).is('usado_por', null).order('criado_em', { ascending: false }),
  ]);
  const ids = (vinc.data || []).map((v) => v.aluno_id);
  prof.convites = conv.data || [];
  const usuarios = await Promise.all(ids.map((id) => carregarUsuario(id, true)));
  prof.alunos = usuarios;
  prof.carregando = false;
  render();
}

// Indicadores de acompanhamento de um aluno
function indicadoresAluno(dados) {
  return comDadosDe(dados, () => {
    const sessoes = sessoesOrdenadas();
    const ult = sessoes[0];
    const dias = ult ? Math.round((dataDeIso(isoDia()) - dataDeIso(ult.data)) / 864e5) : null;
    const seteDias = isoDia(new Date(Date.now() - 6 * 864e5));
    const p = programaAtivo();
    const andamento = p ? progressoPrograma(p) : null;
    const recentes = sessoes.filter((s) => s.data >= isoDia(new Date(Date.now() - 14 * 864e5)));
    const dor = recentes.find((s) => /\b(dor|doeu|doendo|inc[oô]modo|lesão|lesao)\b/i.test(s.notas || ''));
    const alertas = [];
    if (dias === null) alertas.push('Ainda não treinou');
    else if (dias >= 7) alertas.push(`${dias} dias sem treinar`);
    if (andamento?.concluido) alertas.push('Programa concluído');
    if (!p) alertas.push('Sem programa');
    if (dor) alertas.push(`Relatou dor em ${fmtData(dor.data)}`);
    return {
      ultimo: ult ? (dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`) : 'nunca',
      semana: sessoes.filter((s) => s.data >= seteDias).length,
      programa: p ? `${p.nome} · ${andamento.texto}` : 'Nenhum programa',
      alertas,
    };
  });
}

// ---------- Lista de alunos ----------
function telaAlunos() {
  if (!ehProfessor()) return '<div class="vazio">Área dos personais.</div>';
  if (!prof.alunos && !prof.carregando) carregarAlunos();
  let h = `<h1>Alunos</h1>
    <div class="linha" style="gap:8px"><a class="btn" href="#/convidar">+ Convidar aluno</a>
      <a class="btn sec" href="#/mensagens">Mensagens${social.naoLidas ? ` (${social.naoLidas})` : ''}</a></div>
    ${ehAdmin() ? '<a class="btn sec" href="#/admin">Administração</a>' : ''}`;
  if (!prof.alunos) return h + '<div class="vazio">Carregando alunos...</div>';
  if (!prof.alunos.length) {
    h += `<div class="card"><p class="small">Você ainda não tem alunos. Toque em <b>Convidar aluno</b>, informe o nome e o e-mail e envie o link:
      quando o aluno criar a conta (ou entrar) pelo link, ele aparece aqui.</p></div>`;
  }
  for (const u of prof.alunos) {
    const ind = indicadoresAluno(u.dados);
    h += `<a class="card" href="#/aluno/${u.id}" style="display:block;color:inherit;text-decoration:none">
      <div class="linha entre"><h2>${esc(nomeDe(u.id))}</h2><span class="seta">›</span></div>
      <p class="muted small">${esc(ind.programa)}</p>
      <p class="small">Último treino: <b>${esc(ind.ultimo)}</b> · ${ind.semana} na semana</p>
      ${ind.alertas.length ? `<div class="opcoes" style="margin-top:6px">${ind.alertas.map((a) => `<span class="tag alerta">${esc(a)}</span>`).join('')}</div>` : ''}</a>`;
  }
  if (prof.convites.length) {
    h += `<h3>Convites aguardando</h3><div class="card">${prof.convites.map((c) => `<div class="linha entre small" style="padding:8px 0;border-top:1px solid var(--line)">
      <span><b>${esc(c.nome || 'Sem nome')}</b><br><span class="muted">${esc(c.email || '')}</span></span>
      <span class="linha" style="gap:6px"><button class="btn-mini" data-acao="prof-compartilhar" data-codigo="${esc(c.codigo)}" data-nome="${esc(c.nome || '')}">Enviar link</button>
      <button class="btn-mini" data-acao="prof-cancelar-convite" data-codigo="${esc(c.codigo)}">✕</button></span></div>`).join('')}</div>`;
  }
  h += '<p class="muted small" style="margin-top:12px">Seus programas na aba Treinos servem de modelo: você pode enviar o mesmo programa para vários alunos.</p>';
  return h;
}
window.addEventListener('hashchange', () => {
  const pag = rotaAtual().pag;
  if (pag === 'alunos') prof.alunos = null;
  if (!['criar', 'importar', 'catalogo'].includes(pag)) criandoParaAluno = null;
});

// ---------- Convidar ----------
const linkConvite = (codigo) => `${URL_APP}#/convite/${codigo}`;
function telaConvidar() {
  return `<a href="#/alunos" class="small">‹ Alunos</a><h1>Convidar aluno</h1>
    <div class="card form">
      <label>Nome do aluno<input class="input-texto" id="cv-nome" placeholder="ex.: Maria Souza"></label>
      <label>E-mail (opcional, para você se lembrar)<input class="input-texto" type="email" id="cv-email" autocapitalize="none"></label>
      <button class="btn" data-acao="prof-criar-convite">Gerar link de convite</button>
      <p class="muted small">O aluno abre o link, cria a conta (ou entra) e aceita. Ele passa a aparecer na sua lista e você pode enviar treinos e mensagens.</p>
    </div>`;
}
async function compartilharConvite(codigo, nome) {
  const link = linkConvite(codigo);
  const texto = `Olá${nome ? `, ${nome.split(' ')[0]}` : ''}! Vou acompanhar seus treinos pelo app Já treinô? Abra este link para aceitar: ${link}`;
  if (navigator.share) { try { await navigator.share({ title: 'Convite Já treinô?', text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch (e) { prompt('Copie o link do convite:', link); }
}

// ---------- Tela do aluno ----------
// #/aluno/<id>                     resumo e ações
// #/aluno/<id>/relatorios|historico|progresso[/f]|exercicio/<ex>|sessao/<s>   telas do app, só leitura
function telaAluno(id, args) {
  const u = prof.usuarios[id];
  if (!u) { carregarUsuario(id).then(render); return '<div class="vazio">Carregando...</div>'; }
  const sub = args[1];
  const voltar = `<a href="#/aluno/${id}" class="small">‹ ${esc(nomeDe(id))}</a>`;
  if (sub) {
    const telasLeitura = { relatorios: () => telaRelatorios(), historico: () => telaHistorico(), progresso: () => telaProgresso(args[2]), exercicio: () => telaExercicio(args[2]), sessao: () => telaSessao(args[2]) };
    if (!telasLeitura[sub]) return '<div class="vazio">Tela não encontrada.</div>';
    let h = comDadosDe(u.dados, telasLeitura[sub]);
    // Links passam a apontar para as telas do aluno; ações de alterar dados são retiradas
    h = h.replace(/href="#\/(sessao|exercicio|progresso|historico|relatorios)/g, `href="#/aluno/${id}/$1`)
      .replace(/<button class="btn perigo" data-acao="apagar-sessao"[^>]*>[^<]*<\/button>/g, '')
      .replace(/<a class="btn sec" href="#\/registrar">[^<]*<\/a>/g, '')
      .replace(/<a href="#\/aluno\/[^"]+\/historico" class="small">‹ Histórico<\/a>/, `<a href="#/aluno/${id}/historico" class="small">‹ Histórico de ${esc(nomeDe(id))}</a>`);
    if (sub === 'sessao') h += blocoComentarios(args[2], id);
    return h.trimStart().startsWith('<a ') ? h : `${voltar}${h}`;
  }
  const ind = indicadoresAluno(u.dados);
  const ativo = comDadosDe(u.dados, () => programaAtivo());
  const meus = (db.programas || []).filter((p) => !p.paraAluno || p.paraAluno === id);
  let h = `<a href="${u.vinculado ? '#/alunos' : '#/admin'}" class="small">‹ ${u.vinculado ? 'Alunos' : 'Administração'}</a><h1>${esc(nomeDe(id))}</h1>
    <p class="muted small">${esc(u.perfil?.email || '')}${u.atualizado ? ` · atualizado em ${fmtData(isoDia(new Date(u.atualizado)))}` : ''}</p>
    <div class="card"><p class="small"><b>Programa:</b> ${esc(ind.programa)}</p>
      <p class="small">Último treino: <b>${esc(ind.ultimo)}</b> · ${ind.semana} treino${ind.semana === 1 ? '' : 's'} nos últimos 7 dias</p>
      ${ind.alertas.length ? `<div class="opcoes" style="margin-top:6px">${ind.alertas.map((a) => `<span class="tag alerta">${esc(a)}</span>`).join('')}</div>` : ''}</div>
    <div class="fichas" style="grid-template-columns:repeat(2,1fr)">
      <a class="ficha" href="#/aluno/${id}/historico"><b>☰</b><span>Histórico</span></a>
      <a class="ficha" href="#/aluno/${id}/relatorios"><b>▦</b><span>Relatórios</span></a>
      <a class="ficha" href="#/aluno/${id}/progresso"><b>↗</b><span>Evolução das cargas</span></a>
      ${u.vinculado || ehAdmin() ? `<a class="ficha" href="#/conversa/${id}"><b>💬</b><span>Mensagens</span></a>` : ''}
    </div>`;
  if (!u.vinculado) return h + '<p class="muted small">Você vê os dados deste usuário como administrador. Para prescrever treinos, ele precisa aceitar um convite seu.</p>';
  h += `<h3>Prescrever treino</h3><div class="card">
      ${ativo ? `<button class="btn sec" data-acao="prof-editar-atual" data-id="${id}">Ajustar o programa atual do aluno</button>` : ''}
      <button class="btn sec" data-acao="prof-criar-para" data-id="${id}">Criar um programa novo para o aluno</button>
      ${meus.length ? `<p class="small muted" style="margin-top:12px">Ou envie um dos seus programas:</p>
        ${meus.map((p) => `<div class="linha entre small" style="padding:8px 0;border-top:1px solid var(--line)">
          <span><b>${esc(p.nome)}</b> <span class="muted">· ${p.ordem.length} fichas${p.paraAluno ? ' · rascunho para este aluno' : ''}</span></span>
          <span class="linha" style="gap:6px"><a class="btn-mini" href="#/programa/${p.id}">Ver</a>
          <a class="btn-mini" href="#/enviar/${p.id}/${id}">Enviar</a></span></div>`).join('')}` : ''}</div>
    <button class="btn perigo" data-acao="prof-desvincular" data-id="${id}">Deixar de acompanhar este aluno</button>`;
  return h;
}

// Copia o programa atual do aluno para o professor editar (com outro id, para não misturar com os seus)
function editarProgramaDoAluno(id) {
  const u = prof.usuarios[id];
  const original = comDadosDe(u.dados, () => structuredClone(programaAtivo()));
  if (!original) return;
  const anterior = db.programas.find((p) => p.paraAluno === id && p.substitui === original.id);
  if (anterior && !confirm(`Você já tem um rascunho do programa de ${nomeDe(id)}. Substituir pela versão atual do aluno?`)) {
    programaEmEdicao = anterior.id; location.hash = `#/programa/${anterior.id}`; return;
  }
  if (anterior) db.programas = db.programas.filter((p) => p !== anterior);
  const copia = { ...original, id: `prog-${uid()}`, substitui: original.id, paraAluno: id, nome: original.nome };
  db.programas.push(copia);
  salvar();
  programaEmEdicao = copia.id;
  toast('Edite as fichas e depois toque em Enviar');
  location.hash = `#/programa/${copia.id}`;
}

// ---------- Enviar programa ----------
// #/enviar/<programa>[/<aluno>]
function telaEnviar(progId, args) {
  const p = programaPorId(progId);
  if (!p) return '<div class="vazio">Programa não encontrado.</div>';
  if (!prof.alunos && !prof.carregando) carregarAlunos();
  if (!prof.alunos) return '<div class="vazio">Carregando alunos...</div>';
  const pre = args[1] || p.paraAluno;
  return `<a href="#/programa/${p.id}" class="small">‹ ${esc(p.nome)}</a><h1>Enviar programa</h1>
    <p class="muted small">${esc(p.nome)} · ${p.ordem.length} fichas · ${esc(descreverPeriodo(p.periodicidade))}</p>
    ${prof.alunos.length ? `<div class="card form">
      <label>Para<select id="env-aluno">${prof.alunos.map((u) => `<option value="${u.id}" ${u.id === pre ? 'selected' : ''}>${esc(nomeDe(u.id))}</option>`).join('')}</select></label>
      <label>Mensagem para o aluno (opcional)<textarea id="env-msg" rows="3" placeholder="ex.: Novo treino para as próximas 8 semanas. Qualquer dor, me avise."></textarea></label>
      ${p.substitui ? '<p class="small muted" style="margin:0">Este programa substitui o programa atual do aluno, mantendo o histórico.</p>' : ''}
      <button class="btn" data-acao="prof-enviar" data-id="${p.id}">Enviar</button></div>`
      : '<div class="card small">Você ainda não tem alunos vinculados. Convide um aluno primeiro.</div>'}`;
}

async function enviarPrograma(progId) {
  const p = programaPorId(progId), alunoId = $('#env-aluno').value, msg = $('#env-msg').value.trim();
  const programa = structuredClone(p);
  programa.id = p.substitui || `prog-${uid()}`; // novo id para não sobrepor um programa do próprio aluno
  delete programa.paraAluno; delete programa.substitui;
  programa.criadoEm = isoDia();
  const { error } = await sb.from('prescricoes').insert({ professor_id: contaAtual.id, aluno_id: alunoId, programa, mensagem: msg || null });
  if (error) return toast('Não foi possível enviar. Confira se o aluno ainda está vinculado.');
  await enviarMensagem(alunoId, `📋 Enviei um novo programa: ${p.nome}${msg ? `\n${msg}` : ''}`);
  toast(`Programa enviado para ${nomeDe(alunoId)}`);
  location.hash = `#/aluno/${alunoId}`;
}

// ---------- Eventos ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el || !el.dataset.acao.startsWith('prof-')) return;
  const acao = el.dataset.acao;
  if (acao === 'prof-criar-convite') {
    const nome = $('#cv-nome').value.trim(), email = normEmail($('#cv-email').value);
    if (!nome) return toast('Informe o nome do aluno');
    const codigo = uid() + uid().slice(-4);
    const { error } = await sb.from('convites').insert({ codigo, professor_id: contaAtual.id, nome, email: email || null });
    if (error) return toast('Não foi possível criar o convite');
    await compartilharConvite(codigo, nome);
    location.hash = '#/alunos';
  } else if (acao === 'prof-compartilhar') compartilharConvite(el.dataset.codigo, el.dataset.nome);
  else if (acao === 'prof-cancelar-convite') {
    if (!confirm('Cancelar este convite? O link deixa de funcionar.')) return;
    await sb.from('convites').delete().eq('codigo', el.dataset.codigo);
    prof.alunos = null; render();
  } else if (acao === 'prof-editar-atual') editarProgramaDoAluno(el.dataset.id);
  else if (acao === 'prof-criar-para') { criandoParaAluno = el.dataset.id; location.hash = '#/criar'; }
  else if (acao === 'prof-enviar') { el.disabled = true; await enviarPrograma(el.dataset.id); el.disabled = false; }
  else if (acao === 'prof-desvincular') {
    if (!confirm(`Deixar de acompanhar ${nomeDe(el.dataset.id)}? Você não verá mais os treinos dele.`)) return;
    await sb.from('vinculos').delete().eq('professor_id', contaAtual.id).eq('aluno_id', el.dataset.id);
    delete prof.usuarios[el.dataset.id]; prof.alunos = null;
    location.hash = '#/alunos';
  }
});
