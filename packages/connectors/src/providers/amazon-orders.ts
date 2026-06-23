import type { ConnectorModule, ConnectorSetup, ConnectorSyncOptions, ConnectorSyncPayload } from "../types.js";
import { emptyPayload, fixturePath, readJsonFile, setupState, stringField } from "../util.js";

interface AmazonFixture {
  orders: Array<{
    id: string;
    date: string;
    total: number;
    currency?: string;
    status?: string;
    items: Array<{
      id: string;
      name: string;
      quantity?: number;
      unitPrice?: number;
      totalPrice?: number;
      category?: string;
    }>;
  }>;
}

export const amazonOrdersConnector: ConnectorModule = {
  definition: {
    id: "amazon-orders",
    name: "Amazon orders",
    category: "shopping",
    status: "available",
    summary: "Imports itemized Amazon order history from a local desktop session or receipt fixture without storing Amazon credentials.",
    capabilities: ["merchant_orders", "order_items", "transaction_order_matching"],
    setupFields: [{ name: "localSession", label: "Local browser session", kind: "local_session", required: true }]
  },
  buildSetup(options = {}): ConnectorSetup {
    return {
      provider: "amazon_orders",
      providerItemId: options.providerItemId ?? "local-session",
      connectorId: "amazon-orders",
      displayName: options.displayName ?? "Amazon orders",
      status: "healthy",
      setupState: {
        fixturePath: options.fixturePath,
        mode: options.demo ? "demo_fixture" : "local_session_or_receipts"
      }
    };
  },
  async sync(connection, options: ConnectorSyncOptions = {}): Promise<ConnectorSyncPayload> {
    const state = setupState(connection);
    const syncedAt = options.now ?? new Date().toISOString();
    const filePath = options.fixturePath ?? stringField(state.fixturePath, fixturePath("amazon-orders.json"));
    const fixture = await readJsonFile<AmazonFixture>(filePath);
    const payload = emptyPayload(connection, "amazon_orders", syncedAt);

    payload.orders = fixture.orders.map((order) => ({
      orderId: `amazon:${order.id}`,
      connectionId: connection.connectionId,
      providerOrderId: order.id,
      merchantName: "Amazon",
      orderDate: order.date,
      totalAmount: order.total,
      currency: order.currency ?? "USD",
      status: order.status ?? "shipped",
      rawProviderPayload: { id: order.id, date: order.date, total: order.total },
      items: order.items.map((item) => ({
        orderItemId: `amazon:${order.id}:${item.id}`,
        name: item.name,
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? null,
        totalPrice: item.totalPrice ?? null,
        category: item.category ?? null,
        rawProviderPayload: { id: item.id }
      }))
    }));

    return payload;
  }
};
