
import { MongoClient } from "mongodb";

/**
 * Repositório responsável pela persistência dos pedidos do KubeShop.
 *
 * O catálogo de produtos não é armazenado no MongoDB.
 * Esta classe trabalha exclusivamente com a coleção "orders".
 *
 * Responsabilidades:
 * - Conectar ao MongoDB.
 * - Verificar a disponibilidade do banco.
 * - Gravar pedidos confirmados pela API.
 * - Consultar o histórico de pedidos.
 * - Encerrar a conexão com o banco.
 */
export class MongoOrderRepository {
  constructor(config) {
    if (!config?.mongoUri) {
      throw new Error("A URI de conexão do MongoDB não foi configurada");
    }

    if (!config?.database) {
      throw new Error("O nome do banco de dados não foi configurado");
    }

    this.client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 1500,
      connectTimeoutMS: 1500,
      maxPoolSize: 10,
    });

    // Utiliza uma única instância do banco de dados.
    this.db = this.client.db(config.database);

    // Coleção exclusiva para armazenar os pedidos.
    this.collection = this.db.collection("orders");

    this.connected = false;
  }

  /**
   * Estabelece a conexão com o MongoDB e prepara a coleção.
   *
   * O índice facilita a consulta dos pedidos mais recentes.
   */
  async connect() {
    if (this.connected) {
      return;
    }

    await this.client.connect();

    await this.collection.createIndex(
      { createdAt: -1 },
      {
        name: "orders_createdAt_desc",
      }
    );

    this.connected = true;
  }

  /**
   * Verifica se o MongoDB está respondendo.
   *
   * Utilizado pela rota GET /api/health/ready
   * para verificar a disponibilidade do banco.
   *
   * @returns {Promise<boolean>}
   */
  async ping() {
    await this.db.command(
      { ping: 1 },
      { timeoutMS: 1500 }
    );

    return true;
  }

  /**
   * Grava um novo pedido na coleção "orders".
   *
   * O pedido já deve ter sido validado pela API,
   * utilizando a função validateOrder() do catalog.js.
   *
   * @param {Object} order Pedido validado.
   * @returns {Promise<Object>} Pedido salvo com identificador.
   */
  async create(order) {
    if (
      !order ||
      typeof order !== "object" ||
      Array.isArray(order)
    ) {
      throw new Error("Não foi possível gravar um pedido inválido");
    }

    // Cria uma cópia para evitar alterações no objeto recebido.
    const document = {
      ...order,
      items: Array.isArray(order.items)
        ? order.items.map((item) => ({ ...item }))
        : order.items,
    };

    const { insertedId } = await this.collection.insertOne(
      document,
      {
        timeoutMS: 3000,
        writeConcern: {
          w: 1,
          j: true,
        },
      }
    );

    // Retorna o pedido com o ID gerado pelo MongoDB.
    return {
      ...document,
      id: insertedId.toString(),
    };
  }

  /**
   * Consulta o histórico de pedidos.
   *
   * Os pedidos mais recentes são apresentados primeiro.
   * A consulta é limitada aos últimos 100 registros.
   *
   * @returns {Promise<Array<Object>>}
   */
  async list() {
    const orders = await this.collection
      .find(
        {},
        {
          timeoutMS: 3000,
        }
      )
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(100)
      .toArray();

    // Converte o ObjectId do MongoDB para uma string.
    return orders.map(({ _id, ...order }) => ({
      ...order,
      id: _id.toString(),
    }));
  }

  /**
   * Encerra a conexão com o MongoDB.
   *
   * Deve ser utilizado durante o encerramento da API.
   */
  async close() {
    await this.client.close();
    this.connected = false;
  }
}