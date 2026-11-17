'use strict';

// Versão BETA: selo, rodapé e envio de comentários / problemas (tabela feedback, ver supabase-feedback.sql).
// O administrador vê tudo em Administração e recebe um aviso na tela Hoje quando há algo novo.

const fb = { tipo: 'problema', enviando: false, origem: '', abertos: null, lista: null, carregando: false, verResolvidos: false };
const TIPOS_FB = [['problema', 'Problema'], ['sugestao', 'Sugestão'], ['comentario', 'Comentário']];
const NOME_TIPO_FB = Object.fromEntries(TIPOS_FB);

const seloBeta = () => '<span class="selo-beta" title="Versão de testes">BETA</span>';

// Rodapé nas telas principais
const PAGS_RODAPE = ['hoje', 'treinos', 'historico', 'progresso', 'relatorios', 'ajustes', 'alunos'];
function rodapeBeta(pag) {
  if (!PAGS_RODAPE.includes(pag)) return '';
  return `<p class="rodape-beta small">${seloBeta()} Versão de testes: pode haver falhas.
    <a href="#/feedback">Enviar comentário ou relatar problema</a></p>`;
}

// Lembra de qual tela a pessoa veio (vai junto no relato)
window.addEventListener('hashchange', (e) => {
  if (rotaAtual().pag !== 'feedback') return;
  const antes = ((e.oldURL || '').split('#')[1] || '').replace(/^\/+/, '');
  if (!antes.startsWith('feedback')) fb.origem = antes;
});

function descreverAparelho() {
  const ua = navigator.userAgent;
  const so = (ua.match(/iPhone OS [\d_]+|iPad; CPU OS [\d_]+|Android [\d.]+|Mac OS X [\d_]+|Windows NT [\d.]+/) || ['?'])[0].replace(/_/g, '.');
  const nav = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'outro';
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app instalado' : 'navegador';
  return `${so} · ${nav} · ${instalado} · ${innerWidth}x${innerHeight}`;
}

function telaFeedback() {
  let h = `<a href="#/${esc(fb.origem || 'ajustes')}" class="small">‹ Voltar</a><h1>Comentários e problemas ${seloBeta()}</h1>
    <p class="muted small">O Já treinô? está em fase de testes. Conte o que deu errado, o que pode melhorar ou o que você achou. Cada mensagem é lida pela equipe.</p>`;
  if (!contaAtual?.servidor) {
    return h + '<div class="card"><p class="small">Para enviar, entre com a sua conta (e-mail e senha).</p></div>';
  }
  h += `<div class="card form">
    <div class="opcoes">${TIPOS_FB.map(([v, t]) => `<button data-acao="fb-tipo" data-tipo="${v}" class="${fb.tipo === v ? 'sel' : ''}" aria-pressed="${fb.tipo === v}">${t}</button>`).join('')}</div>
    <label>${fb.tipo === 'problema' ? 'O que aconteceu? (o que você fez e o que apareceu)' : fb.tipo === 'sugestao' ? 'Qual a sua sugestão?' : 'Seu comentário'}
      <textarea id="fb-texto" rows="6" maxlength="4000" placeholder="${fb.tipo === 'problema' ? 'ex.: Toquei em Finalizar treino e a tela ficou branca.' : ''}"></textarea></label>
    <button class="btn" data-acao="fb-enviar">Enviar</button>
    <p class="muted small" style="margin:0">Vai junto, para ajudar a encontrar o problema: versão do app (${VERSAO_APP}), tipo de aparelho e a tela de onde você veio.</p>
  </div>`;
  return h;
}

async function enviarFeedback(botao) {
  const campo = $('#fb-texto');
  const texto = (campo?.value || '').trim();
  if (!texto) return toast('Escreva a sua mensagem');
  if (fb.enviando) return;
  fb.enviando = true; botao.disabled = true; botao.textContent = 'Enviando...';
  let error = null;
  try {
    ({ error } = await sb.from('feedback').insert({
      user_id: contaAtual.id, nome: meuPerfil?.nome || contaAtual.nome || '', email: contaAtual.email || meuPerfil?.email || '',
      tipo: fb.tipo, texto: texto.slice(0, 4000), versao: VERSAO_APP, aparelho: descreverAparelho(), tela: fb.origem || '',
    }));
  } catch (e) { error = e; }
  fb.enviando = false; botao.disabled = false; botao.textContent = 'Enviar';
  if (error) {
    const m = `${error.code || ''} ${error.message || ''}`;
    return toast(/42P01|does not exist|schema cache/i.test(m) ? 'O envio de comentários ainda não foi ativado no servidor.'
      : /fetch|network|Failed/i.test(m) ? 'Sem conexão. Tente de novo quando estiver com internet.' : 'Não foi possível enviar. Tente de novo.');
  }
  campo.value = '';
  toast('Obrigado! Sua mensagem foi enviada.');
  location.hash = `#/${fb.origem || 'hoje'}`;
}

