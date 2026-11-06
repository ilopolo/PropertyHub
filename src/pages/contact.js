import './main.js';
const form=document.querySelector('#contact-demo'),result=document.querySelector('#contact-result'),button=document.querySelector('#contact-preview');
form.addEventListener('submit',e=>e.preventDefault());button.disabled=false;
button.addEventListener('click',()=>{if(!form.reportValidity())return;result.replaceChildren();const title=document.createElement('p');title.className='alert alert-secondary';title.textContent='Само локален преглед — съобщението не е изпратено и не е запазено.';const topic=document.createElement('h3');topic.className='h5';topic.textContent=document.querySelector('#contact-topic').selectedOptions[0].textContent;const text=document.createElement('p');text.className='text-break';text.textContent=document.querySelector('#contact-message').value;result.append(title,topic,text);result.hidden=false;});
form.addEventListener('reset',()=>{result.replaceChildren();result.hidden=true;});
