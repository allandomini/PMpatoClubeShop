
/**
 * Catálogo oficial de produtos do KubeShop.
 *
 * O catálogo é mantido diretamente na API, conforme o escopo
 * do projeto. Não existe consulta ao MongoDB para carregar produtos.
 *
 * Os preços são armazenados em centavos para evitar problemas
 * de precisão com valores monetários.
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
 * Limites permitidos para a criação de pedidos.
 */
const ORDER_LIMITS = Object.freeze({
  minItems: 1,
  maxItems: 20,
  minQuantity: 1,
  maxQuantity: 10,
});

/**
 * Cria um erro de validação HTTP 400.
 */
function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * Valida os itens enviados pelo frontend e calcula o valor
 * utilizando exclusivamente os preços oficiais do catálogo.
 *
 * Formato esperado:
 *
 * {
 *   items: [
 *     {
 *       productId: "headphones",
 *       quantity: 2
 *     }
 *   ]
 * }
 *
 * O preço enviado pelo frontend, caso exista, é ignorado.
 *
 * @param {Object} body Dados recebidos na requisição.
 * @returns {Object} Pedido validado e normalizado.
 */
export function validateOrder(body) {
  // Verifica se o corpo da requisição é um objeto válido.
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw validationError("Dados do pedido inválidos");
  }

  // Verifica se existe uma lista de produtos.
  if (!Array.isArray(body.items)) {
    throw validationError("A lista de itens do pedido é obrigatória");
  }

  // Verifica a quantidade de itens enviados.
  if (
    body.items.length < ORDER_LIMITS.minItems ||
    body.items.length > ORDER_LIMITS.maxItems
  ) {
    throw validationError(
      `O pedido deve possuir entre ${ORDER_LIMITS.minItems} e ${ORDER_LIMITS.maxItems} itens`
    );
  }

  const validatedItems = [];
  const addedProducts = new Set();

  let totalCents = 0;

  // Valida individualmente cada item do pedido.
  for (const item of body.items) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      throw validationError("Item do pedido inválido");
    }

    const { productId, quantity } = item;

    // Verifica se o identificador do produto foi informado.
    if (
      typeof productId !== "string" ||
      productId.trim().length === 0
    ) {
      throw validationError("Identificador do produto inválido");
    }

    // Procura o produto no catálogo oficial da API.
    const product = products.find(
      (product) => product.id === productId
    );

    if (!product) {
      throw validationError(
        `Produto não encontrado: ${productId}`
      );
    }

    // Verifica se a quantidade é um número inteiro permitido.
    if (
      !Number.isInteger(quantity) ||
      quantity < ORDER_LIMITS.minQuantity ||
      quantity > ORDER_LIMITS.maxQuantity
    ) {
      throw validationError(
        `Quantidade inválida para o produto ${product.name}`
      );
    }

    // Impede que o mesmo produto seja repetido na lista.
    if (addedProducts.has(productId)) {
      throw validationError(
        `O produto ${product.name} foi informado mais de uma vez`
      );
    }

    addedProducts.add(productId);

    // Calcula o subtotal usando o preço oficial da API.
    const subtotalCents = product.priceCents * quantity;

    if (!Number.isSafeInteger(subtotalCents)) {
      throw validationError("Valor do pedido inválido");
    }

    totalCents += subtotalCents;

    // Armazena somente os dados necessários para o pedido.
    validatedItems.push({
      productId: product.id,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
    });
  }

  // Verifica se o total calculado é um número seguro.
  if (!Number.isSafeInteger(totalCents)) {
    throw validationError("Total do pedido inválido");
  }

  // Retorna o pedido validado.
  return {
    items: validatedItems,
    totalCents,
    status: "confirmed",
    fictional: true,
  };
}