// ---------- Administrador ----------
async function carregarFeedbackAdmin() {
  if (fb.carregando) return;
  fb.carregando = true;
  try {
    const { data, error } = await sb.from('feedback').select('*').order('criado_em', { ascending: false }).limit(300);
    fb.lista = error ? [] : data || [];
  } catch (e) { fb.lista = []; }
  fb.abertos = fb.lista.filter((f) => !f.resolvido_em).length;
  fb.carregando = false;
  render();
}

// Aviso na tela Hoje para o administrador
function cartaoFeedbackHoje() {
  if (!ehAdmin()) return '';
  if (fb.lista === null) { if (!fb.carregando && navigator.onLine) carregarFeedbackAdmin(); return ''; }
  if (!fb.abertos) return '';
  return `<a class="card destaque" href="#/admin" style="display:block;color:inherit;text-decoration:none">
    <b>${fb.abertos} ${fb.abertos === 1 ? 'mensagem nova' : 'mensagens novas'} de usuários</b>
    <p class="muted small" style="margin:4px 0 0">Comentários e problemas relatados no BETA. Toque para ver.</p></a>`;
}

function secaoFeedbackAdmin() {
  if (fb.lista === null) { if (!fb.carregando) carregarFeedbackAdmin(); return '<h3>Comentários e problemas</h3><div class="card muted small">Carregando...</div>'; }
  const lista = fb.lista.filter((f) => fb.verResolvidos || !f.resolvido_em);
  const resolvidos = fb.lista.length - fb.abertos;
  let h = `<h3>Comentários e problemas${fb.abertos ? ` <span class="tag alerta">${fb.abertos} novo${fb.abertos === 1 ? '' : 's'}</span>` : ''}</h3><div class="card">`;
  h += lista.map((f) => `<div class="fb-item ${f.resolvido_em ? 'resolvido' : ''}">
      <div class="linha entre"><span class="tag ${f.tipo === 'problema' ? 'alerta' : ''}">${NOME_TIPO_FB[f.tipo] || f.tipo}</span>
        <span class="muted small">${fmtData(isoDia(new Date(f.criado_em)))} ${new Date(f.criado_em).toTimeString().slice(0, 5)}</span></div>
      <p style="white-space:pre-wrap;margin:6px 0">${esc(f.texto)}</p>
      <div class="muted small">${f.user_id ? `<a href="#/aluno/${f.user_id}">${esc(f.nome || f.email || 'usuário')}</a>` : esc(f.nome || 'usuário removido')}${f.email ? ` · ${esc(f.email)}` : ''}</div>
      <div class="muted small">v${esc(f.versao || '?')} · ${esc(f.aparelho || '')}${f.tela ? ` · tela: ${esc(f.tela)}` : ''}</div>
      <div class="linha" style="gap:6px;margin-top:6px">
        ${f.resolvido_em ? `<span class="small" style="color:var(--ok-text)">Resolvido em ${fmtData(isoDia(new Date(f.resolvido_em)))}</span>
          <button class="btn-mini" data-acao="fb-reabrir" data-id="${f.id}">Reabrir</button>`
        : `<button class="btn-mini" data-acao="fb-resolver" data-id="${f.id}">Marcar como resolvido</button>`}
      </div></div>`).join('') || `<p class="muted small">${fb.lista.length ? 'Nada pendente. 🎉' : 'Nenhuma mensagem ainda.'}</p>`;
  if (resolvidos) h += `<button class="link-btn small" data-acao="fb-ver-resolvidos">${fb.verResolvidos ? 'Esconder resolvidos' : `Ver resolvidos (${resolvidos})`}</button>`;
  return `${h}</div>`;
}

async function marcarFeedback(id, resolvido) {
  const resolvido_em = resolvido ? new Date().toISOString() : null;
  const { error } = await sb.from('feedback').update({ resolvido_em }).eq('id', id);
  if (error) return toast('Não foi possível atualizar');
  const f = fb.lista.find((x) => x.id === id);
  if (f) f.resolvido_em = resolvido_em;
  fb.abertos = fb.lista.filter((x) => !x.resolvido_em).length;
  render();
}

window.addEventListener('hashchange', () => { if (rotaAtual().pag === 'admin') fb.lista = null; });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao^="fb-"]');
  if (!el) return;
  const acao = el.dataset.acao;
  if (acao === 'fb-tipo') {
    const texto = $('#fb-texto')?.value || '';
    fb.tipo = el.dataset.tipo; render();
    const campo = $('#fb-texto'); if (campo) campo.value = texto;
  } else if (acao === 'fb-enviar') enviarFeedback(el);
  else if (acao === 'fb-resolver') marcarFeedback(el.dataset.id, true);
  else if (acao === 'fb-reabrir') marcarFeedback(el.dataset.id, false);
  else if (acao === 'fb-ver-resolvidos') { fb.verResolvidos = !fb.verResolvidos; render(); }
});
