#!/usr/bin/env node
// Verificação estática de integridade do projeto (rode depois de qualquer merge): node scripts/verificar-integridade.mjs
//  1) marcadores de conflito  2) sintaxe de todo .js/.cjs/.mjs  3) import × export entre módulos do navegador
//  4) declarações duplicadas no topo de cada arquivo  5) JSON válido  6) <script>/<link> locais existem e ids de HTML não repetem
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ignorar = new Set(["node_modules", ".git", "docs"]);
const arquivos = []; (function varrer(d) { for (const n of fs.readdirSync(d)) { if (ignorar.has(n)) continue; const p = path.join(d, n); fs.statSync(p).isDirectory() ? varrer(p) : arquivos.push(p); } })(raiz);
const rel = (p) => path.relative(raiz, p), ler = (p) => fs.readFileSync(p, "utf8"), problemas = [];
const add = (tipo, arq, msg) => problemas.push(`[${tipo}] ${rel(arq)}: ${msg}`);
const texto = arquivos.filter((p) => /\.(js|cjs|mjs|json|html|css|md|yaml|yml|rules)$/.test(p));

for (const p of texto) { const l = ler(p).split("\n"); l.forEach((x, i) => { if (/^(<{7}|>{7}) /.test(x) || /^={7}$/.test(x)) add("CONFLITO", p, `marcador na linha ${i + 1}`); }); }

const js = arquivos.filter((p) => /\.(js|cjs|mjs)$/.test(p));
for (const p of js) { try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); } catch (e) { add("SINTAXE", p, String(e.stderr || e.message).split("\n").slice(0, 3).join(" ")); } }

// exports de cada módulo ESM do navegador (raiz do projeto, *.js)
const exportsDe = (p) => { const t = ler(p), s = new Set(); for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) s.add(m[1]); for (const m of t.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(",").forEach((x) => s.add(x.trim().split(/\s+as\s+/).pop())); if (/export\s+default/.test(t)) s.add("default"); return s; };
const cacheExp = new Map();
for (const p of js.filter((f) => path.dirname(f) === raiz || /server\/lib\/ti\//.test(f) === false && path.dirname(f) === raiz)) {
  const t = ler(p);
  for (const m of t.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.\/[^"']+)["']/g)) {
    const alvo = path.join(path.dirname(p), m[2]); if (!fs.existsSync(alvo)) { add("IMPORT", p, `arquivo inexistente ${m[2]}`); continue; }
    if (!cacheExp.has(alvo)) cacheExp.set(alvo, exportsDe(alvo));
    for (const nome of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!cacheExp.get(alvo).has(nome)) add("IMPORT", p, `"${nome}" não é exportado por ${m[2]}`);
  }
}

// declarações duplicadas no nível raiz (coluna 0)
for (const p of js) {
  const vistos = new Map(); ler(p).split("\n").forEach((l, i) => { const m = l.match(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)/); if (!m) return; if (vistos.has(m[1])) add("DUPLICADO", p, `"${m[1]}" declarado nas linhas ${vistos.get(m[1])} e ${i + 1}`); else vistos.set(m[1], i + 1); });
}

for (const p of arquivos.filter((f) => /\.json$/.test(f))) { try { JSON.parse(ler(p)); } catch (e) { add("JSON", p, e.message); } }

for (const p of arquivos.filter((f) => /\.html$/.test(f))) {
  const t = ler(p), dir = path.dirname(p);
  for (const m of t.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g)) { const u = m[1]; if (/^(https?:|\/\/|data:|#|\/[a-z-]+$)/.test(u) || u.startsWith("mailto:")) continue; if (!fs.existsSync(path.join(dir, u.split("?")[0]))) add("REFERENCIA", p, `não existe: ${u}`); }
  const ids = [...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); for (const i of new Set(ids.filter((x, k) => ids.indexOf(x) !== k))) add("ID-DUPLICADO", p, `id="${i}" repetido`);
}

console.log(`Arquivos de texto: ${texto.length} · JS: ${js.length}`);
if (problemas.length) { console.log(problemas.join("\n")); console.log(`\n✗ ${problemas.length} problema(s)`); process.exit(1); }
console.log("✓ sem marcadores de conflito, sintaxe OK, imports×exports OK, sem declarações duplicadas, JSON válido, referências de HTML OK");
