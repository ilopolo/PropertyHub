export const ticketStatuses = Object.freeze({new:'Нов',accepted:'Приет',in_progress:'В работа',completed:'Приключен'});
export function nextTicketStatus(status){return {new:'accepted',accepted:'in_progress',in_progress:'completed',completed:'in_progress'}[status] || null;}
export function ticketContent(title,description){
 const value={title:String(title??'').trim(),description:String(description??'').trim()};
 if(!value.title || [...value.title].length>160 || !value.description || [...value.description].length>4000)throw Error('Въведи заглавие до 160 и описание до 4000 знака.');
 return value;
}
