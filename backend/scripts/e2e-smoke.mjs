// E2E de fumaca contra a API local (http://localhost:3355/api) com o seed demo.
const B = 'http://localhost:3355/api'
let ok = 0, fail = 0
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, ...j }
}
function check(name, cond, extra) {
  if (cond) { ok++; console.log('  ✓', name) } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') }
}
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

const login = await call('POST', '/auth/login', { email: 'dono@demo.com', senha: '123456' })
check('login dono', login.success, login)
const T = login.data.token
const rec = (await call('POST', '/auth/login', { email: 'recepcao@demo.com', senha: '123456' })).data.token
const ana = (await call('POST', '/auth/login', { email: 'ana@demo.com', senha: '123456' })).data

const ref = await call('GET', '/agenda/referencias', null, T)
check('referencias', ref.success && ref.data.servicos.length === 4, ref)
const corte = ref.data.servicos.find((s) => s.nome === 'Corte')
const escova = ref.data.servicos.find((s) => s.nome === 'Escova')
const carla = ref.data.profissionais.find((p) => p.nome.startsWith('Carla'))

// achar um dia util futuro com horario
let dia = addDays(today, 3), hs
for (let i = 0; i < 10; i++) {
  hs = await call('GET', `/publico/demo/horarios?servicoIds=${corte.id},${escova.id}&profissionalId=${carla.id}&data=${dia}`)
  if (hs.data?.profissionais?.[0]?.horarios?.length > 2) break
  dia = addDays(dia, 1)
}
const horarios = hs.data.profissionais[0].horarios
check('horarios publicos (multi-servico, grade 1h)', horarios.length > 2 && horarios.every((h) => h.endsWith(':00')), hs.data)
check('duracao total = soma dur+intervalos (110)', hs.data.duracao.ocupacaoTotal === 110, hs.data.duracao)
check('pausa 12-13 respeitada (sem 11:00 p/ 110min)', !horarios.includes('11:00') && !horarios.includes('12:00'), horarios)

// --- fluxo do site ---
const h1 = horarios[0]
const site = await call('POST', '/publico/demo/agendamentos', { servicoIds: [corte.id, escova.id], profissionalId: carla.id, data: dia, hora: h1, cliente: { nome: 'Mariana Lima Nova', telefone: '11911110001' }, produtos: [] })
check('site cria agendamento', site.success && site.data.pagamentoId, site)
const dup = await call('POST', '/publico/demo/agendamentos', { servicoIds: [corte.id], profissionalId: carla.id, data: dia, hora: h1, cliente: { nome: 'X', telefone: '11900000009' } })
check('site nao permite mesmo horario (409)', dup.status === 409, dup)
const hs2 = await call('GET', `/publico/demo/horarios?servicoIds=${corte.id}&profissionalId=${carla.id}&data=${dia}`)
check('horario reservado sai da lista', !hs2.data.profissionais[0].horarios.includes(h1), hs2.data.profissionais[0].horarios)
const ck = await call('GET', `/checkout/${site.data.pagamentoId}`)
check('checkout pendente simulado c/ contador', ck.data.status === 'PENDENTE' && ck.data.modoGateway === 'simulado' && ck.data.segundosRestantes > 800, ck.data)
const pix = await call('POST', `/checkout/${site.data.pagamentoId}/pix`)
check('gera pix', pix.success && pix.data.copiaCola, pix)
const sim = await call('POST', `/checkout/${site.data.pagamentoId}/simular`, { forma: 'PIX' })
check('simula pagamento aprovado', sim.data?.status === 'APROVADO', sim)
const agSite = await call('GET', `/agenda/agendamentos/${site.data.agendamentoId}`, null, T)
check('agendamento confirmado apos pagamento', agSite.data.status === 'CONFIRMADO' && agSite.data.situacaoPagamento === 'PAGO_ONLINE', agSite.data?.status)
check('mesmo cliente pelo telefone + nome atualizado', agSite.data.cliente.nome === 'Mariana Lima Nova' && agSite.data.clienteResumo.totalVisitas >= 2, agSite.data.cliente)

// --- cancelamento: regra e valor ---
const simc = await call('GET', `/agenda/agendamentos/${site.data.agendamentoId}/simular-cancelamento`, null, T)
check('simulacao cancel dentro do prazo = 100%', simc.data.regra === 'DENTRO_PRAZO' && simc.data.valor === 14000, simc.data)

