import { useState } from 'react'
import { patch } from '../../../lib/api'
import { Card, Field } from '../../../components/ui'
import { CopyField } from '../agentes/CopyField'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

function slugify(t: string) {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
}

export function Site({ dados, onChange, recarregar }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void; recarregar: () => Promise<void> }) {
  const st = dados.site
  const [form, setForm] = useState({
    slug: dados.empresa.slug,
    siteTitulo: st.siteTitulo || '',
    siteDescricao: st.siteDescricao || '',
    siteCorPrimaria: st.siteCorPrimaria || '#007f64',
    siteLogoUrl: st.siteLogoUrl || '',
    siteBannerUrl: st.siteBannerUrl || '',
  })
  const s = useSalvar()
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const base = st.url.replace(/\/s\/[^/]*$/, '/s/')
  const corValida = /^#[0-9a-fA-F]{6}$/.test(form.siteCorPrimaria)
  const cor = corValida ? form.siteCorPrimaria : '#007f64'

  const salvar = () =>
    s.salvar(async () => {
      const slug = slugify(form.slug).replace(/-+$/, '')
      if (!slug) throw new Error('Informe o link da página (letras, números e hífens).')
      if (!corValida) throw new Error('Cor inválida. Use o formato #RRGGBB.')
      const r = await patch<{ slug: string; siteTitulo: string | null; siteDescricao: string | null; siteCorPrimaria: string | null; siteLogoUrl: string | null; siteBannerUrl: string | null }>('/configuracoes/site', { ...form, slug })
      setForm((f) => ({ ...f, slug: r.slug }))
      onChange({
        empresa: { ...dados.empresa, slug: r.slug },
        site: { url: `${base}${r.slug}`, siteTitulo: r.siteTitulo, siteDescricao: r.siteDescricao, siteCorPrimaria: r.siteCorPrimaria, siteLogoUrl: r.siteLogoUrl, siteBannerUrl: r.siteBannerUrl },
      })
      await recarregar()
    }, 'Site atualizado. As alterações já estão no ar.')

  const slugMudou = slugify(form.slug).replace(/-+$/, '') !== dados.empresa.slug

  return (
    <div className="stack">
      <Card title="Link da página" subtitle="Endereço público do site de agendamento. É o link que o agente envia aos clientes.">
        <CopyField
          value={st.url}
          extra={
            <a className="btn" href={st.url} target="_blank" rel="noreferrer">
              Abrir ↗
            </a>
          }
        />
      </Card>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Visual e textos">
          <div className="stack">
            <Field label="Link (slug)" hint={slugMudou ? 'Atenção: o link antigo deixa de funcionar. Atualize onde ele estiver divulgado.' : 'Letras minúsculas, números e hífens.'}>
              <div className="input-group">
                <span className="addon" style={{ borderRadius: '10px 0 0 10px', borderLeft: '1px solid var(--border-strong)', borderRight: 0 }}>
                  /s/
                </span>
                <input className="input" style={{ borderRadius: '0 10px 10px 0' }} value={form.slug} onChange={(e) => set('slug', slugify(e.target.value))} />
              </div>
            </Field>
            <Field label="Título">
              <input className="input" value={form.siteTitulo} onChange={(e) => set('siteTitulo', e.target.value)} placeholder={dados.empresa.nome} />
            </Field>
            <Field label="Descrição">
              <textarea className="textarea" rows={3} value={form.siteDescricao} onChange={(e) => set('siteDescricao', e.target.value)} placeholder="Uma frase sobre o seu negócio" />
            </Field>
            <Field label="Cor primária">
              <div className="cf-color">
                <input type="color" value={cor} onChange={(e) => set('siteCorPrimaria', e.target.value)} />
                <input className="input mono" style={{ width: 120 }} value={form.siteCorPrimaria} onChange={(e) => set('siteCorPrimaria', e.target.value)} />
              </div>
            </Field>
            <Field label="URL do logo" hint="Imagem quadrada, de preferência PNG.">
              <input className="input" value={form.siteLogoUrl} onChange={(e) => set('siteLogoUrl', e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="URL do banner" hint="Imagem horizontal (ex.: 1600×500).">
              <input className="input" value={form.siteBannerUrl} onChange={(e) => set('siteBannerUrl', e.target.value)} placeholder="https://..." />
            </Field>
          </div>
          <SaveBar {...s} onSave={salvar} label="Salvar site" />
        </Card>

        <Card title="Pré-visualização" subtitle="Aproximação do topo do site.">
          <div className="cf-site-preview">
            <div className="cf-site-banner" style={{ backgroundColor: cor, backgroundImage: form.siteBannerUrl ? `url("${form.siteBannerUrl}")` : undefined }}>
              {form.siteLogoUrl ? <img className="cf-site-logo" src={form.siteLogoUrl} alt="Logo" /> : null}
            </div>
            <div className="cf-site-body">
              <div className="strong" style={{ fontSize: 17 }}>
                {form.siteTitulo || dados.empresa.nome}
              </div>
              <div className="small muted">{form.siteDescricao || 'Agende seu horário online.'}</div>
              <span className="cf-site-btn" style={{ background: cor }}>
                Agendar horário
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
