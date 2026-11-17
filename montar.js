'use strict';

// "Criar sozinho" (#/montar): o usuário monta o programa livremente, sem questionário.
// Escolhe quantos treinos (A, B, C...), os dias da semana de cada um (opcional), as séries e o descanso,
// e adiciona exercícios do catálogo (vários de uma vez) ou pede uma sugestão pelo foco do treino.
// O rascunho fica guardado no aparelho até salvar, para não perder nada ao sair da tela.

const RASCUNHO_KEY = 'meutreino:rascunho-montar';
const DIAS_SEMANA = [['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']];
// Focos rápidos: rótulo, modelo do gerador (para sugerir exercícios) e região (para aquecimento e alongamento)
const FOCOS = [
  ['Superiores', 'superiores', 'sup'], ['Inferiores', 'inferiores', 'inf'], ['Corpo inteiro', 'corpo', 'todo'],
  ['Peito e tríceps', 'peitoTriceps', 'sup'], ['Costas e bíceps', 'costasBiceps', 'sup'], ['Pernas e glúteos', 'pernas', 'inf'],
  ['Ombros', 'ombrosBracos', 'sup'], ['Empurrar', 'empurrar', 'sup'], ['Puxar', 'puxar', 'sup'], ['Abdômen e core', 'abdomen', 'todo'],
];
// Padrões para sugerir quando o foco não existe no assistente
const SLOTS_EXTRA = {
  abdomen: ['Abdômen · flexão de tronco', 'Abdômen · elevação de pernas', 'Abdômen · anti-extensão', 'Abdômen · rotação', 'Abdômen · anti-rotação', 'Costas · lombar'],
};
const slotsDoFoco = (chave) => MODELOS[chave]?.slots || SLOTS_EXTRA[chave] || [];
const DESCANSOS = [[45, '45 s'], [60, '1 min'], [90, '1 min 30'], [120, '2 min']];

function rascunhoNovo() {
  return { nome: '', modalidade: 'tradicional', series: 3, descanso: 60, prep: true, core: true, mob: true, fichas: [fichaNova('A')] };
}
function fichaNova(id, tipo = 'forca') { return { id, tipo, foco: '', dias: [], exs: [] }; }
const ehMob = (f) => f.tipo === 'mob';
// Exercícios de mobilidade, alongamento, core e aquecimento (complementares) para fichas só de mobilidade
function gruposMobilidade() {
  const p = complementosDisponiveis();
  return [['Mobilidade e alongamento · superiores', p.mobSup], ['Mobilidade e alongamento · inferiores', p.mobInf], ['Core', p.core], ['Aquecimento', [...p.prepSup, ...p.prepInf]]];
}
const compMontar = (id) => gruposMobilidade().flatMap(([, l]) => l).find((c) => c.id === id) || null;

let mont = null;
function carregarRascunho() {
  if (mont) return mont;
  try { mont = JSON.parse(localStorage.getItem(`${RASCUNHO_KEY}:${contaAtual?.id}`)); } catch (e) { mont = null; }
  if (!mont || !Array.isArray(mont.fichas)) mont = rascunhoNovo();
  return mont;
}
function guardarRascunho() {
  try { localStorage.setItem(`${RASCUNHO_KEY}:${contaAtual?.id}`, JSON.stringify(mont)); } catch (e) { /* modo privado */ }
}
function descartarRascunho() {
  try { localStorage.removeItem(`${RASCUNHO_KEY}:${contaAtual?.id}`); } catch (e) { /* ok */ }
  mont = null;
}
const MAX_FICHAS = 14;
const letraFicha = (i) => String.fromCharCode(65 + i);
const temExercicios = (m) => m.fichas.some((f) => f.exs.length);

