/**
 * KubeShop - Verificação de saúde do MongoDB
 *
 * Executado pelo mongosh no HEALTHCHECK do container:
 *
 *   mongosh --quiet --norc /healthcheck.js
 *
 * O comando "ping" não exige autenticação, portanto nenhuma
 * credencial precisa ser informada nem aparece nos logs.
 * Retorna código 0 quando o banco responde e 1 em caso de falha.
 */
try {
  const result = db.adminCommand({ ping: 1 });
  quit(result.ok === 1 ? 0 : 1);
} catch {
  quit(1);
}
