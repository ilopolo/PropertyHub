import {ticketFiles,uploadTicketFile,downloadTicketFile,removeTicketFile} from '../services/ticket-files.js';
import {renderTicketFiles} from '../ui/ticket-files.js';
export function mountTicketFiles(body,ticket){
 const root=document.createElement('section');root.className='mt-4 border-top pt-3';root.dataset.item=ticket.id;body.append(root);
 const refresh=async()=>{try{renderTicketFiles(root,await ticketFiles(ticket.id),actions);}catch{renderTicketFiles(root,null,actions);}};
 const actions={refresh,
  async upload(file){try{await uploadTicketFile(ticket.id,file);}finally{await refresh();}},
  async remove(d,note){try{await removeTicketFile(d,note);}finally{await refresh();}},
  async download(d){
   try{const blob=await downloadTicketFile(d),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=d.original_filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   catch(error){await refresh();throw error;}
  }
 };
 return refresh();
}
