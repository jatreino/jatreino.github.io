'use strict';

// Exclusão da própria conta (#/excluir-conta) e links legais (privacidade, suporte).
// No servidor: função excluir_minha_conta() — ver supabase-excluir-conta.sql.

const LINKS_LEGAIS = { privacidade: 'privacidade.html', suporte: 'suporte.html', excluir: 'excluir-conta.html' };
const exc = { enviando: false };

function telaExcluirConta() {
  const voltar = '<a href="#/ajustes/conta" class="small">‹ Conta e segurança</a>';
  if (contaAtual?.demo) {
    return `${voltar}<h1>Excluir conta</h1><div class="card small">Esta é a conta de demonstração: os dados ficam só neste aparelho.
      Para apagá-los, use <b>Ajustes → Backup e dados → Apagar todos os dados</b>.</div>`;
  }
  return `${voltar}<h1>Excluir minha conta</h1>
    <div class="card small">
      <p style="margin-top:0">Ao excluir a conta <b>${esc(contaAtual.email || '')}</b>, apagamos <b>de forma definitiva</b>:</p>
      <ul class="lista-exclusao">
        <li>seus dados de acesso (e-mail, senha e biometria cadastrada);</li>
        <li>todos os treinos, programas, fichas e históricos;</li>
        <li>seus dados pessoais: nascimento, altura, sexo, peso e medidas corporais;</li>
        <li>vínculos com personal ou alunos, convites, treinos enviados e mensagens;</li>
        <li>comentários e problemas que você enviou.</li>
      </ul>
      <p>Isso <b>não pode ser desfeito</b>. Se quiser guardar uma cópia, antes exporte um backup em <a href="#/ajustes/backup">Backup e dados</a>.</p>
      <p class="muted">Cópias de segurança automáticas do servidor são descartadas em até 30 dias.</p>
    </div>
    <div class="card form">
      <label>Para confirmar, digite <b>EXCLUIR</b><input class="input-texto" id="exc-confirma" autocapitalize="characters" autocomplete="off"></label>
      <button class="btn perigo" data-acao="exc-confirmar">Excluir minha conta definitivamente</button>
    </div>`;
}

async function excluirConta(botao) {
  if (exc.enviando || !contaAtual?.servidor) return;
  if (($('#exc-confirma').value || '').trim().toUpperCase() !== 'EXCLUIR') return toast('Digite EXCLUIR para confirmar');
  if (!navigator.onLine) return toast('Conecte-se à internet para excluir a conta.');
  exc.enviando = true; botao.disabled = true; botao.textContent = 'Excluindo...';
  let error = null;
  try { ({ error } = await sb.rpc('excluir_minha_conta')); } catch (e) { error = e; }
  exc.enviando = false;
  if (error) {
    botao.disabled = false; botao.textContent = 'Excluir minha conta definitivamente';
    const m = `${error.code || ''} ${error.message || ''}`;
    return toast(/PGRST202|could not find|does not exist/i.test(m) ? 'A exclusão de conta ainda não foi ativada no servidor. Fale com o suporte.'
      : /único administrador/i.test(m) ? error.message
      : /fetch|network|Failed/i.test(m) ? 'Sem conexão. Tente de novo.' : 'Não foi possível excluir a conta. Tente de novo ou fale com o suporte.');
  }
  // Conta apagada no servidor: limpa o que ficou neste aparelho e sai
  const id = contaAtual.id;
  try {
    for (const k of Object.keys(localStorage)) if (k.includes(id)) localStorage.removeItem(k);
    for (const k of [USUARIO_KEY, BIO_OFERTA_KEY]) localStorage.removeItem(k);
  } catch (e) { /* ok */ }
  await sair();
  location.hash = '#/hoje';
  toast('Sua conta foi excluída. Obrigado por ter usado o Já treinô?');
}

// Links para as páginas legais (abrem fora do app)
const linksLegais = () => `<p class="links-legais small">
  <a href="${LINKS_LEGAIS.privacidade}" target="_blank" rel="noopener">Privacidade</a> ·
  <a href="${LINKS_LEGAIS.suporte}" target="_blank" rel="noopener">Suporte</a></p>`;

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao="exc-confirmar"]');
  if (el) excluirConta(el);
});
