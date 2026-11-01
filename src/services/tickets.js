import {getClient,unwrap} from './supabase.js';
import {ticketContent} from '../domain/tickets.js';
export async function createTicket(unit,title,description){return unwrap(await getClient().rpc('create_ticket',{unit,...ticketContent(title,description)}));}
export async function ticketFeed(){return unwrap(await getClient().rpc('ticket_feed'));}
export async function changeTicketStatus(ticket,nextStatus,note){return unwrap(await getClient().rpc('change_ticket_status',{item:ticket.id,expected_revision:ticket.revision,next_status:nextStatus,note}));}
