
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import App, { money } from "./App.jsx";

// Simula a função responsável pelas requisições HTTP.
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock("./api.js", () => ({
  request: requestMock,
}));

// O desenho dos produtos não é o foco destes testes.
vi.mock("./ProductArt.jsx", () => ({
  default: () => null,
}));

const product = {
  id: "headphones",
  name: "Headphone Orbit",
  category: "Áudio",
  description: "Seu foco.",
  priceCents: 18990,
  originalPriceCents: 29990,
  illustration: "headphones",
  color: "lavender",
};

const order = {
  id: "abc123456",
  items: [
    {
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPriceCents: product.priceCents,
    },
  ],
  totalCents: product.priceCents,
  createdAt: "2026-10-19T10:00:00Z",
};

// Configura as respostas simuladas da API.
function configureSuccessfulApi() {
  requestMock.mockImplementation(async (path, options = {}) => {
    if (path === "/health/ready") {
      return { status: "ready" };
    }

    if (path === "/products") {
      return {
        products: [product],
      };
    }

    if (path === "/orders" && options.method === "POST") {
      return {
        order,
      };
    }

    if (path === "/orders") {
      return {
        orders: [],
      };
    }

    throw new Error(`Rota não simulada: ${path}`);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  configureSuccessfulApi();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("KubeShop - frontend", () => {
  it("formata corretamente os valores monetários", () => {
    expect(money(18990)).toMatch(/189,90/);
    expect(money(29990)).toMatch(/299,90/);
    expect(money(0)).toMatch(/0,00/);
  });

  it("carrega o catálogo e verifica a disponibilidade da loja", async () => {
    render(<App />);

    expect(
      await screen.findByText("Headphone Orbit"),
    ).toBeInTheDocument();

    expect(
      await screen.findByText("Loja disponível"),
    ).toBeInTheDocument();

    expect(requestMock).toHaveBeenCalledWith("/products");
    expect(requestMock).toHaveBeenCalledWith("/orders");
    expect(requestMock).toHaveBeenCalledWith("/health/ready");
  });

  it("filtra os produtos por categoria", async () => {
    render(<App />);

    expect(
      await screen.findByText("Headphone Orbit"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Setup",
        exact: true,
      }),
    );

    expect(
      screen.queryByText("Headphone Orbit"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Todos",
        exact: true,
      }),
    );

    expect(
      screen.getByText("Headphone Orbit"),
    ).toBeInTheDocument();
  });

  it("adiciona produtos à sacola e calcula o total", async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Adicionar Headphone Orbit",
      }),
    );

    expect(screen.getByText("1 × R$ 189,90")).toBeInTheDocument();
    expect(screen.getByText("R$ 189,90")).toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: /Confirmar pedido fictício/,
      }),
    ).toBeEnabled();
  });

  it("cria um pedido, limpa a sacola e atualiza o histórico", async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Adicionar Headphone Orbit",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Confirmar pedido fictício/,
      }),
    );

    expect(
      await screen.findByText(/Pedido #123456 confirmado/),
    ).toBeInTheDocument();

    // Confirma o envio dos identificadores e quantidades à API.
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/orders",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                productId: "headphones",
                quantity: 1,
              },
            ],
          }),
        }),
      );
    });

    // Consulta o histórico atualizado.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Meus pedidos",
      }),
    );

    expect(
      await screen.findByText("Pedido #123456"),
    ).toBeInTheDocument();

    expect(
      screen.getByText("Headphone Orbit"),
    ).toBeInTheDocument();

    // A sacola deve estar vazia após a confirmação.
    expect(
      screen.getByRole("button", {
        name: /Confirmar pedido fictício/,
      }),
    ).toBeDisabled();
  });

  it("exibe mensagem quando a API está indisponível", async () => {
    requestMock.mockRejectedValue(
      new Error("Loja indisponível no teste."),
    );

    render(<App />);

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Loja indisponível no teste.");

    expect(
      await screen.findByText("Loja indisponível"),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: "Tentar novamente",
      }),
    ).toBeEnabled();
  });

  it("preserva os produtos na sacola quando a confirmação falha", async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Adicionar Headphone Orbit",
      }),
    );

    requestMock.mockImplementation(async (path, options = {}) => {
      if (path === "/orders" && options.method === "POST") {
        throw new Error("Banco indisponível.");
      }

      if (path === "/health/ready") {
        return { status: "ready" };
      }

      if (path === "/products") {
        return { products: [product] };
      }

      if (path === "/orders") {
        return { orders: [] };
      }

      throw new Error(`Rota não simulada: ${path}`);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Confirmar pedido fictício/,
      }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Banco indisponível.");

    // O produto continua na sacola.
    expect(
      screen.getByText("1 × R$ 189,90"),
    ).toBeInTheDocument();

    // O usuário pode tentar novamente.
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Confirmar pedido fictício/,
        }),
      ).toBeEnabled();
    });
  });

  it("permite remover produtos da sacola", async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Adicionar Headphone Orbit",
      }),
    );

    expect(
      screen.getByText("1 × R$ 189,90"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remover uma unidade de Headphone Orbit",
      }),
    );

    expect(
      screen.queryByText("1 × R$ 189,90"),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: /Confirmar pedido fictício/,
      }),
    ).toBeDisabled();
  });
});