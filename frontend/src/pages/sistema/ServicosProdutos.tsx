import { useState } from 'react'
import { PageHeader, Tabs } from '../../components/ui'
import ServicosTab from './servicos/ServicosTab'
import ProdutosTab from './servicos/ProdutosTab'
import './servicos/servicos.css'

type Aba = 'servicos' | 'produtos'

export default function ServicosProdutos() {
  const [aba, setAba] = useState<Aba>('servicos')
  return (
    <div>
      <PageHeader title="Serviços / Produtos" subtitle="Catálogo de serviços, produtos, estoque e vendas." />
      <div className="sv-note">
        <span className="dot" /> Tudo o que é alterado aqui é atualizado automaticamente no site.
      </div>
      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        tabs={[
          { key: 'servicos', label: 'Serviços' },
          { key: 'produtos', label: 'Produtos' },
        ]}
      />
      {aba === 'servicos' ? <ServicosTab /> : <ProdutosTab />}
    </div>
  )
}
