export const ticketCategoryCodes=Object.freeze(['common_repairs','elevator','electrical_lighting','plumbing','cleaning_hygiene','access_security','garden_landscaping','administration','other']);
export function ticketHandling(category,assignee,note){
 const value={category:category===''||category==null?null:category,assignee:assignee===''||assignee==null?null:assignee,note:typeof note==='string'?note.trim():''};
 if(value.category!==null&&!ticketCategoryCodes.includes(value.category))throw Error('Избери допустима категория.');
 if(value.assignee!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.assignee))throw Error('Избери допустим получател.');
 if(!value.note||[...value.note].length>1000)throw Error('Въведи причина до 1000 знака.');return value;
}
