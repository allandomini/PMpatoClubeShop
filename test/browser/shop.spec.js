import { test, expect } from "@playwright/test";

/**
 * KubeShop - Fluxo de compra no navegador
 *
 * Cobre o critério de aceite ACE-04: acesso à loja, catálogo
 * carregado, pedido fictício criado e consultado após recarregar
 * o navegador (o pedido vem do MongoDB, não da memória da página).
 */

test.describe("KubeShop - loja", () => {
  test("carrega a loja e o catálogo sem erros no console", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");

    await expect(page).toHaveTitle(/KubeShop/i);
    await expect(
      page.getByRole("button", { name: /^Adicionar / }).first(),
    ).toBeVisible();

    // Nenhum erro de JavaScript nem bloqueio da Content-Security-Policy.
    expect(errors).toEqual([]);
  });

  test("cria um pedido e o encontra no histórico após recarregar", async ({ page }) => {
    await page.goto("/");

    // Adiciona o primeiro produto do catálogo à sacola.
    const addButton = page.getByRole("button", { name: /^Adicionar / }).first();
    await expect(addButton).toBeVisible();
    const productName = (await addButton.getAttribute("aria-label")).replace(/^Adicionar /, "");
    await addButton.click();

    const bag = page.getByRole("complementary", { name: "Sua sacola" });
    await expect(bag.getByText(productName)).toBeVisible();

    // Confirma o pedido fictício.
    const confirm = bag.getByRole("button", { name: /Confirmar pedido fictício/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const notice = page.getByText(/Pedido #\w+ confirmado/);
    await expect(notice).toBeVisible();
    const orderCode = (await notice.textContent()).match(/Pedido #(\w+)/)[1];

    // A sacola é esvaziada após o sucesso.
    await expect(confirm).toBeDisabled();

    // Recarrega a página: o pedido precisa vir do banco.
    await page.reload();

    await page
      .getByRole("navigation", { name: "Navegação principal" })
      .getByRole("button", { name: "Meus pedidos" })
      .click();

    await expect(page.getByText(`Pedido #${orderCode}`, { exact: true })).toBeVisible();
  });
});
