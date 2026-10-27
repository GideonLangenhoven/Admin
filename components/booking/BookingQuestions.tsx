import { useEffect, useState } from "react";
import BookingSelect from "./BookingSelect";
import {questionInputId, questionErrorKey, type BookingQuestion, type QuestionAnswer, type QuestionAnswers} from "../../supabase/functions/_shared/booking-custom-fields";

export function BookingQuestions({questions,answers,qty,invalidKey,onChange}:{questions:BookingQuestion[];answers:QuestionAnswers;qty:number;invalidKey:string|null;onChange:(answers:QuestionAnswers)=>void}){
 const [page,setPage]=useState(0);
 const lastPage=Math.max(0,Math.ceil(qty/50)-1);
 const currentPage=Math.min(page,lastPage);
 useEffect(()=>{const match=invalidKey?.match(/:(\d+)$/);if(match)setPage(Math.floor(Number(match[1])/50));},[invalidKey]);
 return <div className="mt-4 grid gap-4">{qty>50 && questions.some(question=>question.scope==="participant") && <nav className="flex flex-wrap items-center gap-3" aria-label="Participant details">
  <button type="button" className="ui-btn ui-btn-soft" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous guests</button>
  <span>Guests {currentPage*50+1}–{Math.min(qty,(currentPage+1)*50)} of {qty}</span>
  <button type="button" className="ui-btn ui-btn-soft" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Next guests</button>
 </nav>}{questions.flatMap(question=>{
  const participants=question.scope==="participant"?Array.from({length:Math.max(0,Math.min(50,qty-currentPage*50))},(_,i)=>i+currentPage*50):[null];
  return participants.map(participant=>{
   const id=questionInputId(question.key,participant),label=(participant===null?"":"Guest "+(participant+1)+": ")+question.label;
   const raw=participant===null?answers[question.key]:Array.isArray(answers[question.key])?answers[question.key][participant]:"";
   const multiple=question.type==="multiselect"||(question.type==="checkbox"&&question.options.length>0);
   const value:QuestionAnswer=Array.isArray(raw)?[...raw].filter((item):item is string=>typeof item==="string"):typeof raw==="string"?raw:"";
   const update=(answer:QuestionAnswer)=>{const next={...answers};if(participant===null)next[question.key]=answer;else{const values=Array.isArray(answers[question.key])?[...answers[question.key]]:[];values[participant]=answer;next[question.key]=values;}onChange(next);};
   const invalid=invalidKey===`custom_${questionErrorKey(question.key,participant)}`;
   const props={id,"aria-invalid":invalid||undefined,"aria-required":question.required,className:"ui-control mt-1.5 w-full px-3 py-3"};
   return <div key={id}><label htmlFor={id} className="text-sm font-medium">{label}{question.required?" *":""}</label>
    {multiple?<fieldset id={id} aria-label={label} aria-invalid={invalid||undefined} className="mt-2 flex flex-wrap gap-4">{question.options.map(option=><label key={option.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Array.isArray(value)&&value.includes(option.value)} onChange={e=>update(e.target.checked?[...(Array.isArray(value)?value:[]),option.value]:(Array.isArray(value)?value:[]).filter(item=>item!==option.value))}/>{option.label}</label>)}</fieldset>
    :question.type==="select"||question.type==="radio"||question.type==="checkbox"?<BookingSelect id={id} label={label} error={invalid} required={question.required} value={typeof value==="string"?value:""} onChange={update} placeholder="Choose an answer" options={[{id:"",name:"Choose an answer"},...(question.type==="checkbox"?[{value:"true",label:"Yes"},{value:"false",label:"No"}]:question.options).map(option=>({id:option.value,name:option.label}))]} />
    :question.type==="textarea"?<textarea {...props} rows={3} maxLength={4000} placeholder={question.placeholder} value={typeof value==="string"?value:""} onChange={e=>update(e.target.value)}/>
    :<input {...props} type={question.type==="number"?"number":question.type==="date"?"date":"text"} step={question.type==="number"?"any":undefined} maxLength={4000} placeholder={question.placeholder} value={typeof value==="string"?value:""} onChange={e=>update(e.target.value)}/>}
   </div>;
  });
 })}</div>;
}
