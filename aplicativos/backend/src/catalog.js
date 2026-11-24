
/**
 * KubeShop - Catálogo de Produtos
 *
 * Responsabilidades:
 * - Definir os produtos disponíveis na loja.
 * - Disponibilizar os dados para a API.
 * - Validar os itens enviados pelo frontend.
 * - Calcular o valor total dos pedidos fictícios.
 *
 * O catálogo é mantido na aplicação e não é consultado
 * no MongoDB, conforme o escopo do projeto.
 */

/**
 * Catálogo de produtos.
 *
 * Os valores monetários são armazenados em centavos
 * para evitar problemas de precisão com números decimais.
 *
 * Exemplo:
 * 18990 = R$ 189,90
 */

export const products = Object.freeze([
  Object.freeze({
    id: "headphones",
    name: "Headphone Orbit",
    category: "Áudio",
    description: "Seu foco em outra frequência.",
    priceCents: 18990,
    originalPriceCents: 29990,
    illustration: "headphones",
    color: "lavender",
  }),

  Object.freeze({
    id: "keyboard",
    name: "Teclado Flow",
    category: "Setup",
    description: "Uma boa ideia começa com um toque.",
    priceCents: 24990,
    originalPriceCents: 39990,
    illustration: "keyboard",
    color: "mint",
  }),

  Object.freeze({
    id: "monitor",
    name: "Monitor Horizon",
    category: "Setup",
    description: "Mais espaço para o próximo projeto.",
    priceCents: 89990,
    originalPriceCents: 129990,
    illustration: "monitor",
    color: "peach",
  }),

  Object.freeze({
    id: "backpack",
    name: "Mochila Deploy",
    category: "Essenciais",
    description: "Leve suas ideias para qualquer lugar.",
    priceCents: 15990,
    originalPriceCents: 22990,
    illustration: "backpack",
    color: "sky",
  }),

  Object.freeze({
    id: "mouse",
    name: "Mouse Vector",
    category: "Setup",
    description: "Precisão para explorar novos caminhos.",
    priceCents: 9990,
    originalPriceCents: 16990,
    illustration: "mouse",
    color: "peach",
  }),

  Object.freeze({
    id: "speaker",
    name: "Speaker Echo",
    category: "Áudio",
    description: "O som que acompanha o seu ritmo.",
    priceCents: 12990,
    originalPriceCents: 19990,
    illustration: "speaker",
    color: "mint",
  }),
]);

/**
 * Limites para validação dos pedidos.
 */
const ORDER_LIMITS = Object.freeze({
  minItems: 1,
  maxItems: 20,
  minQuantity: 1,
  maxQuantity: 10,
});

/**
 * Valida os dados de um pedido enviado pelo frontend.
 *
 * Formato esperado:
 *
 * {
 *   "items": [
 *     {
 *       "productId": "headphones",
 *       "quantity": 2
 *     }
 *   ]
 * }
 *
 * Regras:
 * - O pedido deve ser um objeto válido.
 * - Deve conter entre 1 e 20 itens.
 * - O produto precisa existir no catálogo.
 * - A quantidade deve ser um número inteiro entre 1 e 10.
 * - Não são permitidos produtos repetidos no mesmo pedido.
 *
 * IMPORTANTE:
 * O preço nunca é recebido do frontend.
 * O valor utilizado no cálculo é sempre o preço
 * definido neste catálogo da API.
 *
 * @param {Object} body Dados enviados pelo frontend.
 * @returns {Object} Pedido validado e calculado.
 * @throws {Error} Quando os dados não forem válidos.
 */
export function validateOrder(body) {
  /**
   * Verifica se o corpo da requisição é válido.
   */
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Array.isArray(body.items) ||
    body.items.length < ORDER_LIMITS.minItems ||
    body.items.length > ORDER_LIMITS.maxItems
  ) {
    throw new Error(
      "Informe de 1 a 20 itens no pedido."
    );
  }

  /**
   * Impede que o mesmo produto seja incluído
   * mais de uma vez no pedido.
   */
  const seen = new Set();

  /**
   * Valida e normaliza cada item do pedido.
   */
  const items = body.items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      throw new Error("Item inválido.");
    }

    /**
     * Localiza o produto no catálogo oficial.
     */
    const product = products.find(
      (product) => product.id === item.productId
    );

    /**
     * Verifica a existência do produto,
     * a quantidade e a duplicidade.
     */
    if (
      !product ||
      !Number.isInteger(item.quantity) ||
      item.quantity < ORDER_LIMITS.minQuantity ||
      item.quantity > ORDER_LIMITS.maxQuantity ||
      seen.has(item.productId)
    ) {
      throw new Error(
        "Produto inexistente, repetido ou quantidade fora de 1–10."
      );
    }

    /**
     * Registra o produto para impedir duplicidade.
     */
    seen.add(item.productId);

    /**
     * Retorna somente os dados necessários
     * para registrar o item no pedido.
     */
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
    };
  });

  /**
   * Calcula o valor total utilizando
   * exclusivamente os preços do catálogo.
   */
  const totalCents = items.reduce(
    (sum, item) => {
      return sum + item.quantity * item.unitPriceCents;
    },
    0
  );

  /**
   * Retorna o pedido validado.
   *
   * O pedido é fictício e não representa
   * uma transação financeira real.
   */
  return {
    items,
    totalCents,
    status: "confirmed",
    fictional: true,
  };
}