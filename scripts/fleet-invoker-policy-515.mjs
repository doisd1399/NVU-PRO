export function publicFleetInvokerPolicy(current){
 if(!current||typeof current!=='object'||Array.isArray(current)||(current.bindings!==undefined&&!Array.isArray(current.bindings)))throw Error('INVALID_IAM_POLICY');
 const policy=structuredClone(current);policy.bindings||=[];
 for(const b of policy.bindings)if(typeof b.role!=='string'||!Array.isArray(b.members)||b.members.some(x=>typeof x!=='string'))throw Error('INVALID_IAM_BINDING');
 const role='roles/cloudfunctions.invoker',binding=policy.bindings.find(x=>x.role===role&&!x.condition);
 if(binding?.members.includes('allUsers'))return{changed:false,policy};
 if(binding)binding.members.push('allUsers');else policy.bindings.push({role,members:['allUsers']});
 policy.version=Math.max(3,Number(policy.version)||0);return{changed:true,policy};
}
