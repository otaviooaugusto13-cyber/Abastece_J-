// Error Boundary para apps em React. OS APPS ATUAIS (loja/promotor) NÃO são React: eles já são cobertos por erros-globais.js
// (window.onerror + unhandledrejection + erros 500 da API). Use este componente SÓ se/quando uma tela nova for escrita em React:
// erros de renderização do React são capturados pelo Boundary e NÃO chegam ao window.onerror.
// Ele entrega o erro ao MESMO capturador (window.AbasteceErros.reportar), que abre o chamado [AUTO-BUG] em segundo plano.
import { Component, type ErrorInfo, type ReactNode } from "react";

declare global { interface Window { AbasteceErros?: { reportar: (erro: unknown, origem?: string, extra?: Record<string, unknown>) => Promise<void> } } }

interface Props { children: ReactNode; /** O que mostrar no lugar da tela quebrada (o app continua navegável). */ fallback?: ReactNode }
export default class AbasteceErrorBoundary extends Component<Props, { quebrou: boolean }> {
  state = { quebrou: false };
  static getDerivedStateFromError() { return { quebrou: true }; }
  componentDidCatch(erro: Error, info: ErrorInfo) {
    try { void window.AbasteceErros?.reportar(Object.assign(erro, { stack: `${erro.stack ?? ""}\n${info.componentStack ?? ""}` }), "react-boundary"); }
    catch { /* o relato nunca pode causar outro erro */ }
  }
  render() { return this.state.quebrou ? (this.props.fallback ?? <p role="alert">Algo deu errado nesta tela. A equipe de TI já foi avisada.</p>) : this.props.children; }
}
