'use strict';

// Importar um treino pronto: PDF (lido no próprio aparelho com pdf.js) ou texto colado.
// O texto é dividido em fichas ("Treino A", "Ficha B"...) e blocos ("Bloco 1"); cada linha é comparada
// com os nomes do catálogo. Séries, repetições e descanso vêm dos números próximos ao exercício.
// O usuário revisa tudo antes de criar o programa.

const PDFJS = 'vendor/pdfjs-6.4.299/';
const importacao = { etapa: 'origem', texto: '', fichas: [], nome: '', modalidade: 'circuito', complementos: true, periodoTipo: 'livre', periodoValor: 0, erro: '' };

const PALAVRAS_VAZIAS = new Set(['com', 'na', 'no', 'nas', 'nos', 'de', 'do', 'da', 'dos', 'das', 'em', 'e', 'a', 'o', 'as', 'os', 'ao', 'para', 'por', 'um', 'uma', 'pegada']);
function tokens(s) {
  return normal(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((t) => t && !PALAVRAS_VAZIAS.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 ? t.replace(/(es|s)$/, '') : t)); // halteres/halter, séries/série
}
// O que está entre parênteses no nome é opcional ("Crucifixo na máquina (peck deck)");
// a primeira palavra (remada, supino, rosca...) é obrigatória para evitar falsos positivos em descrições.
// Nomes alternativos comuns em fichas (o primeiro termo é a palavra principal)
const APELIDOS = {
  'a2-crossover-polia-alta': ['Crossover na polia alta'],
  'x-woodchopper-polia': ['Wood chop na polia', 'Rotação diagonal na polia (wood chop)', 'Lenhador na polia'],
  'a3-supino-horizontal-maquina': ['Supino reto na máquina'],
  'a3-triceps-testa-ez': ['Tríceps testa com barra W'],
  'a2-rosca-direta-barra': ['Rosca direta com barra W', 'Rosca direta com barra reta'],
  'x-caminhada-fazendeiro': ['Farmer walk'],
  'x-carregamento-unilateral': ['Caminhada com halter unilateral (suitcase)', 'Suitcase carry'],
  'x-pallof-polia': ['Pallof press em pé na polia', 'Pallof press em meio-ajoelhado na polia'],
};
const TOKENS_CATALOGO = CATALOGO.flatMap((c) => [c.nome, ...(APELIDOS[c.id] || [])].map((nome) => {
  const t = tokens(nome.replace(/\(.*?\)/g, ' '));
  return { c, t: new Set(t), cabeca: t[0] };
}));

// Quanto do nome do exercício aparece no texto (0 a 1); exige a palavra principal e 2 palavras em comum.
// Equipamento que falta no texto ("Puxada frontal" x "Puxada frontal na polia") pesa só metade.
const EQUIP_PALAVRAS = new Set(['polia', 'maquina', 'halter', 'barra', 'smith', 'cabo', 'banco']);
// Palavras que diferenciam exercícios parecidos: se o texto tem uma e o catálogo tem a outra, não é o mesmo exercício
const CONFLITOS = [['flexora', 'extensora'], ['alta', 'baixa'], ['unilateral', 'bilateral'], ['supinada', 'pronada'],
  ['inclinado', 'declinado'], ['inclinado', 'reto'], ['maquina', 'barra'], ['maquina', 'halter'], ['barra', 'halter'],
  ['smith', 'barra'], ['smith', 'halter'], ['polia', 'halter'], ['polia', 'barra'], ['sentada', 'pe'], ['frente', 'atra'],
  ['romeno', 'convencional'], ['horizontal', '45']];
function conflita(textoTokens, item) {
  return CONFLITOS.some(([a, b]) => (textoTokens.has(a) && item.t.has(b) && !item.t.has(a)) || (textoTokens.has(b) && item.t.has(a) && !item.t.has(b)));
}
function pontuar(textoTokens, item) {
  if (!textoTokens.has(item.cabeca)) return 0;
  if (conflita(textoTokens, item)) return 0;
  let comuns = 0, faltaEquip = 0;
  for (const t of item.t) {
    if (textoTokens.has(t)) comuns++;
    else if (EQUIP_PALAVRAS.has(t)) faltaEquip++;
  }
  if (comuns < Math.min(2, item.t.size)) return 0;
  return comuns / (item.t.size - faltaEquip / 2) - (textoTokens.size > item.t.size + 6 ? 0.1 : 0);
}
function melhoresParecidos(texto, n = 5) {
  const tk = new Set(tokens(texto));
  return TOKENS_CATALOGO.map((it) => ({ c: it.c, s: pontuar(tk, it), n: it.t.size, cabeca: it.cabeca })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n - a.n)
    .filter((x, i, l) => l.findIndex((y) => y.c.id === x.c.id) === i) // um exercício aparece uma vez, mesmo com apelidos
    .slice(0, n); // empate: o nome mais específico
}
const LIMIAR = 0.6;
// Linhas que são só rótulo de grupo ("PANTURRILHAS", "PEITO") não são exercício nem se emendam com a seguinte
const ROTULOS = new Set([...GRUPOS.flatMap((g) => tokens(g)), 'terra', 'quadricep', 'adutor', 'abdutor', 'ombro', 'posterior', 'core', 'antebraco', 'trapezio', 'gluteo']);

