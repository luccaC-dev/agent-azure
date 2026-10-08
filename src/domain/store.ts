import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Customer {
  id: string;
  name: string;
  phone: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: 'placed' | 'shipped' | 'delivered' | 'cancelled';
  placedAt: string;
  shippedAt?: string;
  deliveredAt?: string;
  carrier?: string;
  trackingNumber?: string;
  total: number;
  refunded: number;
  items: OrderItem[];
}

export interface StoreData {
  asOf: string;
  customers: Customer[];
  orders: Order[];
}

/** In-memory store. The demo data is fictional; a real deployment would put a database behind the same methods. */
export class Store {
  private readonly customers: Map<string, Customer>;
  private readonly orders: Map<string, Order>;

  constructor(data: StoreData) {
    this.customers = new Map(data.customers.map((c) => [c.id, { ...c }]));
    this.orders = new Map(data.orders.map((o) => [o.id, { ...o, items: o.items.map((i) => ({ ...i })) }]));
  }

  static fromFile(path = join(__dirname, '..', '..', 'data', 'store.json')): { store: Store; asOf: Date } {
    const data = JSON.parse(readFileSync(path, 'utf8')) as StoreData;
    return { store: new Store(data), asOf: new Date(data.asOf) };
  }

  customer(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  customerByPhone(phone: string): Customer | undefined {
    return [...this.customers.values()].find((c) => c.phone === phone);
  }

  /** Orders are only ever returned for their owner. Callers never get a way to probe other customers' orders. */
  orderFor(customerId: string, orderId: string): Order | undefined {
    const order = this.orders.get(orderId.trim().toUpperCase());
    return order && order.customerId === customerId ? order : undefined;
  }

  ordersFor(customerId: string): Order[] {
    return [...this.orders.values()].filter((o) => o.customerId === customerId);
  }

  recordRefund(orderId: string, amount: number): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`unknown order ${orderId}`);
    order.refunded = round2(order.refunded + amount);
    return order;
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
