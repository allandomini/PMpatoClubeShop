
const API_BASE_URL = "/api";
const REQUEST_TIMEOUT_MS = 6000;

/**
 * Normaliza o caminho para evitar barras duplicadas
 * e impedir a repetição do prefixo /api.
 */
function normalizePath(path) {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("O caminho da API é inválido.");
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (
    normalized === API_BASE_URL ||
    normalized.startsWith(`${API_BASE_URL}/`)
  ) {
    return normalized;
  }

  return `${API_BASE_URL}${normalized}`;
}

/**
 * Realiza uma requisição HTTP para a API do KubeShop.
 *
 * @param {string} path - Caminho do endpoint.
 * @param {RequestInit} options - Opções da requisição fetch.
 * @returns {Promise<any>} Dados retornados pela API.
 */
export async function request(path, options = {}) {
  const url = normalizePath(path);

  const headers = new Headers(options.headers || {});

  headers.set("Accept", "application/json");

  // O Content-Type é necessário quando enviamos um corpo JSON.
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const signal =
    options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal,
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(
        "A requisição demorou muito para responder. Tente novamente."
      );
    }

    if (error.name === "AbortError") {
      throw new Error("A requisição foi cancelada.");
    }

    throw new Error(
      "Não foi possível estabelecer comunicação com a API do KubeShop."
    );
  }

  let data = null;

  try {
    const responseText = await response.text();

    if (responseText) {
      data = JSON.parse(responseText);
    }
  } catch {
    if (response.ok) {
      throw new Error("A API retornou uma resposta inválida.");
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `A API respondeu com o erro HTTP ${response.status}.`
    );
  }

  return data;
}