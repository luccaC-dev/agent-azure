export type TicketCategory = 'shipping' | 'warranty' | 'account' | 'other';

export interface Ticket {
  id: string;
  customerId: string;
  category: TicketCategory;
  summary: string;
  orderId?: string;
  createdAt: string;
}

export class TicketDesk {
  private readonly tickets: Ticket[] = [];

  constructor(private readonly clock: () => Date) {}

  open(input: Omit<Ticket, 'id' | 'createdAt'>): Ticket {
    const ticket: Ticket = { id: `T-${1000 + this.tickets.length + 1}`, createdAt: this.clock().toISOString(), ...input };
    this.tickets.push(ticket);
    return ticket;
  }

  all(): Ticket[] {
    return [...this.tickets];
  }
}