// --- reagendar pelo estabelecimento ---
const novoH = horarios[horarios.length - 1]
const reag = await call('POST', `/agenda/agendamentos/${site.data.agendamentoId}/reagendar`, { data: dia, hora: novoH }, T)
check('reagendar mantem pagamento', reag.success && reag.data.agendamento.hora === novoH && reag.data.agendamento.situacaoPagamento === 'PAGO_ONLINE', reag)

// --- manual com conflito / encaixe ---
const man = await call('POST', '/agenda/agendamentos', { cliente: { nome: 'Cliente Balcao', telefone: '11955554444' }, servicoIds: [corte.id], profissionalId: carla.id, data: dia, hora: novoH, pagamento: 'LOCAL' }, T)
check('manual em conflito -> 409 com conflitos', man.status === 409 && man.details?.requerEncaixe && man.details.conflitos.length, man)
const enc = await call('POST', '/agenda/agendamentos', { cliente: { nome: 'Cliente Balcao', telefone: '11955554444' }, servicoIds: [corte.id], profissionalId: carla.id, data: dia, hora: novoH, pagamento: 'LOCAL', encaixe: true }, T)
check('encaixe confirmado cria', enc.success && enc.data.encaixe && enc.data.status === 'CONFIRMADO', enc)

// --- iniciar / finalizar ---
const ini = await call('POST', `/agenda/agendamentos/${enc.data.id}/iniciar`, null, T)
check('iniciar', ini.data?.status === 'EM_ATENDIMENTO', ini)
const prev = await call('GET', `/agenda/agendamentos/${enc.data.id}/finalizacao`, null, T)
check('previa finalizacao valor em aberto + retorno', prev.data.valorEmAberto === 8000 && prev.data.retornoSugerido, prev.data)
const finSem = await call('POST', `/agenda/agendamentos/${enc.data.id}/finalizar`, {}, T)
check('finalizar exige forma de pagamento', finSem.status === 400, finSem)
const prod = ref.data.produtos[0]
const fin = await call('POST', `/agenda/agendamentos/${enc.data.id}/finalizar`, { formaPagamento: 'DINHEIRO', produtosAdicionais: [{ produtoId: prod.id, quantidade: 1 }], retorno: { acao: 'ACEITAR' } }, T)
check('finalizar com produto + dinheiro', fin.data?.status === 'CONCLUIDO' && fin.data.valorTotal === 8000 + prod.preco && fin.data.situacaoPagamento === 'PAGO_LOCAL', fin)

// --- no-show e cancelamento manual ---
const m2 = await call('POST', '/agenda/agendamentos', { cliente: { nome: 'Pedro', telefone: '11944443333' }, servicoIds: [corte.id], profissionalId: carla.id, data: addDays(dia, 1), hora: '15:00', pagamento: 'LINK', encaixe: true }, T)
check('manual com LINK -> aguardando pagamento', m2.data?.status === 'AGUARDANDO_PAGAMENTO' && m2.data.linkPagamento, m2)
const pl = await call('POST', `/agenda/agendamentos/${m2.data.id}/pagamento-local`, { forma: 'MAQUININHA' }, T)
check('registrar pagamento no local confirma', pl.data?.status === 'CONFIRMADO', pl)
const ns = await call('GET', `/agenda/agendamentos/${m2.data.id}/simular-cancelamento?tipo=NO_SHOW`, null, T)
check('simular no-show regra NO_SHOW 0%', ns.data.regra === 'NO_SHOW' && ns.data.valor === 0, ns.data)
const cEst = await call('POST', `/agenda/agendamentos/${m2.data.id}/cancelar`, { porEstabelecimento: true }, T)
check('cancelar pelo estabelecimento = reembolso integral registrado', cEst.data?.agendamento.status === 'CANCELADO' && cEst.data.reembolso.valor === 8000, cEst.data?.reembolso)

// --- bloqueio com afetados ---
const bl = await call('POST', '/agenda/bloqueios', { profissionalId: carla.id, data: dia, horaInicio: '08:00', horaFim: '19:00', motivo: 'Curso' }, T)
check('bloqueio com afetados -> 409 requerDecisao', bl.status === 409 && bl.details?.afetados?.length >= 1, bl)
const bl2 = await call('POST', '/agenda/bloqueios', { profissionalId: carla.id, data: dia, horaInicio: '08:00', horaFim: '19:00', motivo: 'Curso', decisoes: bl.details.afetados.map((a) => ({ agendamentoId: a.id, acao: 'CANCELAR' })) }, T)
check('bloqueio aplica decisoes', bl2.success && bl2.data.resultados.length === bl.details.afetados.length, bl2)
const hs3 = await call('GET', `/publico/demo/horarios?servicoIds=${corte.id}&profissionalId=${carla.id}&data=${dia}`)
check('dia bloqueado sem horarios', hs3.data.profissionais[0].horarios.length === 0, hs3.data.profissionais[0])

