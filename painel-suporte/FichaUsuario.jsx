// Coluna da direita: ficha completa do usuário da conversa aberta (perfil, contato, treinamento, nota, turnos e ações recentes).
// Mostra na hora o que já se sabe (nome/segmento da conversa + ficha em cache) e completa quando a API responde.
import styles from "./SuportePanel.module.css";
import { formatarEspera, formatarTelefone, mascararDocumento, progressoTreinamento, rotuloStatusConta, titulo } from "./logica.js";
import { Avatar, BotaoCopiar, Chip, Icone, classeSegmento, rotuloSegmento } from "./ui.jsx";

const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const ROTULO_ACAO = { "admin.suporte.responder": "Respondeu no suporte", "admin.suporte.ver_perfil": "Abriu a ficha no atendimento", "admin.suporte.escalar": "Escalou o atendimento", "admin.suporte.resolver": "Resolveu o atendimento", "admin.promotor.status": "Mudou o status do cadastro", "admin.recado.enviar": "Enviou um recado" };

const relativo = (d) => { const t = formatarEspera(d); return t === "agora" ? "agora" : `há ${t}`; };

function Linha({ rotulo, children, copiar, onCopiar, rotuloCopia }) {
  return (
    <div className={styles.linhaFicha}>
      <dt>{rotulo}</dt>
      <dd>{children || <span className={styles.nulo}>Não informado</span>}{copiar ? <BotaoCopiar valor={copiar} rotulo={rotuloCopia || rotulo.toLowerCase()} onCopiar={onCopiar} /> : null}</dd>
    </div>
  );
}
const Nota = ({ valor }) => (
  <span className={styles.nota} aria-label={`Nota média ${valor} de 5`}>
    <span className={styles.estrelas} aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <Icone.Estrela key={n} width={15} height={15} className={n <= Math.round(valor) ? styles.estrelaOn : styles.estrelaOff} />)}</span>
    <b>{Number(valor).toFixed(1).replace(".", ",")}</b>
  </span>
);

