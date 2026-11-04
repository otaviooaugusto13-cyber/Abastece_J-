// Raio de atendimento (km) para o MAPA. A fonte da verdade é o Admin Root (config_publica/operacao): quem a escuta chama definirRaioKm() (geo.js),
// que atualiza RAIO_KM (binding vivo) e dispara este evento. Aqui não há segunda configuração.
import { RAIO_KM } from "./geo.js";
export const EVENTO_RAIO = "raio:atualizado";
export const RAIO = { get raioKm() { return RAIO_KM; } };