// ---------- Tela principal ----------
function telaMontar(sub, args) {
  if (sub === 'escolher') return telaMontarEscolher(args[1]);
  const m = carregarRascunho();
  const voltar = criandoParaAluno ? `#/aluno/${criandoParaAluno}` : programaAtivo() ? '#/treinos' : '#/hoje';
  m.fichas.forEach((f) => { f.tipo ||= 'forca'; });
  const totalEx = m.fichas.reduce((s, f) => s + f.exs.length, 0);
  let h = `<a href="${voltar}" class="small">‹ Voltar</a><h1>Monte seu treino</h1>
    <p class="muted small">${criandoParaAluno ? `Programa para <b>${esc(nomeDe(criandoParaAluno))}</b>.` : criandoModelo ? '<b>Modelo para alunos.</b>' : 'Do seu jeito: escolha os treinos, os dias e os exercícios.'}
      Pode mudar tudo depois.</p>

    <div class="card form">
      <label>Nome do programa<input class="input-texto" data-mt="nome" value="${esc(m.nome)}" placeholder="ex.: Meu treino de força"></label>
      <div><b class="small">Quantos treinos diferentes?</b>
        <p class="muted small" style="margin:2px 0 6px">Você alterna entre eles: 2 = Treino A e B; 3 = A, B e C…</p>
        <div class="contador-fichas"><button class="btn-mini" data-acao="mt-qtd" data-n="${m.fichas.length - 1}" ${m.fichas.length <= 1 ? 'disabled' : ''} aria-label="Menos um treino">−</button>
          <b>${m.fichas.length}</b><span class="muted small">${m.fichas.length === 1 ? 'treino' : `treinos (${m.fichas[0].id} a ${m.fichas[m.fichas.length - 1].id})`}</span>
          <button class="btn-mini" data-acao="mt-qtd" data-n="${m.fichas.length + 1}" ${m.fichas.length >= MAX_FICHAS ? 'disabled' : ''} aria-label="Mais um treino">+</button></div>
        <p class="muted small" style="margin:6px 0 0">Quer treinar todo dia? Use 7, um para cada dia da semana.</p></div>
    </div>`;

  m.fichas.forEach((f, i) => {
    h += `<div class="card ficha-montar">
      <div class="linha entre"><h2 style="margin:0">Treino ${f.id}</h2><span class="muted small">${f.exs.length} exercício${f.exs.length === 1 ? '' : 's'}</span></div>
      <div class="segmento segmento-mini" style="margin:8px 0 0">
        <a href="#" data-acao="mt-tipo" data-i="${i}" data-tipo="forca" class="${ehMob(f) ? '' : 'sel'}">Musculação</a>
        <a href="#" data-acao="mt-tipo" data-i="${i}" data-tipo="mob" class="${ehMob(f) ? 'sel' : ''}">Mobilidade e alongamento</a></div>
      ${ehMob(f) ? '<p class="muted small" style="margin:8px 0 0">Para dias de descanso ativo: só mobilidade, alongamento e core, sem carga.</p>' : `
      <label class="small" style="display:block;margin-top:8px">Foco (opcional)<input class="input-texto" data-mt-foco="${i}" value="${esc(f.foco)}" placeholder="ex.: Peito e tríceps"></label>
      <div class="chips" style="margin-top:6px">${FOCOS.map(([t]) => `<a href="#" data-acao="mt-foco" data-i="${i}" data-foco="${esc(t)}" class="${f.foco === t ? 'sel' : ''}">${esc(t)}</a>`).join('')}</div>`}
      <p class="small" style="margin:10px 0 4px">Dias da semana <span class="muted">(opcional)</span></p>
      <div class="dias-semana">${DIAS_SEMANA.map(([d, t]) => `<button data-acao="mt-dia" data-i="${i}" data-dia="${d}" class="${f.dias.includes(d) ? 'sel' : ''}" aria-pressed="${f.dias.includes(d)}">${t}</button>`).join('')}</div>
      <div class="lista-montar">${f.exs.map((e, j) => (ehMob(f) ? linhaMobMontar : linhaExercicioMontar)(e, i, j, f.exs.length)).join('')
        || '<p class="muted small" style="margin:10px 0">Nenhum exercício ainda.</p>'}</div>
      <div class="linha" style="gap:8px;flex-wrap:wrap">
        <a class="btn" href="#/montar/escolher/${i}" style="flex:1">+ Adicionar exercícios</a>
        ${ehMob(f) || FOCOS.some(([t]) => t === f.foco) ? `<button class="btn sec" data-acao="mt-sugerir" data-i="${i}" style="flex:1">${f.exs.length ? 'Completar com sugestão' : 'Sugerir exercícios'}</button>` : ''}
      </div>
    </div>`;
  });

  const extras = [m.prep && 'aquecimento', m.core && 'core', m.mob && 'alongamento'].filter(Boolean).map((x) => ` · ${x}`).join('');
  h += `<details class="card ajustes-montar" ${m.ajustesAbertos ? 'open' : ''}><summary class="linha entre"><span><b class="small">Séries, descanso e extras</b><br>
      <span class="muted small">${m.series} séries · descanso ${(DESCANSOS.find(([v]) => v === m.descanso) || [, ''])[1]} · ${m.modalidade === 'circuito' ? 'circuito' : 'séries normais'}${extras}</span></span><span class="seta">▾</span></summary>
      <div class="form" style="margin-top:12px">
      <div class="opcoes">
        <button data-acao="mt-campo" data-campo="modalidade" data-valor="tradicional" class="${m.modalidade === 'tradicional' ? 'sel' : ''}">Séries normais</button>
        <button data-acao="mt-campo" data-campo="modalidade" data-valor="circuito" class="${m.modalidade === 'circuito' ? 'sel' : ''}">Circuito</button></div>
      <p class="muted small" style="margin:0">${m.modalidade === 'circuito' ? 'Circuito: uma série de cada exercício do bloco em sequência, descanso ao fim da volta.' : 'Séries normais: todas as séries de um exercício, depois o próximo.'}</p>
      <div class="linha entre"><span class="small">Séries por exercício</span>
        <span class="linha" style="gap:6px"><button class="btn-mini" data-acao="mt-series" data-d="-1">−</button><b>${m.series}</b><button class="btn-mini" data-acao="mt-series" data-d="1">+</button></span></div>
      <div><span class="small">Descanso entre séries</span>
        <div class="opcoes" style="margin-top:6px">${DESCANSOS.map(([v, t]) => `<button data-acao="mt-campo" data-campo="descanso" data-valor="${v}" class="${m.descanso === v ? 'sel' : ''}">${t}</button>`).join('')}</div></div>
      <div><span class="small">Incluir em cada treino</span>
        <div class="opcoes" style="margin-top:6px">
          ${[['prep', 'Aquecimento'], ['core', 'Core'], ['mob', 'Alongamento']].map(([c, t]) => `<button data-acao="mt-toggle" data-campo="${c}" class="${m[c] ? 'sel' : ''}" aria-pressed="${m[c]}">${m[c] ? '✓ ' : ''}${t}</button>`).join('')}</div>
        <p class="muted small" style="margin:6px 0 0">O app escolhe 2 exercícios de cada; dá para trocar depois na ficha.</p></div>
    </div></details>`;
  h += `<p class="muted small">Dica: escolha um foco para cada treino e toque em <b>Sugerir exercícios</b> se não souber por onde começar.</p>
    <button class="link-btn small" data-acao="mt-limpar" style="display:block;margin:4px auto 90px">Recomeçar do zero</button>
    <div class="barra-fixa"><button class="btn" data-acao="mt-salvar" ${totalEx ? '' : 'disabled'}>${totalEx ? `Salvar treino (${totalEx} exercícios)` : 'Adicione exercícios para salvar'}</button></div>`;
  return h;
}