export default function FichaUsuario({ conv, estado, aberta, onFechar, onCopiar, agora }) {
  const { perfil, carregando, erro, recarregar } = estado;
  const cad = perfil?.cadastro, loja = (perfil?.tipo || conv?.tipo) === "loja", status = rotuloStatusConta(cad?.status), parcial = !!perfil?.parcial;
  const trein = progressoTreinamento(cad?.treinamento), nome = cad?.nome || conv?.nome;
  const desde = cad?.criadoEm ? fmtMes.format(new Date(cad.criadoEm)) : null;

  return (
    <aside className={styles.ficha} data-aberta={aberta ? "true" : "false"} aria-label="Ficha do usuário">
      <header className={styles.fichaTopo}>
        <h2 className={styles.fichaTitulo}>Ficha do usuário</h2>
        <button type="button" className={styles.btnIcone} onClick={recarregar} aria-label="Atualizar ficha" title="Atualizar ficha" disabled={!conv || carregando}><Icone.Recarregar /></button>
        <button type="button" className={`${styles.btnIcone} ${styles.soCompacto}`} onClick={onFechar} aria-label="Fechar ficha"><Icone.Fechar /></button>
      </header>

      {!conv ? <p className={styles.fichaVazia}>Selecione uma conversa para ver a ficha completa de quem está falando com você.</p> : (
        <div className={styles.fichaCorpo} aria-busy={carregando}>
          <div className={styles.fichaId}>
            <Avatar nome={nome} foto={cad?.foto} tipo={conv.tipo} tamanho={72} />
            <h3 className={styles.fichaNome}>{nome || "Usuário"}</h3>
            <div className={styles.fichaChips}>
              <span className={`${styles.segRotulo} ${classeSegmento(conv.tipo)}`}>{rotuloSegmento(conv.tipo)}</span>
              {cad ? <Chip tom={status.tom} title={cad.statusMotivo || undefined}>Conta: {status.texto}</Chip> : <span className={styles.esqueletoChip} aria-hidden="true" />}
              {cad?.menor && <Chip tom="aviso">Menor de idade</Chip>}
            </div>
            {(desde || cad?.cidade) && <p className={styles.fichaSub}>{[cad?.cidade, desde ? `na plataforma desde ${desde}` : ""].filter(Boolean).join(" · ")}</p>}
            {cad?.statusMotivo && status.tom !== "ok" && <p className={styles.fichaMotivo}>{cad.statusMotivo}</p>}
          </div>

          {erro && !perfil && <p className={styles.aviso} role="alert">Não foi possível carregar a ficha ({erro.message}). <button type="button" className={styles.link} onClick={recarregar}>Tentar de novo</button></p>}
          {parcial && <p className={styles.faixaFicha} role="status">Carregando contato e documento…</p>}

          <section className={styles.bloco} aria-label="Contato">
            <h4>Contato</h4>
            <dl>
              <Linha rotulo="E-mail" copiar={perfil?.email} onCopiar={onCopiar}>{perfil?.email}</Linha>
              <Linha rotulo="Telefone" copiar={cad?.telefone} onCopiar={onCopiar}>{cad?.telefone ? formatarTelefone(cad.telefone) : parcial || !perfil ? <span className={styles.nulo}>…</span> : null}</Linha>
              <Linha rotulo={loja ? "CPF/CNPJ" : "CPF"}>{loja ? mascararDocumento(cad?.documento) : cad?.cpfMascarado || (parcial || !perfil ? <span className={styles.nulo}>…</span> : null)}</Linha>
              {loja && <Linha rotulo="Endereço">{cad?.endereco}</Linha>}
            </dl>
          </section>

          <section className={styles.bloco} aria-label="Desempenho e habilitações">
            <h4>{loja ? "Loja" : "Desempenho e habilitações"}</h4>
            {loja ? (
              <dl>
                <Linha rotulo="Ramo">{cad?.ramo}</Linha>
                <Linha rotulo="Cartão">{cad ? titulo(cad.cartao) : null}</Linha>
                <Linha rotulo="Nota média"><span className={styles.nulo}>Lojas não recebem avaliações</span></Linha>
                <Linha rotulo="Treinamento"><span className={styles.nulo}>Não se aplica a lojas</span></Linha>
              </dl>
            ) : (
              <>
                <div className={styles.metricas}>
                  <div className={styles.metrica}><span className={styles.metricaRotulo}>Nota média</span>{cad?.ratingMedia ? <Nota valor={cad.ratingMedia} /> : <span className={styles.nulo}>{cad ? "Sem avaliações" : "…"}</span>}</div>
                  <div className={styles.metrica}><span className={styles.metricaRotulo}>Treinamento</span><b className={styles.metricaValor}>{cad ? `${trein.feitos}/${trein.total}` : "…"}</b></div>
                </div>
                <div className={styles.barra} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={trein.pct} aria-label="Progresso nos treinamentos"><span style={{ width: `${trein.pct}%` }} /></div>
                <p className={styles.barraLegenda}>{cad ? (trein.total ? `${trein.pct}% dos módulos concluídos` : "Nenhum módulo de treinamento publicado") : ""}</p>
                {cad?.habilitacoes?.length > 0 && <div className={styles.listaChips} aria-label="Habilitações">{cad.habilitacoes.map((h) => <Chip key={h} tom="ok">{titulo(h)}</Chip>)}</div>}
                {cad && cad.habilitacoes?.length === 0 && <p className={styles.nulo}>Nenhuma habilitação por categoria ainda.</p>}
                {cad?.pendencias?.length > 0 && (
                  <div className={styles.pendencias}><b>Pendências para liberar turnos</b><ul>{cad.pendencias.map((p) => <li key={p}>{titulo(p)}</li>)}</ul></div>
                )}
              </>
            )}
          </section>

          {perfil && (
            <section className={styles.bloco} aria-label="Turnos">
              <h4>Turnos</h4>
              <p className={styles.turnosResumo}><b>{perfil.historico.total}</b> no total{Object.entries(perfil.historico.porStatus).map(([s, n]) => <Chip key={s} tom={s === "concluido" || s === "pago" ? "ok" : s === "cancelado" ? "erro" : "neutro"}>{n} {s.replace(/_/g, " ")}</Chip>)}</p>
              {perfil.historico.ultimos.length > 0 && (
                <ul className={styles.turnos}>
                  {perfil.historico.ultimos.slice(0, 5).map((tr) => (
                    <li key={tr.id}><span className={styles.turnoData}>{tr.data ? fmtDia.format(new Date(`${tr.data}T00:00:00Z`)) : "—"}</span><span className={styles.turnoInfo}>{tr.contraparte || tr.foco || "Turno"}{tr.entrada ? <small> {tr.entrada}{tr.saida ? `–${tr.saida}` : ""}</small> : null}</span><span className={styles.turnoStatus}>{tr.status.replace(/_/g, " ")}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {perfil && (
            <section className={styles.bloco} aria-label="Histórico com a equipe">
              <h4>Histórico com a equipe</h4>
              <p className={styles.fichaSub}>{perfil.conversa.mensagens} mensagens no chat{perfil.conversa.desde ? ` · conversa aberta em ${fmtMes.format(new Date(perfil.conversa.desde))}` : ""}</p>
              {perfil.acoes.length > 0 && <ul className={styles.acoesLista}>{perfil.acoes.map((a, i) => <li key={`${a.acao}-${i}`}><span>{ROTULO_ACAO[a.acao] || a.acao}</span><time>{a.em ? relativo(agora - Date.parse(a.em)) : ""}</time></li>)}</ul>}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
