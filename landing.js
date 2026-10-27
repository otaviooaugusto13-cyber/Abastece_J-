// Simulador: mesma regra de config.js / server/split.js (diária fixa de R$ 200,00 por turno de 4 a 6 horas)
(function () {
    var DIARIA = 20000, MIN_H = 4, MAX_H = 6;
    var $ = function (id) { return document.getElementById(id); };
    var brl = function (c) { return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, "\u00a0"); };
    function calcular() {
        var h = parseFloat(String($("calc-valor").value).replace(",", ".")), ok = h >= MIN_H && h <= MAX_H;
        $("calc-erro").hidden = ok;
        $("calc-valor").setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) return;
        $("calc-servico").textContent = brl(DIARIA);
        $("calc-total").textContent = brl(DIARIA);
    }
    $("calc-valor").addEventListener("input", calcular);
    calcular();
})();