function linhaExercicioMontar(e, i, j, total) {
  const c = catalogoPorId(e.id) || e;
  return `<div class="ex-montar">
    <div class="cresce"><b class="small">${esc(c.nome)}</b>
      <div class="linha small" style="gap:5px;margin-top:5px;flex-wrap:wrap"><span class="muted">${carregarRascunho().series} ×</span>
        <input class="input-mini" inputmode="numeric" data-mt-reps="${i}:${j}:0" value="${e.reps[0]}" aria-label="Repetições mínimas">
        <span class="muted">–</span>
        <input class="input-mini" inputmode="numeric" data-mt-reps="${i}:${j}:1" value="${e.reps[1]}" aria-label="Repetições máximas">
        <span class="muted">reps${c.lado ? ` ${esc(c.lado)}` : ''}</span></div></div>
    <div class="ex-montar-acoes">
      <button class="btn-mini" data-acao="mt-mover" data-i="${i}" data-j="${j}" data-d="-1" ${j === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
      <button class="btn-mini" data-acao="mt-mover" data-i="${i}" data-j="${j}" data-d="1" ${j === total - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
      <button class="btn-mini" data-acao="mt-remover" data-i="${i}" data-j="${j}" aria-label="Remover">✕</button></div></div>`;
}

function linhaMobMontar(e, i, j, total) {
  const c = compMontar(e.id) || { nome: e.id, dose: '' };
  return `<div class="ex-montar">
    <div class="cresce"><b class="small">${esc(c.nome)}</b><div class="muted small" style="margin-top:3px">${esc(c.dose || '')}</div></div>
    <div class="ex-montar-acoes">
      <button class="btn-mini" data-acao="mt-mover" data-i="${i}" data-j="${j}" data-d="-1" ${j === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
      <button class="btn-mini" data-acao="mt-mover" data-i="${i}" data-j="${j}" data-d="1" ${j === total - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
      <button class="btn-mini" data-acao="mt-remover" data-i="${i}" data-j="${j}" aria-label="Remover">✕</button></div></div>`;
}

