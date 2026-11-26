#!/usr/bin/env node
/**
 * KubeShop - Teste de fumaça (smoke test)
 *
 * Verifica rapidamente uma instalação em execução, local ou na nuvem,
 * seguindo o fluxo do escopo: loja -> catálogo -> pedido -> histórico.
 *
 * Uso:
 *   node roteiros/smoke.mjs                         (http://localhost:8080)
 *   node roteiros/smoke.mjs http://IP_PUBLICO
 *   BASE_URL=http://IP_PUBLICO node roteiros/smoke.mjs
 *   node roteiros/smoke.mjs http://IP --read-only   (não cria pedido)
 *
 * Código de saída: 0 = tudo certo; 1 = alguma verificação falhou.
 * A saída serve como evidência e não contém credenciais.
 */
const args = process.argv.slice(2);
const readOnly = args.includes("--read-only");
const baseUrl = (args.find((arg) => !arg.startsWith("--")) || process.env.BASE_URL || "http://localhost:8080").replace(/\/+$/, "");

let failures = 0;

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`✔ ${name}${detail ? ` - ${detail}` : ""} (${Date.now() - started} ms)`);
  } catch (error) {
    failures += 1;
    console.log(`✖ ${name} - ${error.message}`);
  }
}

async function http(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

function expectStatus(result, expected) {
  if (result.status !== expected) {
    throw new Error(`HTTP ${result.status}, esperado ${expected}`);
  }
}

console.log(`KubeShop smoke test - ${baseUrl} - ${new Date().toISOString()}\n`);

await check("Nginx responde em /healthz", async () => {
  const result = await http("/healthz");
  expectStatus(result, 200);
});

await check("Loja (GET /) entrega o HTML do React", async () => {
  const result = await http("/");
  expectStatus(result, 200);
  if (typeof result.body !== "string" || !result.body.includes('id="root"')) {
    throw new Error("HTML sem o elemento #root");
  }
  return result.headers.get("content-security-policy") ? "com Content-Security-Policy" : "sem CSP";
});

await check("API pronta e conectada ao MongoDB (/api/health/ready)", async () => {
  const result = await http("/api/health/ready");
  expectStatus(result, 200);
  if (result.body.database !== true) throw new Error("database=false");
});

let firstProduct;

await check("Catálogo carregado (GET /api/products)", async () => {
  const result = await http("/api/products");
  expectStatus(result, 200);
  const { products } = result.body;
  if (!Array.isArray(products) || products.length === 0) throw new Error("catálogo vazio");
  firstProduct = products[0];
  return `${products.length} produtos`;
});

let createdId;

if (readOnly) {
  console.log("- Criação de pedido ignorada (--read-only)");
} else {
  await check("Pedido fictício criado (POST /api/orders)", async () => {
    if (!firstProduct) throw new Error("sem produto para comprar");
    const result = await http("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ productId: firstProduct.id, quantity: 1 }] }),
    });
    expectStatus(result, 201);
    const { order } = result.body;
    if (order.totalCents !== firstProduct.priceCents) {
      throw new Error(`total ${order.totalCents} diferente do preço ${firstProduct.priceCents}`);
    }
    createdId = order.id;
    return `pedido ${createdId}`;
  });
}

await check("Histórico consultado (GET /api/orders)", async () => {
  const result = await http("/api/orders");
  expectStatus(result, 200);
  const { orders } = result.body;
  if (!Array.isArray(orders)) throw new Error("resposta sem lista de pedidos");
  if (createdId && !orders.some((order) => order.id === createdId)) {
    throw new Error(`pedido ${createdId} não aparece no histórico`);
  }
  return `${orders.length} pedidos no histórico`;
});

await check("Pedido inválido é rejeitado (HTTP 400)", async () => {
  const result = await http("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ productId: "nao-existe", quantity: 1 }] }),
  });
  expectStatus(result, 400);
});

console.log(`\n${failures === 0 ? "✔ Todas as verificações passaram." : `✖ ${failures} verificação(ões) falharam.`}`);
process.exit(failures === 0 ? 0 : 1);
