
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Limpa o ambiente de testes após cada teste.
 *
 * Isso evita que componentes renderizados, eventos ou estados
 * de um teste interfiram na execução dos testes seguintes.
 */
afterEach(() => {
  cleanup();
});