// ---------- Escolher vários exercícios do catálogo ----------
const montSel = new Set();
function telaMontarEscolher(iTxt) {
  const m = carregarRascunho(), i = +iTxt, f = m.fichas[i];
  if (!f) return '<div class="vazio">Treino não encontrado.<a class="btn sec" href="#/montar">Voltar</a></div>';
  const emUso = f.exs.map((e) => e.id);
  if (ehMob(f)) return telaEscolherMob(f, i, emUso);
  const itens = CATALOGO.filter((c) => passaFiltro(c));
  let lista = '', grupo = '';
  for (const c of itens) {
    if (c.grupo !== grupo) { grupo = c.grupo; lista += `<h3>${esc(grupo)}</h3>`; }
    const ja = emUso.includes(c.id), sel = montSel.has(c.id);
    lista += `<div class="cat-item ${sel ? 'sel' : ''} ${ja ? 'bloq' : ''}" ${ja ? '' : `data-acao="mt-marcar" data-id="${c.id}"`}>
      <div class="linha entre"><b class="small">${sel ? '✓ ' : ''}${esc(c.nome)}</b><span class="tag">${esc(c.equip || '–')}</span></div>
      <div class="muted small">${esc(faixaReps(c))}${ja ? ' · já está neste treino' : ''}</div>
      ${sel ? `<div class="cat-detalhe">${videoExercicio(c)}<p class="small muted">${esc(c.dica || '')}</p></div>` : ''}</div>`;
  }
  return `<a href="#/montar" class="small">‹ Treino ${f.id}</a><h1>Adicionar ao Treino ${f.id}</h1>
    <p class="muted small">Toque para marcar quantos quiser e depois em Adicionar. ${CATALOGO.length} exercícios no catálogo.</p>
    <input class="input-texto" id="mt-busca" placeholder="Buscar (ex.: agachamento, polia, abdômen)" value="${esc(filtroCat.busca)}">
    ${chipsFiltro('grupo', GRUPOS, 'Todos os grupos')}
    ${chipsFiltro('equip', EQUIPAMENTOS, 'Todo equipamento')}
    <div class="card" id="mt-lista">${lista || '<p class="muted small">Nenhum exercício encontrado.</p>'}</div>
    <div style="height:80px"></div>
    <div class="barra-fixa"><button class="btn" data-acao="mt-adicionar" data-i="${i}" ${montSel.size ? '' : 'disabled'}>${montSel.size ? `Adicionar ${montSel.size} exercício${montSel.size === 1 ? '' : 's'}` : 'Marque os exercícios'}</button></div>`;
}

