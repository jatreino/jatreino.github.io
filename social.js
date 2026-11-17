'use strict';

// Perfis e relação professor–aluno (tabelas de supabase-perfis.sql).
// - Todo usuário tem um perfil: 'aluno' (padrão), 'professor' ou 'admin'.
// - O aluno pode usar o app sozinho; vincula-se a um professor aceitando um convite (link).
// - O professor lê os treinos dos alunos vinculados, envia programas (prescrições) e mensagens.
// Se o script do servidor ainda não foi rodado, tudo aqui fica escondido e o app funciona como antes.

let meuPerfil = null;
const social = { disponivel: false, naoLidas: 0, prescricoes: [], professores: [], convites: [], carregadoEm: 0 };
const ehProfessor = () => social.disponivel && ['professor', 'admin'].includes(meuPerfil?.papel);
const ehAdmin = () => social.disponivel && meuPerfil?.papel === 'admin';
const CONVITE_KEY = 'meutreino:convite';
const nomesPerfis = {}; // user_id -> nome, para mostrar quem é quem

function guardarConviteDoEndereco(hash) {
  const m = (hash || '').match(/^#\/convite\/([\w-]{6,40})/);
  if (m) localStorage.setItem(CONVITE_KEY, m[1]);
}
guardarConviteDoEndereco(location.hash);
window.addEventListener('hashchange', () => guardarConviteDoEndereco(location.hash));

async function carregarPerfil() {
  meuPerfil = null; social.disponivel = false;
  if (!contaAtual?.servidor) return;
  const { data, error } = await sb.from('perfis').select('*').eq('user_id', contaAtual.id).maybeSingle();
  if (error) return; // tabelas ainda não criadas no servidor
  social.disponivel = true;
  meuPerfil = data;
  if (!meuPerfil) {
    const novo = { user_id: contaAtual.id, nome: contaAtual.nome, email: contaAtual.email };
    const r = await sb.from('perfis').insert(novo).select().single();
    meuPerfil = r.data || { ...novo, papel: 'aluno' };
  }
  if (!meuPerfil.nome && contaAtual.nome) {
    await sb.from('perfis').update({ nome: contaAtual.nome }).eq('user_id', contaAtual.id);
    meuPerfil.nome = contaAtual.nome;
  }
  nomesPerfis[meuPerfil.user_id] = meuPerfil.nome;
  await atualizarAvisosSociais();
}

async function buscarNomes(ids) {
  const faltam = [...new Set(ids)].filter((id) => id && !(id in nomesPerfis));
  if (!faltam.length) return;
  const { data } = await sb.from('perfis').select('user_id, nome, email').in('user_id', faltam);
  for (const p of data || []) nomesPerfis[p.user_id] = p.nome || p.email || 'Sem nome';
}
const nomeDe = (id) => nomesPerfis[id] || 'Usuário';

// Mensagens não lidas, treinos enviados pelo professor e professores vinculados
async function atualizarAvisosSociais() {
  if (!social.disponivel || !contaAtual) return;
  const eu = contaAtual.id;
  const [msgs, presc, vinc] = await Promise.all([
    sb.from('mensagens').select('id', { count: 'exact', head: true }).eq('para', eu).is('lida_em', null),
    sb.from('prescricoes').select('id, professor_id, programa, mensagem, criado_em').eq('aluno_id', eu).is('aplicada_em', null).order('criado_em', { ascending: false }),
    sb.from('vinculos').select('professor_id').eq('aluno_id', eu),
  ]);
  social.naoLidas = msgs.count || 0;
  social.prescricoes = presc.data || [];
  social.professores = (vinc.data || []).map((v) => v.professor_id);
  // Convites de personal enviados para o meu e-mail (supabase-convites-email.sql); sem a função, fica vazio
  try { const r = await sb.rpc('meus_convites'); social.convites = r.error ? [] : r.data || []; } catch (e) { social.convites = []; }
  await buscarNomes([...social.professores, ...social.prescricoes.map((p) => p.professor_id)]);
  social.carregadoEm = Date.now();
  atualizarNav();
}
setInterval(() => { if (document.visibilityState === 'visible' && social.disponivel) atualizarAvisosSociais(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && social.disponivel) atualizarAvisosSociais(); });

// Abas conforme o papel: professores veem "Alunos" no lugar de "Progresso" (que segue em Relatórios)
function atualizarNav() {
  const alunos = $('#nav [data-tab="alunos"]'), progresso = $('#nav [data-tab="progresso"]');
  if (alunos) alunos.hidden = !ehProfessor();
  if (progresso) progresso.hidden = ehProfessor();
  const aviso = social.naoLidas > 0 || social.prescricoes.length > 0;
  $('#nav [data-tab="hoje"]')?.classList.toggle('tem-aviso', aviso && !ehProfessor());
  alunos?.classList.toggle('tem-aviso', social.naoLidas > 0);
}

// ---------- Hoje: avisos para o aluno ----------
function cartoesSociaisHoje() {
  if (!social.disponivel) return '';
  let h = '';
  for (const c of social.convites || []) {
    h += `<div class="card destaque"><span class="tag ac">Convite</span>
      <h2 style="margin-top:8px">${esc(c.professor_nome || 'Um personal')} quer acompanhar seus treinos</h2>
      <p class="small" style="margin:0 0 6px">Ao aceitar, ${esc(c.professor_nome || 'o personal')} poderá ver seus treinos, cargas, peso e medidas, enviar programas e trocar mensagens com você.</p>
      <p class="muted small">Você pode desfazer o vínculo quando quiser, em Ajustes.</p>
      <div class="linha" style="gap:8px"><button class="btn" data-acao="soc-aceitar" data-codigo="${esc(c.codigo)}">Aceitar</button>
      <button class="btn sec" data-acao="soc-recusar-email" data-codigo="${esc(c.codigo)}">Agora não</button></div></div>`;
  }
  for (const pr of social.prescricoes) {
    h += `<div class="card destaque"><span class="tag ac">Novo treino de ${esc(nomeDe(pr.professor_id))}</span>
      <h2 style="margin-top:8px">${esc(pr.programa?.nome || 'Programa')}</h2>
      ${pr.mensagem ? `<p class="small">“${esc(pr.mensagem)}”</p>` : ''}
      <p class="muted small">${(pr.programa?.ordem || []).length} fichas · ${esc(descreverPeriodo(pr.programa?.periodicidade))}</p>
      <button class="btn" data-acao="soc-aplicar" data-id="${pr.id}">Usar este treino</button></div>`;
  }
  if (social.naoLidas > 0) {
    h += `<a class="card" href="#/mensagens" style="display:block;color:inherit;text-decoration:none">
      <div class="linha entre"><b>💬 ${social.naoLidas} mensage${social.naoLidas === 1 ? 'm nova' : 'ns novas'}</b><span class="seta">›</span></div></a>`;
  }
  return h;
}

async function aplicarPrescricao(id) {
  const pr = social.prescricoes.find((x) => x.id === id);
  if (!pr) return;
  if (db.ativa) return toast('Finalize ou descarte o treino em andamento antes de trocar de programa');
  const p = structuredClone(pr.programa);
  p.origem = p.origem === 'padrao' ? 'padrao' : 'professor';
  p.autor = nomeDe(pr.professor_id);
  delete p.paraAluno;
  const existente = programaPorId(p.id);
  if (existente) Object.assign(existente, { ...p, inicio: existente.inicio, baseSessoes: existente.baseSessoes || 0 });
  else { p.inicio = isoDia(); p.baseSessoes = 0; db.programas.push(p); }
  db.programaAtivo = p.id; fichaEscolhida = null;
  salvar();
  await sb.from('prescricoes').update({ aplicada_em: new Date().toISOString() }).eq('id', id);
  social.prescricoes = social.prescricoes.filter((x) => x.id !== id);
  toast(`Programa ativo: ${p.nome}`);
  atualizarNav(); render();
}

// ---------- Convite ----------
const estadoConvite = { codigo: null, professor: null, valido: false, carregando: false, erro: '' };
function telaConvite(codigo) {
  if (!social.disponivel) return `<div class="vazio">Os convites ainda não estão ativos no servidor.</div>`;
  if (estadoConvite.codigo !== codigo) {
    Object.assign(estadoConvite, { codigo, professor: null, valido: false, carregando: true, erro: '' });
    sb.rpc('ver_convite', { p_codigo: codigo }).then(({ data, error }) => {
      const linha = Array.isArray(data) ? data[0] : data;
      Object.assign(estadoConvite, { carregando: false, professor: linha?.professor_nome || null, valido: !!linha?.valido, erro: error ? error.message : '' });
      render();
    });
  }
  if (estadoConvite.carregando) return '<div class="vazio">Carregando convite...</div>';
  if (!estadoConvite.professor || !estadoConvite.valido) {
    localStorage.removeItem(CONVITE_KEY);
    return `<h1>Convite</h1><div class="card">Este convite não existe ou já foi usado. Peça um novo link ao seu personal.</div><a class="btn sec" href="#/hoje">Voltar</a>`;
  }
  return `<h1>Convite</h1><div class="card destaque">
    <h2>${esc(estadoConvite.professor)} convidou você</h2>
    <p class="small">Ao aceitar, ${esc(estadoConvite.professor)} passa a ser seu personal no app e poderá:</p>
    <p class="small">• ver seus treinos, cargas, peso e relatórios;<br>• enviar programas de treino para você;<br>• trocar mensagens e comentar seus treinos.</p>
    <p class="muted small">Você pode desfazer o vínculo quando quiser, em Ajustes. Seus treinos continuam seus.</p>
    <button class="btn" data-acao="soc-aceitar" data-codigo="${esc(codigo)}">Aceitar convite</button>
    <button class="btn sec" data-acao="soc-recusar">Agora não</button></div>`;
}

// ---------- Mensagens ----------
const conversa = { com: null, itens: [], carregando: false, timer: null };
async function carregarConversa(outro) {
  const eu = contaAtual.id;
  const { data } = await sb.from('mensagens').select('*').in('de', [eu, outro]).in('para', [eu, outro]).order('criado_em', { ascending: true }).limit(300);
  if (conversa.com !== outro) return;
  conversa.itens = data || [];
  const naoLidas = conversa.itens.filter((m) => m.para === eu && !m.lida_em).map((m) => m.id);
  if (naoLidas.length) {
    await sb.from('mensagens').update({ lida_em: new Date().toISOString() }).in('id', naoLidas);
    social.naoLidas = Math.max(0, social.naoLidas - naoLidas.length); atualizarNav();
  }
  conversa.carregando = false;
  if (rotaAtual().pag === 'conversa') {
    const caixa = $('#conversa-lista');
    const noFim = !caixa || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
    render();
    if (noFim) window.scrollTo(0, document.body.scrollHeight);
  }
}

function telaConversa(outro) {
  if (!social.disponivel) return '<div class="vazio">Mensagens indisponíveis.</div>';
  if (conversa.com !== outro) {
    Object.assign(conversa, { com: outro, itens: [], carregando: true });
    buscarNomes([outro]).then(() => carregarConversa(outro));
    clearInterval(conversa.timer);
    conversa.timer = setInterval(() => { if (rotaAtual().pag === 'conversa' && conversa.com) carregarConversa(conversa.com); else clearInterval(conversa.timer); }, 8000);
  }
  const eu = contaAtual.id;
  const voltar = ehProfessor() && !social.professores.includes(outro) ? `#/aluno/${outro}` : '#/mensagens';
  let h = `<a href="${voltar}" class="small">‹ Voltar</a><h1>${esc(nomeDe(outro))}</h1><div id="conversa-lista" class="conversa">`;
  if (conversa.carregando) h += '<p class="muted small">Carregando...</p>';
  else if (!conversa.itens.length) h += '<p class="muted small">Nenhuma mensagem ainda. Escreva a primeira!</p>';
  let dia = '';
  for (const m of conversa.itens) {
    const d = isoDia(new Date(m.criado_em));
    if (d !== dia) { dia = d; h += `<p class="conversa-dia">${fmtDataLonga(d)}</p>`; }
    const hora = new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    h += `<div class="balao ${m.de === eu ? 'meu' : ''}">${m.sessao_id ? '<span class="small muted">Sobre um treino · </span>' : ''}${esc(m.texto).replace(/\n/g, '<br>')}<span class="hora">${hora}</span></div>`;
  }
  h += `</div><div class="barra-fixa"><textarea id="msg-texto" rows="1" placeholder="Escreva uma mensagem"></textarea>
    <button class="btn" style="width:auto" data-acao="soc-enviar" data-para="${esc(outro)}">Enviar</button></div>`;
  return h;
}

async function enviarMensagem(para, texto, sessaoId = null) {
  const { error } = await sb.from('mensagens').insert({ de: contaAtual.id, para, texto: texto.slice(0, 4000), sessao_id: sessaoId });
  if (error) { toast('Não foi possível enviar a mensagem'); return false; }
  return true;
}

// Lista de conversas: professores do aluno e/ou alunos do professor
const listaMsgs = { itens: null };
function telaMensagens() {
  if (!social.disponivel) return '<div class="vazio">Mensagens indisponíveis.</div>';
  if (!listaMsgs.itens) {
    const eu = contaAtual.id;
    Promise.all([
      sb.from('mensagens').select('de, para, texto, criado_em, lida_em').eq('para', eu).order('criado_em', { ascending: false }).limit(200),
      sb.from('mensagens').select('de, para, texto, criado_em, lida_em').eq('de', eu).order('criado_em', { ascending: false }).limit(200),
      ehProfessor() ? sb.from('vinculos').select('aluno_id').eq('professor_id', eu) : Promise.resolve({ data: [] }),
    ]).then(async ([recebidas, enviadas, alunos]) => {
      const porPessoa = {};
      const pessoas = new Set([...social.professores, ...(alunos.data || []).map((a) => a.aluno_id)]);
      for (const m of [...(recebidas.data || []), ...(enviadas.data || [])]) {
        const outro = m.de === eu ? m.para : m.de;
        pessoas.add(outro);
        const p = (porPessoa[outro] ??= { ultima: null, naoLidas: 0 });
        if (!p.ultima || m.criado_em > p.ultima.criado_em) p.ultima = m;
        if (m.para === eu && !m.lida_em) p.naoLidas++;
      }
      await buscarNomes([...pessoas]);
      listaMsgs.itens = [...pessoas].map((id) => ({ id, ...(porPessoa[id] || { ultima: null, naoLidas: 0 }) }))
        .sort((a, b) => (b.ultima?.criado_em || '').localeCompare(a.ultima?.criado_em || ''));
      render();
    });
    return '<h1>Mensagens</h1><div class="vazio">Carregando...</div>';
  }
  if (!listaMsgs.itens.length) return '<h1>Mensagens</h1><div class="vazio">Você ainda não tem com quem conversar. As conversas aparecem quando você se vincula a um personal.</div>';
  return `<h1>Mensagens</h1><div class="card">${listaMsgs.itens.map((p) => `<a class="item" href="#/conversa/${p.id}">
    <div class="cresce"><b>${esc(nomeDe(p.id))}</b>${social.professores.includes(p.id) ? ' <span class="tag">personal</span>' : ''}
      <div class="muted small">${p.ultima ? esc(p.ultima.texto.slice(0, 60)) : 'Sem mensagens'}</div></div>
    ${p.naoLidas ? `<span class="tag ac">${p.naoLidas}</span>` : '<span class="seta">›</span>'}</a>`).join('')}</div>`;
}
window.addEventListener('hashchange', () => { if (rotaAtual().pag !== 'mensagens') listaMsgs.itens = null; if (rotaAtual().pag !== 'conversa') conversa.com = null; });

// Comentários do professor num treino (aparecem no detalhe do treino, para o aluno e para o professor)
const comentarios = {};
function blocoComentarios(sessaoId, donoId) {
  if (!social.disponivel) return '';
  if (!(sessaoId in comentarios)) {
    comentarios[sessaoId] = null;
    sb.from('mensagens').select('*').eq('sessao_id', sessaoId).order('criado_em', { ascending: true }).then(({ data }) => {
      comentarios[sessaoId] = data || [];
      if (data?.length || ehProfessor()) render();
    });
    return '';
  }
  const lista = comentarios[sessaoId] || [];
  const souProfessorDoDono = ehProfessor() && donoId && donoId !== contaAtual.id;
  // O aluno responde a quem comentou (ou ao primeiro professor)
  const respostaPara = souProfessorDoDono ? donoId
    : donoId === contaAtual.id && social.professores.length ? ([...lista].reverse().find((m) => m.de !== contaAtual.id)?.de || social.professores[0]) : null;
  if (!lista.length && !souProfessorDoDono) return '';
  return `<div class="card"><h2>Comentários</h2>
    ${lista.map((m) => `<div class="balao ${m.de === contaAtual.id ? 'meu' : ''}"><b class="small">${esc(nomeDe(m.de))}</b><br>${esc(m.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<p class="muted small">Nenhum comentário ainda.</p>'}
    ${respostaPara ? `<textarea id="coment-texto" rows="2" placeholder="${souProfessorDoDono ? 'Comente este treino para o aluno' : 'Responder'}"></textarea>
      <button class="btn" data-acao="soc-comentar" data-sessao="${esc(sessaoId)}" data-para="${esc(respostaPara)}">${souProfessorDoDono ? 'Enviar comentário' : 'Responder'}</button>` : ''}</div>`;
}

// ---------- Ajustes: professor, alunos e pedido de acesso ----------
function cartaoSocial() {
  if (!social.disponivel || !meuPerfil) return '';
  let h = `<div class="card"><h2>${meuPerfil.papel === 'aluno' ? 'Personal' : 'Seu personal'}</h2>`;
  if (social.professores.length) {
    h += social.professores.map((id) => `<div class="linha entre small" style="padding:8px 0;border-top:1px solid var(--line)">
      <b>${esc(nomeDe(id))}</b><span class="linha" style="gap:6px">
      <a class="btn-mini" href="#/conversa/${id}">Mensagens</a>
      <button class="btn-mini" data-acao="soc-desvincular" data-id="${id}">Desvincular</button></span></div>`).join('');
  } else {
    h += '<p class="muted small">Você treina por conta própria. Se tiver um personal no app, peça o link de convite a ele.</p>';
  }
  if (meuPerfil.papel === 'aluno') {
    h += meuPerfil.pedido_professor
      ? '<p class="small" style="margin-top:10px">⏳ Seu pedido para ser personal está em análise.</p>'
      : `<details style="margin-top:10px"><summary class="small muted">Sou personal trainer / professor de educação física ▾</summary>
        <div class="form"><label>CREF (opcional)<input class="input-texto" id="cref" placeholder="ex.: 012345-G/BA"></label>
        <button class="btn sec" data-acao="soc-pedir-professor">Pedir acesso de personal</button>
        <p class="muted small">Com o acesso aprovado, você poderá convidar alunos, prescrever treinos e acompanhar a evolução deles.</p></div></details>`;
  } else {
    h += `<p class="small" style="margin-top:10px">Você tem acesso de <b>${meuPerfil.papel === 'admin' ? 'administrador' : 'personal'}</b>.
      <a href="#/alunos">Ver meus alunos</a>${ehAdmin() ? ' · <a href="#/admin">Administração</a>' : ''}</p>`;
  }
  return h + '</div>';
}

// ---------- Eventos ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el || !el.dataset.acao.startsWith('soc-')) return;
  const acao = el.dataset.acao;
  if (acao === 'soc-aplicar') aplicarPrescricao(el.dataset.id);
  else if (acao === 'soc-aceitar') {
    const { data, error } = await sb.rpc('aceitar_convite', { p_codigo: el.dataset.codigo });
    localStorage.removeItem(CONVITE_KEY);
    if (error) return toast(error.message || 'Não foi possível aceitar o convite');
    toast(`Agora ${data || 'seu personal'} acompanha seus treinos`);
    social.convites = (social.convites || []).filter((c) => c.codigo !== el.dataset.codigo);
    await atualizarAvisosSociais();
    if (location.hash === '#/hoje') render(); else location.hash = '#/hoje';
  } else if (acao === 'soc-recusar') { localStorage.removeItem(CONVITE_KEY); location.hash = '#/hoje'; }
  else if (acao === 'soc-recusar-email') {
    if (el.dataset.confirmando !== '1') { el.dataset.confirmando = '1'; el.textContent = 'Recusar convite?'; return; }
    const { error } = await sb.rpc('recusar_convite', { p_codigo: el.dataset.codigo });
    if (error) return toast('Não foi possível recusar o convite');
    social.convites = social.convites.filter((c) => c.codigo !== el.dataset.codigo);
    toast('Convite recusado'); render();
  }
  else if (acao === 'soc-enviar') {
    const caixa = $('#msg-texto'), texto = caixa.value.trim();
    if (!texto) return;
    el.disabled = true;
    if (await enviarMensagem(el.dataset.para, texto)) { caixa.value = ''; await carregarConversa(el.dataset.para); window.scrollTo(0, document.body.scrollHeight); }
    el.disabled = false;
  } else if (acao === 'soc-comentar') {
    const caixa = $('#coment-texto'), texto = caixa.value.trim();
    if (!texto) return;
    if (await enviarMensagem(el.dataset.para, texto, el.dataset.sessao)) { delete comentarios[el.dataset.sessao]; toast('Comentário enviado'); render(); }
  } else if (acao === 'soc-desvincular') {
    if (!confirm(`Desfazer o vínculo com ${nomeDe(el.dataset.id)}? Ele deixará de ver seus treinos.`)) return;
    await sb.from('vinculos').delete().eq('professor_id', el.dataset.id).eq('aluno_id', contaAtual.id);
    await atualizarAvisosSociais(); toast('Vínculo desfeito'); render();
  } else if (acao === 'soc-pedir-professor') {
    const cref = ($('#cref')?.value || '').trim();
    const { error } = await sb.from('perfis').update({ pedido_professor: true, cref: cref || null }).eq('user_id', contaAtual.id);
    if (error) return toast('Não foi possível enviar o pedido');
    meuPerfil.pedido_professor = true; meuPerfil.cref = cref;
    toast('Pedido enviado ao administrador'); render();
  }
});
