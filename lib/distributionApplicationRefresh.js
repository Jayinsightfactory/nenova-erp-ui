async function readApplicationChannel({label,url,signal,fetchImpl,validate,isCurrent,apply,errorMessage}) {
  try {
    const response=await fetchImpl(url,{signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!validate(data))throw new Error(errorMessage(data,`${label} 응답 형식이 올바르지 않습니다.`));
    if(isCurrent())apply(data);
    return {label,ok:true};
  } catch(error) {
    return {label,ok:false,error};
  }
}

module.exports={readApplicationChannel};