function telaEscolherMob(f, i, emUso) {
  const q = normal(filtroCat.busca);
  const lista = gruposMobilidade().map(([titulo, itens]) => {
    const vis = itens.filter((c) => !q || normal(c.nome).includes(q));
    return vis.length ? `<h3>${esc(titulo)}</h3>${vis.map((c) => {
      const ja = emUso.includes(c.id), sel = montSel.has(c.id);
      return `<div class="cat-item ${sel ? 'sel' : ''} ${ja ? 'bloq' : ''}" ${ja ? '' : `data-acao="mt-marcar" data-id="${c.id}"`}>
        <div class="linha entre"><b class="small">${sel ? '✓ ' : ''}${esc(c.nome)}</b><span class="small muted">${esc(c.dose || '')}</span></div>
        ${ja ? '<div class="muted small">já está neste treino</div>' : ''}
        ${sel ? `<div class="cat-detalhe">${videoExercicio(c)}<p class="small muted">${esc(c.dica || '')}</p></div>` : ''}</div>`;
    }).join('')}` : '';
  }).join('');
  return `<a href="#/montar" class="small">‹ Treino ${f.id}</a><h1>Mobilidade e alongamento</h1>
    <p class="muted small">Marque quantos quiser e toque em Adicionar.</p>
    <input class="input-texto" id="mt-busca" placeholder="Buscar (ex.: quadril, ombro, prancha)" value="${esc(filtroCat.busca)}">
    <div class="card" id="mt-lista">${lista || '<p class="muted small">Nenhum exercício encontrado.</p>'}</div>
    <div style="height:80px"></div>
    <div class="barra-fixa"><button class="btn" data-acao="mt-adicionar" data-i="${i}" ${montSel.size ? '' : 'disabled'}>${montSel.size ? `Adicionar ${montSel.size} exercício${montSel.size === 1 ? '' : 's'}` : 'Marque os exercícios'}</button></div>`;
}

// Faixa de repetições inicial conforme o tipo de exercício
function repsIniciais(c) {
  if (c.carga === 'corporal' || c.carga === 'elastico') return [...c.reps];
  return /Abdômen|Panturrilhas/.test(c.grupo) ? [12, 15] : ehComposto(c) ? [8, 12] : [10, 12];
}

// Sugestão pelo foco do treino, usando os mesmos modelos do assistente (ou mobilidade, nas fichas de mobilidade)
function preencherFicha(m, f, max = 6) {
  const usados = new Set(m.fichas.flatMap((x) => x.exs.map((e) => e.id)));
  const novos = [];
  if (ehMob(f)) {
    const p = complementosDisponiveis();
    for (const lista of [p.mobSup, p.mobInf, p.mobSup, p.mobInf, p.core]) {
      if (f.exs.length + novos.length >= 8) break;
      const c = lista.find((x) => !usados.has(x.id));
      if (c) { usados.add(c.id); novos.push({ id: c.id }); }
    }
    for (const lista of [p.mobSup, p.mobInf]) for (const c of lista) {
      if (f.exs.length + novos.length >= 8) break;
      if (!usados.has(c.id)) { usados.add(c.id); novos.push({ id: c.id }); }
    }
  } else {
    const foco = FOCOS.find(([t]) => t === f.foco);
    if (!foco) return [];
    const ordem = ORDEM_EQUIP.iniciante;
    const permitido = (c) => (m.equip ? m.equip.includes(c.equip) : c.equip !== 'Kettlebell');
    for (const slot of slotsDoFoco(foco[1])) {
      if (f.exs.length + novos.length >= max) break;
      const cands = CATALOGO.filter((c) => c.padrao === slot && !usados.has(c.id) && permitido(c))
        .sort((a, b) => ordem.indexOf(a.equip) - ordem.indexOf(b.equip));
      if (!cands.length) continue;
      usados.add(cands[0].id);
      novos.push({ id: cands[0].id, reps: repsIniciais(cands[0]) });
    }
  }
  f.exs.push(...novos);
  return novos;
}
function sugerirExercicios(i) {
  const m = carregarRascunho();
  const novos = preencherFicha(m, m.fichas[i]);
  if (!novos.length) return toast('Não há mais sugestões para este treino');
  guardarRascunho(); render();
  toast(`${novos.length} exercícios sugeridos. Troque ou remova à vontade.`);
}

