'use strict';

// Entrada com biometria (Face ID / digital) usando chaves de acesso (passkeys / WebAuthn) do Supabase.
// A chave fica no aparelho (Keychain do iCloud, Gerenciador de Senhas do Google...) e é presa ao domínio do app.

const BIO_OFERTA_KEY = 'meutreino:bio-oferta'; // '1' = o usuário já respondeu ao convite para ativar
const bio = { lista: null, carregando: false, ocupado: false };

const bioSuportada = () => !!(window.PublicKeyCredential && navigator.credentials && sb.auth.signInWithPasskey);
function nomeBiometria() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'Face ID';
  if (/Android/.test(ua)) return 'biometria';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  return 'biometria';
}

// Cancelamento do usuário não é erro: some em silêncio
function erroPasskey(error) {
  const texto = `${error?.code || ''} ${error?.message || ''} ${error?.cause?.name || ''} ${error?.name || ''}`;
  if (/NotAllowed|AbortError|cancel|abort|timed out/i.test(texto)) return null;
  if (/passkey_disabled/.test(texto)) return 'A entrada por biometria ainda não foi ativada no servidor.';
  if (/credential_not_found/.test(texto)) return `Esta chave não está mais cadastrada. Entre com a senha e ative o ${nomeBiometria()} de novo em Ajustes.`;
  if (/credential_exists|InvalidStateError/i.test(texto)) return `O ${nomeBiometria()} deste aparelho já está ativado.`;
  if (/too_many_passkeys/.test(texto)) return 'Limite de aparelhos atingido. Remova um aparelho antigo em Ajustes.';
  if (/email_not_confirmed/.test(texto)) return 'Confirme seu e-mail antes de usar a biometria.';
  if (/challenge_expired|challenge_not_found/.test(texto)) return 'O tempo acabou. Tente de novo.';
  if (/does not support WebAuthn/i.test(texto)) return 'Este navegador não permite entrar com biometria.';
  if (/RP_ID|SecurityError/i.test(texto)) return 'Para usar a biometria, abra o app pelo endereço jatreino.app.br.';
  if (/fetch|network|Failed to/i.test(texto)) return 'Sem conexão com o servidor. Verifique a internet.';
  return `Não foi possível usar o ${nomeBiometria()}. Tente de novo ou entre com a senha.`;
}

// ---------- Login ----------
const botaoBiometriaLogin = () => (bioSuportada()
  ? `<button type="button" class="btn sec" data-acao="bio-entrar">Entrar com ${nomeBiometria()}</button>` : '');

async function entrarComBiometria(botao) {
  if (bio.ocupado) return;
  bio.ocupado = true;
  const original = botao.textContent;
  botao.disabled = true; botao.textContent = 'Aguardando...';
  let data = null, error = null;
  try { ({ data, error } = await sb.auth.signInWithPasskey()); } catch (e) { error = e; }
  bio.ocupado = false;
  botao.disabled = false; botao.textContent = original;
  if (error || !data?.user) {
    const msg = erroPasskey(error);
    if (msg) erroLogin(msg);
    return;
  }
  marcarOfertaBio();
  entrarServidor(data.user);
  irParaApp();
}

// ---------- Ajustes ----------
async function carregarChaves() {
  if (bio.carregando) return;
  bio.carregando = true;
  try {
    const { data, error } = await sb.auth.passkey.list();
    bio.lista = error ? [] : data || [];
    bio.erroLista = !!error;
  } catch (e) { bio.lista = []; bio.erroLista = true; }
  bio.carregando = false;
  render();
}

function cartaoBiometria() {
  if (!contaAtual?.servidor || !bioSuportada()) return '';
  if (!bio.lista && !bio.carregando && navigator.onLine) carregarChaves();
  const nome = nomeBiometria();
  let h = `<div class="card"><h2>Entrar com ${nome}</h2>`;
  if (!bio.lista) return `${h}<p class="muted small">${navigator.onLine ? 'Carregando...' : 'Conecte-se à internet para ver.'}</p></div>`;
  if (bio.lista.length) {
    h += bio.lista.map((p) => `<div class="linha entre small" style="padding:8px 0;border-top:1px solid var(--line)">
      <span><b>${esc(p.friendly_name || 'Chave de acesso')}</b><br><span class="muted">Ativada em ${fmtData(isoDia(new Date(p.created_at)))}${p.last_used_at ? ` · último uso ${fmtData(isoDia(new Date(p.last_used_at)))}` : ''}</span></span>
      <button class="btn-mini" data-acao="bio-remover" data-id="${esc(p.id)}">Remover</button></div>`).join('');
    h += `<button class="btn sec" data-acao="bio-ativar" style="margin-top:8px">Ativar em outro aparelho</button>`;
  } else {
    h += `<p class="muted small">Entre sem digitar a senha: o aparelho confirma que é você pelo ${nome}.</p>
      <button class="btn" data-acao="bio-ativar">Ativar ${nome}</button>`;
  }
  return `${h}<p class="muted small" style="margin:8px 0 0">A senha continua valendo. A chave fica guardada no aparelho (no iPhone, no Keychain do iCloud).</p></div>`;
}

async function ativarBiometria(botao) {
  if (bio.ocupado) return;
  bio.ocupado = true;
  if (botao) { botao.disabled = true; botao.textContent = 'Aguardando...'; }
  let error = null;
  try { ({ error } = await sb.auth.registerPasskey()); } catch (e) { error = e; }
  bio.ocupado = false;
  marcarOfertaBio();
  if (error) {
    const msg = erroPasskey(error);
    if (msg) toast(msg);
    render();
    return;
  }
  toast(`${nomeBiometria()} ativado. Da próxima vez, é só tocar em "Entrar com ${nomeBiometria()}".`);
  bio.lista = null; render();
}

async function removerChave(id) {
  if (!confirm('Remover esta chave? Este aparelho deixará de entrar com biometria (a senha continua valendo).')) return;
  let error = null;
  try { ({ error } = await sb.auth.passkey.delete({ passkeyId: id })); } catch (e) { error = e; }
  if (error) return toast('Não foi possível remover. Tente de novo.');
  toast('Chave removida');
  bio.lista = null; render();
}

// ---------- Convite na tela Hoje (uma vez, para quem ainda não ativou) ----------
function marcarOfertaBio() { try { localStorage.setItem(BIO_OFERTA_KEY, '1'); } catch (e) { /* modo privado */ } }
function cartaoOfertaBiometria() {
  if (!contaAtual?.servidor || !bioSuportada()) return '';
  try { if (localStorage.getItem(BIO_OFERTA_KEY)) return ''; } catch (e) { return ''; }
  if (!bio.lista) { if (!bio.carregando && navigator.onLine) carregarChaves(); return ''; }
  if (bio.lista.length || bio.erroLista) return '';
  const nome = nomeBiometria();
  return `<div class="card"><b>Entre mais rápido com ${nome}</b>
    <p class="muted small" style="margin:4px 0 8px">Na próxima vez, entre sem digitar a senha.</p>
    <div class="linha" style="gap:8px"><button class="btn-mini" data-acao="bio-ativar">Ativar</button>
    <button class="btn-mini" data-acao="bio-dispensar">Agora não</button></div></div>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao^="bio-"]');
  if (!el) return;
  const acao = el.dataset.acao;
  if (acao === 'bio-entrar') entrarComBiometria(el);
  else if (acao === 'bio-ativar') ativarBiometria(el);
  else if (acao === 'bio-remover') removerChave(el.dataset.id);
  else if (acao === 'bio-dispensar') { marcarOfertaBio(); render(); toast('Você pode ativar depois em Ajustes.'); }
});
