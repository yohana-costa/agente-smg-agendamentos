import { useState } from 'react'
import { patch } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { Card, Field } from '../../../components/ui'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

const FUSOS: Array<[string, string]> = [
  ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, GO, DF)'],
  ['America/Bahia', 'Bahia'],
  ['America/Fortaleza', 'Fortaleza (CE, RN, PB, PI, MA)'],
  ['America/Recife', 'Recife (PE)'],
  ['America/Maceio', 'Maceió (AL, SE)'],
  ['America/Belem', 'Belém (PA, AP)'],
  ['America/Araguaina', 'Araguaína (TO)'],
  ['America/Cuiaba', 'Cuiabá (MT)'],
  ['America/Campo_Grande', 'Campo Grande (MS)'],
  ['America/Manaus', 'Manaus (AM)'],
  ['America/Porto_Velho', 'Porto Velho (RO)'],
  ['America/Boa_Vista', 'Boa Vista (RR)'],
  ['America/Rio_Branco', 'Rio Branco (AC)'],
  ['America/Noronha', 'Fernando de Noronha'],
]

export function Empresa({ dados, onChange, recarregar }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void; recarregar: () => Promise<void> }) {
  const e = dados.empresa
  const [form, setForm] = useState({
    nome: e.nome || '',
    documento: e.documento || '',
    telefone: e.telefone ? phone(e.telefone) : '',
    email: e.email || '',
    endereco: e.endereco || '',
    timezone: e.timezone || 'America/Sao_Paulo',
  })
  const s = useSalvar()
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const fusos = FUSOS.some(([k]) => k === form.timezone) ? FUSOS : [[form.timezone, form.timezone] as [string, string], ...FUSOS]

  const salvar = () =>
    s.salvar(async () => {
      if (!form.nome.trim()) throw new Error('Informe o nome do estabelecimento.')
      const r = await patch<{ nome: string; documento: string | null; telefone: string | null; email: string | null; endereco: string | null; timezone: string }>('/configuracoes/empresa', form)
      onChange({ empresa: { ...e, nome: r.nome, documento: r.documento, telefone: r.telefone, email: r.email, endereco: r.endereco, timezone: r.timezone } })
      await recarregar()
    }, 'Dados da empresa salvos.')

  return (
    <Card title="Dados do estabelecimento" subtitle="Aparecem no site, nas mensagens automáticas e nos comprovantes.">
      <div className="form-grid">
        <Field label="Nome do estabelecimento" className="full">
          <input className="input" value={form.nome} onChange={(ev) => set('nome', ev.target.value)} />
        </Field>
        <Field label="CPF / CNPJ">
          <input className="input" value={form.documento} onChange={(ev) => set('documento', ev.target.value)} />
        </Field>
        <Field label="Telefone">
          <input className="input" inputMode="tel" value={form.telefone} onChange={(ev) => set('telefone', ev.target.value)} placeholder="(11) 99999-9999" />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={form.email} onChange={(ev) => set('email', ev.target.value)} />
        </Field>
        <Field label="Fuso horário" hint="Usado na agenda, nos horários oferecidos e nas mensagens.">
          <select className="select" value={form.timezone} onChange={(ev) => set('timezone', ev.target.value)}>
            {fusos.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Endereço" className="full">
          <textarea className="textarea" rows={2} value={form.endereco} onChange={(ev) => set('endereco', ev.target.value)} placeholder="Rua, número, bairro, cidade - UF" />
        </Field>
      </div>
      <SaveBar {...s} onSave={salvar} />
    </Card>
  )
}