// ---------- Modelos prontos: viram um rascunho do "Criar sozinho" para a pessoa ajustar ----------
const MODELOS_PRONTOS = [
  { id: 'iniciante-fb', nome: 'Iniciante · corpo inteiro', desc: '3 treinos por semana (seg, qua, sex), o corpo todo em cada um. Ótimo para começar.', icone: '🌱',
    fichas: [['Corpo inteiro', ['seg']], ['Corpo inteiro', ['qua']], ['Corpo inteiro', ['sex']]], cfg: { series: 2, descanso: 60 } },
  { id: 'ab-4x', nome: 'AB · superiores e inferiores', desc: '4 treinos por semana: A (parte de cima) e B (pernas e glúteos), duas vezes cada.', icone: '💪',
    fichas: [['Superiores', ['seg', 'qui']], ['Inferiores', ['ter', 'sex']]], cfg: { series: 3, descanso: 90 } },
  { id: 'abc', nome: 'ABC · empurrar, puxar, pernas', desc: '3 a 6 treinos por semana, um grupo de músculos por dia.', icone: '🔁',
    fichas: [['Empurrar', ['seg', 'qui']], ['Puxar', ['ter', 'sex']], ['Pernas e glúteos', ['qua', 'sab']]], cfg: { series: 3, descanso: 90 } },
  { id: 'abcd', nome: 'ABCD · um grupo por dia', desc: 'Peito e tríceps, costas e bíceps, pernas, ombros. Para quem já treina há algum tempo.', icone: '🏋️',
    fichas: [['Peito e tríceps', ['seg']], ['Costas e bíceps', ['ter']], ['Pernas e glúteos', ['qui']], ['Ombros', ['sex']]], cfg: { series: 3, descanso: 90 } },
  { id: 'casa', nome: 'Em casa · peso do corpo', desc: 'Sem aparelhos: só o peso do corpo e, se tiver, elástico. 3 treinos por semana.', icone: '🏠',
    fichas: [['Corpo inteiro', ['seg']], ['Corpo inteiro', ['qua']], ['Corpo inteiro', ['sex']]], cfg: { series: 3, descanso: 60, modalidade: 'circuito', equip: ['Peso corporal', 'Elástico'] } },
  { id: 'core-mob', nome: 'Core e mobilidade', desc: 'Abdômen e core em um dia, mobilidade e alongamento no outro. Bom para complementar ou para dias leves.', icone: '🧘',
    fichas: [['Abdômen e core', ['ter', 'qui']], ['mob', ['sab']]], cfg: { series: 3, descanso: 45, core: false, mob: true } },
];
function telaModelosProntos() {
  const voltar = criandoParaAluno ? `#/aluno/${criandoParaAluno}` : programaAtivo() ? '#/criar' : '#/hoje';
  return `<a href="${voltar}" class="small">‹ Voltar</a><h1>Modelos prontos</h1>
    <p class="muted small">Escolha um ponto de partida. Os exercícios já vêm preenchidos e você ajusta o que quiser antes de salvar.</p>
    ${MODELOS_PRONTOS.map((t) => `<button class="escolha-grande com-icone" data-acao="mt-modelo" data-id="${t.id}"><i aria-hidden="true">${t.icone}</i>
      <span><b>${esc(t.nome)}</b><span>${esc(t.desc)}</span></span></button>`).join('')}`;
}
function aplicarModeloPronto(id) {
  const t = MODELOS_PRONTOS.find((x) => x.id === id);
  if (!t) return;
  const m = { ...rascunhoNovo(), ...t.cfg, nome: t.nome.split(' · ')[0] === 'Em casa' ? 'Treino em casa' : t.nome, fichas: [] };
  t.fichas.forEach(([foco, dias], k) => {
    const f = fichaNova(letraFicha(k), foco === 'mob' ? 'mob' : 'forca');
    if (foco !== 'mob') f.foco = foco;
    f.dias = [...dias];
    m.fichas.push(f);
  });
  for (const f of m.fichas) preencherFicha(m, f);
  mont = m; guardarRascunho();
  toast('Modelo carregado. Ajuste o que quiser e salve.');
  location.hash = '#/montar';
}

