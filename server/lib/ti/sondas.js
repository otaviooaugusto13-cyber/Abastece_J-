// Sondas reais do monitor de saúde. Cada uma devolve { estado?, detalhe?, latenciaMs? } ou LANÇA se o serviço falhou.
// Regras: só leitura; timeout curto; nunca devolve corpo de resposta, token ou stack (o painel mostra o `detalhe` na tela).
const MP_API = "https://api.mercadopago.com";

function criarSondas({ db, admin, G, saude, mpToken = "", baseUrl = "", segredoWebhook = false, geoUrl = "", fetchFn = (...a) => fetch(...a), timeoutMs = 5_000 }) {
  const medir = async (fn) => { const t0 = Number(process.hrtime.bigint() / 1000n) / 1000; await fn(); return Math.round(Number(process.hrtime.bigint() / 1000n) / 1000 - t0); };
  const sinal = () => AbortSignal.timeout(timeoutMs);
  const drenar = (r) => r.arrayBuffer().catch(() => {});      // libera a conexão sem ler/guardar o conteúdo

  return {
    firebase: {
      nome: "Firebase Admin", tipo: "externo", lentoMs: 800,
      // Firestore (leitura de 1 documento) + Auth (listar 1 usuário): se qualquer um cair, o login ou os dados quebram.
      fn: async () => {
        const [fs, au] = await Promise.allSettled([medir(() => db.collection("_saude").doc("ping").get()), medir(() => admin.auth().listUsers(1))]);
        const falhas = [fs.status === "rejected" && "Firestore", au.status === "rejected" && "Auth"].filter(Boolean);
        if (falhas.length) throw new Error(`${falhas.join(" e ")} sem resposta`);
        return { latenciaMs: Math.max(fs.value, au.value), detalhe: `Firestore ${fs.value} ms · Auth ${au.value} ms` };
      }
    },
    mercadopago: {
      nome: "Mercado Pago (gateway)", tipo: "externo", lentoMs: 2_000,
      // GET /v1/payment_methods: leitura barata que exige a credencial → prova ao mesmo tempo rede, API e token válido.
      fn: async () => {
        if (!mpToken) return { estado: "nao_configurado", detalhe: "MP_ACCESS_TOKEN ausente neste ambiente" };
        const r = await fetchFn(`${MP_API}/v1/payment_methods`, { headers: { Authorization: `Bearer ${mpToken}` }, signal: sinal() });
        await drenar(r);
        if (r.status === 401 || r.status === 403) throw new Error(`Credencial recusada pelo Mercado Pago (HTTP ${r.status})`);
        if (r.status === 429) return { estado: "degradado", detalhe: "Limite de requisições atingido (HTTP 429)" };
        if (!r.ok) throw new Error(`Mercado Pago respondeu HTTP ${r.status}`);
        return {};
      }
    },
    webhooks: {
      nome: "Serviço de Webhooks", tipo: "interno", lentoMs: 1_500,
      // Ativo: POST sem assinatura na URL PÚBLICA — o servidor TEM que recusar (401). Prova DNS, TLS, proxy e a checagem de assinatura de ponta a ponta.
      // Passivo: taxa de erro 5xx dos webhooks reais nos últimos 15 min (uma porta que responde mas falha ao processar também é problema).
      fn: async () => {
        if (!segredoWebhook) return { estado: "nao_configurado", detalhe: "MP_WEBHOOK_SECRET ausente neste ambiente" };
        const r = await fetchFn(`${baseUrl}/webhookMP`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "abastece-ja-saude" }, body: "{}", signal: sinal() });
        await drenar(r);
        if (r.status !== 401) throw new Error(`Endpoint respondeu HTTP ${r.status} (esperado 401 sem assinatura)`);
        const w = saude.webhookRecente(), quando = w.ultimoEm ? `último evento ${new Date(w.ultimoEm).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "nenhum evento em 15 min";
        if (w.total >= 5 && w.taxa >= 0.5) return { estado: "fora", detalhe: `${w.falhas} de ${w.total} webhooks falharam em 15 min` };
        if (w.total >= 5 && w.taxa >= 0.2) return { estado: "degradado", detalhe: `${w.falhas} de ${w.total} webhooks falharam em 15 min` };
        return { detalhe: `Recusa chamadas sem assinatura · ${w.total} evento(s) em 15 min (${w.falhas} falha) · ${quando}` };
      }
    },
    geolocalizacao: geoUrl ? {
      nome: "API de Geolocalização / Mapas", tipo: "externo", lentoMs: 2_000,
      fn: async () => { const r = await fetchFn(geoUrl, { signal: sinal() }); await drenar(r); if (!r.ok) throw new Error(`Provedor de mapas respondeu HTTP ${r.status}`); return { detalhe: "Provedor externo (GEO_HEALTH_URL)" }; }
    } : {
      nome: "Geolocalização (geofence)", tipo: "interno", lentoMs: 250,
      // O app NÃO usa API externa de mapas: o GPS vem do navegador e o servidor calcula a distância (haversine). A sonda confere esse cálculo
      // com valores conhecidos — pega regressão de código, não queda de provedor. Para monitorar um provedor, defina GEO_HEALTH_URL.
      fn: async () => {
        const t0 = Number(process.hrtime.bigint() / 1000n) / 1000;
        const d = G.distanciaM({ lat: 0, lng: 1 }, { lat: 1, lng: 1 });                    // 1° de latitude ≈ 111,19 km
        if (Math.abs(d - 111_195) > 60) throw new Error(`Cálculo de distância incorreto (${Math.round(d)} m)`);
        let aceitou = false; try { G.coordenadas({ lat: 0, lng: 0 }); aceitou = true; } catch { /* esperado: 0/0 é inválido */ }
        if (aceitou) throw new Error("Geofence aceitou a coordenada 0/0");
        return { latenciaMs: Math.round((Number(process.hrtime.bigint() / 1000n) / 1000 - t0) * 100) / 100, detalhe: "Cálculo interno (haversine): sem dependência externa" };
      }
    }
  };
}
module.exports = { criarSondas };