// ---------- Leitura do PDF ----------
async function textoDoPdf(arquivo) {
  await import('./pdf-compat.mjs'); // Safari do iPhone: ver o arquivo
  const pdfjs = await import(`./${PDFJS}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = 'pdf-worker.mjs';
  const doc = await pdfjs.getDocument({ data: await arquivo.arrayBuffer(), isEvalSupported: false }).promise; // sem eval (CSP)
  const linhas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const { items } = await pagina.getTextContent();
    // Linhas na ordem em que o texto foi escrito no PDF (célula por célula nas tabelas).
    // Quebra a linha quando muda a altura, volta para a esquerda ou salta para outra coluna.
    let atual = null;
    for (const it of items) {
      if (!it.str.trim()) { if (it.hasEOL && atual) { linhas.push(atual.s); atual = null; } continue; }
      const x = it.transform[4], y = it.transform[5];
      const continua = atual && Math.abs(atual.y - y) < 2 && x >= atual.fimX - 1 && x - atual.fimX < 12;
      if (continua) atual.s += (x - atual.fimX > 1 ? ' ' : '') + it.str;
      else { if (atual) linhas.push(atual.s); atual = { s: it.str, y }; }
      atual.fimX = x + (it.width || 0);
      if (it.hasEOL) { linhas.push(atual.s); atual = null; }
    }
    if (atual) linhas.push(atual.s);
  }
  return linhas.join('\n');
}

// ---------- Interpretação do texto ----------
const RE_FICHA = /\b(?:treino|ficha|dia)\s+([a-z](?:\d{1,2})?)\b/i;
const RE_BLOCO = /\bbloco\s*(\d+)/i;
const RE_SERIES_REPS = /(\d{1,2})\s*[x×]\s*(\d{1,2})(?:\s*(?:[-–a]|até)\s*(\d{1,2}))?/i;
const RE_SERIES = /(\d{1,2})\s*(?:séries|series|voltas)\b/i;
const RE_FAIXA = /(?:^|[^\d])(\d{1,2})\s*[-–]\s*(\d{1,2})(?!\s*(?:s\b|seg|min|kg|°|\d))/i;
const RE_DESCANSO = /(\d{2,3})\s*(?:[-–]\s*(\d{2,3}))?\s*(?:s|seg|segundos)\b/i;
// Seções que não são musculação: o leitor pula até a próxima parte, bloco ou ficha
const RE_SECAO_FORA = /^(core(?!\s*:)|mobilidade|cardio|prepara[cç][aã]o|aquecimento|alongamento|carga e progress|registro da|refer[eê]ncias|observa)/i;
// Cabeçalho de colunas de tabela ("Nº", "EXERCÍCIO / EXECUÇÃO", "SÉRIES x REPS", "DESCANSO", "REGISTRO"): só pula a linha
const RE_CABECALHO = /^(n[ºo°.]?|exerc[ií]cios?(\s*\/\s*execu[cç][aã]o)?|s[eé]ries(\s*x\s*reps)?|reps|descanso|registro|carga|dose sugerida|como executar)$/i;
// Seção de mobilidade/aquecimento da ficha: os itens numerados ("1. Gato-camelo") viram a preparação da ficha
const RE_SECAO_PREP = /^(mobilidade e prepara|prepara[cç][aã]o|aquecimento)/i;
const RE_RETOMA = /^(parte\s+\d|exerc[ií]cio\s+por\s+s[eé]rie|muscula[cç][aã]o)/i;

function interpretar(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const fichas = [];
  let ficha = null, bloco = null;
  const novaFicha = (id, titulo) => { ficha = { id, titulo, blocos: [], prep: [], mob: [] }; fichas.push(ficha); bloco = null; };
  // Tabela "EXERCÍCIO / DOSE SUGERIDA / COMO EXECUTAR" (fichas de mobilidade e alongamento):
  // nome (1-2 linhas) -> dose (começa com número; pode quebrar) -> descrição (termina com ponto)
  const dose = { ativo: false, estado: 'nome', nome: [], item: null };
  const fecharItem = () => { if (dose.item && ficha) ficha.mob.push(dose.item); dose.item = null; dose.nome = []; dose.estado = 'nome'; };
  const novoBloco = (nome) => { if (!ficha) novaFicha('A', 'Treino A'); bloco = { nome, descanso: null, exercicios: [] }; ficha.blocos.push(bloco); };
  let ultimo = null; // último exercício reconhecido: recebe os números das linhas seguintes
  let fora = false;  // dentro de uma seção que não é musculação (core, mobilidade, cardio...)
  let prep = false;  // dentro da mobilidade/preparação da ficha
  let proximoEhNome = false; // tabela "nº / GRUPO / nome": a linha seguinte ao rótulo é o nome do exercício
  let modoTabela = false;    // a ficha usa essa tabela numerada

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const mFicha = l.match(RE_FICHA);
    if (mFicha && l.length < 80) {
      const id = mFicha[1].toUpperCase();
      if (!fichas.some((f) => f.id === id)) {
        novaFicha(id, l.replace(/\s*[·|-].*$/, '').trim() || `Treino ${id}`);
        // "TREINO A1 | EMPURRAR" -> tipo "Empurrar" (a não ser que seja "continuação")
        const sub = (l.split(/\s[|·–-]\s/)[1] || '').trim();
        if (sub && !/continua|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo/i.test(sub)) ficha.subtitulo = sub.charAt(0) + sub.slice(1).toLowerCase();
      }
      else ficha = fichas.find((f) => f.id === id); // cabeçalho repetido em outra página
      ultimo = null; fora = false; prep = false;
      fecharItem(); dose.ativo = false;
      continue;
    }
    if (/^dose sugerida$/i.test(l)) { dose.ativo = true; fecharItem(); continue; }
    if (dose.ativo) {
      if (/\s\|\s/.test(l) || /^\d+\s*\/\s*\d+$/.test(l) || RE_RETOMA.test(l) || RE_CABECALHO.test(l)) continue; // rodapé, cabeçalho, "PARTE 2 DE 4"
      if (dose.estado === 'nome') {
        if (/^\d/.test(l) && dose.nome.length) { dose.item = { nome: dose.nome.join(' '), dose: l, dica: '' }; dose.estado = 'dose'; }
        else if (/[.]$/.test(l)) dose.nome = []; // parágrafo de orientação, não é exercício
        else dose.nome.push(l);
      } else if (dose.estado === 'dose') {
        if (l.length < 25 && !/[.;]/.test(l) && (/^[a-zà-ÿ\d]/.test(l))) dose.item.dose += ` ${l}`; // "por lado", "lentas", "2 s"
        else { dose.item.dica = l; if (/[.]$/.test(l)) fecharItem(); else dose.estado = 'dica'; }
      } else { dose.item.dica += ` ${l}`; if (/[.]$/.test(l)) fecharItem(); }
      continue;
    }
    const mBloco = l.match(RE_BLOCO);
    if (mBloco) { novoBloco(`Bloco ${mBloco[1]}`); bloco.detectado = true; ultimo = null; fora = false; }
    if (RE_RETOMA.test(l)) { fora = false; prep = false; ultimo = null; continue; }
    if (RE_CABECALHO.test(l)) continue;
    if (RE_SECAO_PREP.test(l) && ficha) { fora = true; prep = true; ultimo = null; continue; }
    if (!prep && RE_SECAO_FORA.test(l)) { fora = true; ultimo = null; }
    if (fora) {
      if (prep && ficha) { // "1. Gato-camelo em quatro apoios" e, na linha seguinte, "1 x 8 lentas"
        const item = l.match(/^\d\.\s+(.{3,80})$/);
        if (item) ficha.prep.push({ nome: item[1].trim(), dose: '' });
        else if (ficha.prep.length && !ficha.prep[ficha.prep.length - 1].dose && /^\d+(\s*-\s*\d+)?\s*x\s*\S/i.test(l)) ficha.prep[ficha.prep.length - 1].dose = l.replace(/^\d+\s*x\s*/i, (m) => m.replace(/\s+/g, ' '));
      }
      continue;
    }
    // Tabela numerada: "7" / "TRÍCEPS" / "Tríceps na corda" -> o nome vem logo depois do rótulo
    if (/^\d{1,2}$/.test(l) && linhas[i + 1] && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ :\/\-]{2,40}$/.test(linhas[i + 1])) { proximoEhNome = true; modoTabela = true; i++; continue; }
    if (/\s\|\s/.test(l)) continue; // subtítulo ("Terça-feira | Terra com barra, puxada...") não é exercício
    // Em ficha de tabela numerada, o nome só aparece logo depois do nº e do grupo: o resto é descrição ou número
    if (modoTabela && !proximoEhNome) { if (ultimo) lerNumeros(l, ultimo, bloco); continue; }
    if (/^core\s*:/i.test(l)) { proximoEhNome = true; continue; }
    const tl = tokens(l);
    if (tl.length && tl.every((t) => ROTULOS.has(t)) && !/\d/.test(l)) continue;

    // Tabela numerada: nome quebrado em duas linhas ("…com pegada" / "supinada") vira um nome só
    if (proximoEhNome && linhas[i + 1] && /^[a-zà-ÿ]/.test(linhas[i + 1]) && linhas[i + 1].length < 30 && !/[.;]/.test(linhas[i + 1])) {
      linhas[i] = `${l} ${linhas[i + 1]}`; linhas.splice(i + 1, 1); i--; continue;
    }
    // Exercício: a linha sozinha ou emendada com a seguinte (nomes quebrados em duas linhas)
    // (não emenda se a linha já traz séries × repetições, nem se o nome não começa nesta linha)
    const sozinha = melhoresParecidos(l, 1)[0];
    const podeEmendar = !proximoEhNome && i + 1 < linhas.length && !RE_SERIES_REPS.test(l); // na tabela o nome já veio inteiro
    const emendada = podeEmendar ? melhoresParecidos(`${l} ${linhas[i + 1]}`, 1)[0] : null;
    // Na tabela o nome vem inteiro e limpo: só troca por um do catálogo quando é quase o mesmo exercício
    const limiar = proximoEhNome ? 0.8 : LIMIAR;
    let achado = sozinha && sozinha.s >= limiar ? sozinha : null;
    let usouProxima = false;
    if (emendada && emendada.s >= LIMIAR && new Set(tokens(l)).has(emendada.cabeca) && (!achado || emendada.s > achado.s + 0.15)) { achado = emendada; usouProxima = true; }
    if (achado) {
      proximoEhNome = false;
      if (!bloco) novoBloco(`Bloco ${(ficha?.blocos.length || 0) + 1}`);
      ultimo = { catId: achado.c.id, original: usouProxima ? `${l} ${linhas[i + 1]}` : l, series: null, reps: null };
      bloco.exercicios.push(ultimo);
      lerNumeros(usouProxima ? `${l} ${linhas[i + 1]}` : l, ultimo, bloco);
      if (usouProxima) i++;
      continue;
    }
    // Nome vindo da tabela numerada, mas fora do catálogo: exercício personalizado com o nome do PDF
    if (proximoEhNome && /[a-zà-ÿ]{3}/i.test(l) && !RE_SERIES_REPS.test(l)) {
      proximoEhNome = false;
      if (!bloco) novoBloco(`Bloco ${(ficha?.blocos.length || 0) + 1}`);
      ultimo = { catId: null, nomeLivre: l.replace(/^[\d.)\-•·\s]+/, '').trim(), original: l, series: null, reps: null };
      bloco.exercicios.push(ultimo);
      continue;
    }
    // Linha com "3x12" mas nome fora do catálogo: exercício personalizado
    const sr = l.match(RE_SERIES_REPS);
    if (sr && /[a-z]{3}/i.test(l.slice(0, sr.index))) {
      if (!bloco) novoBloco(`Bloco ${(ficha?.blocos.length || 0) + 1}`);
      ultimo = { catId: null, nomeLivre: l.slice(0, sr.index).replace(/^[\d.)\-•·\s]+/, '').trim(), original: l, series: null, reps: null };
      bloco.exercicios.push(ultimo);
      lerNumeros(l, ultimo, bloco);
      continue;
    }
    if (ultimo) lerNumeros(l, ultimo, bloco);
    else if (bloco) { lerDescanso(l, bloco); const s = l.match(RE_SERIES); if (s) bloco.voltas = +s[1]; }
  }
  fecharItem();
  for (const f of fichas) f.blocos = f.blocos.filter((b) => b.exercicios.length);
  // Dias da semana ("Segunda A1 Empurrar", "Domingo C Mobilidade")
  const DIAS = { segunda: 'seg', terca: 'ter', quarta: 'qua', quinta: 'qui', sexta: 'sex', sabado: 'sab', domingo: 'dom' };
  linhas.forEach((l, k) => {
    // na mesma linha ("Segunda A1 Empurrar") ou em linhas seguidas ("Segunda" / "A1"), como sai das tabelas
    const junto = /^(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?$/.test(normal(l)) && linhas[k + 1] ? `${l} ${linhas[k + 1]}` : l;
    const m = normal(junto).match(/^(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\s+([a-z]\d{0,2})\b/);
    const f = m && fichas.find((x) => x.id === m[2].toUpperCase());
    if (f) { f.dias ??= []; if (!f.dias.includes(DIAS[m[1]])) f.dias.push(DIAS[m[1]]); }
  });
  return fichas.filter((f) => f.blocos.length || f.mob.length);
}
// Descanso: só em linhas que falam de descanso/intervalo ou com faixa (ex.: "90-120 s")
function lerDescanso(l, bloco, ex) {
  if (RE_SERIES_REPS.test(l)) return; // "3x30s" é tempo de exercício, não descanso
  const d = l.match(RE_DESCANSO);
  if (d && ex && !ex.descanso && +d[1] >= 20 && (d[2] || /descans|interval/i.test(l) || /^\d{2,3}\s*(?:[-–]\s*\d{2,3})?\s*s$/i.test(l.trim()))) ex.descanso = [+d[1], +(d[2] || d[1])];
  if (!d || bloco.descanso || +d[1] < 20) return;
  if (d[2] || /descans|interval|entre\s+s[eé]ries|ap[oó]s/i.test(l)) bloco.descanso = [+d[1], +(d[2] || d[1])];
}
function lerNumeros(l, ex, bloco) {
  const sr = l.match(RE_SERIES_REPS);
  if (sr && !ex.reps) {
    ex.series = +sr[1]; ex.reps = [+sr[2], +(sr[3] || sr[2])];
    const resto = l.slice(sr.index + sr[0].length);
    if (/^\s*(s|seg|segundos)\b/i.test(resto)) ex.unidade = 's';
    else if (/^\s*m\b/i.test(resto)) ex.unidade = 'm';
    if (/por\s+(lado|perna|bra)/i.test(resto)) ex.lado = 'por lado';
  }
  const s = l.match(RE_SERIES);
  if (s && /voltas|por exerc/i.test(l)) bloco.voltas = +s[1]; // "2 voltas" vale para o bloco todo
  else if (s && !ex.series) ex.series = +s[1];
  const f = l.match(RE_FAIXA);
  if (f && !ex.reps && +f[1] <= +f[2] && +f[2] <= 30) ex.reps = [+f[1], +f[2]];
  lerDescanso(l, bloco, ex);
}

// ---------- Telas ----------
function telaImportar() {
  const imp = importacao;
  if (imp.etapa === 'origem') {
    return `<a href="#/criar" class="small">‹ Novo programa</a><h1>Importar treino pronto</h1>
      <p class="muted small">O app lê a ficha, reconhece os exercícios do catálogo e você confere tudo antes de criar o programa.</p>
      <label class="escolha-grande"><b>Escolher arquivo PDF</b><span>Ficha em PDF com texto (de um personal, de outro app ou feita no computador).</span>
        <input type="file" accept="application/pdf,.pdf" data-acao="imp-pdf" hidden></label>
      <div class="card"><b class="small">Ou cole o texto da ficha</b>
        <textarea id="imp-texto" rows="8" placeholder="Ex.:&#10;Treino A&#10;Supino reto com halteres 3x10&#10;Puxada frontal 3x12&#10;Treino B&#10;Leg press 45 4x10">${esc(imp.texto)}</textarea>
        <button class="btn" data-acao="imp-texto">Reconhecer exercícios</button></div>
      ${imp.erro ? `<div class="card small" style="border-color:var(--danger)">${esc(imp.erro)}</div>` : ''}
      <p class="muted small">Fotos de fichas em papel ainda não são lidas; para isso, digite ou cole o texto.</p>`;
  }
  // Revisão
  let total = 0, h = `<button class="link-btn" style="width:auto;padding:0" data-acao="imp-recomecar">‹ Escolher outro arquivo</button>
    <h1>Revisar importação</h1>
    <p class="muted small">Confira cada exercício: troque pelo nome certo do catálogo, ajuste séries e repetições ou remova o que não for exercício.</p>`;
  imp.fichas.forEach((f, fi) => {
    h += `<div class="card"><label class="form">Ficha ${esc(f.id)}<input class="input-texto" data-imp-ficha="${fi}" value="${esc(f.titulo)}"></label>`;
    if (f.dias?.length) h += `<p class="small muted" style="margin:6px 0 0">Dias: ${f.dias.map((d) => ({ seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb', dom: 'dom' }[d])).join(', ')}</p>`;
    if (f.prep?.length) h += `<p class="small muted" style="margin:6px 0 0">Preparação: ${f.prep.map((p) => esc(p.nome)).join(' · ')}</p>`;
    if (f.mob?.length) {
      total += f.mob.length;
      h += `<h3>Mobilidade e alongamento (${f.mob.length})</h3>${f.mob.map((m) => `<div class="small" style="padding:5px 0;border-top:1px solid var(--line)"><b>${esc(m.nome)}</b> <span class="muted">· ${esc(m.dose)}</span></div>`).join('')}`;
    }
    f.blocos.forEach((b, bi) => {
      h += `<h3>${esc(b.nome)}${b.descanso ? ` · descanso ${b.descanso[0]}-${b.descanso[1]} s` : ''}</h3>`;
      b.exercicios.forEach((ex, ei) => {
        total++;
        const opcoes = melhoresParecidos(ex.original, 6);
        if (ex.catId && !opcoes.some((o) => o.c.id === ex.catId)) opcoes.unshift({ c: catalogoPorId(ex.catId) });
        // Também os que têm alguma palavra em comum (ex.: "Agachamento livre" -> todos os agachamentos)
        const tk = new Set(tokens(ex.original));
        for (const it of TOKENS_CATALOGO) if (opcoes.length < 12 && !opcoes.some((o) => o.c.id === it.c.id) && [...it.t].some((t) => tk.has(t))) opcoes.push({ c: it.c });
        const c = ex.catId ? catalogoPorId(ex.catId) : null;
        const reps = ex.reps || c?.reps || [10, 12];
        h += `<div class="imp-ex">
          <p class="small muted">Lido: “${esc(ex.original.slice(0, 80))}”</p>
          <select data-imp-ex="${fi}.${bi}.${ei}">
            ${opcoes.map((o) => `<option value="${o.c.id}" ${o.c.id === ex.catId ? 'selected' : ''}>${esc(o.c.nome)} · ${esc(o.c.equip)}</option>`).join('')}
            <option value="" ${!ex.catId ? 'selected' : ''}>Personalizado: ${esc(ex.nomeLivre || ex.original.slice(0, 40))}</option>
            ${CATALOGO.filter((x) => !opcoes.some((o) => o.c.id === x.id)).map((x) => `<option value="${x.id}">${esc(x.nome)} · ${esc(x.equip)}</option>`).join('')}
          </select>
          <div class="linha" style="gap:8px;margin-top:6px">
            <label class="campo"><input inputmode="numeric" data-imp-num="${fi}.${bi}.${ei}.series" value="${ex.series || b.voltas || ''}" placeholder="3"><em>séries</em></label>
            <label class="campo"><input inputmode="numeric" data-imp-num="${fi}.${bi}.${ei}.r0" value="${reps[0]}"><em>mín</em></label>
            <label class="campo"><input inputmode="numeric" data-imp-num="${fi}.${bi}.${ei}.r1" value="${reps[1]}"><em>máx</em></label>
            <button class="btn-mini" data-acao="imp-remover" data-pos="${fi}.${bi}.${ei}" aria-label="Remover">🗑</button>
          </div></div>`;
      });
    });
    h += `</div>`;
  });
  h += `<div class="card form">
    <label>Nome do programa<input class="input-texto" id="imp-nome" value="${esc(imp.nome)}"></label>
    <label>Execução<select id="imp-modalidade">${MODALIDADES.map(([v, t]) => `<option value="${v}" ${imp.modalidade === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Duração<select id="imp-ptipo">${TIPOS_PERIODO.map(([v, t]) => `<option value="${v}" ${imp.periodoTipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Quantidade<input class="input-texto" id="imp-pvalor" inputmode="numeric" value="${imp.periodoValor || ''}" placeholder="ex.: 8"></label>
    <label class="check-linha"><input type="checkbox" id="imp-comp" ${imp.complementos ? 'checked' : ''}> Incluir preparação, core e mobilidade com vídeos</label>
  </div>
  <div class="barra-fixa"><button class="btn" data-acao="imp-criar">Criar programa (${imp.fichas.length} fichas, ${total} exercícios)</button></div>`;
  return h;
}

function iniciarRevisao(texto) {
  const fichas = interpretar(texto);
  if (!fichas.length) {
    importacao.erro = 'Não encontrei exercícios do catálogo nesse texto. Confira se o PDF tem texto (não é uma foto) ou cole o texto da ficha.';
    return render();
  }
  Object.assign(importacao, { etapa: 'revisao', fichas, erro: '', nome: importacao.nome || 'Treino importado' });
  // Séries tradicionais têm prioridade: fichas costumam citar "circuito" justamente para dizer que não é
  if (/s[eé]ries tradicionais|conclua (todas )?as (\S+ )?s[eé]ries|antes de avan[cç]ar|n[aã]o repita .{0,40}circuito/i.test(texto)) importacao.modalidade = 'tradicional';
  else if (/\bvoltas?\b|circuito/i.test(texto)) importacao.modalidade = 'circuito';
  window.scrollTo(0, 0); render();
}

function criarProgramaImportado() {
  const imp = importacao;
  imp.nome = $('#imp-nome').value.trim() || 'Treino importado';
  imp.modalidade = $('#imp-modalidade').value;
  imp.periodoTipo = $('#imp-ptipo').value;
  imp.periodoValor = parseInt($('#imp-pvalor').value, 10) || 0;
  imp.complementos = $('#imp-comp').checked;
  if (imp.periodoTipo !== 'livre' && !(imp.periodoValor >= 1)) return toast('Informe a duração do programa');
  const pools = complementosDisponiveis();
  const fichas = {}, ordem = [];
  imp.fichas.forEach((f, k) => {
    let id = f.id; while (fichas[id]) id += '2';
    if (!f.blocos.length && f.mob?.length) { // ficha só de mobilidade e alongamento
      fichas[id] = { titulo: f.titulo, tipo: f.subtitulo || 'Mobilidade e alongamento', tipoCurto: 'Mobilidade', resumo: `${f.mob.length} exercícios de mobilidade e alongamento`,
        instrucoes: 'Movimentos lentos e controlados, sem dor. Siga a dose sugerida de cada exercício.', cardioInicial: null, cardioFinal: null,
        preparacao: [], avisos: [], core: [], progressao: 'Aumente aos poucos a amplitude ou o tempo, sempre sem dor.', dias: [...(f.dias || [])], blocos: [],
        mobilidade: f.mob.map((m, j) => ({ id: `${id.toLowerCase()}-mob-${j}`, nome: m.nome, series: 1, dose: m.dose, dica: m.dica })) };
      ordem.push(id);
      return;
    }
    const blocos = [];
    for (const b of f.blocos) {
      const exs = b.exercicios.map((ex) => {
        const c = ex.catId && catalogoPorId(ex.catId);
        const reps = ex.reps || c?.reps || [10, 12];
        const base = c ? { ...paraFicha(c), reps } : { id: `${id.toLowerCase()}-${uid()}`, nome: ex.nomeLivre || ex.original.slice(0, 60), grupo: '', carga: ex.unidade ? 'corporal' : 'total', reps, dica: '' };
        if (ex.unidade) base.unidade = ex.unidade;
        if (ex.lado && !base.lado) base.lado = ex.lado;
        return base;
      });
      if (!exs.length) continue;
      const voltas = Math.max(...b.exercicios.map((ex) => ex.series || b.voltas || 3));
      const grupos = [...new Set(exs.map((e) => e.grupo).filter(Boolean))];
      // Sem blocos no texto: agrupa de 2 em 2, como o gerador
      // Descanso próprio de cada exercício (tabelas): agrupa os vizinhos com o mesmo descanso, cada grupo com o seu
      const descansos = b.exercicios.map((ex) => ex.descanso || b.descanso || [60, 90]);
      const porDescanso = imp.modalidade === 'tradicional' && b.exercicios.some((ex) => ex.descanso);
      let partes;
      if (porDescanso) {
        partes = [];
        exs.forEach((e, i) => {
          const ultima = partes[partes.length - 1];
          if (ultima && String(ultima.descanso) === String(descansos[i])) ultima.exs.push(e);
          else partes.push({ exs: [e], descanso: descansos[i] });
        });
      } else {
        partes = (!b.detectado ? Array.from({ length: Math.ceil(exs.length / 2) }, (_, i) => exs.slice(i * 2, i * 2 + 2)) : [exs])
          .map((p) => ({ exs: p, descanso: b.descanso || [60, 90] }));
      }
      for (const parte of partes) {
        blocos.push({ nome: `Bloco ${blocos.length + 1}`, foco: [...new Set(parte.exs.map((e) => e.grupo).filter(Boolean))].join(' / ') || grupos.join(' / '),
          voltas, descanso: parte.descanso, ...(imp.modalidade === 'tradicional' ? { modo: 'series' } : {}), exercicios: parte.exs });
      }
    }
    const todos = blocos.flatMap((b) => b.exercicios);
    const inf = todos.filter((e) => ['Quadríceps', 'Posteriores', 'Glúteos', 'Panturrilhas'].includes(e.grupo)).length > todos.length / 2;
    fichas[id] = {
      titulo: f.titulo, tipo: f.subtitulo || (inf ? 'Membros inferiores' : 'Membros superiores'), tipoCurto: f.subtitulo || (inf ? 'Inferiores' : 'Superiores'), resumo: resumoDe(todos),
      instrucoes: instrucoesDe({ modalidade: imp.modalidade }, blocos[0]?.voltas || 3), cardioInicial: null, cardioFinal: null,
      // Preparação que veio no próprio PDF tem prioridade sobre a escolhida pelo app
      preparacao: f.prep?.length ? f.prep.map((p, j) => ({ id: `${id.toLowerCase()}-prep-${j}`, nome: p.nome, series: 1, dose: p.dose || '', dica: '' }))
        : imp.complementos ? pegarRodando(inf ? pools.prepInf : pools.prepSup, 2, k) : [], avisos: [],
      core: imp.complementos ? pegarRodando(pools.core, 2, k) : [], mobilidade: imp.complementos ? pegarRodando(inf ? pools.mobInf : pools.mobSup, 2, k) : [],
      progressao: PROGRESSAO, blocos, dias: [...(f.dias || [])],
    };
    ordem.push(id);
  });
  const p = { id: `prog-${uid()}`, nome: imp.nome, origem: 'importado', criadoEm: isoDia(), inicio: isoDia(), baseSessoes: 0,
    periodicidade: { tipo: imp.periodoTipo, valor: imp.periodoTipo === 'livre' ? 0 : imp.periodoValor }, ordem, fichas };
  Object.assign(importacao, { etapa: 'origem', texto: '', fichas: [], nome: '', erro: '' });
  criarEAbrir(p);
}

// ---------- Eventos ----------
document.addEventListener('change', async (e) => {
  if (e.target.dataset.acao === 'imp-pdf') {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    toast('Lendo o PDF...');
    try {
      importacao.texto = await textoDoPdf(arq);
      importacao.nome = arq.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
      iniciarRevisao(importacao.texto);
    } catch (err) {
      importacao.erro = 'Não foi possível ler esse PDF. Tente outro arquivo ou cole o texto da ficha.';
      render();
    }
    e.target.value = '';
  }
  const pos = e.target.dataset.impEx;
  if (pos) {
    const [fi, bi, ei] = pos.split('.').map(Number);
    importacao.fichas[fi].blocos[bi].exercicios[ei].catId = e.target.value || null;
  }
});
document.addEventListener('input', (e) => {
  const num = e.target.dataset.impNum, fi = e.target.dataset.impFicha;
  if (fi !== undefined) importacao.fichas[+fi].titulo = e.target.value;
  if (!num) return;
  const [a, b, c, campo] = num.split('.');
  const ex = importacao.fichas[+a].blocos[+b].exercicios[+c];
  const v = parseInt(e.target.value, 10) || 0;
  if (campo === 'series') ex.series = v || null;
  else { ex.reps ??= [...(catalogoPorId(ex.catId)?.reps || [10, 12])]; ex.reps[campo === 'r0' ? 0 : 1] = v; }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el || !el.dataset.acao.startsWith('imp-') || el.dataset.acao === 'imp-pdf') return;
  const acao = el.dataset.acao;
  if (acao === 'imp-texto') {
    importacao.texto = $('#imp-texto').value;
    if (!importacao.texto.trim()) return toast('Cole o texto da ficha');
    iniciarRevisao(importacao.texto);
  } else if (acao === 'imp-recomecar') { Object.assign(importacao, { etapa: 'origem', fichas: [], erro: '' }); render(); }
  else if (acao === 'imp-remover') {
    const [fi, bi, ei] = el.dataset.pos.split('.').map(Number);
    importacao.fichas[fi].blocos[bi].exercicios.splice(ei, 1);
    render();
  } else if (acao === 'imp-criar') criarProgramaImportado();
});