// ---------- Salvar: vira um programa como os do assistente ----------
function salvarMontagem() {
  const m = carregarRascunho();
  if (!temExercicios(m)) return toast('Adicione pelo menos um exercício');
  const vazias = m.fichas.filter((f) => !f.exs.length).map((f) => f.id);
  if (!m.fichas.some((f) => f.exs.length && !ehMob(f)) && !m.fichas.some((f) => ehMob(f) && f.exs.length)) return toast('Adicione pelo menos um exercício');
  if (vazias.length) return toast(`Adicione exercícios ao Treino ${vazias.join(', ')} ou diminua a quantidade de treinos`);
  const pools = complementosDisponiveis();
  const r = { modalidade: m.modalidade };
  const descanso = [m.descanso, m.descanso + 30];
  const fichas = {};
  m.fichas.forEach((f, k) => {
    if (ehMob(f)) {
      const itens = f.exs.map((e) => compMontar(e.id)).filter(Boolean).map((c) => ({ ...structuredClone(c), series: 1 }));
      fichas[f.id] = {
        titulo: `Treino ${f.id}`, tipo: 'Mobilidade e alongamento', tipoCurto: 'Mobilidade', resumo: `${itens.length} exercícios de mobilidade e alongamento`,
        instrucoes: 'Movimentos lentos e controlados, sem dor. Respire fundo e solte o ar ao aprofundar cada alongamento.',
        cardioInicial: null, cardioFinal: null, preparacao: [], avisos: [], core: [], mobilidade: itens,
        progressao: 'Aumente aos poucos o tempo em cada posição ou a amplitude, sempre sem dor.', dias: [...f.dias], blocos: [],
      };
      return;
    }
    const exs = f.exs.map((e) => ({ ...paraFicha(catalogoPorId(e.id) || e), reps: [Math.min(e.reps[0], e.reps[1]), Math.max(e.reps[0], e.reps[1])] }));
    const reg = (FOCOS.find(([t]) => t === f.foco) || [, , ''])[2] || regiaoDe(exs);
    const prepPool = reg === 'inf' ? pools.prepInf : pools.prepSup;
    const mobPool = reg === 'inf' ? pools.mobInf : reg === 'sup' ? pools.mobSup : [...pools.mobSup, ...pools.mobInf];
    const blocos = m.modalidade === 'circuito'
      ? montarBlocos(exs, { objetivo: 'hipertrofia', modalidade: 'circuito' }, m.series).map((b) => ({ ...b, descanso }))
      : [{ nome: 'Exercícios', foco: f.foco || resumoDe(exs), voltas: m.series, descanso, modo: 'series', exercicios: exs }];
    fichas[f.id] = {
      titulo: `Treino ${f.id}`, tipo: f.foco || resumoDe(exs), tipoCurto: f.foco || `Treino ${f.id}`, resumo: resumoDe(exs),
      instrucoes: instrucoesDe(r, m.series), cardioInicial: null, cardioFinal: null,
      preparacao: m.prep ? pegarRodando(prepPool, 2, k) : [], avisos: [],
      core: m.core ? pegarRodando(pools.core, 2, k) : [], mobilidade: m.mob ? pegarRodando(mobPool, 2, k) : [],
      progressao: PROGRESSAO, dias: [...f.dias], blocos,
    };
  });
  const p = {
    id: `prog-${uid()}`, nome: m.nome.trim() || (m.fichas.length > 1 ? `Treino ${m.fichas.map((f) => f.id).join('')}` : 'Meu treino'),
    origem: 'manual', criadoEm: isoDia(), inicio: isoDia(), baseSessoes: 0, periodicidade: { tipo: 'livre', valor: 0 },
    ordem: m.fichas.map((f) => f.id), fichas, config: { modalidade: m.modalidade, series: m.series, descanso: m.descanso },
  };
  descartarRascunho();
  criarEAbrir(p); // gerador.js: ativa o programa (ou guarda para o aluno, no caso do personal)
}
// Região predominante (para escolher aquecimento e alongamento) quando o foco foi digitado livremente
function regiaoDe(exs) {
  const inf = exs.filter((e) => ['Quadríceps', 'Posteriores', 'Glúteos', 'Panturrilhas'].includes(e.grupo)).length;
  return inf * 2 > exs.length ? 'inf' : inf ? 'todo' : 'sup';
}