// --- visao / metricas ---
const vis = await call('GET', `/agenda/visao?de=${dia}&ate=${addDays(dia, 6)}`, null, T)
check('agenda visao semana', vis.success && vis.data.dias.length === 7 && vis.data.bloqueios.length >= 1, vis.error)
const vg = await call('GET', '/visao-geral', null, T)
check('visao geral dono', vg.success && vg.data.resumo.faturamento !== null, vg.error)
const vgr = await call('GET', '/visao-geral', null, rec)
check('visao geral recepcao sem financeiro', vgr.success && vgr.data.resumo.faturamento === null && vgr.data.meta.valor === null, vgr)
const de = await call('GET', '/desempenho', null, T)
check('desempenho', de.success && de.data.capacidade.taxaOcupacao >= 0 && de.data.receita.evolucaoMensal.length === 12, de.error)
const fr = await call('GET', '/financeiro/resultado', null, T)
check('financeiro resultado', fr.success && fr.data.faturamento > 0, fr)
const frr = await call('GET', '/financeiro/resultado', null, rec)
check('recepcao bloqueada no resultado (403)', frr.status === 403, frr)
const frec = await call('GET', '/financeiro/recebimentos', null, rec)
check('recepcao ve recebimentos', frec.success, frec)
const cfg = await call('GET', '/configuracoes', null, rec)
check('recepcao sem configuracoes (403)', cfg.status === 403, cfg)
const cli = await call('GET', '/clientes', null, T)
check('clientes com segmentos', cli.success && cli.data.contagem && cli.data.total >= 6, cli.data?.contagem)
const cliAna = await call('GET', '/clientes', null, ana.token)
check('profissional ve so os seus clientes', cliAna.success && cliAna.data.total < cli.data.total, cliAna.data?.total)
const visAna = await call('GET', `/agenda/visao?de=${dia}&ate=${dia}`, null, ana.token)
check('profissional ve so propria agenda', visAna.data.profissionais.length === 1, visAna.data?.profissionais)
const eq = await call('GET', '/equipe', null, T)
check('equipe', eq.success && eq.data.length === 2, eq.error)
const des = await call('GET', '/desempenho', null, ana.token)
check('desempenho profissional', des.success, des.error)

// --- portal ---
const cod = await call('POST', '/publico/demo/portal/codigo', { telefone: '11911110001' })
check('portal codigo (dev)', cod.success && cod.data.codigoDev, cod)
const cad = await call('POST', '/publico/demo/portal/cadastro', { nome: 'Mariana Lima', telefone: '11911110001', senha: 'abc123', codigo: cod.data.codigoDev })
check('portal cadastro', cad.success && cad.data.token, cad)
const hist = await call('GET', '/portal/historico', null, cad.data.token)
check('portal historico vinculado pelo telefone', hist.success && hist.data.length >= 2, hist.data?.length)
const pts = await call('GET', '/portal/pontos', null, cad.data.token)
check('portal pontos', pts.success && pts.data.ativo, pts)

// --- reserva expira ---
const r2 = await call('POST', '/publico/demo/agendamentos', { servicoIds: [corte.id], profissionalId: carla.id, data: addDays(dia, 2), hora: '10:00', cliente: { nome: 'Teste Expira', telefone: '11933332222' } })
check('reserva criada', r2.success, r2)
globalThis.R2 = r2.data
console.log(JSON.stringify({ expiraId: r2.data?.agendamentoId }))

// --- automacoes / agentes / config ---
const au = await call('GET', '/automacoes', null, T)
check('automacoes 7', au.data?.length === 7, au)
const ag = await call('GET', '/agentes', null, T)
check('agentes config', ag.success && ag.data.numerosAutorizados.length === 1, ag.error)
const cf = await call('GET', '/configuracoes', null, T)
check('configuracoes', cf.success && cf.data.pagamentos.modo === 'simulado', cf.error)
const conv = await call('GET', '/atendimento/conversas', null, T)
check('atendimento conversas', conv.success, conv.error)

console.log(`\n${ok} ok, ${fail} falhas`)
