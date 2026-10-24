// No celular cada linha de tabela vira um cartao (styles.css, max-width 900px) e o cabecalho
// some. Para cada celula continuar dizendo o que e, copia o texto do <th> da mesma coluna
// para data-label, que o CSS mostra ao lado do valor. Vale para todas as tabelas .table,
// inclusive as que aparecem depois (troca de aba, modal, lista carregada).

function rotular(tabela: HTMLTableElement) {
  const cabecalho = tabela.tHead?.rows[0]
  if (!cabecalho) return
  // posicao real de cada coluna, considerando colspan no cabecalho
  const nomes: string[] = []
  for (const th of Array.from(cabecalho.cells)) {
    const texto = (th.textContent || '').trim()
    for (let i = 0; i < (th.colSpan || 1); i++) nomes.push(texto)
  }
  for (const corpo of Array.from(tabela.tBodies)) {
    for (const linha of Array.from(corpo.rows)) {
      let coluna = 0
      for (const td of Array.from(linha.cells)) {
        const nome = nomes[coluna] ?? ''
        if (td.getAttribute('data-label') !== nome) td.setAttribute('data-label', nome)
        coluna += td.colSpan || 1
      }
    }
  }
}

let agendado = false
function rotularTudo() {
  agendado = false
  document.querySelectorAll<HTMLTableElement>('table.table').forEach(rotular)
}

export function ligarTabelaResponsiva() {
  const observador = new MutationObserver(() => {
    if (agendado) return
    agendado = true
    requestAnimationFrame(rotularTudo)
  })
  observador.observe(document.body, { childList: true, subtree: true, characterData: true })
  rotularTudo()
}