// ---------- Eventos ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao^="mt-"]');
  if (!el) return;
  const m = carregarRascunho(), acao = el.dataset.acao, i = +el.dataset.i, j = +el.dataset.j;
  if (acao === 'mt-qtd') {
    const n = Math.min(MAX_FICHAS, Math.max(1, +el.dataset.n));
    if (n < m.fichas.length && m.fichas.slice(n).some((f) => f.exs.length)
      && el.dataset.confirmando !== '1') { el.dataset.confirmando = '1'; return toast(`O Treino ${letraFicha(n)} em diante tem exercícios. Toque de novo para remover.`); }
    while (m.fichas.length < n) m.fichas.push(fichaNova(letraFicha(m.fichas.length)));
    m.fichas.length = n;
  } else if (acao === 'mt-campo') m[el.dataset.campo] = el.dataset.campo === 'descanso' ? +el.dataset.valor : el.dataset.valor;
  else if (acao === 'mt-toggle') m[el.dataset.campo] = !m[el.dataset.campo];
  else if (acao === 'mt-series') m.series = Math.min(6, Math.max(1, m.series + +el.dataset.d));
  else if (acao === 'mt-tipo') {
    e.preventDefault();
    const f = m.fichas[i];
    if (f.tipo === el.dataset.tipo) return;
    if (f.exs.length && el.dataset.confirmando !== '1') { el.dataset.confirmando = '1'; return toast('Trocar o tipo apaga os exercícios deste treino. Toque de novo para confirmar.'); }
    f.tipo = el.dataset.tipo; f.exs = []; f.foco = '';
  } else if (acao === 'mt-modelo') return aplicarModeloPronto(el.dataset.id);
  else if (acao === 'mt-foco') { e.preventDefault(); m.fichas[i].foco = m.fichas[i].foco === el.dataset.foco ? '' : el.dataset.foco; }
  else if (acao === 'mt-dia') {
    const f = m.fichas[i], d = el.dataset.dia;
    f.dias = f.dias.includes(d) ? f.dias.filter((x) => x !== d) : DIAS_SEMANA.map(([x]) => x).filter((x) => x === d || f.dias.includes(x));
  } else if (acao === 'mt-mover') {
    const lista = m.fichas[i].exs, k = j + +el.dataset.d;
    if (k < 0 || k >= lista.length) return;
    [lista[j], lista[k]] = [lista[k], lista[j]];
  } else if (acao === 'mt-remover') m.fichas[i].exs.splice(j, 1);
  else if (acao === 'mt-sugerir') return sugerirExercicios(i);
  else if (acao === 'mt-marcar') { const id = el.dataset.id; montSel.has(id) ? montSel.delete(id) : montSel.add(id); }
  else if (acao === 'mt-adicionar') {
    const f = m.fichas[i];
    for (const id of montSel) {
      if (f.exs.some((x) => x.id === id)) continue;
      if (ehMob(f)) { if (compMontar(id)) f.exs.push({ id }); continue; }
      const c = catalogoPorId(id); if (c) f.exs.push({ id, reps: repsIniciais(c) });
    }
    toast(`${montSel.size} exercício${montSel.size === 1 ? '' : 's'} no Treino ${f.id}`);
    montSel.clear(); guardarRascunho(); location.hash = '#/montar'; return;
  } else if (acao === 'mt-limpar') {
    if (el.dataset.confirmando !== '1') { el.dataset.confirmando = '1'; el.textContent = 'Toque de novo para apagar tudo'; return; }
    descartarRascunho(); carregarRascunho();
  } else if (acao === 'mt-salvar') return salvarMontagem();
  guardarRascunho(); render();
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!mont) return;
  if (t.dataset.mt === 'nome') { mont.nome = t.value; guardarRascunho(); }
  else if (t.dataset.mtFoco !== undefined) { mont.fichas[+t.dataset.mtFoco].foco = t.value; guardarRascunho(); }
  else if (t.dataset.mtReps) {
    const [i, j, k] = t.dataset.mtReps.split(':').map(Number);
    const v = parseInt(t.value, 10);
    if (v > 0 && v <= 200) { mont.fichas[i].exs[j].reps[k] = v; guardarRascunho(); }
  } else if (t.id === 'mt-busca') {
    filtroCat.busca = t.value;
    clearTimeout(t._busca); t._busca = setTimeout(() => { const pos = t.selectionStart; render(); const c = $('#mt-busca'); if (c) { c.focus(); c.setSelectionRange(pos, pos); } }, 250);
  }
});
// O foco digitado só redesenha ao sair do campo (mostra o botão de sugestão quando bate com um foco rápido)
document.addEventListener('change', (e) => { if (e.target.dataset?.mtFoco !== undefined) render(); });
// Lembra se o usuário abriu as opções de séries (para não fechar a cada toque)
document.addEventListener('toggle', (e) => { if (mont && e.target.classList?.contains('ajustes-montar')) mont.ajustesAbertos = e.target.open; }, true);
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/montar/escolher')) montSel.clear(); });
