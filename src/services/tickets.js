import {getClient,unwrap} from './supabase.js';
import {ticketContent} from '../domain/tickets.js';
import {ticketHandling} from '../domain/ticket-handling.js';
export async function createTicket(unit,title,description){return unwrap(await getClient().rpc('create_ticket',{unit,...ticketContent(title,description)}));}
export async function ticketFeed(){return unwrap(await getClient().rpc('ticket_feed'));}
export async function changeTicketStatus(ticket,nextStatus,note){return unwrap(await getClient().rpc('change_ticket_status',{item:ticket.id,expected_revision:ticket.revision,next_status:nextStatus,note}));}
export async function ticketAssignees(item){return unwrap(await getClient().rpc('ticket_assignees',{item}));}
export async function updateTicketHandling(ticket,category,assignee,note){return unwrap(await getClient().rpc('update_ticket_handling',{item:ticket.id,expected_revision:ticket.revision,...ticketHandling(category,assignee,note)}));}
